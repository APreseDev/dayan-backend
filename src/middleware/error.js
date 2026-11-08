import { HttpError } from '../lib/errors.js'

export function notFoundApi(req, res) {
  res.status(404).json({ error: 'مسیر پیدا نشد' })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.fields ? { fields: err.fields } : {}) })
  }
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم فایل بیش از ۵ مگابایت است.' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'بدنه‌ی درخواست JSON معتبر نیست.' })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'درخواست بیش از حد بزرگ است.' })
  console.error('[server error]', err)
  res.status(500).json({ error: 'خطای داخلی سرور' })
}
