/**
 * ai_assistant.tools.js
 * ------------------------------------------------------------------
 * بوابة وصول الموديل الذكي إلى قاعدة البيانات.
 *
 * الجديد في هذه النسخة:
 * كل أداة بحث بترجع نسختين من نفس النتيجة:
 *   1) result : نص/بيانات مختصرة تُرسَل للموديل (بدون صور ولا IDs)
 *              حتى لا نستهلك توكنز ولا نسرّب تفاصيل لا يحتاجها.
 *   2) cards  : بيانات عرض للواجهة فقط (صورة، سعر، خصم، رابط المنتج)
 *              تُرسَل مباشرة للمتصفح ولا تمر على الموديل إطلاقًا.
 *
 * قاعدة أمنية أساسية (كما هي):
 * الموديل لا يلمس Mongo مباشرة أبدًا، ولا يمرر فلتر خام، ولا يختار
 * Collection. كل الحقول المرتجعة عبر "قائمة سماح" صريحة (select).
 * الـ Collections المسموح بها هنا فقط: products, section, store.
 * ------------------------------------------------------------------
 */

const products = require("../models/products");
const section = require("../models/section");
const store = require("../models/store");
const config = require("../config/ai_assistant.config");

// ====================================================================
// أدوات مساعدة للأمان
// ====================================================================

