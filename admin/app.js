// پنل مدیریت دایان — بدون وابستگی و بدون مرحله‌ی build.
// همه‌ی متن‌های کاربر با textContent رندر می‌شوند (نه innerHTML) تا XSS ممکن نباشد.

// ───────── ابزارهای کوچک ─────────
function h(tag, props, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k in el && k !== 'list') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  const add = (kid) => {
    if (Array.isArray(kid)) return kid.forEach(add)
    if (kid === null || kid === undefined || kid === false) return
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  kids.forEach(add)
  return el
}

const FA = '۰۱۲۳۴۵۶۷۸۹'
const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660)
const toNum = (s) => {
  const t = toLatin(s).replace(/[^\d]/g, '')
  return t === '' ? NaN : Number(t)
}
const fmt = (n) => Number(n).toLocaleString('fa-IR')
const money = (n) => `${fmt(n)} تومان`
const date = (iso) => new Date(iso).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' })

const STATUS = {
  new: 'جدید', confirmed: 'تأیید شده', processing: 'در حال آماده‌سازی',
  shipped: 'ارسال شد', delivered: 'تحویل شد', cancelled: 'لغو شده',
}
const pill = (status) => h('span', { class: `pill ${status}` }, STATUS[status] || status)

function toast(message, type = '') {
  const el = h('div', { class: `toast ${type}`, role: 'status' }, message)
  document.getElementById('toasts').append(el)
  setTimeout(() => el.remove(), 4000)
}

// ───────── API ─────────
class ApiError extends Error {
  constructor(status, message, issues) {
    super(message)
    this.status = status
    this.issues = issues || []
  }
}

async function api(method, url, body) {
  const headers = { 'X-Requested-With': 'dian-admin' }
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`/api/admin${url}`, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'ارتباط با سرور برقرار نشد.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // نشست وسط کار منقضی شد ⇒ برگرد به صفحه‌ی ورود. (برای /me و /login نه؛ وگرنه حلقه‌ی بی‌نهایت می‌شود)
    if (res.status === 401 && state.admin && url !== '/me' && url !== '/login') {
      state.admin = null
      render()
    }
    throw new ApiError(res.status, data.error || 'خطای ناشناخته', data.issues)
  }
  return data
}

const state = { admin: null, stats: null }
let renderToken = 0

// ───────── اجزای مشترک ─────────
function field(label, input, hint) {
  return h('label', { class: 'field' }, label, input, hint ? h('small', {}, hint) : null)
}

function showError(box, err) {
  box.replaceChildren(
    err.message,
    ...(err.issues || []).slice(1).map((i) => h('div', {}, `${i.path ? i.path + ': ' : ''}${i.message}`)),
  )
}

/** دکمه‌ای که حین اجرای عملیات غیرفعال می‌شود */
function busyButton(label, cls, action) {
  const btn = h('button', { type: 'button', class: `btn ${cls}` }, label)
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      await action()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      btn.disabled = false
    }
  })
  return btn
}

function pager(page, total, size, go) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (pages <= 1) return null
  return h('div', { class: 'pager' },
    h('button', { class: 'btn small', disabled: page <= 1, onclick: () => go(page - 1) }, 'قبلی'),
    h('span', {}, `صفحه ${fmt(page)} از ${fmt(pages)}`),
    h('button', { class: 'btn small', disabled: page >= pages, onclick: () => go(page + 1) }, 'بعدی'),
  )
}

const emptyBox = (text) => h('div', { class: 'card empty' }, text)

// ───────── ورود ─────────
function loginView() {
  const err = h('p', { class: 'err', role: 'alert' })
  const email = h('input', { type: 'email', class: 'ltr', autocomplete: 'username', required: true })
  const pass = h('input', { type: 'password', class: 'ltr', autocomplete: 'current-password', required: true })
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'ورود')
  const form = h('form', { class: 'login-card' },
    h('div', { class: 'logo' }, 'D'),
    h('h1', {}, 'پنل مدیریت تاسیسات دایان'),
    h('p', {}, 'برای ادامه وارد شوید.'),
    field('ایمیل', email),
    field('رمز عبور', pass),
    err,
    btn,
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    btn.disabled = true
    err.textContent = ''
    try {
      const r = await api('POST', '/login', { email: email.value, password: pass.value })
      state.admin = r.admin
      location.hash = '#/dashboard'
      render()
    } catch (ex) {
      showError(err, ex)
    } finally {
      btn.disabled = false
    }
  })
  return h('div', { class: 'login-wrap' }, form)
}

