'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const db = require('./db')
const { seedSettings } = require('./repo/admin')

/** ساخت جدول‌ها (idempotent) و مقداردهی اولیه‌ی تنظیمات */
async function migrate() {
  const sql = await fs.readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  await db.query(sql)
  await seedSettings(db)
}

module.exports = { migrate }
