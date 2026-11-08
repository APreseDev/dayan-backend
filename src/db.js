'use strict'
const { Pool, types } = require('pg')
const config = require('./config')

// BIGINT (قیمت‌ها و شمارنده‌ها) به‌صورت عدد برگردد، نه رشته. مقادیر ما بسیار کوچک‌تر از 2^53 هستند.
types.setTypeParser(20, (value) => Number(value))

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 })

/** اجرای یک کوئری ساده */
const query = (text, params) => pool.query(text, params)

/** اجرای چند کوئری در یک تراکنش؛ با خطا rollback می‌شود */
async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn({ query: (text, params) => client.query(text, params) })
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* اتصال خراب است؛ خطای اصلی مهم‌تر است */
    }
    throw err
  } finally {
    client.release()
  }
}

module.exports = { query, tx, pool, close: () => pool.end() }
