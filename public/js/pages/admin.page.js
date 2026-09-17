import { request, fetchAllOrders } from "../api.js";
import { checkAuth } from "../auth-guard.js";
import { joinRooms, onEvent } from "../socket-client.js";
import { confirm } from "../components/modal.js";
import { money, state } from "./common.js";
import { toast } from "../toast.js";
import { resolveProductImage, setupImgFallback, setCatalogCache } from "../image-helper.js";

let user;
let orders = [];
let products = [];

const statuses = ["new", "processing", "delivered", "cancelled"];

// متغيرات التقسيم والتمرير اللانهائي
let ordersPage = 1;
const ordersPerPage = 10;
let ordersTotalPages = 1;
let ordersTotalCount = 0;
let ordersLoading = false;
let ordersScrollReady = false;

function id(x) {
  return x?._id || x?.id;
}

// ======================================================
// جلب كتالوج المنتجات (للصور الحقيقية فقط، هذه الصفحة
// لا تحتوي على واجهة إدارة منتجات مثل super-admin.html)
// ======================================================
// FIX: resolveProductImage() كانت تُستدعى في هذا الملف بدون كتالوج
// منتجات إطلاقاً (لا setCatalogCache ولا تمرير مصفوفة products كوسيط
// ثانٍ كما يحدث في dashboard_page.js) — فكانت تلجأ دائمًا لصورة
// احتياطية/وهمية بدل الصورة الحقيقية للمنتج، مهما كان المنتج المطلوب
// فعليًا في الطلب.
async function loadProductCatalog() {
  try {
    const response = await request("/api/get_products?limit=1000", { silent: true });
    products = response.data || [];
    setCatalogCache(products);
  } catch (error) {
    console.error("Load product catalog error:", error);
  }
}

// ======================================================
// بدء التشغيل والتحقق من صلاحية المدير
// ======================================================
async function init() {
  user = await checkAuth(["admin", "super_admin"]);
  if (!user) return;

  const userNameEl = document.querySelector("[data-user-name]");
  if (userNameEl) {
    userNameEl.textContent = user.name || "مدير النظام";
  }

  joinRooms(user.role);
  setupTabs();
  setupOrderDetailsModal();

  // تحميل البيانات الأولية
  await loadProductCatalog();
  await loadOrders(1, false);
  await loadOverviewStats();

  // الاستماع للأحداث الحية عبر السوكيت
  onEvent("new_order", async () => {
    await reloadOrdersKeepCount();
    await loadOverviewStats();
  });

  onEvent("deleted_order", async () => {
    await reloadOrdersKeepCount();
    await loadOverviewStats();
  });

  onEvent("update_status_of_order", async () => {
    await reloadOrdersKeepCount();
    await loadOverviewStats();
  });

  // FIX: keep the product image catalog fresh when products are added,
  // edited, or their section changes — otherwise a product created
  // after this page loaded would still show the fallback image until
  // a full page refresh.
  onEvent("new_product", loadProductCatalog);
  onEvent("update_product", loadProductCatalog);
}

// ======================================================
// التبديل بين التبويبات (Tabs Switching)
// ======================================================
function setupTabs() {
  const tabButtons = document.querySelectorAll("[data-tab]");
  tabButtons.forEach((button) => {
    button.onclick = () => {
      tabButtons.forEach((b) => {
        b.classList.remove("bg-[#FF9900]", "text-[#0F1111]", "shadow-sm");
        b.classList.add("text-slate-300");
      });

      button.classList.add("bg-[#FF9900]", "text-[#0F1111]", "shadow-sm");
      button.classList.remove("text-slate-300");

      document.querySelectorAll(".tab").forEach((node) => {
        node.classList.remove("active");
      });

      const target = document.querySelector(`#${button.dataset.tab}`);
      if (target) {
        target.classList.add("active");
        if (button.dataset.tab === "overview-tab") {
          loadOverviewStats();
        }
      }
    };
  });
}

