import { initSite } from './common.js';
import { mountSiteShell } from '../components/site-shell.js';
import { toast } from '../toast.js';

mountSiteShell({ active: 'ai' });

/* ------------------------------------------------------------------
 * عناصر الصفحة
 * ---------------------------------------------------------------- */
const messagesEl = document.querySelector('#chat-messages');
const formEl = document.querySelector('#chat-form');
const inputEl = document.querySelector('#chat-input');
const sendBtn = document.querySelector('#chat-send-btn');
const suggestionsEl = document.querySelector('#chat-suggestions');
const clearBtn = document.querySelector('#chat-clear');

// بنحتفظ بالمحادثة في الذاكرة بس (من غير حفظ دائم)
let history = [];

const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
       <rect width="120" height="120" fill="#F1F3F5"/>
       <path d="M30 78l20-24 14 17 10-12 16 19z" fill="#C9CFD6"/>
       <circle cx="44" cy="42" r="7" fill="#C9CFD6"/>
     </svg>`
  );

/* ------------------------------------------------------------------
 * أدوات مساعدة
 * ---------------------------------------------------------------- */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// الموديل أحياناً بيرجع علامات Markdown — بننضفها عشان النص يظهر طبيعي
function cleanReplyText(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ج.م`;
}

// حقل image ممكن يكون رابط كامل، أو مسار يبدأ بـ /، أو اسم ملف فقط
function resolveImage(src) {
  if (!src) return PLACEHOLDER_IMAGE;
  const value = String(src).trim();
  if (/^(https?:|data:)/i.test(value)) return value;
  if (value.startsWith('/')) return value;
  return `/uploads/${value}`;
}

function productUrl(product) {
  return product.id ? `/product.html?id=${encodeURIComponent(product.id)}` : '#';
}

/**
 * زر (+) — إضافة للسلة.
 * لو عندك دالة سلة جاهزة في المشروع، الربط بيحصل هنا تلقائياً:
 * بنحاول نستورد /js/cart.js وناخد منها addToCart، وغير كده بنفتح
 * صفحة المنتج. غيّر السطر المعلّم بالاسم الفعلي لو مختلف عندك.
 */
