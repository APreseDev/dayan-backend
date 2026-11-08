'use strict'
const { resetDb, startServer } = require('./helpers')
const test = require('node:test')
const assert = require('node:assert/strict')

let app
let admin
const pub = () => app.client()

// یک PNG ۱×۱ معتبر
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const customer = (over = {}) => ({
  name: 'علی رضایی', phone: '۰۹۱۲۳۴۵۶۷۸۹', province: 'تهران', city: 'تهران', address: 'خیابان آزادی، پلاک ۱۲', ...over,
})

test.before(async () => {
  await resetDb()
  app = await startServer()
  admin = await app.adminClient()
})
test.after(async () => app.close())

test('احراز هویت ادمین', async (t) => {
  const c = pub()
  assert.equal((await c.get('/api/admin/me')).status, 401)
  assert.equal((await c.post('/api/admin/login', { email: 'admin@dian.ir', password: 'wrong-password' })).status, 401)
  assert.equal((await c.post('/api/admin/login', { email: 'nobody@dian.ir', password: 'x' })).status, 401)

  const ok = await c.post('/api/admin/login', { email: 'ADMIN@dian.ir', password: 'test-password-123' })
  assert.equal(ok.status, 200)
  assert.match(c.cookie, /^dian_admin=/)
  const setCookie = ok.headers.getSetCookie()[0]
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)

  assert.equal((await c.get('/api/admin/me')).body.admin.email, 'admin@dian.ir')
  // بدون هدر CSRF، درخواست تغییردهنده رد می‌شود
  assert.equal((await c.post('/api/admin/logout', {}, { csrf: false })).status, 403)
  assert.equal((await c.post('/api/admin/logout', {})).status, 200)
  assert.equal((await c.get('/api/admin/me')).status, 401)

  // کوکی جعلی
  c.setCookie('dian_admin=fake')
  assert.equal((await c.get('/api/admin/me')).status, 401)
})

test('دسته‌ها: CRUD، تکراری، اعتبارسنجی، فیلتر فعال', async () => {
  const r = await admin.post('/api/admin/categories', { slug: 'gas-boiler', name: 'پکیج و موتورخانه', sortOrder: 2 })
  assert.equal(r.status, 201)
  assert.equal(r.body.slug, 'gas-boiler')
  assert.equal((await admin.post('/api/admin/categories', { slug: 'gas-boiler', name: 'دیگر' })).status, 409)
  assert.equal((await admin.post('/api/admin/categories', { slug: 'پکیج', name: 'x' })).status, 400)

  const r2 = await admin.post('/api/admin/categories', { slug: 'radiator', name: 'رادیاتور', sortOrder: 1 })
  const pubList = await pub().get('/api/categories')
  assert.deepEqual(pubList.body.items.map((c) => c.slug), ['radiator', 'gas-boiler']) // بر اساس sortOrder

  const up = await admin.put(`/api/admin/categories/${r2.body.id}`, { slug: 'radiator', name: 'رادیاتور پنلی', isActive: false })
  assert.equal(up.body.name, 'رادیاتور پنلی')
  assert.equal((await pub().get('/api/categories')).body.items.length, 1) // غیرفعال مخفی
  assert.equal((await admin.get('/api/admin/categories')).body.items.length, 2)
  assert.equal((await admin.put('/api/admin/categories/9999', { slug: 'zz', name: 'zz' })).status, 404)
})

