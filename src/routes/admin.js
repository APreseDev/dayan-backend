'use strict'
const express = require('express')
const { rateLimit } = require('express-rate-limit')
const db = require('../db')
const config = require('../config')
const catalog = require('../repo/catalog')
const orders = require('../repo/orders')
const repo = require('../repo/admin')
const v = require('../lib/validate')
const { hashPassword, verifyPassword, newToken, hashToken } = require('../lib/auth')
const { badRequest, HttpError } = require('../lib/errors')
const { requireAdmin, parseCookies } = require('../middleware/auth')
const { upload, saveImage } = require('../lib/upload')

const router = express.Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تلاش‌های ناموفق زیاد بود؛ ۱۵ دقیقه بعد دوباره امتحان کنید.' },
})

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.isProd,
  path: '/',
})

const id = (req) => {
  const n = Number(req.params.id)
  if (!Number.isInteger(n) || n <= 0) throw badRequest('شناسه نامعتبر است.')
  return n
}
const toInt = (value, fallback, max) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback
}
const str = (value) => (typeof value === 'string' ? value : '')

// ───────── ورود/خروج (بدون نیاز به نشست) ─────────
const DUMMY_HASH = 'scrypt$16384$00000000000000000000000000000000$' + '00'.repeat(64)

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = v.loginInput.parse(req.body)
  const found = await repo.findAdminByEmail(db, email)
  // حتی اگر کاربر وجود نداشت یک هش بررسی می‌شود تا زمان پاسخ چیزی لو ندهد
  const ok = await verifyPassword(password, found ? found.password_hash : DUMMY_HASH)
  if (!found || !ok) throw new HttpError(401, 'ایمیل یا رمز عبور اشتباه است.')

  const token = newToken()
  await repo.createSession(db, hashToken(token), found.id, config.sessionDays)
  res.cookie(config.cookieName, token, { ...cookieOptions(), maxAge: config.sessionDays * 86_400_000 })
  res.json({ admin: { id: found.id, email: found.email, name: found.name } })
})

router.post('/logout', async (req, res) => {
  if (req.headers['x-requested-with'] !== 'dian-admin') throw new HttpError(403, 'درخواست نامعتبر است.')
  const token = parseCookies(req.headers.cookie)[config.cookieName]
  if (token) await repo.deleteSession(db, hashToken(token))
  res.clearCookie(config.cookieName, cookieOptions())
  res.json({ ok: true })
})

// ───────── از اینجا به بعد فقط ادمین ─────────
router.use(requireAdmin)

router.get('/me', (req, res) => res.json({ admin: req.admin }))

router.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = v.passwordInput.parse(req.body)
  const found = await repo.findAdminByEmail(db, req.admin.email)
  if (!(await verifyPassword(currentPassword, found.password_hash))) throw new HttpError(400, 'رمز فعلی اشتباه است.')
  const passwordHash = await hashPassword(newPassword)
  await db.tx((tx) => repo.changePassword(tx, req.admin.id, passwordHash, req.tokenHash))
  res.json({ ok: true })
})

router.get('/stats', async (req, res) => res.json(await repo.getStats(db)))

// ───────── دسته‌ها ─────────
router.get('/categories', async (req, res) => res.json({ items: await catalog.listCategories(db, { includeInactive: true }) }))
router.post('/categories', async (req, res) => {
  const created = await catalog.createCategory(db, v.categoryInput.parse(req.body))
  res.status(201).json(created)
})
router.put('/categories/:id', async (req, res) => {
  res.json(await catalog.updateCategory(db, id(req), v.categoryInput.parse(req.body)))
})
router.delete('/categories/:id', async (req, res) => {
  await catalog.deleteCategory(db, id(req))
  res.json({ ok: true })
})

