import { notFound } from '../lib/errors.js'

/* ───────── تنظیمات ───────── */
export async function getSetting(q, key) {
  const { rows } = await q.query('SELECT value FROM settings WHERE key = $1', [key])
  return rows[0]?.value ?? null
}

export async function getAllSettings(db) {
  const { rows } = await db.query('SELECT key, value FROM settings')
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function saveSettings(db, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    )
  }
  return getAllSettings(db)
}

/* ───────── پیام‌های فرم تماس ───────── */
const mapMessage = (r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, topic: r.topic, message: r.message, isRead: r.is_read, createdAt: r.created_at })

export async function createMessage(db, m) {
  const { rows } = await db.query(
    'INSERT INTO messages (name, email, phone, topic, message) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [m.name, m.email, m.phone, m.topic, m.message],
  )
  return mapMessage(rows[0])
}

export async function listMessages(db, { unread } = {}) {
  const { rows } = await db.query(`SELECT * FROM messages ${unread ? 'WHERE NOT is_read' : ''} ORDER BY created_at DESC, id DESC LIMIT 500`)
  return rows.map(mapMessage)
}

export async function setMessageRead(db, id, isRead) {
  const { rows } = await db.query('UPDATE messages SET is_read = $2 WHERE id = $1 RETURNING *', [id, isRead])
  if (!rows[0]) throw notFound('پیام پیدا نشد')
  return mapMessage(rows[0])
}

export async function deleteMessage(db, id) {
  const { rows } = await db.query('DELETE FROM messages WHERE id = $1 RETURNING id', [id])
  if (!rows[0]) throw notFound('پیام پیدا نشد')
}

/* ───────── استعلام قیمت ───────── */
const mapInquiry = (r) => ({
  id: r.id, productId: r.product_id, productName: r.product_name ?? null, name: r.name, phone: r.phone,
  message: r.message, status: r.status, createdAt: r.created_at,
})

export async function createInquiry(db, i) {
  // اگر محصول در این فاصله حذف شده باشد، استعلام بدون محصول ثبت می‌شود
  const { rows } = await db.query(
    `INSERT INTO inquiries (product_id, name, phone, message)
     VALUES ((SELECT id FROM products WHERE id = $1), $2, $3, $4) RETURNING *`,
    [i.productId ?? null, i.name, i.phone, i.message],
  )
  return mapInquiry(rows[0])
}

export async function listInquiries(db, { status } = {}) {
  const { rows } = await db.query(
    `SELECT i.*, p.name AS product_name FROM inquiries i LEFT JOIN products p ON p.id = i.product_id
     ${status ? 'WHERE i.status = $1' : ''} ORDER BY i.created_at DESC, i.id DESC LIMIT 500`,
    status ? [status] : [],
  )
  return rows.map(mapInquiry)
}

export async function setInquiryStatus(db, id, status) {
  const { rows } = await db.query('UPDATE inquiries SET status = $2 WHERE id = $1 RETURNING *', [id, status])
  if (!rows[0]) throw notFound('استعلام پیدا نشد')
  return mapInquiry(rows[0])
}

/* ───────── آمار داشبورد ───────── */
export async function stats(db) {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE status = 'new')                                  AS new_orders,
      (SELECT COUNT(*) FROM orders)                                                       AS total_orders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE payment_status = 'paid' AND status <> 'cancelled') AS paid_revenue,
      (SELECT COUNT(*) FROM products)                                                     AS products,
      (SELECT COUNT(*) FROM products WHERE track_stock AND stock <= 3 AND is_active)      AS low_stock,
      (SELECT COUNT(*) FROM messages WHERE NOT is_read)                                   AS unread_messages,
      (SELECT COUNT(*) FROM inquiries WHERE status = 'new')                               AS new_inquiries`)
  const r = rows[0]
  return {
    newOrders: r.new_orders, totalOrders: r.total_orders, paidRevenue: r.paid_revenue, products: r.products,
    lowStock: r.low_stock, unreadMessages: r.unread_messages, newInquiries: r.new_inquiries,
  }
}