// ───────── داشبورد ─────────
async function dashboardView() {
  const [stats, orders] = await Promise.all([api('GET', '/stats'), api('GET', '/orders?limit=6')])
  state.stats = stats
  const stat = (label, value, warn) => h('div', { class: `card stat ${warn ? 'warn' : ''}` }, h('b', {}, value), h('span', {}, label))
  return h('div', {},
    h('div', { class: 'topbar' }, h('h1', {}, 'داشبورد')),
    h('div', { class: 'cards' },
      stat('سفارش جدید', fmt(stats.newOrders), stats.newOrders > 0),
      stat('کل سفارش‌ها', fmt(stats.totalOrders)),
      stat('مجموع فروش (بدون لغوشده‌ها)', money(stats.salesTotal)),
      stat('استعلام جدید', fmt(stats.newInquiries), stats.newInquiries > 0),
      stat('پیام خوانده‌نشده', fmt(stats.unreadMessages), stats.unreadMessages > 0),
      stat('محصول فعال', fmt(stats.activeProducts)),
      stat('محصول ناموجود', fmt(stats.outOfStock), stats.outOfStock > 0),
    ),
    h('h2', {}, 'آخرین سفارش‌ها'),
    ordersTable(orders.items),
  )
}

// ───────── سفارش‌ها ─────────
function ordersTable(items) {
  if (!items.length) return emptyBox('سفارشی ثبت نشده است.')
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['کد', 'مشتری', 'موبایل', 'تعداد', 'مبلغ', 'وضعیت', 'تاریخ'].map((t) => h('th', {}, t)))),
    h('tbody', {}, items.map((o) =>
      h('tr', { class: 'clickable', onclick: () => (location.hash = `#/orders/${o.id}`) },
        h('td', { class: 'ltr' }, o.code),
        h('td', {}, o.customer.name),
        h('td', { class: 'ltr' }, o.customer.phone),
        h('td', {}, fmt(o.itemCount)),
        h('td', {}, money(o.total)),
        h('td', {}, pill(o.status)),
        h('td', {}, date(o.createdAt)),
      ))),
  ))
}

const listState = { orders: { page: 1, status: '', q: '' }, products: { page: 1, q: '', category: '' }, inquiries: { status: '' } }

async function ordersView() {
  const s = listState.orders
  const params = new URLSearchParams({ page: s.page, limit: 20 })
  if (s.status) params.set('status', s.status)
  if (s.q) params.set('q', s.q)
  const data = await api('GET', `/orders?${params}`)

  const status = h('select', { onchange: (e) => { s.status = e.target.value; s.page = 1; render() } },
    h('option', { value: '' }, 'همه‌ی وضعیت‌ها'),
    ...Object.entries(STATUS).map(([v, l]) => h('option', { value: v, selected: v === s.status }, l)))
  const q = h('input', { type: 'search', value: s.q, placeholder: 'جستجو: کد، نام یا موبایل', onkeydown: (e) => { if (e.key === 'Enter') { s.q = e.target.value.trim(); s.page = 1; render() } } })
  return h('div', {},
    h('div', { class: 'topbar' }, h('h1', {}, 'سفارش‌ها'), h('div', { class: 'row' }, q, status)),
    ordersTable(data.items),
    pager(s.page, data.total, 20, (p) => { s.page = p; render() }),
  )
}

