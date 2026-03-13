/* ═══════════════════════════════════════════════════════════════════
   OVM CLO — cart.js
   Client-side cart (localStorage), Paystack checkout, UI interactions
   ═══════════════════════════════════════════════════════════════════ */

// ─── CONFIG ────────────────────────────────────────────────────────
// ⚠️  Replace with your live Paystack public key:
//     https://dashboard.paystack.com/#/settings/developer
const PKEY = 'pk_test_689da17b94cdc8cdd495f7c0864aad1d3838e462';

// ─── PRODUCT CATALOGUE ─────────────────────────────────────────────
// Mirrors the products rendered in index.html.
// Update prices here if they change in the HTML.
const PRODUCTS = {
  1: { name: 'Ovm Retro Jersey',      price: 55500, pClass: 'p1' },
  2: { name: 'Baddies White Polo',   price: 60000, pClass: 'p2' },
  3: { name: 'Baddies Red Polo',        price: 60000, pClass: 'p3' },
  4: { name: 'Kente Bomber Jacket',     price: 85000, pClass: 'p4' },
  5: { name: 'Naija Wave Tee — Red',    price: 25000, pClass: 'p5' },
  6: { name: 'Adire Pullover — White',  price: 48000, pClass: 'p6' },
};

const STORE_KEY = 'ovm_clo_cart';

// ─── STORAGE HELPERS ───────────────────────────────────────────────
function loadCartData() {
  try   { return JSON.parse(localStorage.getItem(STORE_KEY)) || { items: [] }; }
  catch { return { items: [] }; }
}

function saveCartData(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
}

// ─── CART CALCULATIONS ─────────────────────────────────────────────
function cartTotal(items) {
  return items.reduce((sum, it) => sum + it.price * it.quantity, 0);
}

function cartCount(items) {
  return items.reduce((sum, it) => sum + it.quantity, 0);
}

function shippingCost(total) {
  return total >= 50000 ? 0 : 3500;
}

// ─── ADD TO CART ───────────────────────────────────────────────────
function addToCart(pid, size) {
  const product = PRODUCTS[pid];
  if (!product) return false;

  const data     = loadCartData();
  const existing = data.items.find(i => i.pid === pid && i.size === size);

  if (existing) {
    existing.quantity += 1;
  } else {
    data.items.push({
      id:       Date.now(),      // unique key for qty/remove ops
      pid,
      name:     product.name,
      price:    product.price,
      size,
      pClass:   product.pClass,
      quantity: 1,
    });
  }

  saveCartData(data);
  renderBadge();
  return true;
}

// ─── BADGE ─────────────────────────────────────────────────────────
function renderBadge() {
  const { items } = loadCartData();
  const n = cartCount(items);
  const badge = document.getElementById('cart-badge');
  badge.textContent = n;
  badge.classList.toggle('visible', n > 0);
}

// ─── TOAST ─────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const wrap = document.getElementById('toasts');
  const el   = document.createElement('div');
  el.className   = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 4000);
}

// ─── SIZE SELECTORS ────────────────────────────────────────────────
document.querySelectorAll('.product-overlay').forEach(ov => {
  const sizes  = JSON.parse(ov.dataset.sizes || '["S","M","L","XL"]');
  const sWrap  = ov.querySelector('.size-selector');
  const addBtn = ov.querySelector('.product-add');
  let   chosen = sizes[Math.min(1, sizes.length - 1)];

  sizes.forEach((sz, i) => {
    const btn = document.createElement('button');
    btn.className   = 'size-btn' + (i === 1 ? ' active' : '');
    btn.textContent = sz;
    btn.onclick = e => {
      e.stopPropagation();
      sWrap.querySelectorAll('.size-btn').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      chosen = sz;
    };
    sWrap.appendChild(btn);
  });

  addBtn.onclick = e => {
    e.stopPropagation();
    const pid  = parseInt(ov.dataset.pid);
    const name = ov.dataset.name;

    if (addToCart(pid, chosen)) {
      toast(`✓  ${name}  ·  Size ${chosen}  added to bag`, 'ok');
      addBtn.style.background = '#4a7c59';
      addBtn.style.color      = '#faf8f3';
      addBtn.textContent      = '✓ Added';
      setTimeout(() => {
        addBtn.style.background = '';
        addBtn.style.color      = '';
        addBtn.textContent      = 'Add to Bag';
      }, 1400);
    }
  };
});

