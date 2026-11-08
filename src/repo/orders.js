'use strict'
const crypto = require('node:crypto')
const { computeOrder } = require('../lib/pricing')
const { conflict, notFound } = require('../lib/errors')
const { likePattern } = require('../lib/text')

const toOrder = (r, items) => ({
  id: r.id,
  code: r.code,
  status: r.status,
  customer: {
    name: r.customer_name,
    phone: r.phone,
    email: r.email,
    province: r.province,
    city: r.city,
    address: r.address,
    postalCode: r.postal_code,
  },
  notes: r.notes,
  itemsTotal: r.items_total,
  shippingCost: r.shipping_cost,
  total: r.total,
  adminNote: r.admin_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  itemCount: r.item_count,
  items,
})

const toItem = (i) => ({ productId: i.product_id, name: i.name, unitPrice: i.unit_price, qty: i.qty, image: i.image })

async function getOrderBy(db, column, value) {
  const { rows } = await db.query(`SELECT * FROM orders WHERE ${column} = $1`, [value]) // column از کد می‌آید، نه کاربر
  if (!rows[0]) throw notFound('سفارش پیدا نشد.')
  const { rows: items } = await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [rows[0].id])
  return toOrder(rows[0], items.map(toItem))
}

const getOrderById = (db, id) => getOrderBy(db, 'id', id)
const getOrderByCode = (db, code) => getOrderBy(db, 'code', code)

/**
 * ثبت سفارش در یک تراکنش: قفل ردیف محصولات، قیمت‌گذاری از دیتابیس، کسر موجودی، ثبت سفارش.
 * `tx` باید یک اتصال تراکنشی باشد.
 */
async function createOrder(tx, input, shipping) {
  const ids = [...new Set(input.items.map((i) => i.productId))].sort((a, b) => a - b)
  const { rows: products } = await tx.query(
    `SELECT p.id, p.name, p.price, p.track_stock, p.stock,
            (p.is_active AND (c.id IS NULL OR c.is_active)) AS is_active,
            (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS image
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ANY($1::int[])
      ORDER BY p.id
        FOR UPDATE OF p`,
    [ids],
  )

  const priced = computeOrder(products, input.items, shipping)

  for (const line of priced.lines) {
    if (!line.trackStock) continue
    const { rows } = await tx.query(
      'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING id',
      [line.productId, line.qty],
    )
    if (!rows[0]) throw conflict('موجودی کالا تغییر کرد؛ سبد را بررسی کنید.')
  }

  const c = input.customer
  let order = null
  for (let attempt = 0; attempt < 8 && !order; attempt++) {
    const code = `DN${crypto.randomInt(10_000_000, 100_000_000)}`
    const { rows } = await tx.query(
      `INSERT INTO orders (code, customer_name, phone, email, province, city, address, postal_code, notes,
                           items_total, shipping_cost, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [code, c.name, c.phone, c.email, c.province, c.city, c.address, c.postalCode, c.notes,
        priced.itemsTotal, priced.shippingCost, priced.total],
    )
    order = rows[0] || null
  }
  if (!order) throw new Error('could not allocate order code')

  for (const l of priced.lines) {
    await tx.query(
      'INSERT INTO order_items (order_id, product_id, name, unit_price, qty, image) VALUES ($1,$2,$3,$4,$5,$6)',
      [order.id, l.productId, l.name, l.unitPrice, l.qty, l.image],
    )
  }
  return getOrderById(tx, order.id)
}

async function listOrders(db, { status = null, q = '', limit = 30, offset = 0 } = {}) {
  const pattern = q && q.trim() ? likePattern(q) : null
  const { rows } = await db.query(
    `SELECT o.*, (SELECT COALESCE(sum(qty),0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
            count(*) OVER() AS total_count
       FROM orders o
      WHERE ($1::text IS NULL OR o.status = $1)
        AND ($2::text IS NULL OR o.code ILIKE $2 OR o.phone ILIKE $2 OR o.customer_name ILIKE $2)
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $3 OFFSET $4`,
    [status, pattern, limit, offset],
  )
  return { items: rows.map((r) => toOrder(r, undefined)), total: rows.length ? Number(rows[0].total_count) : 0 }
}

/** تغییر وضعیت/یادداشت. لغو سفارش، موجودی کالاها را برمی‌گرداند. لغوشده، نهایی است. */
async function updateOrder(tx, id, { status, adminNote }) {
  const { rows } = await tx.query('SELECT id, status FROM orders WHERE id=$1 FOR UPDATE', [id])
  if (!rows[0]) throw notFound('سفارش پیدا نشد.')
  const current = rows[0].status

  if (status && status !== current) {
    if (current === 'cancelled') throw conflict('سفارش لغوشده قابل تغییر نیست.')
    if (status === 'cancelled') {
      await tx.query(
        `UPDATE products p SET stock = p.stock + oi.qty
           FROM order_items oi
          WHERE oi.order_id = $1 AND oi.product_id = p.id AND p.track_stock`,
        [id],
      )
    }
  }

  await tx.query(
    'UPDATE orders SET status = COALESCE($2, status), admin_note = COALESCE($3, admin_note), updated_at = now() WHERE id = $1',
    [id, status ?? null, adminNote ?? null],
  )
  return getOrderById(tx, id)
}

/** نمای عمومی برای پیگیری سفارش توسط مشتری (بدون نشانی و تلفن) */
const toPublicOrder = (o) => ({
  code: o.code,
  status: o.status,
  createdAt: o.createdAt,
  itemsTotal: o.itemsTotal,
  shippingCost: o.shippingCost,
  total: o.total,
  items: o.items,
})

module.exports = { createOrder, listOrders, getOrderById, getOrderByCode, updateOrder, toPublicOrder }
