'use strict'
const { likePattern } = require('../lib/text')
const { notFound, conflict } = require('../lib/errors')

// ───────── دسته‌ها ─────────
const toCategory = (r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  image: r.image,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  productCount: r.product_count ?? 0,
})

async function listCategories(db, { includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT c.*, (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.is_active) AS product_count
       FROM categories c
      WHERE ($1::boolean OR c.is_active)
      ORDER BY c.sort_order, c.id`,
    [includeInactive],
  )
  return rows.map(toCategory)
}

async function getCategory(db, id) {
  const { rows } = await db.query('SELECT * FROM categories WHERE id = $1', [id])
  if (!rows[0]) throw notFound('دسته‌بندی پیدا نشد.')
  return toCategory(rows[0])
}

const isUnique = (err) => err && err.code === '23505'

async function createCategory(db, c) {
  try {
    const { rows } = await db.query(
      `INSERT INTO categories (slug, name, description, image, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [c.slug, c.name, c.description, c.image, c.sortOrder, c.isActive],
    )
    return toCategory(rows[0])
  } catch (err) {
    if (isUnique(err)) throw conflict('این شناسه‌ی لاتین قبلاً برای دسته‌ی دیگری استفاده شده است.')
    throw err
  }
}

async function updateCategory(db, id, c) {
  try {
    const { rows } = await db.query(
      `UPDATE categories SET slug=$2, name=$3, description=$4, image=$5, sort_order=$6, is_active=$7
        WHERE id=$1 RETURNING *`,
      [id, c.slug, c.name, c.description, c.image, c.sortOrder, c.isActive],
    )
    if (!rows[0]) throw notFound('دسته‌بندی پیدا نشد.')
    return toCategory(rows[0])
  } catch (err) {
    if (isUnique(err)) throw conflict('این شناسه‌ی لاتین قبلاً برای دسته‌ی دیگری استفاده شده است.')
    throw err
  }
}

async function deleteCategory(db, id) {
  const { rows } = await db.query('DELETE FROM categories WHERE id=$1 RETURNING id', [id])
  if (!rows[0]) throw notFound('دسته‌بندی پیدا نشد.')
}

// ───────── محصولات ─────────
function discountPercent(price, oldPrice) {
  return oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0
}

function toProduct(r, { admin = false } = {}) {
  const images = r.images || []
  const dto = {
    id: r.id,
    name: r.name,
    brand: r.brand,
    shortDescription: r.short_description,
    description: r.description,
    price: r.price,
    oldPrice: r.old_price,
    discount: discountPercent(r.price, r.old_price),
    inStock: !r.track_stock || r.stock > 0,
    badge: r.badge,
    warranty: r.warranty,
    features: r.features,
    specs: r.specs,
    isFeatured: r.is_featured,
    categoryId: r.category_id,
    category: r.category_id ? { id: r.category_id, slug: r.category_slug, name: r.category_name } : null,
    images,
    image: images[0] || null,
    createdAt: r.created_at,
  }
  if (admin) {
    Object.assign(dto, { sku: r.sku, trackStock: r.track_stock, stock: r.stock, isActive: r.is_active, updatedAt: r.updated_at })
  }
  return dto
}

// ترتیب‌ها از لیست سفید می‌آیند، هرگز مستقیم از ورودی کاربر
const ORDERS = {
  newest: 'p.created_at DESC, p.id DESC',
  cheapest: 'p.price ASC, p.id ASC',
  expensive: 'p.price DESC, p.id DESC',
  discount: '(CASE WHEN p.old_price > p.price THEN (p.old_price - p.price)::float / p.old_price ELSE 0 END) DESC, p.id DESC',
}

const PRODUCT_COLUMNS = `
  p.*, c.slug AS category_slug, c.name AS category_name,
  COALESCE((SELECT json_agg(pi.url ORDER BY pi.sort_order, pi.id)
              FROM product_images pi WHERE pi.product_id = p.id), '[]'::json) AS images`
const PRODUCT_FROM = 'FROM products p LEFT JOIN categories c ON c.id = p.category_id'

