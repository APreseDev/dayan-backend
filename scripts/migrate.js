'use strict'
const db = require('../src/db')
const { migrate } = require('../src/migrate')

migrate()
  .then(() => console.log('✔ دیتابیس آماده است.'))
  .catch((err) => {
    console.error('✘ migrate ناموفق بود:', err.message)
    process.exitCode = 1
  })
  .finally(() => db.close())