// ======================================================
// دالة حساب وعرض الإحصائيات الحقيقية
// ======================================================
window.loadOverviewStats = async function loadOverviewStats() {
  try {
    const allOrders = await fetchAllOrders();

    const newOrders = allOrders.filter((o) => o.status === "new").length;
    const processingOrders = allOrders.filter((o) => o.status === "processing").length;
    const deliveredOrders = allOrders.filter((o) => o.status === "delivered").length;
    const cancelledOrders = allOrders.filter((o) => o.status === "cancelled").length;

    // حساب إجمالي الأرباح من الطلبات المستلمة (Delivered)
    const totalRevenue = allOrders
      .filter((o) => o.status === "delivered")
      .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

    const elRevenue = document.querySelector("#metric-revenue");
    const elOrdersTotal = document.querySelector("#metric-orders-total");
    const elOrdersNew = document.querySelector("#metric-orders-new");
    const elOrdersProcessing = document.querySelector("#metric-orders-processing");
    const elOrdersDelivered = document.querySelector("#metric-orders-delivered");
    const elOrdersCancelled = document.querySelector("#metric-orders-cancelled");

    if (elRevenue) elRevenue.textContent = money(totalRevenue);
    if (elOrdersTotal) elOrdersTotal.textContent = allOrders.length;
    if (elOrdersNew) elOrdersNew.textContent = newOrders;
    if (elOrdersProcessing) elOrdersProcessing.textContent = processingOrders;
    if (elOrdersDelivered) elOrdersDelivered.textContent = deliveredOrders;
    if (elOrdersCancelled) elOrdersCancelled.textContent = cancelledOrders;

    // جلب وتحديث المستخدمين الحقيقيين
    const usersRes = await request("/api/admin/get_all_users", { silent: true });
    const allUsers = usersRes?.data || [];
    const realCustomers = allUsers.filter((u) => u.role !== "admin" && u.role !== "super_admin").length;

    const elUsersReal = document.querySelector("#metric-users-real");
    const elUsersTotal = document.querySelector("#metric-users-total");
    if (elUsersReal) elUsersReal.textContent = realCustomers;
    if (elUsersTotal) elUsersTotal.textContent = allUsers.length;

  } catch (err) {
    console.error("Load overview stats error:", err);
  }
};

// ======================================================
// إدارة الطلبات وتحميلها
// ======================================================
async function loadOrders(page = 1, append = false) {
  if (ordersLoading) return;

  const root = document.querySelector("#orders-list");
  if (!root) return;

  ordersLoading = true;

  if (!append) {
    orders = [];
    ordersPage = 1;
    ordersTotalPages = 1;
    state(root, "جارٍ تحميل الطلبات…");
  }

  try {
    const response = await request(
      `/api/admin/get_all_orders?page=${page}&limit=${ordersPerPage}`
    );

    const newOrders = response.data || [];
    orders = append ? [...orders, ...newOrders] : newOrders;
    ordersPage = page;

    if (response.pagination) {
      ordersTotalPages = Number(response.pagination.totalPages) || 1;
      ordersTotalCount = Number(response.pagination.totalOrders) || orders.length;
    } else {
      ordersTotalPages = newOrders.length >= ordersPerPage ? page + 1 : page;
      ordersTotalCount = orders.length;
    }

    if (append) {
      root.append(...newOrders.map(orderRow));
    } else {
      root.replaceChildren(...orders.map(orderRow));
    }

    if (!orders.length) {
      state(root, "لا توجد طلبات حتى الآن.", "empty");
    }

    updateOrdersPagination();
  } catch (error) {
    console.error("Load orders error:", error);
    if (append) {
      updateOrdersPagination("تعذر تحميل المزيد من الطلبات.");
    } else {
      state(root, "تعذر تحميل قائمة الطلبات.", "error");
    }
  } finally {
    ordersLoading = false;
  }
}

async function reloadOrdersKeepCount() {
  const root = document.querySelector("#orders-list");
  if (!root) return;

  const currentCount = Math.max(orders.length, ordersPerPage);
  const pageSize = 50;

  try {
    let collected = [];
    let page = 1;
    let pagination = null;

    while (collected.length < currentCount) {
      const response = await request(
        `/api/admin/get_all_orders?page=${page}&limit=${pageSize}`
      );
      const batch = response.data || [];
      collected = collected.concat(batch);
      pagination = response.pagination || null;

      if (!pagination || !pagination.hasNextPage) break;
      page += 1;
    }

    orders = collected.slice(0, currentCount);

    if (pagination) {
      ordersTotalCount = Number(pagination.totalOrders) || orders.length;
      ordersTotalPages = Math.ceil(ordersTotalCount / ordersPerPage) || 1;
    } else {
      ordersTotalCount = orders.length;
      ordersTotalPages = 1;
    }

    root.replaceChildren(...orders.map(orderRow));

    if (!orders.length) {
      state(root, "لا توجد طلبات حتى الآن.", "empty");
    }

    updateOrdersPagination();
  } catch (err) {
    console.error("Reload orders error:", err);
  }
}

