'use strict'
const db = require('../db')
const config = require('../config')
const { hashToken } = require('../lib/auth')
const { unauthorized, HttpError } = require('../lib/errors')
const admin = require('../repo/admin')

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      /* کوکی خراب نادیده گرفته می‌شود */
    }
  }
  return out
}

/** فقط ادمین واردشده. درخواست‌های تغییردهنده باید هدر سفارشی داشته باشند (دفاع در برابر CSRF، کنار SameSite=Strict). */
async function requireAdmin(req, res, next) {
  const token = parseCookies(req.headers.cookie)[config.cookieName]
  if (!token) throw unauthorized()
  const tokenHash = hashToken(token)
  const found = await admin.getAdminBySession(db, tokenHash)
  if (!found) throw unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید.')

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'dian-admin') {
    throw new HttpError(403, 'درخواست نامعتبر است.')
  }
  req.admin = found
  req.tokenHash = tokenHash
  next()
}

module.exports = { requireAdmin, parseCookies }