let boilerId
test('محصولات: ساخت، نرمال‌سازی، اعتبارسنجی، نمایش عمومی', async () => {
  const cats = (await admin.get('/api/admin/categories')).body.items
  const boiler = cats.find((c) => c.slug === 'gas-boiler')

  const bad = await admin.post('/api/admin/products', { name: 'ab', price: 100, oldPrice: 50 })
  assert.equal(bad.status, 400)
  assert.equal((await admin.post('/api/admin/products', { name: 'محصول', price: -5 })).status, 400)
  assert.equal((await admin.post('/api/admin/products', { name: 'محصول', price: 5, categoryId: 9999 })).status, 409)
  assert.equal((await admin.post('/api/admin/products', { name: 'محصول', price: 5, images: ['javascript:alert(1)'] })).status, 400)

  const r = await admin.post('/api/admin/products', {
    categoryId: boiler.id, name: 'پكيج ديواري ۲۴ هزار', brand: 'ایران رادیاتور', sku: 'PK-24', price: 25_000_000, oldPrice: 28_000_000,
    shortDescription: 'پکیج کم‌مصرف', description: 'توضیح کامل',
    features: ['کم‌مصرف', '  ', 'ایمن'].filter((x) => x.trim()), specs: [{ label: 'توان', value: '۲۴ کیلووات' }],
    images: ['/uploads/a.png', '/uploads/b.png'], trackStock: true, stock: 3, isFeatured: true, badge: 'پرفروش',
  })
  assert.equal(r.status, 201, r.text)
  boilerId = r.body.id
  assert.equal(r.body.name, 'پکیج دیواری ۲۴ هزار') // ي/ك عربی → فارسی
  assert.equal(r.body.discount, 11)
  assert.equal(r.body.image, '/uploads/a.png')
  assert.equal(r.body.stock, 3) // ادمین موجودی دقیق را می‌بیند
  assert.deepEqual(r.body.specs, [{ label: 'توان', value: '۲۴ کیلووات' }])

  assert.equal((await admin.post('/api/admin/products', { name: 'تکراری', price: 1, sku: 'PK-24' })).status, 409)

  const one = await pub().get(`/api/products/${boilerId}`)
  assert.equal(one.status, 200)
  assert.equal(one.body.stock, undefined) // عمومی: موجودی دقیق لو نمی‌رود
  assert.equal(one.body.sku, undefined)
  assert.equal(one.body.inStock, true)
  assert.equal(one.body.category.slug, 'gas-boiler')
  assert.equal((await pub().get('/api/products/abc')).status, 404)
  assert.equal((await pub().get('/api/products/99999')).status, 404)
})

test('لیست محصولات: فیلتر دسته، جستجو، مرتب‌سازی، صفحه‌بندی، مخفی‌بودن غیرفعال', async () => {
  const mk = (o) => admin.post('/api/admin/products', { price: 1000, ...o })
  const cats = (await admin.get('/api/admin/categories')).body.items
  const radiator = cats.find((c) => c.slug === 'radiator') // غیرفعال
  await mk({ name: 'شیر برقی', price: 500_000, brand: 'دایان' })
  await mk({ name: 'لوله مسی', price: 90_000 })
  await mk({ name: 'محصول پنهان', isActive: false })
  await mk({ name: 'رادیاتور آلومینیومی', categoryId: radiator.id }) // دسته غیرفعال ⇒ مخفی

  const all = (await pub().get('/api/products')).body
  assert.deepEqual(all.items.map((p) => p.name).sort(), ['شیر برقی', 'لوله مسی', 'پکیج دیواری ۲۴ هزار'].sort())
  assert.equal(all.total, 3)

  const cheap = (await pub().get('/api/products?sort=cheapest')).body.items.map((p) => p.price)
  assert.deepEqual(cheap, [...cheap].sort((a, b) => a - b))
  const exp = (await pub().get('/api/products?sort=expensive')).body.items.map((p) => p.price)
  assert.deepEqual(exp, [...exp].sort((a, b) => b - a))

  assert.equal((await pub().get('/api/products?category=gas-boiler')).body.total, 1)
  assert.equal((await pub().get(`/api/products?q=${encodeURIComponent('پكيج')}`)).body.total, 1) // ك/ي عربی هم پیدا می‌شود
  assert.equal((await pub().get(`/api/products?q=${encodeURIComponent('دایان')}`)).body.total, 1) // برند
  assert.equal((await pub().get(`/api/products?q=${encodeURIComponent('%')}`)).body.total, 0) // % معنای ویژه ندارد
  assert.equal((await pub().get('/api/products?featured=true')).body.total, 1)

  const page = (await pub().get('/api/products?limit=2&page=2')).body
  assert.equal(page.items.length, 1)
  assert.equal(page.total, 3)

  const adm = (await admin.get('/api/admin/products')).body
  assert.equal(adm.total, 5) // ادمین همه را می‌بیند
  assert.equal((await pub().get('/api/products?sort=;DROP TABLE products')).status, 200) // sort ناشناخته نادیده گرفته می‌شود
  assert.equal((await app.db.query('SELECT count(*) AS n FROM products')).rows[0].n, 5)
})