function ensureOrdersSentinel() {
  let pagination = document.querySelector("#orders-pagination");
  if (!pagination) {
    pagination = document.createElement("div");
    pagination.id = "orders-pagination";
    pagination.className = "py-3 text-center text-xs font-bold text-[#565959]";

    const root = document.querySelector("#orders-list");
    const anchor = root?.closest("table") || root;
    if (anchor) anchor.after(pagination);
  }
  return pagination;
}

function updateOrdersPagination(customText) {
  const pagination = ensureOrdersSentinel();
  pagination.replaceChildren();

  const info = document.createElement("span");
  const hasMore = orders.length < ordersTotalCount;

  info.textContent = customText
    ? customText
    : hasMore
    ? `تم تحميل ${orders.length} من أصل ${ordersTotalCount} طلب (قم بالتمرير لتحميل المزيد...)`
    : orders.length
    ? `تم عرض كافة الطلبات بنجاح (${ordersTotalCount})`
    : "";

  pagination.append(info);
  setupOrdersInfiniteScroll();
}

function setupOrdersInfiniteScroll() {
  if (ordersScrollReady) return;

  const sentinel = ensureOrdersSentinel();
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !ordersLoading && orders.length < ordersTotalCount) {
        const nextPage = Math.floor(orders.length / ordersPerPage) + 1;
        loadOrders(nextPage, true);
      }
    },
    { rootMargin: "400px" }
  );

  observer.observe(sentinel);
  ordersScrollReady = true;
}

