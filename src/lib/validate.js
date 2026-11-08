'use strict'
const { z } = require('zod')
const { normFa, normalizePhone, toLatinDigits } = require('./text')

const MAX_PRICE = 1_000_000_000_000
const MSG = 'مقدار نامعتبر است.'

/** رشته‌ی تمیز: trim + یکسان‌سازی حروف + حداکثر طول */
const str = (max, { min = 0 } = {}) =>
  z
    .string({ invalid_type_error: MSG, required_error: 'این فیلد الزامی است.' })
    .transform((s) => normFa(s).trim())
    .pipe(z.string().min(min, min ? 'این فیلد الزامی است.' : MSG).max(max, `حداکثر ${max} نویسه.`))

const optStr = (max) => str(max).optional().default('')

const phone = z
  .string({ invalid_type_error: MSG, required_error: 'شماره موبایل الزامی است.' })
  .transform((s) => normalizePhone(s))
  .refine((p) => p !== null, 'شماره موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹).')

const email = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.union([z.literal(''), z.string().email('ایمیل معتبر نیست.').max(200)]))

const optEmail = email.optional().default('')

const money = z.coerce.number({ invalid_type_error: 'عدد وارد کنید.' }).int('عدد صحیح وارد کنید.').min(0, 'نمی‌تواند منفی باشد.').max(MAX_PRICE, 'مبلغ بیش از حد بزرگ است.')

const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^\/uploads\/[\w.-]+$/.test(u) || /^https:\/\/[^\s]+$/.test(u), 'آدرس تصویر معتبر نیست.')

// ───────── محصول و دسته ─────────
const categoryInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'شناسه فقط حروف لاتین کوچک، عدد و خط تیره (مثال: gas-boiler).')
    .max(60),
  name: str(100, { min: 1 }),
  description: optStr(1000),
  image: imageUrl.nullable().optional().default(null),
  sortOrder: z.coerce.number().int().min(-9999).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
})

const productInput = z
  .object({
    categoryId: z.coerce.number().int().positive().nullable().optional().default(null),
    name: str(200, { min: 2 }),
    brand: optStr(100),
    sku: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .transform((s) => (s ? s : null)),
    shortDescription: optStr(300),
    description: optStr(10000),
    price: money,
    oldPrice: money.nullable().optional().default(null),
    trackStock: z.boolean().optional().default(false),
    stock: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
    badge: optStr(40),
    warranty: optStr(200),
    features: z.array(str(200, { min: 1 })).max(30).optional().default([]),
    specs: z
      .array(z.object({ label: str(100, { min: 1 }), value: str(300, { min: 1 }) }))
      .max(60)
      .optional()
      .default([]),
    images: z.array(imageUrl).max(12).optional().default([]),
    isActive: z.boolean().optional().default(true),
    isFeatured: z.boolean().optional().default(false),
  })
  .refine((p) => p.oldPrice === null || p.oldPrice >= p.price, {
    path: ['oldPrice'],
    message: 'قیمت قبلی باید بیشتر یا برابر قیمت فعلی باشد.',
  })

// ───────── سفارش و فرم‌ها ─────────
const orderInput = z.object({
  customer: z.object({
    name: str(120, { min: 2 }),
    phone,
    email: optEmail,
    province: str(60, { min: 1 }),
    city: str(60, { min: 1 }),
    address: str(500, { min: 8 }),
    postalCode: z
      .string()
      .optional()
      .default('')
      .transform((s) => toLatinDigits(s).replace(/\D/g, ''))
      .refine((s) => s === '' || s.length === 10, 'کدپستی باید ۱۰ رقم باشد.'),
    notes: optStr(1000),
  }),
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().min(1, 'تعداد حداقل ۱ است.').max(20, 'حداکثر ۲۰ عدد از هر کالا.'),
      }),
    )
    .min(1, 'سبد خرید خالی است.')
    .max(50),
})

const trackInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^DN\d{8}$/, 'کد پیگیری معتبر نیست (مثال: DN12345678).'),
  phone,
})

const contactInput = z
  .object({
    name: str(120, { min: 2 }),
    email: optEmail,
    phone: z
      .string()
      .optional()
      .default('')
      .transform((s) => (s.trim() ? normalizePhone(s) : ''))
      .refine((p) => p !== null, 'شماره موبایل معتبر نیست.'),
    topic: optStr(100),
    message: str(3000, { min: 5 }),
  })
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'ایمیل یا شماره تماس را وارد کنید.' })

const inquiryInput = z.object({
  name: str(120, { min: 2 }),
  phone,
  message: optStr(2000),
  productId: z.coerce.number().int().positive().nullable().optional().default(null),
})

// ───────── ادمین ─────────
const loginInput = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) })

const passwordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'رمز جدید حداقل ۸ نویسه باشد.').max(200),
})

const ORDER_STATUSES = ['new', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
const orderUpdateInput = z
  .object({ status: z.enum(ORDER_STATUSES).optional(), adminNote: str(2000).optional() })
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, 'هیچ تغییری ارسال نشده است.')

const settingsInput = z.object({
  company: z.object({
    name: str(100, { min: 1 }),
    tagline: optStr(200),
    phone: optStr(40),
    phone2: optStr(40),
    email: optEmail,
    address: optStr(500),
    hours: optStr(200),
    about: optStr(5000),
    instagram: optStr(300),
    telegram: optStr(300),
    whatsapp: optStr(300),
  }),
  shipping: z.object({
    flat: money,
    freeOver: money.nullable().optional().default(null),
    note: optStr(500),
  }),
})

module.exports = {
  categoryInput,
  productInput,
  orderInput,
  trackInput,
  contactInput,
  inquiryInput,
  loginInput,
  passwordInput,
  orderUpdateInput,
  settingsInput,
  ORDER_STATUSES,
}
