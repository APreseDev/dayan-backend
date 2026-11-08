'use strict'
const express = require('express')
const { rateLimit } = require('express-rate-limit')
const db = require('../db')
const catalog = require('../repo/catalog')
const orders = require('../repo/orders')
const admin = require('../repo/admin')
const v = require('../lib/validate')
const { HttpError, notFound } = require('../lib/errors')

const router = express.Router()

const limiter = (limit, windowMinutes) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.' },
  })

const toInt = (value, fallback, { min = 1, max = 1000 } = {}) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}
const one = (value) => (typeof value === 'string' ? value : '')

router.get('/settings', async (req, res) => {
  res.json(await admin.getSettings(db))
})

router.get('/categories', async (req, res) => {
  res.json({ items: await catalog.listCategories(db) })
})

router.get('/products', async (req, res) => {
  const pageSize = toInt(req.query.limit, 24, { max: 100 })
  const page = toInt(req.query.page, 1, { max: 10_000 })
  const { items, total } = await catalog.listProducts(db, {
    category: one(req.query.category) || null,
    q: one(req.query.q).slice(0, 100),
    sort: one(req.query.sort),
    featured: req.query.featured === 'true',
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })
  res.json({ items, total, page, pageSize })
})

router.get('/products/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw notFound('محصول پیدا نشد.')
  res.json(await catalog.getProduct(db, id))
})

router.post('/orders', limiter(20, 60), async (req, res) => {
  const input = v.orderInput.parse(req.body)
  const { shipping } = await admin.getSettings(db)
  const order = await db.tx((tx) => orders.createOrder(tx, input, shipping))
  res.status(201).json(orders.toPublicOrder(order))
})

// POST تا شماره موبایل در آدرس و لاگ سرورها نیاید
router.post('/orders/track', limiter(30, 15), async (req, res) => {
  const { code, phone } = v.trackInput.parse(req.body)
  let order
  try {
    order = await orders.getOrderByCode(db, code)
  } catch (err) {
    if (err instanceof HttpError) throw notFound('سفارشی با این مشخصات پیدا نشد.')
    throw err
  }
  // پیام یکسان برای «کد اشتباه» و «موبایل اشتباه» تا حدس‌زدن کدها ممکن نباشد
  if (order.customer.phone !== phone) throw notFound('سفارشی با این مشخصات پیدا نشد.')
  res.json(orders.toPublicOrder(order))
})

router.post('/contact', limiter(10, 60), async (req, res) => {
  await admin.createMessage(db, v.contactInput.parse(req.body))
  res.status(201).json({ ok: true })
})

router.post('/inquiries', limiter(10, 60), async (req, res) => {
  await admin.createInquiry(db, v.inquiryInput.parse(req.body))
  res.status(201).json({ ok: true })
})

module.exports = router
