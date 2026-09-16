import { money } from '../pages/common.js';
import { addItem } from '../cart-store.js';
import { toast } from '../toast.js';
import { resolveProductImage, setupImgFallback, isValidProductImage } from '../image-helper.js';

function renderCardStars(score) {
  const full = Math.floor(score);
  const hasHalf = score - full >= 0.3 && score - full < 0.8;
  const roundedFull = score - full >= 0.8 ? full + 1 : full;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= (hasHalf ? full : roundedFull)) {
      html += '<i class="fa-solid fa-star"></i>';
    } else if (hasHalf && i === full + 1) {
      html += '<i class="fa-solid fa-star-half-stroke"></i>';
    } else {
      html += '<i class="fa-regular fa-star" style="color: #d1d5db;"></i>';
    }
  }
  return html;
}

export function productCard(p) {
  const card = document.createElement('article');
  card.className = 'product-card';

  const productId = p._id || p.id;
  const price = Number(p.final_price ?? p.price);
  const originalPrice = Number(p.price);
  const hasDiscount = Number(p.discount || 0) > 0;
  const inStock = Number(p.quantity) > 0;
  const sectionName = p.section?.name || 'عام';

  // استخراج الصورة الأولى المناسبة أو البديل الذكي حسب التصنيف
  const rawImages = Array.isArray(p.images) && p.images.length > 0 
    ? p.images.filter(img => isValidProductImage(img)) 
    : (isValidProductImage(p.image) ? [p.image.trim()] : []);

  const imgSrc = rawImages[0] || resolveProductImage(p);

  // احتساب التقييم وعدد المراجعات
  const reviewsCount = Number(p.reviews_count || (Array.isArray(p.reviews) ? p.reviews.length : 0));
  const rating = Number(p.rating || 0);

  card.innerHTML = `
    <!-- غلاف الصورة والبادجات -->
    <div class="product-card-img-wrap">
      <a href="/product.html?id=${productId}" class="product-card-img-link" aria-label="${p.name}">
        <img 
          src="${imgSrc}" 
          alt="${p.name || 'صورة المنتج'}" 
          loading="lazy"
        />
      </a>

      <!-- بادج الخصم -->
      ${hasDiscount ? `<span class="badge badge-discount product-badge-top">خصم ${p.discount}%</span>` : ''}
      
      <!-- شارة عدد الصور إن كان للمنتج أكثر من صورة -->
      ${rawImages.length > 1 ? `
        <span class="product-card-images-count" style="position: absolute; bottom: 8px; right: 8px; background: rgba(15, 17, 17, 0.75); color: #FFF; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; backdrop-filter: blur(2px);">
          <i class="fa-solid fa-images" style="color: #FF9900;"></i> ${rawImages.length}
        </span>
      ` : ''}

      <!-- بادج نفاد المخزون -->
      ${!inStock ? `<span class="badge product-badge-out" style="position: absolute; top: 8px; left: 8px; background: #b12704; color: #fff; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px;">نفد المخزون</span>` : ''}
    </div>

    <!-- تفاصيل وبيانات المنتج -->
    <div class="product-card-body">
      <span class="product-card-category">${sectionName}</span>
      
      <h3 class="product-card-title">
        <a href="/product.html?id=${productId}" title="${p.name}">${p.name || 'منتج بدون اسم'}</a>
      </h3>

      <!-- تقييم النجوم وعدد المراجعات -->
      <div class="product-card-rating">
        <div class="rating-stars">
          ${renderCardStars(rating)}
        </div>
        <span class="rating-count">(${reviewsCount})</span>
      </div>

      <!-- الأسعار -->
      <div class="product-card-price-box">
        <div class="product-card-price-row">
          <strong class="product-card-price">${money(price)}</strong>
          ${hasDiscount ? `<del class="product-card-old-price">${money(originalPrice)}</del>` : ''}
        </div>
      </div>

      <!-- زر الإضافة إلى السلة السريع -->
      <button 
        type="button" 
        class="button btn-accent btn-sm btn-block product-card-btn" 
        ${inStock ? '' : 'disabled style="opacity: 0.6; cursor: not-allowed;"'}
      >
        <i class="fa-solid fa-cart-plus"></i>
        <span>${inStock ? 'أضف للسلة' : 'غير متوفر'}</span>
      </button>
    </div>
  `;

  // تفعيل المعالج التلقائي للصور التالفة
  setupImgFallback(card.querySelector('img'), p.name);

  // تفعيل حدث إضافة المنتج إلى السلة
  const addBtn = card.querySelector('.product-card-btn');
  if (addBtn && inStock) {
    addBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      addItem(p, 1);
      toast(`تمت إضافة ${p.name} إلى سلة المشتريات`, 'success');
    };
  }

  return card;
}