async function handleAddToCart(product, btn) {
  btn.disabled = true;
  try {
    const mod = await import('../cart.js').catch(() => null);
    const addFn = mod?.addToCart || mod?.addItemToCart || window.addToCart; // ← مكان الربط
    if (typeof addFn === 'function') {
      await addFn(product.id, 1);
      toast('تمت إضافة المنتج إلى السلة', 'success');
      return;
    }
    window.location.href = productUrl(product);
  } catch (err) {
    toast('تعذّرت إضافة المنتج للسلة', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------
 * بناء كارت المنتج
 * ---------------------------------------------------------------- */
function buildProductCard(product) {
  const card = document.createElement('article');
  card.className = 'ai-product-card';

  const price = Number(product.final_price ?? product.price);
  const oldPrice = Number(product.price);
  const hasDiscount =
    Number(product.discount) > 0 && Number.isFinite(oldPrice) && oldPrice > price;

  card.innerHTML = `
    <a class="ai-product-media" href="${escapeHtml(productUrl(product))}">
      <img src="${escapeHtml(resolveImage(product.image))}"
           alt="${escapeHtml(product.name)}" loading="lazy" />
    </a>
    <button type="button" class="ai-product-add"
            aria-label="أضف ${escapeHtml(product.name)} إلى السلة">
      <i class="fa-solid fa-plus" aria-hidden="true"></i>
    </button>
    <div class="ai-product-body">
      <a class="ai-product-name" href="${escapeHtml(productUrl(product))}">${escapeHtml(product.name)}</a>
      ${product.section ? `<span class="ai-product-section">${escapeHtml(product.section)}</span>` : ''}
      <div class="ai-product-price-row">
        <span class="ai-product-price">${escapeHtml(formatPrice(price))}</span>
        ${hasDiscount ? `<span class="ai-product-old-price">${escapeHtml(formatPrice(oldPrice))}</span>` : ''}
        ${hasDiscount ? `<span class="ai-product-discount">- ${Math.round(Number(product.discount))}%</span>` : ''}
      </div>
      ${product.in_stock === false ? '<span class="ai-product-out">غير متوفر حالياً</span>' : ''}
    </div>
  `;

  const addBtn = card.querySelector('.ai-product-add');
  if (product.in_stock === false) {
    addBtn.disabled = true;
  } else {
    addBtn.addEventListener('click', () => handleAddToCart(product, addBtn));
  }

  return card;
}

function buildProductsCarousel(products) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-products';

  const track = document.createElement('div');
  track.className = 'ai-products-track';
  products.forEach((p) => track.appendChild(buildProductCard(p)));

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'ai-products-nav prev';
  prev.setAttribute('aria-label', 'المنتجات السابقة');
  prev.innerHTML = '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'ai-products-nav next';
  next.setAttribute('aria-label', 'المنتجات التالية');
  next.innerHTML = '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>';

  // في RTL قيم scrollLeft بتكون سالبة — بنستخدم scrollBy عشان نتفادى الاختلاف بين المتصفحات
  prev.addEventListener('click', () => track.scrollBy({ left: 240, behavior: 'smooth' }));
  next.addEventListener('click', () => track.scrollBy({ left: -240, behavior: 'smooth' }));

  wrap.append(prev, track, next);

  // نخفي الأسهم لو كل المنتجات ظاهرة أصلاً
  requestAnimationFrame(() => {
    const scrollable = track.scrollWidth > track.clientWidth + 8;
    prev.hidden = !scrollable;
    next.hidden = !scrollable;
  });

  return wrap;
}

/* ------------------------------------------------------------------
 * الرسائل
 * ---------------------------------------------------------------- */
function appendUserMessage(text) {
  const bubble = document.createElement('div');
  bubble.className = 'ai-msg-user';
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  scrollToBottom();
}

function appendAssistantMessage(text, products = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'ai-msg-assistant-wrap';

  const avatar = document.createElement('div');
  avatar.className = 'ai-msg-assistant-avatar';
  avatar.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i>';

  const body = document.createElement('div');
  body.className = 'ai-msg-assistant-body';

  const bubble = document.createElement('div');
  bubble.className = 'ai-msg-assistant';
  bubble.textContent = cleanReplyText(text);
  body.appendChild(bubble);

  if (Array.isArray(products) && products.length > 0) {
    body.appendChild(buildProductsCarousel(products));
  }

  wrapper.append(avatar, body);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function appendTypingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.id = 'typing-indicator';
  wrapper.className = 'ai-msg-assistant-wrap';
  wrapper.innerHTML = `
    <div class="ai-msg-assistant-avatar"><i class="fa-solid fa-robot" aria-hidden="true"></i></div>
    <div class="ai-msg-assistant-body">
      <div class="ai-msg-assistant" style="display: flex; align-items: center; gap: 6px; width: fit-content;">
        <span class="ai-typing-dot"></span>
        <span class="ai-typing-dot"></span>
        <span class="ai-typing-dot"></span>
      </div>
    </div>
  `;
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function removeTypingIndicator() {
  document.querySelector('#typing-indicator')?.remove();
}

/* ------------------------------------------------------------------
 * الإرسال
 * ---------------------------------------------------------------- */
async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || sendBtn.disabled) return;

  appendUserMessage(trimmed);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  sendBtn.disabled = true;
  inputEl.disabled = true;
  appendTypingIndicator();

  try {
    const res = await fetch('/api/ai_assistant', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: trimmed, history })
    });

    removeTypingIndicator();

    if (res.status === 429) {
      appendAssistantMessage('في طلبات كتير على المساعد دلوقتي — استنى شوية وجرب تاني.');
      return;
    }

    const data = await res.json();

    if (!res.ok || !data.success) {
      appendAssistantMessage('معلش، مقدرتش أعالج طلبك دلوقتي. جرب تاني كمان شوية.');
      toast(data.message || 'حصل خطأ في المساعد الذكي', 'error');
      return;
    }

    const reply = data.data?.reply || 'معلش، مفيش عندي إجابة لده دلوقتي.';
    const productList = Array.isArray(data.data?.products) ? data.data.products : [];

    appendAssistantMessage(reply, productList);

    history.push({ role: 'user', content: trimmed });
    history.push({ role: 'assistant', content: reply });

    // نحدّ من طول المحادثة المخزّنة
    history = history.slice(-10);
  } catch (err) {
    removeTypingIndicator();
    appendAssistantMessage('معلش، حصلت مشكلة في الاتصال بالمساعد الذكي.');
    toast('حدث خطأ في الاتصال بالشبكة', 'error');
  } finally {
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }
}

/* ------------------------------------------------------------------
 * الأحداث
 * ---------------------------------------------------------------- */
formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(inputEl.value);
});

// إرسال بـ Enter (من غير Shift)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});

// توسيع الـ textarea تلقائياً
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${inputEl.scrollHeight}px`;
});

// اقتراحات سريعة
suggestionsEl.querySelectorAll('.ai-suggestion-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    sendMessage(chip.textContent.trim());
  });
});

// محادثة جديدة
clearBtn?.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '';
  appendAssistantMessage(
    'ابدأ من جديد — قولي على المنتج أو القسم اللي بتدور عليه وأنا أعرضهولك بالأسعار.'
  );
  inputEl.focus();
});

initSite().then(() => {
  inputEl.focus();
});