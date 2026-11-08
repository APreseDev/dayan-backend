'use strict'
const { notFound } = require('../lib/errors')
const defaults = require('../defaultSettings')

// ───────── ادمین و نشست ─────────
const findAdminByEmail = async (db, email) => (await db.query('SELECT * FROM admins WHERE email=$1', [email])).rows[0] || null

async function createAdmin(db, { email, name, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO admins (email, name, password_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id, email, name`,
    [email, name, passwordHash],
  )
  return rows[0]
}

const createSession = (db, tokenHash, adminId, days) =>
  db.query("INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES ($1,$2, now() + make_interval(days => $3))", [tokenHash, adminId, days])

async function getAdminBySession(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT a.id, a.email, a.name FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  )
  return rows[0] || null
}

const deleteSession = (db, tokenHash) => db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash])
const deleteExpiredSessions = (db) => db.query('DELETE FROM sessions WHERE expires_at <= now()')

async function changePassword(tx, adminId, passwordHash, keepTokenHash) {
  await tx.query('UPDATE admins SET password_hash=$2 WHERE id=$1', [adminId, passwordHash])
  // سایر نشست‌های این ادمین بسته می‌شوند
  await tx.query('DELETE FROM sessions WHERE admin_id=$1 AND token_hash <> $2', [adminId, keepTokenHash])
}

// ───────── پیام‌ها ─────────
const toMessage = (r) => ({
  id: r.id, name: r.name, email: r.email, phone: r.phone, topic: r.topic,
  message: r.message, isRead: r.is_read, createdAt: r.created_at,
})

async function createMessage(db, m) {
  const { rows } = await db.query(
    'INSERT INTO messages (name,email,phone,topic,message) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [m.name, m.email, m.phone, m.topic, m.message],
  )
  return toMessage(rows[0])
}

async function listMessages(db, { unreadOnly = false, limit = 30, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT *, count(*) OVER() AS total_count FROM messages
      WHERE (NOT $1::boolean OR NOT is_read) ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [unreadOnly, limit, offset],
  )
  return { items: rows.map(toMessage), total: rows.length ? Number(rows[0].total_count) : 0 }
}

async function setMessageRead(db, id, isRead) {
  const { rows } = await db.query('UPDATE messages SET is_read=$2 WHERE id=$1 RETURNING *', [id, isRead])
  if (!rows[0]) throw notFound('پیام پیدا نشد.')
  return toMessage(rows[0])
}

async function deleteMessage(db, id) {
  const { rows } = await db.query('DELETE FROM messages WHERE id=$1 RETURNING id', [id])
  if (!rows[0]) throw notFound('پیام پیدا نشد.')
}

// ───────── استعلام‌ها ─────────
const toInquiry = (r) => ({
  id: r.id, productId: r.product_id, productName: r.product_name || null, name: r.name,
  phone: r.phone, message: r.message, status: r.status, createdAt: r.created_at,
})

async function createInquiry(db, i) {
  // اگر محصول وجود نداشت، استعلام بدون محصول ثبت می‌شود
  const { rows } = await db.query(
    `INSERT INTO inquiries (product_id, name, phone, message)
     VALUES ((SELECT id FROM products WHERE id = $1), $2, $3, $4) RETURNING id`,
    [i.productId, i.name, i.phone, i.message],
  )
  return rows[0].id
}

async function listInquiries(db, { status = null, limit = 30, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT i.*, p.name AS product_name, count(*) OVER() AS total_count
       FROM inquiries i LEFT JOIN products p ON p.id = i.product_id
      WHERE ($1::text IS NULL OR i.status = $1)
      ORDER BY i.created_at DESC, i.id DESC LIMIT $2 OFFSET $3`,
    [status, limit, offset],
  )
  return { items: rows.map(toInquiry), total: rows.length ? Number(rows[0].total_count) : 0 }
}

async function setInquiryStatus(db, id, status) {
  const { rows } = await db.query('UPDATE inquiries SET status=$2 WHERE id=$1 RETURNING id', [id, status])
  if (!rows[0]) throw notFound('استعلام پیدا نشد.')
}

async function deleteInquiry(db, id) {
  const { rows } = await db.query('DELETE FROM inquiries WHERE id=$1 RETURNING id', [id])
  if (!rows[0]) throw notFound('استعلام پیدا نشد.')
}

// ───────── تنظیمات ─────────
async function getSettings(db) {
  const { rows } = await db.query('SELECT key, value FROM settings')
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    company: { ...defaults.company, ...(stored.company || {}) },
    shipping: { ...defaults.shipping, ...(stored.shipping || {}) },
  }
}

async function saveSettings(db, { company, shipping }) {
  for (const [key, value] of [['company', company], ['shipping', shipping]]) {
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)],
    )
  }
  return getSettings(db)
}

async function seedSettings(db) {
  for (const key of ['company', 'shipping']) {
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(defaults[key])])
  }
}

// ───────── آمار داشبورد ─────────
async function getStats(db) {
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*) FROM orders WHERE status = 'new')                      AS new_orders,
      (SELECT count(*) FROM orders)                                           AS total_orders,
      (SELECT COALESCE(sum(total),0) FROM orders WHERE status <> 'cancelled') AS sales_total,
      (SELECT count(*) FROM inquiries WHERE status = 'new')                   AS new_inquiries,
      (SELECT count(*) FROM messages WHERE NOT is_read)                       AS unread_messages,
      (SELECT count(*) FROM products WHERE is_active)                         AS active_products,
      (SELECT count(*) FROM products WHERE track_stock AND stock = 0)         AS out_of_stock`)
  const r = rows[0]
  return {
    newOrders: Number(r.new_orders), totalOrders: Number(r.total_orders), salesTotal: Number(r.sales_total),
    newInquiries: Number(r.new_inquiries), unreadMessages: Number(r.unread_messages),
    activeProducts: Number(r.active_products), outOfStock: Number(r.out_of_stock),
  }
}

module.exports = {
  findAdminByEmail, createAdmin, createSession, getAdminBySession, deleteSession, deleteExpiredSessions, changePassword,
  createMessage, listMessages, setMessageRead, deleteMessage,
  createInquiry, listInquiries, setInquiryStatus, deleteInquiry,
  getSettings, saveSettings, seedSettings, getStats,
}