async function orderDetailView(id) {
  const o = await api('GET', `/orders/${id}`)
  const c = o.customer
  const status = h('select', { disabled: o.status === 'cancelled' },
    ...Object.entries(STATUS).map(([v, l]) => h('option', { value: v, selected: v === o.status }, l)))
  const note = h('textarea', { placeholder: 'یادداشت داخلی (برای مشتری نمایش داده نمی‌شود)' })
  note.value = o.adminNote

  const save = busyButton('ذخیره تغییرات', 'primary', async () => {
    if (status.value === 'cancelled' && o.status !== 'cancelled' && !confirm('با لغو سفارش، موجودی کالاها برمی‌گردد و دیگر قابل تغییر نیست. ادامه می‌دهید؟')) return
    await api('PATCH', `/orders/${id}`, { status: status.value, adminNote: note.value })
    toast('ذخیره شد.', 'ok')
    render()
  })

  return h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('h1', {}, `سفارش ${o.code}`), h('a', { href: '#/orders' }, '← بازگشت به سفارش‌ها')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', {}, 'مشتری'), h('dl', { class: 'kv' },
        h('dt', {}, 'نام'), h('dd', {}, c.name),
        h('dt', {}, 'موبایل'), h('dd', { class: 'ltr' }, h('a', { href: `tel:${c.phone}` }, c.phone)),
        h('dt', {}, 'ایمیل'), h('dd', { class: 'ltr' }, c.email || '—'),
        h('dt', {}, 'استان / شهر'), h('dd', {}, `${c.province}، ${c.city}`),
        h('dt', {}, 'نشانی'), h('dd', {}, c.address),
        h('dt', {}, 'کدپستی'), h('dd', { class: 'ltr' }, c.postalCode || '—'),
        h('dt', {}, 'توضیحات مشتری'), h('dd', {}, o.notes || '—'),
      )),
      h('div', { class: 'card stack' }, h('h3', {}, 'وضعیت'),
        h('div', {}, 'ثبت: ', date(o.createdAt), ' · ', pill(o.status)),
        field('تغییر وضعیت', status), field('یادداشت داخلی', note), save),
    ),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['', 'کالا', 'قیمت واحد', 'تعداد', 'جمع'].map((t) => h('th', {}, t)))),
      h('tbody', {}, o.items.map((i) => h('tr', {},
        h('td', {}, i.image ? h('img', { class: 'thumb', src: i.image, alt: '' }) : null),
        h('td', {}, i.name, i.productId ? null : h('span', { class: 'hint' }, ' (محصول حذف شده)')),
        h('td', {}, money(i.unitPrice)), h('td', {}, fmt(i.qty)), h('td', {}, money(i.unitPrice * i.qty))))),
    )),
    h('div', { class: 'card' }, h('dl', { class: 'kv' },
      h('dt', {}, 'جمع کالاها'), h('dd', {}, money(o.itemsTotal)),
      h('dt', {}, 'هزینه ارسال'), h('dd', {}, o.shippingCost ? money(o.shippingCost) : 'هماهنگی تلفنی / رایگان'),
      h('dt', {}, 'مبلغ کل'), h('dd', {}, h('b', {}, money(o.total))))),
  )
}

// ───────── محصولات ─────────
async function productsView() {
  const s = listState.products
  const params = new URLSearchParams({ page: s.page, limit: 20 })
  if (s.q) params.set('q', s.q)
  if (s.category) params.set('category', s.category)
  const [data, cats] = await Promise.all([api('GET', `/products?${params}`), api('GET', '/categories')])

  const catSel = h('select', { onchange: (e) => { s.category = e.target.value; s.page = 1; render() } },
    h('option', { value: '' }, 'همه‌ی دسته‌ها'),
    ...cats.items.map((c) => h('option', { value: c.slug, selected: c.slug === s.category }, c.name)))
  const q = h('input', { type: 'search', value: s.q, placeholder: 'جستجوی محصول…', onkeydown: (e) => { if (e.key === 'Enter') { s.q = e.target.value.trim(); s.page = 1; render() } } })

  const rows = data.items.map((p) => h('tr', {},
    h('td', {}, p.image ? h('img', { class: 'thumb', src: p.image, alt: '' }) : h('div', { class: 'thumb' })),
    h('td', {}, h('a', { href: `#/products/${p.id}` }, p.name), p.brand ? h('div', { class: 'hint' }, p.brand) : null),
    h('td', {}, p.category ? p.category.name : '—'),
    h('td', {}, money(p.price)),
    h('td', {}, p.trackStock ? (p.stock > 0 ? fmt(p.stock) : h('span', { class: 'pill off' }, 'ناموجود')) : 'نامحدود'),
    h('td', {}, h('span', { class: `pill ${p.isActive ? 'ok' : 'off'}` }, p.isActive ? 'فعال' : 'غیرفعال')),
    h('td', { class: 'row' },
      h('a', { class: 'btn small', href: `#/products/${p.id}` }, 'ویرایش'),
      busyButton('حذف', 'small danger', async () => {
        if (!confirm(`محصول «${p.name}» حذف شود؟ سفارش‌های قبلی آن حفظ می‌شود.`)) return
        await api('DELETE', `/products/${p.id}`)
        toast('حذف شد.', 'ok')
        render()
      })),
  ))

  return h('div', {},
    h('div', { class: 'topbar' }, h('h1', {}, `محصولات (${fmt(data.total)})`),
      h('div', { class: 'row' }, q, catSel, h('a', { class: 'btn gold', href: '#/products/new' }, '+ محصول جدید'))),
    rows.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['', 'نام', 'دسته', 'قیمت', 'موجودی', 'وضعیت', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, rows)))
      : emptyBox('محصولی پیدا نشد. با «محصول جدید» اولین کالا را اضافه کنید.'),
    pager(s.page, data.total, 20, (p) => { s.page = p; render() }),
  )
}

