/**
 * ==============================================================================
 * MATGARI (متجري) — Unified Smart Product Image Helper
 * Resolves accurate, category-aware images and provides seamless fallback handling
 * across Product Listings, Product Detail, Cart, and Order Management.
 * ==============================================================================
 */

// Legacy generic placeholder that caused mismatched images across the store
const GENERIC_PHONE_PLACEHOLDER_SUBSTRING = 'photo-1592750475338-74b7b21085ab';

// Curated high-resolution image repository by category
export const CATEGORY_IMAGE_MAP = {
  // 1. كاميرات ومعدات صناع المحتوى والتصوير
  camera: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
  // 2. سماعات الرأس وسماعات الأذن وAirPods
  headphones: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
  earbuds: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80',
  // 3. هواتف ذكية وأجهزة آيفون
  phone: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80',
  // 4. شاشات وتلفزيونات ذكية 4K OLED
  tv: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=600&auto=format&fit=crop&q=80',
  // 5. ثلاجات وأجهزة منزلية كبرى
  fridge: 'https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=600&auto=format&fit=crop&q=80',
  // 6. قلايات هوائية رقمية
  airfryer: 'https://images.unsplash.com/photo-1585659722983-3a675dabf23d?w=600&auto=format&fit=crop&q=80',
  // 7. ماكينات تحضير القهوة والإسبريسو
  coffee: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=600&auto=format&fit=crop&q=80',
  // 8. مكانس روبوت ذكية
  vacuum: 'https://images.unsplash.com/photo-1610492461128-4bc2794c4897?w=600&auto=format&fit=crop&q=80',
  // 9. أجهزة لابتوب وحواسيب
  laptop: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&auto=format&fit=crop&q=80',
  // 10. ساعات ذكية
  watch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
  // 11. أحذية رياضية وسنيكرز
  shoes: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
  // 12. عطور فاخرة
  perfume: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop&q=80',
  // 13. خلاطات ومحضرات طعام
  blender: 'https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=600&auto=format&fit=crop&q=80',
  // 14. غسالات ملابس
  washer: 'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=600&auto=format&fit=crop&q=80',
  // 15. أفران وميكروويف
  oven: 'https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=600&auto=format&fit=crop&q=80',
  // 16. أجهزة لوحية وتطبيقات لوحية (iPad / Tablet)
  tablet: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80',
  // 17. إكسسوارات إلكترونية ومحولات
  accessories: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&auto=format&fit=crop&q=80',
  // بديل افتراضي احترافي للأجهزة العامة
  default: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop&q=80'
};

// Global in-memory catalog cache to reconcile orders and cart items
//
// FIX: this used to overwrite _cachedCatalog wholesale on every call, so
// whichever caller ran last "won" — e.g. a full-catalog preload done for
// image matching would get wiped out the moment any paginated fetch (like
// the admin "Catalog & Inventory" tab loading just its first page of 20)
// called setCatalogCache() afterward with a smaller subset. Every product
// not on that page would then silently lose its cached entry and fall back
// to the generic category placeholder image. Caching by product id and
// merging on every call means the cache only grows/updates and never loses
// a product just because a later call didn't happen to include it.
const _catalogById = new Map();
let _cachedCatalog = [];

export function setCatalogCache(products) {
  if (!Array.isArray(products) || products.length === 0) return;
  products.forEach((prod) => {
    const key = String(prod?._id || prod?.id || '');
    if (key) _catalogById.set(key, prod);
  });
  _cachedCatalog = Array.from(_catalogById.values());
}

export function getCatalogCache() {
  return _cachedCatalog;
}

/**
 * Checks if a given image URL string is valid, non-empty, and not the unwanted placeholder
 */
export function isValidProductImage(imgUrl) {
  if (!imgUrl || typeof imgUrl !== 'string') return false;
  const trimmed = imgUrl.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return false;
  if (trimmed.includes(GENERIC_PHONE_PLACEHOLDER_SUBSTRING)) return false;
  return true;
}

/**
 * Resolves a fallback category image from a product's name or title
 */