test('آپلود تصویر: PNG معتبر، فایل جعلی، حجم زیاد، بدون ورود', async () => {
  const form = (buf, name = 'x.png') => { const f = new FormData(); f.append('file', new Blob([buf]), name); return f }
  const ok = await admin.post('/api/admin/uploads', form(PNG))
  assert.equal(ok.status, 201, ok.text)
  assert.match(ok.body.url, /^\/uploads\/[\w-]+\.png$/)
  const served = await fetch(app.base + ok.body.url)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')

  const fake = await admin.post('/api/admin/uploads', form(Buffer.from('<script>alert(1)</script>'), 'evil.png'))
  assert.equal(fake.status, 400)
  const big = await admin.post('/api/admin/uploads', form(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)])))
  assert.equal(big.status, 413)
  assert.equal((await pub().post('/api/admin/uploads', form(PNG))).status, 401)
})

test('ثبت سفارش: قیمت از دیتابیس، موجودی، ادغام، اعتبارسنجی', async () => {
  const c = pub()
  // قیمت ارسالی کلاینت نادیده گرفته می‌شود
  const r = await c.post('/api/orders', {
    customer: customer(), items: [{ productId: boilerId, qty: 1, price: 1 }, { productId: boilerId, qty: 1 }], total: 5,
  })
  assert.equal(r.status, 201, r.text)
  assert.match(r.body.code, /^DN\d{8}$/)
  assert.equal(r.body.itemsTotal, 50_000_000)
  assert.equal(r.body.items.length, 1)
  assert.equal(r.body.items[0].qty, 2)
  assert.equal(r.body.customer, undefined) // نشانی/تلفن در پاسخ عمومی نیست

  const stock = (await admin.get(`/api/admin/products/${boilerId}`)).body.stock
  assert.equal(stock, 1) // ۳ − ۲

  const over = await c.post('/api/orders', { customer: customer(), items: [{ productId: boilerId, qty: 2 }] })
  assert.equal(over.status, 409)
  assert.equal(over.body.details[0].reason, 'out_of_stock')
  assert.equal(over.body.details[0].available, 1)

  assert.equal((await c.post('/api/orders', { customer: customer({ phone: '123' }), items: [{ productId: boilerId, qty: 1 }] })).status, 400)
  assert.equal((await c.post('/api/orders', { customer: customer(), items: [] })).status, 400)
  assert.equal((await c.post('/api/orders', { customer: customer(), items: [{ productId: 99999, qty: 1 }] })).status, 400)
  assert.equal((await c.post('/api/orders', { customer: customer(), items: [{ productId: boilerId, qty: 0 }] })).status, 400)
  assert.equal((await c.post('/api/orders', { customer: customer(), items: [{ productId: boilerId, qty: 21 }] })).status, 400)
  // محصول غیرفعال
  const hidden = (await admin.get('/api/admin/products?q=' + encodeURIComponent('پنهان'))).body.items[0]
  assert.equal((await c.post('/api/orders', { customer: customer(), items: [{ productId: hidden.id, qty: 1 }] })).status, 400)
  // سفارش ناموفق، موجودی را تغییر نمی‌دهد
  assert.equal((await admin.get(`/api/admin/products/${boilerId}`)).body.stock, 1)
})

test('هزینه‌ی ارسال از تنظیمات', async () => {
  const s = (await admin.get('/api/admin/settings')).body
  await admin.put('/api/admin/settings', { company: s.company, shipping: { flat: 200_000, freeOver: 1_000_000, note: '' } })
  const pid = (await admin.get('/api/admin/products?q=' + encodeURIComponent('لوله'))).body.items[0].id
  const small = await pub().post('/api/orders', { customer: customer(), items: [{ productId: pid, qty: 2 }] })
  assert.equal(small.body.shippingCost, 200_000)
  assert.equal(small.body.total, 380_000)
  const big = await pub().post('/api/orders', { customer: customer(), items: [{ productId: pid, qty: 12 }] })
  assert.equal(big.body.shippingCost, 0)
  assert.equal(big.body.total, 1_080_000)
})