async function productFormView(id) {
  const [cats, existing] = await Promise.all([api('GET', '/categories'), id ? api('GET', `/products/${id}`) : null])
  const p = existing || { name: '', brand: '', sku: '', shortDescription: '', description: '', price: '', oldPrice: null, trackStock: false, stock: 0, badge: '', warranty: '', features: [], specs: [], images: [], isActive: true, isFeatured: false, categoryId: null }

  const f = {
    name: h('input', { type: 'text', value: p.name, required: true }),
    brand: h('input', { type: 'text', value: p.brand }),
    sku: h('input', { type: 'text', class: 'ltr', value: p.sku || '' }),
    category: h('select', {}, h('option', { value: '' }, '— بدون دسته —'),
      ...cats.items.map((c) => h('option', { value: c.id, selected: c.id === p.categoryId }, c.name + (c.isActive ? '' : ' (غیرفعال)')))),
    price: h('input', { type: 'text', inputMode: 'numeric', value: p.price === '' ? '' : String(p.price), placeholder: 'تومان' }),
    oldPrice: h('input', { type: 'text', inputMode: 'numeric', value: p.oldPrice ? String(p.oldPrice) : '', placeholder: 'اختیاری؛ برای نمایش تخفیف' }),
    track: h('input', { type: 'checkbox', checked: p.trackStock }),
    stock: h('input', { type: 'text', inputMode: 'numeric', value: String(p.stock || 0) }),
    badge: h('input', { type: 'text', value: p.badge, placeholder: 'مثلاً پرفروش' }),
    warranty: h('input', { type: 'text', value: p.warranty }),
    short: h('input', { type: 'text', value: p.shortDescription }),
    desc: h('textarea', {}),
    features: h('textarea', { placeholder: 'هر ویژگی در یک خط' }),
    active: h('input', { type: 'checkbox', checked: p.isActive }),
    featured: h('input', { type: 'checkbox', checked: p.isFeatured }),
  }
  f.desc.value = p.description
  f.features.value = p.features.join('\n')
  f.stock.disabled = !f.track.checked
  f.track.addEventListener('change', () => { f.stock.disabled = !f.track.checked })

  // ویرایشگر مشخصات فنی
  const specsBox = h('div', { class: 'stack' })
  const addSpec = (label = '', value = '') => {
    const row = h('div', { class: 'spec-row' },
      h('input', { type: 'text', value: label, placeholder: 'عنوان (مثلاً توان)', 'data-k': 'label' }),
      h('input', { type: 'text', value, placeholder: 'مقدار (مثلاً ۲۴ کیلووات)', 'data-k': 'value' }),
      h('button', { type: 'button', class: 'btn small danger', onclick: () => row.remove() }, 'حذف'))
    specsBox.append(row)
  }
  p.specs.forEach((s) => addSpec(s.label, s.value))

  // تصاویر
  let images = [...p.images]
  const imgBox = h('div', { class: 'images' })
  const drawImages = () => {
    imgBox.replaceChildren(...images.map((url, i) => h('div', { class: `img-item ${i === 0 ? 'main' : ''}` },
      h('img', { src: url, alt: '' }),
      i === 0 ? h('span', { class: 'hint' }, 'تصویر اصلی') : h('button', { type: 'button', class: 'btn small', onclick: () => { images.unshift(images.splice(i, 1)[0]); drawImages() } }, 'اصلی کن'),
      h('button', { type: 'button', class: 'btn small danger', onclick: () => { images.splice(i, 1); drawImages() } }, 'حذف'))))
    if (!images.length) imgBox.append(h('span', { class: 'hint' }, 'هنوز تصویری اضافه نشده.'))
  }
  drawImages()
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true })
  fileInput.addEventListener('change', async () => {
    for (const file of fileInput.files) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const r = await api('POST', '/uploads', fd)
        images.push(r.url)
        drawImages()
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error')
      }
    }
    fileInput.value = ''
  })

  const err = h('div', { class: 'err', role: 'alert' })
  const save = busyButton(id ? 'ذخیره تغییرات' : 'ایجاد محصول', 'primary', async () => {
    err.textContent = ''
    const price = toNum(f.price.value)
    const old = f.oldPrice.value.trim() ? toNum(f.oldPrice.value) : null
    const specs = [...specsBox.children]
      .map((r) => ({ label: r.querySelector('[data-k=label]').value.trim(), value: r.querySelector('[data-k=value]').value.trim() }))
      .filter((s) => s.label && s.value)
    const payload = {
      categoryId: f.category.value ? Number(f.category.value) : null,
      name: f.name.value, brand: f.brand.value, sku: f.sku.value.trim() || null,
      shortDescription: f.short.value, description: f.desc.value,
      price: Number.isNaN(price) ? -1 : price, oldPrice: Number.isNaN(old) ? -1 : old,
      trackStock: f.track.checked, stock: f.track.checked ? (toNum(f.stock.value) || 0) : 0,
      badge: f.badge.value, warranty: f.warranty.value,
      features: f.features.value.split('\n').map((x) => x.trim()).filter(Boolean),
      specs, images, isActive: f.active.checked, isFeatured: f.featured.checked,
    }
    try {
      const saved = id ? await api('PUT', `/products/${id}`, payload) : await api('POST', '/products', payload)
      toast('ذخیره شد.', 'ok')
      location.hash = `#/products/${saved.id}`
      if (id) render()
    } catch (e) {
      showError(err, e)
      throw e
    }
  })

  return h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('h1', {}, id ? `ویرایش: ${p.name}` : 'محصول جدید'), h('a', { href: '#/products' }, '← بازگشت به محصولات')),
    h('div', { class: 'card stack' },
      h('div', { class: 'grid2' }, field('نام محصول *', f.name), field('برند', f.brand)),
      h('div', { class: 'grid3' }, field('دسته‌بندی', f.category, cats.items.length ? '' : 'ابتدا از بخش «دسته‌ها» یک دسته بسازید.'), field('کد کالا (SKU)', f.sku), field('نشان (Badge)', f.badge)),
      h('div', { class: 'grid2' }, field('قیمت (تومان) *', f.price), field('قیمت قبلی (تومان)', f.oldPrice, 'اگر از قیمت فعلی بیشتر باشد، درصد تخفیف نمایش داده می‌شود.')),
      h('div', { class: 'grid2' },
        h('div', { class: 'stack' }, h('label', { class: 'check' }, f.track, 'مدیریت موجودی'), field('تعداد موجود', f.stock, 'اگر مدیریت موجودی خاموش باشد، موجودی نامحدود است.')),
        field('گارانتی', f.warranty)),
      field('توضیح کوتاه', f.short), field('توضیحات کامل', f.desc), field('ویژگی‌ها', f.features),
    ),
    h('div', { class: 'card stack' }, h('h3', {}, 'مشخصات فنی'), specsBox,
      h('div', {}, h('button', { type: 'button', class: 'btn small', onclick: () => addSpec() }, '+ افزودن مشخصه'))),
    h('div', { class: 'card stack' }, h('h3', {}, 'تصاویر'), imgBox, field('افزودن تصویر (JPG / PNG / WebP، حداکثر ۵ مگابایت)', fileInput)),
    h('div', { class: 'card row' }, h('label', { class: 'check' }, f.active, 'فعال (نمایش در سایت)'), h('label', { class: 'check' }, f.featured, 'محصول ویژه')),
    err,
    h('div', { class: 'row' }, save, h('a', { class: 'btn', href: '#/products' }, 'انصراف')),
  )
}

