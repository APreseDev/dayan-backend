'use strict'
const { badRequest, conflict } = require('./errors')

/**
 * قیمت‌گذاری سفارش — فقط بر اساس داده‌ی دیتابیس؛ هیچ قیمتی از کلاینت پذیرفته نمی‌شود.
 * @param products ردیف‌های محصول (id, name, price, track_stock, stock, is_active, image)
 * @param items    [{productId, qty}]
 * @param shipping {flat, freeOver}
 */
function computeOrder(products, items, shipping) {
  const byId = new Map(products.map((p) => [p.id, p]))

  // ردیف‌های تکراری یک کالا ادغام می‌شوند
  const wanted = new Map()
  for (const { productId, qty } of items) wanted.set(productId, (wanted.get(productId) || 0) + qty)

  const lines = []
  const problems = []
  for (const [productId, qty] of wanted) {
    const p = byId.get(productId)
    if (!p || !p.is_active) {
      problems.push({ productId, reason: 'unavailable' })
      continue
    }
    if (qty > 20) {
      problems.push({ productId, reason: 'max_qty' })
      continue
    }
    if (p.track_stock && qty > p.stock) {
      problems.push({ productId, reason: 'out_of_stock', available: p.stock })
      continue
    }
    lines.push({
      productId,
      name: p.name,
      unitPrice: p.price,
      qty,
      image: p.image || null,
      trackStock: p.track_stock,
    })
  }

  if (problems.length) {
    const stockOnly = problems.every((x) => x.reason === 'out_of_stock')
    throw (stockOnly ? conflict : badRequest)('برخی کالاهای سبد قابل ثبت نیستند.', problems)
  }

  const itemsTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0)
  const free = shipping.freeOver !== null && shipping.freeOver !== undefined && itemsTotal >= shipping.freeOver
  const shippingCost = free ? 0 : shipping.flat
  return { lines, itemsTotal, shippingCost, total: itemsTotal + shippingCost }
}

module.exports = { computeOrder }
