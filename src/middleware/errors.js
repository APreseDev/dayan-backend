'use strict'
const { ZodError } = require('zod')
const { HttpError } = require('../lib/errors')

const formatIssues = (err) => err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)

  if (err instanceof ZodError) {
    const issues = formatIssues(err)
    return res.status(400).json({ error: issues[0] ? `${issues[0].path ? issues[0].path + ': ' : ''}${issues[0].message}` : 'اطلاعات نامعتبر است.', issues })
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details })
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بدنه‌ی درخواست JSON معتبر نیست.' })
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'حجم فایل/درخواست بیش از حد مجاز است.' })
  }
  if (err.name === 'MulterError') return res.status(400).json({ error: 'آپلود فایل نامعتبر است.' })

  console.error('[error]', req.method, req.originalUrl, err)
  res.status(500).json({ error: 'خطای داخلی سرور.' })
}

function notFoundApi(req, res) {
  res.status(404).json({ error: 'آدرس یافت نشد.' })
}

module.exports = { errorHandler, notFoundApi }