// ───────── دسته‌ها ─────────
async function categoriesView() {
  const { items } = await api('GET', '/categories')
  const form = (c) => {
    const f = {
      name: h('input', { type: 'text', value: c.name || '' }),
      slug: h('input', { type: 'text', class: 'ltr', value: c.slug || '', placeholder: 'gas-boiler' }),
      desc: h('input', { type: 'text', value: c.description || '' }),
      order: h('input', { type: 'text', inputMode: 'numeric', value: String(c.sortOrder ?? 0) }),
      active: h('input', { type: 'checkbox', checked: c.isActive ?? true }),
    }
    const err = h('div', { class: 'err', role: 'alert' })
    const save = busyButton(c.id ? 'ذخیره' : 'افزودن دسته', 'primary', async () => {
      err.textContent = ''
      const payload = { name: f.name.value, slug: f.slug.value, description: f.desc.value, sortOrder: toNum(f.order.value) || 0, isActive: f.active.checked, image: c.image || null }
      try {
        if (c.id) await api('PUT', `/categories/${c.id}`, payload)
        else await api('POST', '/categories', payload)
        toast('ذخیره شد.', 'ok')
        render()
      } catch (e) { showError(err, e); throw e }
    })
    return h('div', { class: 'card stack' },
      h('div', { class: 'grid3' },
        field('نام دسته *', f.name),
        field('شناسه لاتین *', f.slug, 'در آدرس سایت استفاده می‌شود؛ فقط حروف کوچک لاتین، عدد و خط تیره.'),
        field('ترتیب نمایش', f.order, 'عدد کمتر، بالاتر')),
      field('توضیح کوتاه', f.desc),
      h('label', { class: 'check' }, f.active, 'فعال'),
      err,
      h('div', { class: 'row' }, save,
        c.id ? busyButton('حذف', 'danger', async () => {
          if (!confirm(`دسته «${c.name}» حذف شود؟ محصولات آن بدون دسته می‌مانند.`)) return
          await api('DELETE', `/categories/${c.id}`)
          toast('حذف شد.', 'ok')
          render()
        }) : null))
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('h1', {}, 'دسته‌بندی‌ها')),
    h('h3', {}, 'دسته‌ی جدید'), form({}),
    h('h3', {}, `دسته‌های موجود (${fmt(items.length)})`),
    items.length ? items.map((c) => h('details', { class: 'card' },
      h('summary', {}, c.name, ' ', h('span', { class: 'hint ltr' }, c.slug), ' · ', `${fmt(c.productCount)} محصول`, c.isActive ? null : ' · غیرفعال'),
      form(c))) : emptyBox('هنوز دسته‌ای نساخته‌اید.'),
  )
}

