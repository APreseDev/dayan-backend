import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const KEYLEN = 64
const COST = 16384 // N

/** فرمت ذخیره: scrypt$N$saltHex$hashHex */
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, { N: COST })
  return `scrypt$${COST}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, n, saltHex, hashHex] = String(stored).split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