async function listProducts(db, opts = {}) {
  const { category = null, q = '', sort = 'newest', featured = false, includeInactive = false, limit = 24, offset = 0 } = opts
  const order = ORDERS[sort] || ORDERS.newest
  const pattern = q && q.trim() ? likePattern(q) : null
  const params = [includeInactive, category, pattern, featured, limit, offset]
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLUMNS}, count(*) OVER() AS total_count
       ${PRODUCT_FROM}
      WHERE ($1::boolean OR (p.is_active AND (c.id IS NULL OR c.is_active)))
        AND ($2::text IS NULL OR c.slug = $2)
        AND ($3::text IS NULL OR p.name ILIKE $3 OR p.brand ILIKE $3 OR p.sku ILIKE $3 OR p.short_description ILIKE $3)
        AND (NOT $4::boolean OR p.is_featured)
      ORDER BY ${order}
      LIMIT $5 OFFSET $6`,
    params,
  )
  return {
    items: rows.map((r) => toProduct(r, { admin: includeInactive })),
    total: rows.length ? Number(rows[0].total_count) : 0,
  }
}

async function getProduct(db, id, { includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
      WHERE p.id = $1 AND ($2::boolean OR (p.is_active AND (c.id IS NULL OR c.is_active)))`,
    [id, includeInactive],
  )
  if (!rows[0]) throw notFound('محصول پیدا نشد.')
  return toProduct(rows[0], { admin: includeInactive })
}

async function assertCategoryExists(db, categoryId) {
  if (categoryId === null) return
  const { rows } = await db.query('SELECT id FROM categories WHERE id=$1', [categoryId])
  if (!rows[0]) throw conflict('دسته‌بندی انتخاب‌شده وجود ندارد.')
}

async function replaceImages(db, productId, images) {
  await db.query('DELETE FROM product_images WHERE product_id=$1', [productId])
  for (let i = 0; i < images.length; i++) {
    await db.query('INSERT INTO product_images (product_id, url, sort_order) VALUES ($1,$2,$3)', [productId, images[i], i])
  }
}

const productValues = (p) => [
  p.categoryId, p.name, p.brand, p.sku, p.shortDescription, p.description, p.price, p.oldPrice,
  p.trackStock, p.stock, p.badge, p.warranty, JSON.stringify(p.features), JSON.stringify(p.specs),
  p.isActive, p.isFeatured,
]

async function createProduct(tx, p) {
  await assertCategoryExists(tx, p.categoryId)
  try {
    const { rows } = await tx.query(
      `INSERT INTO products (category_id,name,brand,sku,short_description,description,price,old_price,
                             track_stock,stock,badge,warranty,features,specs,is_active,is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16) RETURNING id`,
      productValues(p),
    )
    await replaceImages(tx, rows[0].id, p.images)
    return rows[0].id
  } catch (err) {
    if (isUnique(err)) throw conflict('این کد کالا (SKU) قبلاً ثبت شده است.')
    throw err
  }
}

async function updateProduct(tx, id, p) {
  await assertCategoryExists(tx, p.categoryId)
  try {
    const { rows } = await tx.query(
      `UPDATE products SET category_id=$2,name=$3,brand=$4,sku=$5,short_description=$6,description=$7,
              price=$8,old_price=$9,track_stock=$10,stock=$11,badge=$12,warranty=$13,
              features=$14::jsonb,specs=$15::jsonb,is_active=$16,is_featured=$17,updated_at=now()
        WHERE id=$1 RETURNING id`,
      [id, ...productValues(p)],
    )
    if (!rows[0]) throw notFound('محصول پیدا نشد.')
    await replaceImages(tx, id, p.images)
  } catch (err) {
    if (isUnique(err)) throw conflict('این کد کالا (SKU) قبلاً ثبت شده است.')
    throw err
  }
}

async function deleteProduct(db, id) {
  const { rows } = await db.query('DELETE FROM products WHERE id=$1 RETURNING id', [id])
  if (!rows[0]) throw notFound('محصول پیدا نشد.')
}

module.exports = {
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
}