// ───────── استعلام‌ها و پیام‌ها ─────────
async function inquiriesView() {
  const s = listState.inquiries
  const data = await api('GET', `/inquiries?limit=100${s.status ? `&status=${s.status}` : ''}`)
  const sel = h('select', { onchange: (e) => { s.status = e.target.value; render() } },
    h('option', { value: '' }, 'همه'), h('option', { value: 'new', selected: s.status === 'new' }, 'جدید'), h('option', { value: 'handled', selected: s.status === 'handled' }, 'رسیدگی‌شده'))
  return h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('h1', {}, 'استعلام‌ها'), sel),
    data.items.length ? data.items.map((i) => h('div', { class: `msg ${i.status === 'new' ? 'unread' : ''}` },
      h('div', { class: 'row' }, h('b', {}, i.name), h('a', { class: 'ltr', href: `tel:${i.phone}` }, i.phone), h('span', { class: 'hint' }, date(i.createdAt)),
        h('span', { class: `pill ${i.status === 'new' ? 'new' : 'ok'}` }, i.status === 'new' ? 'جدید' : 'رسیدگی شد')),
      i.productName ? h('div', {}, 'محصول: ', h('a', { href: `#/products/${i.productId}` }, i.productName)) : null,
      i.message ? h('p', {}, i.message) : null,
      h('div', { class: 'row' },
        busyButton(i.status === 'new' ? 'رسیدگی شد' : 'بازگرداندن به جدید', 'small', async () => { await api('PATCH', `/inquiries/${i.id}`, { status: i.status === 'new' ? 'handled' : 'new' }); render() }),
        busyButton('حذف', 'small danger', async () => { if (confirm('حذف شود؟')) { await api('DELETE', `/inquiries/${i.id}`); render() } })),
    )) : emptyBox('استعلامی وجود ندارد.'),
  )
}

