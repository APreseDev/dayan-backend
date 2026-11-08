'use strict'
// محیط تست: دیتابیس جدا و پوشه‌ی آپلود موقت؛ باید پیش از require کردن ماژول‌های برنامه import شود.
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://dian:dian@localhost:5432/dian_test'
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dian-uploads-'))
process.env.NODE_ENV = 'test'

const db = require('../src/db')
const { createApp } = require('../src/app')
const { migrate } = require('../src/migrate')
const { createAdmin } = require('../src/repo/admin')
const { hashPassword } = require('../src/lib/auth')

const ADMIN = { email: 'admin@dian.ir', password: 'test-password-123' }

async function resetDb() {
  await migrate()
  await db.query('TRUNCATE order_items, orders, inquiries, messages, product_images, products, categories, sessions, admins, settings RESTART IDENTITY CASCADE')
  await migrate()
  await createAdmin(db, { email: ADMIN.email, name: 'مدیر تست', passwordHash: await hashPassword(ADMIN.password) })
}

async function startServer() {
  const server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  /** کلاینت ساده با نگه‌داری کوکی */
  function client() {
    let cookie = ''
    const call = async (method, url, body, { csrf = true, raw = false } = {}) => {
      const headers = {}
      if (cookie) headers.cookie = cookie
      if (csrf && url.startsWith('/api/admin')) headers['x-requested-with'] = 'dian-admin'
      let payload
      if (body instanceof FormData) payload = body
      else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
      const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' })
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      if (set.length) {
        const c = set[0].split(';')[0]
        cookie = c.endsWith('=') ? '' : c
      }
      if (raw) return res
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* غیر JSON */ }
      return { status: res.status, body: json, text, headers: res.headers }
    }
    return {
      get: (u, o) => call('GET', u, undefined, o),
      post: (u, b, o) => call('POST', u, b, o),
      put: (u, b, o) => call('PUT', u, b, o),
      patch: (u, b, o) => call('PATCH', u, b, o),
      del: (u, o) => call('DELETE', u, undefined, o),
      setCookie: (c) => { cookie = c },
      get cookie() { return cookie },
    }
  }

  async function adminClient() {
    const c = client()
    const r = await c.post('/api/admin/login', ADMIN)
    if (r.status !== 200) throw new Error('admin login failed in test: ' + r.text)
    return c
  }

  const close = async () => {
    await new Promise((r) => server.close(r))
    await db.close()
  }
  return { base, client, adminClient, close, db }
}

module.exports = { resetDb, startServer, ADMIN }