export function getCategoryFallbackByName(name = '') {
  const title = String(name || '').toLowerCase();

  // 1. كاميرات وصناع المحتوى
  if (
    title.includes('creatorcam') ||
    title.includes('كاميرا') ||
    title.includes('كاميره') ||
    title.includes('camera') ||
    title.includes('تصوير') ||
    title.includes('dslr') ||
    title.includes('gopro') ||
    title.includes('عدسة')
  ) {
    return CATEGORY_IMAGE_MAP.camera;
  }

  // 2. سماعات الأذن اللاسلكية وAirPods
  if (
    title.includes('airpods') ||
    title.includes('airpod') ||
    title.includes('ايربود') ||
    title.includes('إيربود') ||
    title.includes('earbuds') ||
    title.includes('earphone')
  ) {
    return CATEGORY_IMAGE_MAP.earbuds;
  }

  // 3. سماعات الرأس والهيدفون
  if (
    title.includes('سماعه') ||
    title.includes('سماعة') ||
    title.includes('سماعات') ||
    title.includes('headphone') ||
    title.includes('headset') ||
    title.includes('هيدفون')
  ) {
    return CATEGORY_IMAGE_MAP.headphones;
  }

  // 4. هواتف وآيفون وسامسونج
  if (
    title.includes('iphone') ||
    title.includes('ايفون') ||
    title.includes('آيفون') ||
    title.includes('موبايل') ||
    title.includes('هاتف') ||
    title.includes('جوال') ||
    title.includes('smartphone') ||
    title.includes('galaxy') ||
    title.includes('شاومي')
  ) {
    return CATEGORY_IMAGE_MAP.phone;
  }

  // 5. شاشات وتلفزيونات
  if (
    title.includes('شاشة') ||
    title.includes('شاشه') ||
    title.includes('تلفزيون') ||
    title.includes('تلفاز') ||
    title.includes('tv') ||
    title.includes('oled')
  ) {
    return CATEGORY_IMAGE_MAP.tv;
  }

  // 6. ثلاجات
  if (
    title.includes('ثلاجة') ||
    title.includes('ثلاجه') ||
    title.includes('تلاجة') ||
    title.includes('تلاجه') ||
    title.includes('refrigerator') ||
    title.includes('fridge')
  ) {
    return CATEGORY_IMAGE_MAP.fridge;
  }

  // 7. قلاية هوائية
  if (
    title.includes('قلاية') ||
    title.includes('قلايه') ||
    title.includes('fryer') ||
    title.includes('هوائية')
  ) {
    return CATEGORY_IMAGE_MAP.airfryer;
  }

  // 8. قهوة وإسبريسو
  if (
    title.includes('قهوة') ||
    title.includes('قهوه') ||
    title.includes('اسبريسو') ||
    title.includes('إسبريسو') ||
    title.includes('كابتشينو') ||
    title.includes('coffee') ||
    title.includes('espresso')
  ) {
    return CATEGORY_IMAGE_MAP.coffee;
  }

  // 9. مكنسة روبوت
  if (
    title.includes('مكنسة') ||
    title.includes('مكنسه') ||
    title.includes('روبوت') ||
    title.includes('vacuum')
  ) {
    return CATEGORY_IMAGE_MAP.vacuum;
  }

  // 10. لابتوب وكمبيوتر
  if (
    title.includes('لابتوب') ||
    title.includes('لاب توب') ||
    title.includes('كمبيوتر') ||
    title.includes('حاسوب') ||
    title.includes('laptop') ||
    title.includes('macbook') ||
    title.includes('ألترا بوك')
  ) {
    return CATEGORY_IMAGE_MAP.laptop;
  }

  // 11. ساعات ذكية
  if (
    title.includes('ساعة') ||
    title.includes('ساعه') ||
    title.includes('watch') ||
    title.includes('smartwatch')
  ) {
    return CATEGORY_IMAGE_MAP.watch;
  }

  // 12. أحذية
  if (
    title.includes('حذاء') ||
    title.includes('شوز') ||
    title.includes('سنيكرز') ||
    title.includes('shoes') ||
    title.includes('sneakers')
  ) {
    return CATEGORY_IMAGE_MAP.shoes;
  }

  // 13. عطور
  if (
    title.includes('عطر') ||
    title.includes('برفان') ||
    title.includes('perfume') ||
    title.includes('fragrance')
  ) {
    return CATEGORY_IMAGE_MAP.perfume;
  }

  // 14. خلاطات ومطاحن
  if (
    title.includes('خلاط') ||
    title.includes('عصارة') ||
    title.includes('عصاره') ||
    title.includes('blender') ||
    title.includes('juicer')
  ) {
    return CATEGORY_IMAGE_MAP.blender;
  }

  // 15. غسالات
  if (
    title.includes('غسالة') ||
    title.includes('غساله') ||
    title.includes('washer')
  ) {
    return CATEGORY_IMAGE_MAP.washer;
  }

  // 16. أفران وميكروويف
  if (
    title.includes('ميكروويف') ||
    title.includes('فرن') ||
    title.includes('oven') ||
    title.includes('microwave')
  ) {
    return CATEGORY_IMAGE_MAP.oven;
  }

  // 17. تابلت
  if (
    title.includes('تابلت') ||
    title.includes('ايباد') ||
    title.includes('آيباد') ||
    title.includes('tablet') ||
    title.includes('ipad')
  ) {
    return CATEGORY_IMAGE_MAP.tablet;
  }

  return CATEGORY_IMAGE_MAP.default;
}

