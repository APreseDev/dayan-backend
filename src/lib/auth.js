'use strict'
const crypto = require('node:crypto')
const { promisify } = require('node:util')

const scrypt = promisify(crypto.scrypt)
const KEYLEN = 64
const N = 16384

/** قالب ذخیره: scrypt$N$saltHex$hashHex */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, { N })
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [scheme, n, saltHex, hashHex] = String(stored).split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n) })
  return crypto.timingSafeEqual(actual, expected)
}

const newToken = () => crypto.randomBytes(32).toString('base64url')
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

module.exports = { hashPassword, verifyPassword, newToken, hashToken }