// ======================================================
// دالة بناء صف الطلب بتصميم أمازون ودعم كافة الحقول
// ======================================================
function orderRow(o) {
  const tr = document.createElement("tr");
  tr.className = "hover:bg-[#F7F7F7] transition-colors border-b border-[#E7E7E7] text-xs";

  // 1. رقم الطلب وتاريخ الإنشاء
  const tdNum = document.createElement("td");
  tdNum.className = "py-3.5 px-4";
  
  const orderNum = document.createElement("span");
  orderNum.className = "font-bold text-[#0F1111] block font-mono";
  orderNum.textContent = o.orderNumber || id(o)?.slice(-6) || "—";

  const orderDate = document.createElement("span");
  orderDate.className = "text-[10px] text-[#565959] block";
  orderDate.textContent = o.createdAt ? new Date(o.createdAt).toLocaleString("ar-EG") : "";

  tdNum.append(orderNum, orderDate);

  // 2. العميل
  const tdUser = document.createElement("td");
  tdUser.className = "py-3.5 px-4 text-[#0F1111] font-semibold";
  tdUser.textContent = o.user_name || o.user?.name || "عميل مسجل";

  // 3. بيانات الاتصال (الهاتف + الواتساب)
  const tdContact = document.createElement("td");
  tdContact.className = "py-3.5 px-4 space-y-1";

  const phone = o.phone_number || o.user?.phone;
  if (phone) {
    const phoneLink = document.createElement("a");
    phoneLink.href = `tel:${phone}`;
    phoneLink.className = "flex items-center gap-1.5 text-[#007185] hover:text-[#C7511F] font-mono text-[11px] transition-colors";
    phoneLink.innerHTML = `<i class="fa-solid fa-phone text-[#565959] text-[9px]"></i><span>${phone}</span>`;
    tdContact.append(phoneLink);
  }

  const wa = o.whatsApp_number || o.whatsapp_number;
  if (wa) {
    const cleanWa = String(wa).replace(/\D/g, "");
    const waLink = document.createElement("a");
    waLink.href = `https://wa.me/${cleanWa}`;
    waLink.target = "_blank";
    waLink.rel = "noopener noreferrer";
    waLink.className = "inline-flex items-center gap-1 text-[#067D62] hover:text-emerald-800 bg-[#E7F4EE] border border-[#C6F6D5] px-1.5 py-0.5 rounded font-bold text-[10px] transition-colors";
    waLink.innerHTML = `<i class="fa-brands fa-whatsapp text-[#067D62]"></i><span>${wa}</span>`;
    tdContact.append(waLink);
  }

  if (!phone && !wa) {
    tdContact.textContent = "—";
    tdContact.className = "py-3.5 px-4 text-[#565959]";
  }

  // 4. الموقع الجغرافي (GPS)
  const tdGps = document.createElement("td");
  tdGps.className = "py-3.5 px-4 text-center";

  const gpsUrl = o.GPS_URL || o.gps_url || o.gps;
  if (gpsUrl) {
    const fullGpsUrl = gpsUrl.startsWith("http") ? gpsUrl : `https://${gpsUrl}`;
    const gpsBtn = document.createElement("a");
    gpsBtn.href = fullGpsUrl;
    gpsBtn.target = "_blank";
    gpsBtn.rel = "noopener noreferrer";
    gpsBtn.className = "inline-flex items-center gap-1 bg-[#FFF8E7] hover:bg-[#FFECC2] text-[#B45309] font-bold px-2 py-0.5 rounded border border-[#FEEBC8] text-[11px] transition-colors";
    gpsBtn.innerHTML = '<i class="fa-solid fa-location-dot text-[#B12704]"></i><span>الموقع</span>';
    tdGps.append(gpsBtn);
  } else {
    tdGps.textContent = "—";
    tdGps.className = "py-3.5 px-4 text-center text-[#565959]";
  }

  // 5. الإجمالي المطلوب
  const tdPrice = document.createElement("td");
  tdPrice.className = "py-3.5 px-4 font-black text-[#067D62] text-sm";
  tdPrice.textContent = money(o.total_price);

  // 6. حالة الطلب (Dropdown معرب مع تحديث فوري)
  const statusCell = document.createElement("td");
  statusCell.className = "py-3.5 px-4";

  const select = document.createElement("select");
  select.className = "bg-[#F0F2F2] border border-[#D5D9D9] rounded px-2.5 py-1 text-xs font-bold text-[#0F1111] focus:outline-none focus:border-[#E77600] cursor-pointer";

  statuses.forEach((status) => {
    let label = status;
    if (status === "new") label = "جديد";
    if (status === "processing") label = "قيد التنفيذ";
    if (status === "delivered") label = "تم التوصيل";
    if (status === "cancelled") label = "ملغي";

    select.add(new Option(label, status, status === o.status, status === o.status));
  });

  select.onchange = async () => {
    const previousStatus = o.status;
    const newStatus = select.value;

    try {
      await request("/api/admin/update_status_of_order", {
        method: "PUT",
        body: {
          order_id: id(o),
          status_order: newStatus
        }
      });
      o.status = newStatus;
      toast("تم تحديث حالة الطلب بنجاح", "success");
      loadOverviewStats();
    } catch (error) {
      console.error("Update status error:", error);
      select.value = previousStatus;
      toast("تعذر تحديث حالة الطلب", "error");
    }
  };

  statusCell.append(select);

  // 7. إجراءات (معاينة التفاصيل + حذف الطلب)
  const actions = document.createElement("td");
  actions.className = "py-3.5 px-4 text-center";

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "inline-flex items-center gap-1.5";

  // زر عرض تفاصيل منتجات الطلب
  const viewBtn = document.createElement("button");
  viewBtn.className = "w-7 h-7 rounded border border-[#D5D9D9] bg-white hover:bg-[#F0F2F2] text-[#007185] inline-flex items-center justify-center text-xs transition-colors shadow-xs";
  viewBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
  viewBtn.title = "عرض المنتجات وتفاصيل الطلب";
  viewBtn.onclick = () => openOrderDetailsModal(o);

  // زر حذف الطلب
  const del = document.createElement("button");
  del.className = "w-7 h-7 rounded border border-[#D5D9D9] bg-white hover:bg-[#FCF4F4] text-[#B12704] inline-flex items-center justify-center text-xs transition-colors shadow-xs";
  del.innerHTML = '<i class="fa-solid fa-trash"></i>';
  del.title = "حذف الطلب";

  del.onclick = async () => {
    if (await confirm("هل أنت متأكد من رغبتك في حذف هذا الطلب نهائياً؟")) {
      try {
        await request("/api/admin/delete_order", {
          method: "DELETE",
          body: { order_id: id(o) }
        });

        tr.remove();
        orders = orders.filter((item) => id(item) !== id(o));
        ordersTotalCount = Math.max(0, ordersTotalCount - 1);

        toast("تم حذف الطلب بنجاح", "success");
        updateOrdersPagination();
        loadOverviewStats();
      } catch (error) {
        console.error("Delete order error:", error);
        toast("تعذر حذف الطلب", "error");
      }
    }
  };

  actionsWrap.append(viewBtn, del);
  actions.append(actionsWrap);

  tr.append(tdNum, tdUser, tdContact, tdGps, tdPrice, statusCell, actions);
  return tr;
}