/**
 * Universal product image resolver.
 * Handles products from catalog, cart items, order items, and admin models.
 */
export function resolveProductImage(itemOrProduct, catalog = null) {
  if (!itemOrProduct) return CATEGORY_IMAGE_MAP.default;

  // If passed a plain string that is a valid URL
  if (typeof itemOrProduct === 'string') {
    if (isValidProductImage(itemOrProduct)) return itemOrProduct.trim();
    return getCategoryFallbackByName(itemOrProduct);
  }

  const p = itemOrProduct;
  const productName = p.name || p.product_name || p.product?.name || p.title || '';

  // FIX: order line items now store a "product" field as a plain
  // ObjectId string (see order.js / order_controller.js), not a
  // populated object — so p.product?._id / p.product?.id were always
  // undefined for it. This also stopped giving p._id priority: for an
  // order item, p._id is the order line item's OWN auto-generated
  // Mongoose subdocument id, which has nothing to do with the actual
  // product and can never match anything in the catalog — checking it
  // first silently broke id-based matching for every order item that
  // had one.
  const productId = String(
    p.productId ||
    p.product_id ||
    (typeof p.product === 'string' ? p.product : (p.product?._id || p.product?.id)) ||
    p._id ||
    p.id ||
    ''
  );

  // 1. If catalog is provided or cached, try to cross-reference
  const activeCatalog = Array.isArray(catalog) && catalog.length > 0 ? catalog : _cachedCatalog;
  if (activeCatalog && activeCatalog.length > 0) {
    const matched = activeCatalog.find((prod) => {
      const matchId = String(prod._id || prod.id || '');
      if (productId && matchId && matchId === productId) return true;
      if (productName && prod.name && prod.name.trim().toLowerCase() === productName.trim().toLowerCase()) return true;
      return false;
    });

    if (matched) {
      const matchedImg =
        (Array.isArray(matched.images) && matched.images.find((img) => isValidProductImage(img))) ||
        (isValidProductImage(matched.image) ? matched.image : null);
      if (matchedImg) return matchedImg;
    }
  }

  // 2. Direct check on product/item image fields
  // Check images array first
  const imagesArr = Array.isArray(p.images) ? p.images : Array.isArray(p.product?.images) ? p.product.images : null;
  if (imagesArr && imagesArr.length > 0) {
    const validInArr = imagesArr.find((img) => isValidProductImage(img));
    if (validInArr) return validInArr;
  }

  // Check single image property
  const candidate = p.image || p.img || p.thumbnail || p.photo || p.picture || p.product?.image;
  if (isValidProductImage(candidate)) {
    return candidate.trim();
  }

  // 3. Fallback based on name analysis
  return getCategoryFallbackByName(productName);
}

/**
 * Attaches a bulletproof error handler to an <img> element
 * so it never breaks, never enters an infinite loop, and smoothly displays
 * the accurate category image.
 */
export function setupImgFallback(imgElement, productName = '', customFallback = null) {
  if (!imgElement) return;

  const fallback = customFallback || getCategoryFallbackByName(productName);

  imgElement.onerror = function () {
    // Prevent infinite loop if fallback fails
    this.onerror = null;
    this.src = fallback;
  };

  // Add subtle fade-in when loaded
  imgElement.style.transition = 'opacity 0.25s ease-in-out';
  if (imgElement.complete && imgElement.naturalHeight !== 0) {
    imgElement.style.opacity = '1';
  } else {
    imgElement.style.opacity = '0.7';
    imgElement.onload = function () {
      this.style.opacity = '1';
    };
  }
}