async function messagesView() {
  const data = await api('GET', '/messages?limit=100')
  return h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('h1', {}, 'پیام‌های فرم تماس')),
    data.items.length ? data.items.map((m) => h('div', { class: `msg ${m.isRead ? '' : 'unread'}` },
      h('div', { class: 'row' }, h('b', {}, m.name),
        m.phone ? h('a', { class: 'ltr', href: `tel:${m.phone}` }, m.phone) : null,
        m.email ? h('a', { class: 'ltr', href: `mailto:${m.email}` }, m.email) : null,
        m.topic ? h('span', { class: 'pill' }, m.topic) : null, h('span', { class: 'hint' }, date(m.createdAt))),
      h('p', {}, m.message),
      h('div', { class: 'row' },
        busyButton(m.isRead ? 'علامت‌گذاری خوانده‌نشده' : 'خوانده شد', 'small', async () => { await api('PATCH', `/messages/${m.id}`, { isRead: !m.isRead }); render() }),
        busyButton('حذف', 'small danger', async () => { if (confirm('پیام حذف شود؟')) { await api('DELETE', `/messages/${m.id}`); render() } })),
    )) : emptyBox('پیامی دریافت نشده است.'),
  )
}

// ───────── تنظیمات ─────────
async function settingsView() {
  const s = await api('GET', '/settings')
  const c = s.company
  const f = Object.fromEntries(['name', 'tagline', 'phone', 'phone2', 'email', 'address', 'hours', 'instagram', 'telegram', 'whatsapp'].map((k) => [k, h('input', { type: 'text', value: c[k] || '' })]))
  f.about = h('textarea', {})
  f.about.value = c.about || ''
  f.flat = h('input', { type: 'text', inputMode: 'numeric', value: String(s.shipping.flat) })
  f.freeOver = h('input', { type: 'text', inputMode: 'numeric', value: s.shipping.freeOver === null ? '' : String(s.shipping.freeOver) })
  f.note = h('input', { type: 'text', value: s.shipping.note || '' })
  const err = h('div', { class: 'err', role: 'alert' })
  const save = busyButton('ذخیره تنظیمات', 'primary', async () => {
    err.textContent = ''
    const flat = toNum(f.flat.value)
    const free = f.freeOver.value.trim() ? toNum(f.freeOver.value) : null
    try {
      await api('PUT', '/settings', {
        company: Object.fromEntries(['name', 'tagline', 'phone', 'phone2', 'email', 'address', 'hours', 'about', 'instagram', 'telegram', 'whatsapp'].map((k) => [k, f[k].value])),
        shipping: { flat: Number.isNaN(flat) ? 0 : flat, freeOver: Number.isNaN(free) ? -1 : free, note: f.note.value },
      })
      toast('تنظیمات ذخیره شد.', 'ok')
    } catch (e) { showError(err, e); throw e }
  })

  const cur = h('input', { type: 'password', class: 'ltr', autocomplete: 'current-password' })
  const next = h('input', { type: 'password', class: 'ltr', autocomplete: 'new-password' })
  const pwErr = h('div', { class: 'err', role: 'alert' })
  const changePw = busyButton('تغییر رمز', 'primary', async () => {
    pwErr.textContent = ''
    try {
      await api('POST', '/password', { currentPassword: cur.value, newPassword: next.value })
      cur.value = next.value = ''
      toast('رمز تغییر کرد؛ نشست‌های دیگر بسته شدند.', 'ok')
    } catch (e) { showError(pwErr, e); throw e }
  })

  return h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('h1', {}, 'تنظیمات')),
    h('div', { class: 'card stack' }, h('h3', {}, 'اطلاعات شرکت'),
      h('div', { class: 'grid2' }, field('نام شرکت *', f.name), field('شعار', f.tagline)),
      h('div', { class: 'grid3' }, field('تلفن', f.phone), field('تلفن دوم', f.phone2), field('ایمیل', f.email)),
      field('نشانی', f.address), field('ساعات پاسخ‌گویی', f.hours), field('درباره ما', f.about),
      h('div', { class: 'grid3' }, field('اینستاگرام (لینک)', f.instagram), field('تلگرام (لینک)', f.telegram), field('واتس‌اپ (لینک)', f.whatsapp))),
    h('div', { class: 'card stack' }, h('h3', {}, 'ارسال'),
      h('div', { class: 'grid2' },
        field('هزینه ارسال ثابت (تومان)', f.flat, '۰ یعنی هزینه پس از هماهنگی تلفنی مشخص می‌شود.'),
        field('ارسال رایگان از مبلغ (تومان)', f.freeOver, 'خالی = ارسال رایگان ندارد.')),
      field('توضیح ارسال (به مشتری نمایش داده می‌شود)', f.note)),
    err, h('div', {}, save),
    h('div', { class: 'card stack' }, h('h3', {}, 'تغییر رمز عبور'),
      h('div', { class: 'grid2' }, field('رمز فعلی', cur), field('رمز جدید (حداقل ۸ نویسه)', next)), pwErr, h('div', {}, changePw)),
  )
}