// ───────── محصولات ─────────
router.get('/products', async (req, res) => {
  const pageSize = toInt(req.query.limit, 30, 100)
  const page = toInt(req.query.page, 1, 10_000)
  const { items, total } = await catalog.listProducts(db, {
    category: str(req.query.category) || null,
    q: str(req.query.q).slice(0, 100),
    sort: str(req.query.sort),
    includeInactive: true,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })
  res.json({ items, total, page, pageSize })
})
router.get('/products/:id', async (req, res) => res.json(await catalog.getProduct(db, id(req), { includeInactive: true })))
router.post('/products', async (req, res) => {
  const input = v.productInput.parse(req.body)
  const newId = await db.tx((tx) => catalog.createProduct(tx, input))
  res.status(201).json(await catalog.getProduct(db, newId, { includeInactive: true }))
})
router.put('/products/:id', async (req, res) => {
  const pid = id(req)
  const input = v.productInput.parse(req.body)
  await db.tx((tx) => catalog.updateProduct(tx, pid, input))
  res.json(await catalog.getProduct(db, pid, { includeInactive: true }))
})
router.delete('/products/:id', async (req, res) => {
  await catalog.deleteProduct(db, id(req))
  res.json({ ok: true })
})

// ───────── آپلود تصویر ─────────
router.post('/uploads', upload.single('file'), async (req, res) => {
  res.status(201).json({ url: await saveImage(req.file) })
})

// ───────── سفارش‌ها ─────────
router.get('/orders', async (req, res) => {
  const pageSize = toInt(req.query.limit, 30, 100)
  const page = toInt(req.query.page, 1, 10_000)
  const status = str(req.query.status)
  const { items, total } = await orders.listOrders(db, {
    status: v.ORDER_STATUSES.includes(status) ? status : null,
    q: str(req.query.q).slice(0, 100),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })
  res.json({ items, total, page, pageSize })
})
router.get('/orders/:id', async (req, res) => res.json(await orders.getOrderById(db, id(req))))
router.patch('/orders/:id', async (req, res) => {
  const input = v.orderUpdateInput.parse(req.body)
  res.json(await db.tx((tx) => orders.updateOrder(tx, id(req), input)))
})

// ───────── استعلام‌ها و پیام‌ها ─────────
router.get('/inquiries', async (req, res) => {
  const status = str(req.query.status)
  res.json(
    await repo.listInquiries(db, {
      status: ['new', 'handled'].includes(status) ? status : null,
      limit: toInt(req.query.limit, 30, 100),
      offset: (toInt(req.query.page, 1, 10_000) - 1) * toInt(req.query.limit, 30, 100),
    }),
  )
})
router.patch('/inquiries/:id', async (req, res) => {
  const status = req.body && req.body.status
  if (!['new', 'handled'].includes(status)) throw badRequest('وضعیت نامعتبر است.')
  await repo.setInquiryStatus(db, id(req), status)
  res.json({ ok: true })
})
router.delete('/inquiries/:id', async (req, res) => {
  await repo.deleteInquiry(db, id(req))
  res.json({ ok: true })
})

router.get('/messages', async (req, res) => {
  const limit = toInt(req.query.limit, 30, 100)
  res.json(
    await repo.listMessages(db, {
      unreadOnly: req.query.unread === 'true',
      limit,
      offset: (toInt(req.query.page, 1, 10_000) - 1) * limit,
    }),
  )
})
router.patch('/messages/:id', async (req, res) => {
  if (typeof (req.body && req.body.isRead) !== 'boolean') throw badRequest('مقدار isRead باید true/false باشد.')
  res.json(await repo.setMessageRead(db, id(req), req.body.isRead))
})
router.delete('/messages/:id', async (req, res) => {
  await repo.deleteMessage(db, id(req))
  res.json({ ok: true })
})

// ───────── تنظیمات ─────────
router.get('/settings', async (req, res) => res.json(await repo.getSettings(db)))
router.put('/settings', async (req, res) => {
  res.json(await repo.saveSettings(db, v.settingsInput.parse(req.body)))
})

module.exports = router