test('پیگیری سفارش با کد + موبایل', async () => {
  const pid = (await admin.get('/api/admin/products?q=' + encodeURIComponent('لوله'))).body.items[0].id
  const o = (await pub().post('/api/orders', { customer: customer({ phone: '09350001122' }), items: [{ productId: pid, qty: 1 }] })).body
  const ok = await pub().post('/api/orders/track', { code: o.code.toLowerCase(), phone: '۰۹۳۵۰۰۰۱۱۲۲' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.code, o.code)
  assert.equal(ok.body.customer, undefined)
  assert.equal(ok.body.address, undefined)
  const wrongPhone = await pub().post('/api/orders/track', { code: o.code, phone: '09121111111' })
  const wrongCode = await pub().post('/api/orders/track', { code: 'DN00000000', phone: '09350001122' })
  assert.equal(wrongPhone.status, 404)
  assert.equal(wrongCode.status, 404)
  assert.equal(wrongPhone.body.error, wrongCode.body.error) // پیام یکسان
  assert.equal((await pub().post('/api/orders/track', { code: 'abc', phone: '09350001122' })).status, 400)
})

test('مدیریت سفارش: لیست، فیلتر، وضعیت، لغو و بازگشت موجودی', async () => {
  const list = (await admin.get('/api/admin/orders')).body
  assert.ok(list.total >= 4)
  assert.equal(list.items[0].items, undefined)
  assert.ok(list.items[0].itemCount >= 1)

  const first = (await admin.get('/api/admin/orders?q=' + encodeURIComponent('09350001122'))).body
  assert.equal(first.total, 1)
  const id = first.items[0].id
  const detail = (await admin.get(`/api/admin/orders/${id}`)).body
  assert.equal(detail.customer.phone, '09350001122')
  assert.equal(detail.items.length, 1)

  const upd = await admin.patch(`/api/admin/orders/${id}`, { status: 'confirmed', adminNote: 'تماس گرفته شد' })
  assert.equal(upd.body.status, 'confirmed')
  assert.equal(upd.body.adminNote, 'تماس گرفته شد')
  assert.equal((await admin.patch(`/api/admin/orders/${id}`, { status: 'bogus' })).status, 400)
  assert.equal((await admin.patch(`/api/admin/orders/${id}`, {})).status, 400)
  assert.equal((await admin.get('/api/admin/orders?status=confirmed')).body.total, 1)

  // لغو سفارش دارای کالای موجودی‌دار ⇒ موجودی برمی‌گردد
  const boilerOrder = (await admin.get('/api/admin/orders?q=DN')).body.items.find((o) => o.total === 50_000_000)
  const before = (await admin.get(`/api/admin/products/${boilerId}`)).body.stock
  const cancel = await admin.patch(`/api/admin/orders/${boilerOrder.id}`, { status: 'cancelled' })
  assert.equal(cancel.body.status, 'cancelled')
  assert.equal((await admin.get(`/api/admin/products/${boilerId}`)).body.stock, before + 2)
  // لغو دوباره/تغییر بعد از لغو ممکن نیست و موجودی دوباره زیاد نمی‌شود
  assert.equal((await admin.patch(`/api/admin/orders/${boilerOrder.id}`, { status: 'cancelled' })).status, 200)
  assert.equal((await admin.patch(`/api/admin/orders/${boilerOrder.id}`, { status: 'shipped' })).status, 409)
  assert.equal((await admin.get(`/api/admin/products/${boilerId}`)).body.stock, before + 2)
})

test('هم‌زمانی: دو سفارش هم‌زمان برای موجودی ۱ ⇒ فقط یکی موفق', async () => {
  const p = (await admin.post('/api/admin/products', { name: 'کالای کمیاب', price: 10_000, trackStock: true, stock: 1 })).body
  const results = await Promise.all(
    [1, 2, 3].map(() => pub().post('/api/orders', { customer: customer(), items: [{ productId: p.id, qty: 1 }] })),
  )
  const statuses = results.map((r) => r.status).sort()
  assert.deepEqual(statuses, [201, 409, 409])
  assert.equal((await admin.get(`/api/admin/products/${p.id}`)).body.stock, 0)
  assert.equal((await pub().get(`/api/products/${p.id}`)).body.inStock, false)
})

test('پیام تماس و استعلام', async () => {
  const c = pub()
  assert.equal((await c.post('/api/contact', { name: 'مریم', message: 'سلام' })).status, 400)
  assert.equal((await c.post('/api/contact', { name: 'مریم', message: 'سلام، یک سؤال دارم' })).status, 400) // ایمیل یا تلفن لازم
  assert.equal((await c.post('/api/contact', { name: 'مریم', phone: '۰۹۱۲۱۱۱۲۲۳۳', message: 'سلام، یک سؤال دارم', topic: 'مشاوره' })).status, 201)
  assert.equal((await c.post('/api/inquiries', { name: 'رضا', phone: '09121112233', message: 'قیمت؟', productId: boilerId })).status, 201)
  assert.equal((await c.post('/api/inquiries', { name: 'رضا', phone: '09121112233', productId: 424242 })).status, 201) // محصول ناموجود ⇒ بدون محصول

  const msgs = (await admin.get('/api/admin/messages')).body
  assert.equal(msgs.total, 1)
  assert.equal(msgs.items[0].phone, '09121112233')
  assert.equal(msgs.items[0].isRead, false)
  assert.equal((await admin.patch(`/api/admin/messages/${msgs.items[0].id}`, { isRead: true })).body.isRead, true)
  assert.equal((await admin.get('/api/admin/messages?unread=true')).body.total, 0)

  const inq = (await admin.get('/api/admin/inquiries')).body
  assert.equal(inq.total, 2)
  const withProduct = inq.items.find((i) => i.productId)
  assert.equal(withProduct.productName, 'پکیج دیواری ۲۴ هزار')
  assert.equal((await admin.patch(`/api/admin/inquiries/${withProduct.id}`, { status: 'handled' })).status, 200)
  assert.equal((await admin.get('/api/admin/inquiries?status=new')).body.total, 1)
  assert.equal((await admin.del(`/api/admin/inquiries/${withProduct.id}`)).status, 200)
  assert.equal((await admin.del(`/api/admin/messages/${msgs.items[0].id}`)).status, 200)
  assert.equal((await admin.del('/api/admin/messages/999')).status, 404)
})

test('تنظیمات و آمار داشبورد', async () => {
  const pubSettings = (await pub().get('/api/settings')).body
  assert.equal(pubSettings.company.name, 'تاسیسات دایان')
  const up = await admin.put('/api/admin/settings', {
    company: { name: 'تاسیسات دایان', phone: '021-22223333', email: 'a@dian.ir', address: 'تهران', instagram: 'https://instagram.com/dian' },
    shipping: { flat: 0, freeOver: null, note: 'هماهنگی تلفنی' },
  })
  assert.equal(up.status, 200, up.text)
  assert.equal((await pub().get('/api/settings')).body.company.phone, '021-22223333')
  assert.equal((await admin.put('/api/admin/settings', { company: { name: '' }, shipping: { flat: 0 } })).status, 400)

  const st = (await admin.get('/api/admin/stats')).body
  assert.ok(st.totalOrders >= 5 && st.newOrders >= 1 && st.activeProducts >= 3)
  assert.equal(st.outOfStock, 1)
  assert.equal(st.unreadMessages, 0)
})

test('حذف محصول: سفارش‌های قدیمی دست‌نخورده می‌مانند', async () => {
  const p = (await admin.post('/api/admin/products', { name: 'کالای موقت', price: 7000 })).body
  const o = (await pub().post('/api/orders', { customer: customer(), items: [{ productId: p.id, qty: 1 }] })).body
  assert.equal((await admin.del(`/api/admin/products/${p.id}`)).status, 200)
  assert.equal((await pub().get(`/api/products/${p.id}`)).status, 404)
  const order = (await admin.get('/api/admin/orders?q=' + o.code)).body.items[0]
  const detail = (await admin.get(`/api/admin/orders/${order.id}`)).body
  assert.equal(detail.items[0].name, 'کالای موقت')
  assert.equal(detail.items[0].productId, null)
})

test('تغییر رمز: نشست‌های دیگر بسته می‌شوند', async () => {
  const other = await app.adminClient()
  assert.equal((await other.get('/api/admin/me')).status, 200)
  assert.equal((await admin.post('/api/admin/password', { currentPassword: 'wrong-wrong', newPassword: 'new-password-456' })).status, 400)
  assert.equal((await admin.post('/api/admin/password', { currentPassword: 'test-password-123', newPassword: 'short' })).status, 400)
  assert.equal((await admin.post('/api/admin/password', { currentPassword: 'test-password-123', newPassword: 'new-password-456' })).status, 200)
  assert.equal((await other.get('/api/admin/me')).status, 401)
  assert.equal((await admin.get('/api/admin/me')).status, 200)
  const again = pub()
  assert.equal((await again.post('/api/admin/login', { email: 'admin@dian.ir', password: 'test-password-123' })).status, 401)
  assert.equal((await again.post('/api/admin/login', { email: 'admin@dian.ir', password: 'new-password-456' })).status, 200)
})

test('پنل ادمین و هدرهای امنیتی، JSON خراب، مسیر ناشناخته', async () => {
  const res = await fetch(app.base + '/admin/')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/)
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await fetch(app.base + '/api/nope')).status, 404)
  const bad = await fetch(app.base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
  assert.equal(bad.status, 400)
  assert.equal((await fetch(app.base + '/api/admin/stats')).headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(app.base + '/uploads/../package.json')).status, 404)
})
