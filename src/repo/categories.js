import { HttpError, notFound } from '../lib/errors.js'

const map = (r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  image: r.image,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  productCount: r.product_count ?? 0,
})

const BASE = `
  SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active) AS product_count
  FROM categories c`

export async function listPublic(db) {
  const { rows } = await db.query(`${BASE} WHERE c.is_active ORDER BY c.sort_order, c.id`)
  return rows.map(map)
}

export async function listAdmin(db) {
  const { rows } = await db.query(`${BASE} ORDER BY c.sort_order, c.id`)
  return rows.map(map)
}

export async function get(db, id) {
  const { rows } = await db.query(`${BASE} WHERE c.id = $1`, [id])
  if (!rows[0]) throw notFound('دسته‌بندی پیدا نشد')
  return map(rows[0])
}

const duplicate = (error) => {
  if (error.code === '23505') throw new HttpError(409, 'این شناسه (slug) قبلاً برای دسته‌ی دیگری استفاده شده است.', { slug: 'تکراری است' })
  throw error
}

export async function create(db, c) {
  try {
    const { rows } = await db.query(
      `INSERT INTO categories (slug, name, description, image, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [c.slug, c.name, c.description, c.image, c.sortOrder, c.isActive],
    )
    return get(db, rows[0].id)
  } catch (e) {
    return duplicate(e)
  }
}

export async function update(db, id, c) {
  try {
    const { rows } = await db.query(
      `UPDATE categories SET slug=$2, name=$3, description=$4, image=$5, sort_order=$6, is_active=$7
       WHERE id=$1 RETURNING id`,
      [id, c.slug, c.name, c.description, c.image, c.sortOrder, c.isActive],
    )
    if (!rows[0]) throw notFound('دسته‌بندی پیدا نشد')
    return get(db, id)
  } catch (e) {
    return duplicate(e)
  }
}

/** حذف دسته؛ محصولاتش بدون دسته می‌مانند (حذف نمی‌شوند). */
export async function remove(db, id) {
  const { rows } = await db.query('DELETE FROM categories WHERE id = $1 RETURNING id', [id])
  if (!rows[0]) throw notFound('دسته‌بندی پیدا نشد')
}
