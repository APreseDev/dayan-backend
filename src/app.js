'use strict'
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const helmet = require('helmet')
const config = require('./config')
const publicRoutes = require('./routes/public')
const adminRoutes = require('./routes/admin')
const { errorHandler, notFoundApi } = require('./middleware/errors')

const ADMIN_DIR = path.join(__dirname, '..', 'admin')

function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', config.trustProxy)

  // CSP سخت‌گیرانه فقط روی پنل ادمین؛ فرانت سایت (فونت/تصاویر خارجی احتمالی) را محدود نمی‌کنیم
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
  const adminCsp = helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
  })

  app.use(express.json({ limit: '1mb' }))

  app.get('/healthz', (req, res) => res.json({ ok: true }))

  app.use('/api/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  }, adminRoutes)
  app.use('/api', publicRoutes)
  app.use('/api', notFoundApi)

  // تصاویر آپلودشده
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      maxAge: '30d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
    }),
  )

  // پنل ادمین
  // نکته: app.get('/admin') در Express «/admin/» را هم می‌گیرد و حلقه‌ی ریدایرکت می‌سازد؛ پس با originalUrl بررسی می‌شود
  app.use(
    '/admin',
    (req, res, next) => {
      if (req.originalUrl.split('?')[0] === '/admin') return res.redirect(301, '/admin/')
      next()
    },
    adminCsp,
    express.static(ADMIN_DIR, { maxAge: 0, etag: true }),
  )

  // فرانت ساخته‌شده (اختیاری) + بازگشت به index.html برای مسیرهای SPA
  if (config.frontendDist && fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
    app.use(express.static(config.frontendDist, { index: false, maxAge: '1h' }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next()
      res.sendFile(path.join(config.frontendDist, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}

module.exports = { createApp }
