/*
 * لایه‌ی پرداخت — فعلاً فقط «manual» (پرداخت دستی/تلفنی/حضوری؛ ادمین وضعیت را در پنل تغییر می‌دهد).
 *
 * برای افزودن درگاه آنلاین (زرین‌پال، ...) در آینده:
 *  1) فایل src/payment/<provider>.js با دو تابع بسازید:
 *       createPayment({ order, callbackUrl }) → { authority, redirectUrl }
 *       verifyPayment({ order, authority })   → { ok, refId }
 *  2) در جدول orders ستون‌های payment_authority / paid_at را اضافه کنید (migration جدید).
 *  3) مسیر GET /api/payment/callback را اضافه کنید که verifyPayment را صدا بزند و در یک تراکنش
 *     سفارش را (فقط اگر هنوز پرداخت‌نشده است) paid کند — تا کال‌بک تکراری دوبار اثر نگذارد.
 *  4) مبلغ را همیشه از دیتابیس بخوانید (order.total)، نه از کلاینت.
 */
export const PAYMENT_METHODS = ['manual']
