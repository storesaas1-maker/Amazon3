require("dotenv").config();

const AI_API_BASE_URL =
    process.env.AI_API_BASE_URL ||
    "https://api.groq.com/openai/v1/chat/completions";

const AI_API_KEY = process.env.AI_API_KEY || null;

// موديل تفكير (reasoning) حقيقي بيدعم tool calling وبيدّي إجابات أدق
// وأذكى في الحوار متعدد الخطوات (مثال: "عايز آيفون" -> "أي موديل؟" ->
// "17 برو ماكس" -> بحث فعلي بالاسم الكامل). السرعة مش أولوية هنا.
const AI_MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";

// أقصى "جهد تفكير" ممكن (low / medium / high) — يدعمه فقط موديلات
// gpt-oss. لو استخدمت موديل تاني مش بيدعمها، القيمة دي بيتم تجاهلها
// من طرف مزوّد الـ API غالبًا، أو ممكن تشيلها من ai-client.js.
const AI_REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "high";

// "hidden" يخلي المزوّد يرجّع الرد النهائي بس في content (من غير خطوات
// التفكير الداخلية)، وهو اللي بيمنع مشكلة "content فاضي" مع tool calls.
// البديل "parsed" لو حبيت تشوف خطوات التفكير منفصلة للتشخيص.
const AI_REASONING_FORMAT = process.env.AI_REASONING_FORMAT || "hidden";

const config = {
    AI_API_BASE_URL,
    AI_API_KEY,
    AI_MODEL,
    AI_REASONING_EFFORT,
    AI_REASONING_FORMAT,

    // حرارة منخفضة نسبيًا: بنفضّل دقة وثبات في الأسعار/الأسماء على
    // التنويع الإبداعي، خصوصًا إن الموديل بقى بيفكر أصلًا قبل الرد.
    AI_TEMPERATURE: Number(process.env.AI_TEMPERATURE ?? 0.3),

    // سقف أعلى للتوكنز لأن موديل التفكير بيستهلك توكنز داخلية زيادة
    // قبل الرد النهائي، وعايزين مساحة كافية لإجابة مفصلة لما يلزم.
    AI_MAX_OUTPUT_TOKENS: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 1500),

    // مهلة أطول لأن موديل التفكير بياخد وقت أكتر، والسرعة مش أولوية.
    AI_REQUEST_TIMEOUT_MS: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 60000),

    AI_MAX_RETRIES: Number(process.env.AI_MAX_RETRIES ?? 4),

    // جولات أدوات أكتر: نسمح للموديل يبحث، يصحّح بحثه، ويسأل توضيح،
    // من غير ما نقطعه بدري لمجرد توفير وقت.
    AI_MAX_TOOL_ROUNDS: Number(process.env.AI_MAX_TOOL_ROUNDS ?? 6),

    AI_MAX_SEARCH_RESULTS: Math.min(
        Number(process.env.AI_MAX_SEARCH_RESULTS ?? 12),
        20
    ),

    MAX_USER_MESSAGE_LENGTH: 800,
    MAX_HISTORY_MESSAGES: 16,
    MAX_HISTORY_MESSAGE_LENGTH: 600,

    STORE_NAME: process.env.STORE_NAME || "المتجر",
    STORE_URL: process.env.STORE_URL || "http://localhost:3000",

    RATE_LIMIT_WINDOW_MS: Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? 60000),
    RATE_LIMIT_MAX_REQUESTS: Number(process.env.AI_RATE_LIMIT_MAX ?? 20),

    // يطبع تفاصيل أكتر في الكونسول (مفيد وقت التشخيص فقط)
    AI_DEBUG: String(process.env.AI_DEBUG || "") === "1",
};

if (!config.AI_API_KEY) {
    console.warn(
        "[ai_assistant.config] Warning: AI_API_KEY is not present in the environment. " +
        "The smart assistant will operate in fallback mode only."
    );
}

module.exports = config;