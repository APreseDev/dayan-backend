'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizePhone, normFa, toLatinDigits, likePattern } = require('../src/lib/text')
const { computeOrder } = require('../src/lib/pricing')
const { hashPassword, verifyPassword } = require('../src/lib/auth')
const { detectImage } = require('../src/lib/upload')
const v = require('../src/lib/validate')

test('normalizePhone: ارقام فارسی، پیش‌شماره و فاصله', () => {
  assert.equal(normalizePhone('۰۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789')
  assert.equal(normalizePhone('+98 912 345 6789'), '09123456789')
  assert.equal(normalizePhone('9123456789'), '09123456789')
  assert.equal(normalizePhone('021-12345678'), null)
  assert.equal(normalizePhone('0912345'), null)
})

test('normFa و toLatinDigits و likePattern', () => {
  assert.equal(normFa('كتاب ي'), 'کتاب ی')
  assert.equal(toLatinDigits('۱۲٣'), '123')
  assert.equal(likePattern('50%_x'), '%50\\%\\_x%')
})

const P = (o) => ({ id: 1, name: 'پکیج', price: 1000, track_stock: false, stock: 0, is_active: true, image: null, ...o })

test('computeOrder: جمع، ادغام ردیف‌های تکراری، ارسال رایگان', () => {
  const r = computeOrder([P({}), P({ id: 2, price: 500 })], [{ productId: 1, qty: 1 }, { productId: 1, qty: 2 }, { productId: 2, qty: 2 }], { flat: 300, freeOver: 4000 })
  assert.equal(r.lines.length, 2)
  assert.equal(r.itemsTotal, 4000)
  assert.equal(r.shippingCost, 0)
  assert.equal(r.total, 4000)
  const r2 = computeOrder([P({})], [{ productId: 1, qty: 1 }], { flat: 300, freeOver: 4000 })
  assert.equal(r2.total, 1300)
})

test('computeOrder: محصول ناموجود/غیرفعال/کمبود موجودی', () => {
  assert.throws(() => computeOrder([P({ is_active: false })], [{ productId: 1, qty: 1 }], { flat: 0, freeOver: null }), (e) => e.status === 400)
  assert.throws(() => computeOrder([], [{ productId: 9, qty: 1 }], { flat: 0, freeOver: null }), (e) => e.status === 400)
  assert.throws(() => computeOrder([P({ track_stock: true, stock: 1 })], [{ productId: 1, qty: 2 }], { flat: 0, freeOver: null }), (e) => e.status === 409 && e.details[0].available === 1)
})

test('hash رمز: درست/غلط و قالب', async () => {
  const h = await hashPassword('secret-pass-1')
  assert.match(h, /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
  assert.equal(await verifyPassword('secret-pass-1', h), true)
  assert.equal(await verifyPassword('secret-pass-2', h), false)
  assert.equal(await verifyPassword('x', 'garbage'), false)
})

test('detectImage از روی بایت‌ها', () => {
  assert.equal(detectImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'jpg')
  assert.equal(detectImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)])), 'png')
  assert.equal(detectImage(Buffer.from('<?php echo 1; ?>........')), null)
})

test('اعتبارسنجی: سفارش و slug دسته', () => {
  const ok = v.orderInput.parse({
    customer: { name: 'علی رضایی', phone: '۰۹۱۲۳۴۵۶۷۸۹', province: 'تهران', city: 'تهران', address: 'خیابان آزادی، پلاک ۱', postalCode: '۱۲۳۴۵۶۷۸۹۰' },
    items: [{ productId: '3', qty: '2' }],
  })
  assert.equal(ok.customer.phone, '09123456789')
  assert.equal(ok.customer.postalCode, '1234567890')
  assert.deepEqual(ok.items[0], { productId: 3, qty: 2 })
  assert.equal(v.categoryInput.safeParse({ slug: 'پکیج', name: 'x' }).success, false)
  assert.equal(v.categoryInput.safeParse({ slug: 'gas-boiler', name: 'پکیج' }).success, true)
  assert.equal(v.productInput.safeParse({ name: 'abc', price: 100, oldPrice: 50 }).success, false)
})
