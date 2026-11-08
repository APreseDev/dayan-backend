'use strict'
const path = require('node:path')

const env = process.env
const isProd = env.NODE_ENV === 'production'

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL || 'postgres://dian:dian@localhost:5432/dian',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  uploadDir: path.resolve(env.UPLOAD_DIR || './uploads'),
  frontendDist: env.FRONTEND_DIST ? path.resolve(env.FRONTEND_DIST) : null,
  trustProxy: env.TRUST_PROXY === 'true' ? 1 : false,
  autoMigrate: env.AUTO_MIGRATE !== 'false',
  cookieName: 'dian_admin',
  sessionDays: 7,
  maxUploadBytes: 5 * 1024 * 1024,
}