function escapeRegex(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampNumber(value, { min, max, fallback }) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function safeString(value, maxLength = 120) {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// قائمة السماح الوحيدة للحقول اللي ممكن ترجع عن أي منتج.
// _id و images مطلوبين لعرض الكارت والرابط في الواجهة فقط.
// ملاحظة: في موديل products الحقل اسمه "images" وهو مصفوفة [String]،
// مش "image" — ولذلك بناخد أول عنصر فيها لصورة الكارت.
const PRODUCT_PUBLIC_FIELDS =
    "_id name description price final_price discount quantity section images";

const SECTION_PUBLIC_FIELDS = "name description slug";

const STORE_PUBLIC_FIELDS =
    "store_name store_description store_phone store_whatsApp_number store_GPS";

function toPublicStore(s) {
    if (!s) return null;
    return {
        name: safeString(s.store_name, 120),
        description: safeString(s.store_description, 300),
        phone: safeString(s.store_phone, 30),
        whatsapp: safeString(s.store_whatsApp_number, 30),
        location: safeString(s.store_GPS, 150),
    };
}

/**
 * نسخة الموديل: نص فقط، بدون صور ولا معرّفات.
 */
function toPublicProduct(p) {
    if (!p) return null;

    const inStock =
        typeof p.quantity === "number" ? p.quantity > 0 : undefined;

    return {
        name: safeString(p.name, 120) || "منتج",
        description: safeString(p.description, 220),
        price: p.price ?? null,
        final_price: p.final_price > 0 ? p.final_price : (p.price ?? null),
        discount: p.discount || 0,
        section: p.section && p.section.name ? safeString(p.section.name, 60) : null,
        in_stock: inStock,
    };
}

/**
 * نسخة الواجهة: كارت منتج جاهز للعرض (صورة/سعر/خصم/رابط).
 * لا تصل هذه البيانات للموديل إطلاقًا.
 */
function toProductCard(p) {
    if (!p) return null;

    const price = safeNumber(p.price);
    // final_price افتراضيها 0 في الموديل، فبنعتبر الصفر "غير محدد"
    const rawFinal = safeNumber(p.final_price);
    const finalPrice = rawFinal && rawFinal > 0 ? rawFinal : price;
    const discount = safeNumber(p.discount) || 0;

    const firstImage = Array.isArray(p.images)
        ? p.images.find(img => typeof img === "string" && img.trim())
        : p.images;

    return {
        id: p._id ? String(p._id) : null,
        name: safeString(p.name, 120) || "منتج",
        image: safeString(firstImage, 500) || null,
        price,
        final_price: finalPrice,
        discount: discount > 0 ? discount : 0,
        section: p.section && p.section.name ? safeString(p.section.name, 60) : null,
        in_stock: typeof p.quantity === "number" ? p.quantity > 0 : true,
    };
}

function toPublicSection(s) {
    if (!s) return null;
    return {
        name: safeString(s.name, 80),
        description: safeString(s.description, 200),
    };
}

// ====================================================================
// تعريفات الأدوات (OpenAI-compatible / Groq)
// ====================================================================

const TOOL_DEFINITIONS = [
    {
        type: "function",
        function: {
            name: "search_products",
            description:
                "ابحث في منتجات المتجر الحالية (اسم/وصف/سعر/قسم/توفر). " +
                "استخدم هذه الأداة دائمًا قبل الرد على أي سؤال عن منتج أو سعر " +
                "أو توفر، بدلًا من التخمين أو الاعتماد على الذاكرة. " +
                "نتائج هذه الأداة تُعرض للعميل تلقائيًا ككروت منتجات بالصور والأسعار، " +
                "لذلك اكتفِ بجملة تمهيدية قصيرة ولا تكرر قائمة المنتجات أو الأسعار نصيًا.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "كلمة أو عبارة للبحث في اسم أو وصف المنتج. اتركه فارغًا لعرض منتجات عامة.",
                    },
                    section_name: {
                        type: "string",
                        description: "اسم القسم لتصفية المنتجات (اختياري).",
                    },
                    max_price: {
                        type: "number",
                        description: "أعلى سعر مقبول (اختياري).",
                    },
                    min_price: {
                        type: "number",
                        description: "أقل سعر مقبول (اختياري).",
                    },
                    in_stock_only: {
                        type: "boolean",
                        description: "أعرض فقط المنتجات المتوفرة بالمخزون (اختياري).",
                    },
                    limit: {
                        type: "number",
                        description: `أقصى عدد نتائج (الافتراضي والحد الأقصى ${config.AI_MAX_SEARCH_RESULTS}).`,
                    },
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_sections",
            description:
                "اجلب قائمة كل أقسام المتجر المتاحة حاليًا. استخدمها عند سؤال العميل عن الأقسام/الفئات.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
    {
        type: "function",
        function: {
            name: "get_store_info",
            description:
                "اجلب معلومات المتجر العامة (الاسم، الوصف، رقم الهاتف، الواتساب، الموقع). " +
                "استخدمها عند سؤال العميل عن اسم المتجر أو طريقة التواصل معه أو موقعه.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
];

const ALLOWED_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map(t => t.function.name));

// ====================================================================
// تنفيذ الأدوات — الاستعلامات الآمنة على Mongo
// ====================================================================

async function executeSearchProducts(rawArgs) {
    const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};

    const limit = clampNumber(args.limit, {
        min: 1,
        max: config.AI_MAX_SEARCH_RESULTS,
        fallback: config.AI_MAX_SEARCH_RESULTS,
    });

    // نبني الفلتر يدويًا حقل بحقل — الموديل لا يمرر فلتر Mongo أبدًا
    const filter = {};

    const query = safeString(args.query, 80);
    if (query) {
        const safePattern = escapeRegex(query);
        filter.$or = [
            { name: { $regex: safePattern, $options: "i" } },
            { description: { $regex: safePattern, $options: "i" } },
        ];
    }

    const minPrice = Number(args.min_price);
    const maxPrice = Number(args.max_price);
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
        filter.price = {};
        if (Number.isFinite(minPrice)) filter.price.$gte = Math.max(minPrice, 0);
        if (Number.isFinite(maxPrice)) filter.price.$lte = Math.max(maxPrice, 0);
    }

    if (args.in_stock_only === true) {
        filter.quantity = { $gt: 0 };
    }

    let results = await products
        .find(filter)
        .select(PRODUCT_PUBLIC_FIELDS)
        .populate("section", "name")
        .limit(limit)
        .lean();

    // تصفية إضافية باسم القسم بعد الـ populate (القسم مخزّن كـ ObjectId)
    const sectionName = safeString(args.section_name, 60).toLowerCase();
    if (sectionName) {
        results = results.filter(
            p =>
                p.section &&
                p.section.name &&
                String(p.section.name).toLowerCase().includes(sectionName)
        );
    }

    return {
        count: results.length,
        products: results.map(toPublicProduct),
        // للواجهة فقط — يتم نزعها قبل إرسال النتيجة للموديل
        cards: results.map(toProductCard),
    };
}

async function executeGetSections() {
    const results = await section
        .find({})
        .select(SECTION_PUBLIC_FIELDS)
        .limit(50)
        .lean();

    return {
        count: results.length,
        sections: results.map(toPublicSection),
    };
}

async function executeGetStoreInfo() {
    const result = await store
        .findOne({})
        .select(STORE_PUBLIC_FIELDS)
        .lean();

    if (!result) {
        return { error: "لا توجد معلومات متجر مسجلة حاليًا." };
    }

    return { store: toPublicStore(result) };
}

/**
 * نقطة التنفيذ الموحّدة لأي "tool call" قادم من الموديل.
 * ترجع { result, cards }:
 *   result -> يُرسَل للموديل (بدون أي بيانات عرض)
 *   cards  -> يُرسَل للواجهة فقط
 */
async function executeTool(name, rawArguments) {
    if (!ALLOWED_TOOL_NAMES.has(name)) {
        return { result: { error: `الأداة "${name}" غير مسموح بها.` }, cards: [] };
    }

    let args = {};
    try {
        args = rawArguments ? JSON.parse(rawArguments) : {};
    } catch (_) {
        args = {};
    }

    try {
        switch (name) {
            case "search_products": {
                const { cards, ...forModel } = await executeSearchProducts(args);
                return { result: forModel, cards: Array.isArray(cards) ? cards : [] };
            }
            case "get_sections":
                return { result: await executeGetSections(), cards: [] };
            case "get_store_info":
                return { result: await executeGetStoreInfo(), cards: [] };
            default:
                return { result: { error: "أداة غير معروفة." }, cards: [] };
        }
    } catch (error) {
        console.log(`[ai_assistant.tools] فشل تنفيذ ${name}:`, error.message);
        return {
            result: { error: "حدث خطأ أثناء تنفيذ البحث في قاعدة البيانات." },
            cards: [],
        };
    }
}

module.exports = {
    TOOL_DEFINITIONS,
    ALLOWED_TOOL_NAMES,
    executeTool,
    executeSearchProducts,
    executeGetSections,
    executeGetStoreInfo,
    toPublicProduct,
    toProductCard,
    toPublicSection,
    toPublicStore,
};