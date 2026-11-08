import { HttpError, notFound } from '../lib/errors.js'

export function mapProduct(r) {
  const discount = r.old_price && r.old_price > r.price ? Math.round((1 - r.price / r.old_price) * 100) : 0
  const images = r.images ?? []
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    sku: r.sku,
    shortDescription: r.short_description,
    description: r.description,
    price: r.price,
    oldPrice: r.old_price,
    discount,
    trackStock: r.track_stock,
    stock: r.stock,
    inStock: !r.track_stock || r.stock > 0,
    badge: r.badge,
    warranty: r.warranty,
    features: r.features,
    specs: r.specs,
    isActive: r.is_active,
    isFeatured: r.is_featured,
    category: r.category_id ? { id: r.category_id, slug: r.category_slug, name: r.category_name } : null,
    image: images[0] ?? null,
    images,
    createdAt: r.created_at,
  }
}

const SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name,
    COALESCE((SELECT json_agg(i.url ORDER BY i.sort_order, i.id) FROM product_images i WHERE i.product_id = p.id), '[]'::json) AS images
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  cheapest: 'p.price ASC, p.id',
  expensive: 'p.price DESC, p.id',
  discount: 'CASE WHEN p.old_price > p.price THEN 1 - p.price::float / p.old_price ELSE 0 END DESC, p.id',
}

/** جستجوی یکسان با نرمال‌سازی «ي/ك» عربی */
const SEARCH_EXPR = `translate(lower(p.name || ' ' || p.brand || ' ' || COALESCE(p.sku,'') || ' ' || p.short_description), 'يك', 'یک')`
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&')

/**
 * لیست محصولات.
 * publicOnly=true: فقط فعال‌ها (و دسته‌ی فعال). برای ادمین همه‌چیز + فیلتر وضعیت.
 */
export async function list(db, { publicOnly = true, category, q, sort = 'newest', featured, page = 1, limit = 24 } = {}) {
  const where = []
  const params = []
  const add = (value) => (params.push(value), `$${params.length}`)

  if (publicOnly) where.push('p.is_active AND (c.id IS NULL OR c.is_active)')
  if (category) where.push(`c.slug = ${add(category)}`)
  if (featured) where.push('p.is_featured')
  if (q) where.push(`${SEARCH_EXPR} ILIKE ${add(`%${escapeLike(q.replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase())}%`)}`)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const orderSql = SORTS[sort] ?? SORTS.newest
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100)
  const offset = (Math.max(Number(page) || 1, 1) - 1) * safeLimit

  const [{ rows }, { rows: count }] = await Promise.all([
    db.query(`${SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT ${safeLimit} OFFSET ${offset}`, params),
    db.query(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`, params),
  ])
  return { items: rows.map(mapProduct), total: count[0].n, page: Math.max(Number(page) || 1, 1), limit: safeLimit }
}

export async function get(db, id, { publicOnly = true } = {}) {
  const { rows } = await db.query(
    `${SELECT} WHERE p.id = $1 ${publicOnly ? 'AND p.is_active AND (c.id IS NULL OR c.is_active)' : ''}`,
    [id],
  )
  if (!rows[0]) throw notFound('محصول پیدا نشد')
  return mapProduct(rows[0])
}

/** محصولات هم‌دسته (برای «محصولات مشابه») */
export async function related(db, id, limit = 4) {
  const { rows } = await db.query(
    `${SELECT}
     WHERE p.id <> $1 AND p.is_active AND (c.id IS NULL OR c.is_active)
     ORDER BY (p.category_id IS NOT DISTINCT FROM (SELECT category_id FROM products WHERE id = $1)) DESC, p.created_at DESC
     LIMIT $2`,
    [id, limit],
  )
  return rows.map(mapProduct)
}

const writeError = (error) => {
  if (error.code === '23505') throw new HttpError(409, 'این کد کالا (SKU) قبلاً برای محصول دیگری ثبت شده است.', { sku: 'تکراری است' })
  if (error.code === '23503') throw new HttpError(400, 'دسته‌بندی انتخاب‌شده وجود ندارد.', { categoryId: 'نامعتبر است' })
  throw error
}

async function writeImages(client, productId, images) {
  await client.query('DELETE FROM product_images WHERE product_id = $1', [productId])
  for (const [index, url] of images.entries()) {
    await client.query('INSERT INTO product_images (product_id, url, sort_order) VALUES ($1,$2,$3)', [productId, url, index])
  }
}

const COLUMNS = (p) => [
  p.categoryId, p.name, p.brand, p.sku || null, p.shortDescription, p.description, p.price, p.oldPrice,
  p.trackStock, p.stock, p.badge, p.warranty, JSON.stringify(p.features), JSON.stringify(p.specs), p.isActive, p.isFeatured,
]

export async function create(db, p) {
  try {
    const id = await db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO products (category_id, name, brand, sku, short_description, description, price, old_price,
           track_stock, stock, badge, warranty, features, specs, is_active, is_featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16) RETURNING id`,
        COLUMNS(p),
      )
      await writeImages(client, rows[0].id, p.images)
      return rows[0].id
    })
    return get(db, id, { publicOnly: false })
  } catch (e) {
    return writeError(e)
  }
}

export async function update(db, id, p) {
  try {
    await db.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE products SET category_id=$2, name=$3, brand=$4, sku=$5, short_description=$6, description=$7,
           price=$8, old_price=$9, track_stock=$10, stock=$11, badge=$12, warranty=$13,
           features=$14::jsonb, specs=$15::jsonb, is_active=$16, is_featured=$17, updated_at=now()
         WHERE id=$1 RETURNING id`,
        [id, ...COLUMNS(p)],
      )
      if (!rows[0]) throw notFound('محصول پیدا نشد')
      await writeImages(client, id, p.images)
    })
    return get(db, id, { publicOnly: false })
  } catch (e) {
    return writeError(e)
  }
}

export async function remove(db, id) {
  const { rows } = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [id])
  if (!rows[0]) throw notFound('محصول پیدا نشد')
}