// ======================================================
// نافذة تفاصيل الطلب والمنتجات (Order Details Modal)
// ======================================================
function setupOrderDetailsModal() {
  const modal = document.querySelector("#order-details-modal");
  const closeBtn = document.querySelector("#close-order-modal-btn");
  const closeFooterBtn = document.querySelector("#close-order-modal-footer-btn");

  const closeModal = () => {
    if (modal) modal.classList.add("hidden");
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  if (closeFooterBtn) closeFooterBtn.onclick = closeModal;
}

function openOrderDetailsModal(order) {
  const modal = document.querySelector("#order-details-modal");
  if (!modal) return;

  const numEl = document.querySelector("#modal-order-number");
  const nameEl = document.querySelector("#modal-customer-name");
  const dateEl = document.querySelector("#modal-order-date");
  const addressEl = document.querySelector("#modal-order-address");
  const totalEl = document.querySelector("#modal-order-total");
  const itemsList = document.querySelector("#modal-items-list");

  if (numEl) numEl.textContent = order.orderNumber || id(order)?.slice(-6) || "—";
  if (nameEl) nameEl.textContent = order.user_name || order.user?.name || "عميل مسجل";
  if (dateEl) dateEl.textContent = order.createdAt ? new Date(order.createdAt).toLocaleString("ar-EG") : "—";
  if (addressEl) addressEl.textContent = order.address || order.notes || "لا يوجد عنوان إضافي مدون";
  if (totalEl) totalEl.textContent = money(order.total_price);

  if (itemsList) {
    itemsList.innerHTML = "";
    const items = order.items || order.products || order.cart || [];

    if (items.length === 0) {
      itemsList.innerHTML = `<div class="p-3 text-center text-slate-400 text-xs">لا توجد تفاصيل للمنتجات مسجلة في هذا الطلب</div>`;
    } else {
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "p-2.5 flex items-center justify-between gap-3 text-xs";

        const left = document.createElement("div");
        left.className = "flex items-center gap-2.5";

        const img = document.createElement("img");
        const pNameStr = item.name || item.product_name || item.product?.name || "منتج";
        const imgSrc = resolveProductImage(item, products);
        img.src = imgSrc;
        img.alt = pNameStr;
        img.className = "w-9 h-9 object-contain rounded border border-[#E7E7E7] p-0.5 bg-white";
        setupImgFallback(img, pNameStr);

        const titleBox = document.createElement("div");
        const pName = document.createElement("h5");
        pName.className = "font-bold text-[#0F1111]";
        pName.textContent = item.name || item.product_name || item.product?.name || "منتج";

        const pQty = document.createElement("span");
        pQty.className = "text-[11px] text-[#565959] block";
        pQty.textContent = `الكمية: ${item.quantity || item.qty || 1} × ${money(item.price || item.unit_price || 0)}`;

        titleBox.append(pName, pQty);
        left.append(img, titleBox);

        const priceEl = document.createElement("strong");
        priceEl.className = "font-black text-[#0F1111]";
        const itemTotal = (Number(item.price || item.unit_price) || 0) * (Number(item.quantity || item.qty) || 1);
        priceEl.textContent = money(itemTotal || item.total);

        row.append(left, priceEl);
        itemsList.append(row);
      });
    }
  }

  modal.classList.remove("hidden");
}

// بدء التشغيل
init();