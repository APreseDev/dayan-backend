'use strict'
const config = require('./config')
const db = require('./db')
const { createApp } = require('./app')
const { migrate } = require('./migrate')
const { deleteExpiredSessions } = require('./repo/admin')

async function main() {
  if (config.autoMigrate) await migrate()

  const app = createApp()
  const server = app.listen(config.port, () => console.log(`دایان: http://localhost:${config.port}  (پنل ادمین: /admin/)`))

  // پاکسازی ساعتی نشست‌های منقضی
  const cleanup = setInterval(() => deleteExpiredSessions(db).catch((e) => console.error('[cleanup]', e)), 60 * 60 * 1000)
  cleanup.unref()

  const shutdown = (signal) => {
    console.log(`${signal}: در حال خاموش‌شدن…`)
    server.close(async () => {
      await db.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('راه‌اندازی ناموفق بود:', err)
  process.exit(1)
})