// ───────── پوسته و مسیریابی ─────────
const NAV = [
  ['dashboard', 'داشبورد', null], ['orders', 'سفارش‌ها', 'newOrders'], ['products', 'محصولات', null],
  ['categories', 'دسته‌ها', null], ['inquiries', 'استعلام‌ها', 'newInquiries'], ['messages', 'پیام‌ها', 'unreadMessages'], ['settings', 'تنظیمات', null],
]

function shell(main, route) {
  const st = state.stats || {}
  const nav = h('nav', { class: 'nav' }, NAV.map(([key, label, badge]) =>
    h('a', { href: `#/${key}`, class: route === key ? 'active' : '' }, label, badge && st[badge] > 0 ? h('span', { class: 'badge' }, fmt(st[badge])) : null)))
  return h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'D'), 'تاسیسات دایان'), nav,
      h('div', { class: 'spacer' }),
      h('a', { href: '/', target: '_blank', rel: 'noopener', class: 'btn small' }, 'مشاهده سایت'),
      busyButton('خروج', 'small', async () => { await api('POST', '/logout', {}); state.admin = null; render() })),
    h('main', { class: 'main' }, main))
}

async function route() {
  const [name = 'dashboard', arg] = location.hash.replace(/^#\//, '').split('?')[0].split('/')
  switch (name) {
    case 'orders': return [name, arg ? await orderDetailView(Number(arg)) : await ordersView()]
    case 'products': return [name, arg ? await productFormView(arg === 'new' ? null : Number(arg)) : await productsView()]
    case 'categories': return [name, await categoriesView()]
    case 'inquiries': return [name, await inquiriesView()]
    case 'messages': return [name, await messagesView()]
    case 'settings': return [name, await settingsView()]
    default: return ['dashboard', await dashboardView()]
  }
}

async function render() {
  const app = document.getElementById('app')
  const token = ++renderToken
  if (!state.admin) {
    try {
      state.admin = (await api('GET', '/me')).admin
    } catch {
      if (token === renderToken) app.replaceChildren(loginView())
      return
    }
  }
  if (token !== renderToken) return
  try {
    const [name, view] = await route()
    if (token !== renderToken) return
    app.replaceChildren(shell(view, name))
    api('GET', '/stats').then((s) => {
      if (token !== renderToken) return
      state.stats = s
      const nav = app.querySelector('.nav')
      if (nav) nav.replaceWith(shell(h('div'), name).querySelector('.nav'))
    }).catch(() => {})
  } catch (e) {
    if (token !== renderToken || !state.admin) return
    app.replaceChildren(shell(h('div', { class: 'card empty' }, e.message || 'خطا در بارگذاری', h('div', {}, h('button', { class: 'btn', onclick: () => render() }, 'تلاش دوباره'))), ''))
  }
}

window.addEventListener('hashchange', render)
render()