// ─── CART DRAWER ───────────────────────────────────────────────────
const drawer  = document.getElementById('cart-drawer');
const overlay = document.getElementById('cart-overlay');

function openCart()  {
  drawer.classList.add('open');
  overlay.classList.add('open');
  showCartPanel();
  renderCart();
}
function closeCart() {
  drawer.classList.remove('open');
  overlay.classList.remove('open');
}
function showCartPanel() {
  document.getElementById('cart-panel').style.cssText =
    'display:flex;flex-direction:column;flex:1;overflow:hidden;';
  document.getElementById('checkout-panel').style.display = 'none';
}
function showCheckout() {
  document.getElementById('cart-panel').style.display = 'none';
  document.getElementById('checkout-panel').style.display = 'block';
}

document.getElementById('close-cart').onclick        = closeCart;
overlay.onclick                                       = closeCart;
document.getElementById('nav-cart-btn').onclick      = openCart;
document.getElementById('btn-goto-checkout').onclick = () => {
  const { items } = loadCartData();
  if (!items.length) { toast('Your bag is empty', ''); return; }
  showCheckout();
};
document.getElementById('btn-back').onclick = showCartPanel;

// ─── RENDER CART ───────────────────────────────────────────────────
function renderCart() {
  const { items } = loadCartData();
  renderBadge();

  const bodyEl   = document.getElementById('cart-body');
  const footerEl = document.getElementById('cart-footer');

  if (!items.length) {
    bodyEl.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-title">Bag is Empty</div>
        <div class="cart-empty-sub">Go find something beautiful.</div>
      </div>`;
    footerEl.style.display = 'none';
    return;
  }
  footerEl.style.display = 'block';

  bodyEl.innerHTML = items.map(it => `
    <div class="cart-item">
      <div class="cart-item-img ${it.pClass}"></div>
      <div class="cart-item-body">
        <div class="cart-item-name">${it.name}</div>
        <div class="cart-item-size">Size: ${it.size}</div>
        <div class="cart-qty-wrap">
          <button class="qty-btn" onclick="adjustQty(${it.id}, ${it.quantity - 1})">−</button>
          <span  class="qty-val">${it.quantity}</span>
          <button class="qty-btn" onclick="adjustQty(${it.id}, ${it.quantity + 1})">+</button>
        </div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">₦${(it.price * it.quantity).toLocaleString('en-NG')}</div>
        <button class="cart-remove-btn" onclick="removeItem(${it.id})">Remove</button>
      </div>
    </div>
  `).join('');

  const total = cartTotal(items);
  const ship  = shippingCost(total);
  const grand = total + ship;

  document.getElementById('c-subtotal').textContent = `₦${total.toLocaleString('en-NG')}`;
  document.getElementById('c-shipping').innerHTML   = ship === 0
    ? '<span style="color:var(--red);font-weight:700">FREE</span>'
    : `₦${ship.toLocaleString('en-NG')}`;
  document.getElementById('c-total').textContent    = `₦${grand.toLocaleString('en-NG')}`;
  document.getElementById('free-note').style.display = ship > 0 ? 'block' : 'none';
}

// ─── QTY / REMOVE ──────────────────────────────────────────────────
window.adjustQty = (id, qty) => {
  const data = loadCartData();
  if (qty < 1) {
    data.items = data.items.filter(i => i.id !== id);
  } else {
    const it = data.items.find(i => i.id === id);
    if (it) it.quantity = qty;
  }
  saveCartData(data);
  renderCart();
};

window.removeItem = id => {
  const data  = loadCartData();
  data.items  = data.items.filter(i => i.id !== id);
  saveCartData(data);
  toast('Item removed from bag');
  renderCart();
};

// ─── PAYSTACK CHECKOUT ─────────────────────────────────────────────
document.getElementById('btn-pay').onclick = async function () {
  const name    = document.getElementById('f-name').value.trim();
  const email   = document.getElementById('f-email').value.trim();
  const phone   = document.getElementById('f-phone').value.trim();
  const address = document.getElementById('f-address').value.trim();
  const city    = document.getElementById('f-city').value.trim()  || 'Lagos';
  const state   = document.getElementById('f-state').value.trim() || 'Lagos';

  if (!name)                { toast('Please enter your full name', '');         return; }
  if (!email.includes('@')) { toast('Please enter a valid email address', ''); return; }
  if (!address)             { toast('Please enter your delivery address', '');  return; }

  const { items } = loadCartData();
  if (!items.length) { toast('Your bag is empty', ''); return; }

  const total = cartTotal(items);
  const ship  = shippingCost(total);
  const grand = total + ship;
  const self = this;
  self.textContent = 'Preparing order...';
self.disabled    = true;

const orderRes = await fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    shipping_info: { name, email, phone, address, city, state },
    payment_method: 'paystack',
    items: items.map(i => ({
      product_id:   i.pid,
      product_name: i.name,
      size:         i.size,
      quantity:     i.quantity,
      unit_price:   i.price,
      total_price:  i.price * i.quantity,
    })),
    subtotal: total,
    shipping_cost: ship,
    total:    grand,
  }),
}).then(r => r.json());

if (!orderRes.ok) {
  toast(orderRes.error || 'Could not create order. Try again.', '');
  self.textContent = 'PAY WITH PAYSTACK →';
  self.disabled    = false;
  return;
}

const ref = orderRes.data.order_number;
self.textContent = 'Opening Paystack...';

const handler = PaystackPop.setup({
  key:      PKEY,
  email,
  amount:   grand * 100,
  currency: 'NGN',
  ref,
  label:    `OVM CLO — ${name}`,
  metadata: {
    custom_fields: [
      { display_name: 'Name',    variable_name: 'name',    value: name },
      { display_name: 'Phone',   variable_name: 'phone',   value: phone },
      { display_name: 'Address', variable_name: 'address',
        value: `${address}, ${city}, ${state}` },
      { display_name: 'Order',   variable_name: 'order',   value: ref },
      { display_name: 'Items',   variable_name: 'items',
        value: items.map(i => `${i.name} (${i.size}) x${i.quantity}`).join(', ') },
    ],
  },
  callback: function () {
    fetch(`/api/orders/${orderRes.data.order_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: 'paid', payment_status: 'paid' }),
    });
    saveCartData({ items: [] });
    renderBadge();
    closeCart();
    showCartPanel();
    ['f-name','f-email','f-phone','f-address','f-city','f-state']
      .forEach(fid => { document.getElementById(fid).value = ''; });
    toast(`✓ Payment successful! Order ${ref} confirmed.`, 'ok');
  },
  onClose: function () {
    toast('Payment cancelled. Your bag is still saved.', '');
    self.textContent = 'PAY WITH PAYSTACK →';
    self.disabled    = false;
  },
});

handler.openIframe();
};

// ─── NEWSLETTER ────────────────────────────────────────────────────
// Stores locally for now — wire to your email API in production.

document.getElementById('nl-btn').addEventListener('click', async function () {
  const input = document.getElementById('nl-email');
  const email = input.value.trim();
  if (!email.includes('@')) { toast('Enter a valid email address', ''); return; }

  const nlRes = await fetch('/api/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).then(r => r.json());

  if (!nlRes.ok) {
    toast(nlRes.error || 'Could not subscribe. Try again.', '');
    return;
  }

  this.textContent      = 'JOINED ✓';
  this.style.background = '#4a7c59';
  toast('Youre Exclusive!', 'ok');
  input.value = '';
});

// ─── SCROLL REVEAL ─────────────────────────────────────────────────
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ─── INIT ──────────────────────────────────────────────────────────
renderBadge();
