import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { hashPassword, verifyPassword } from '../lib/password.js'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export async function createAdmin(db, { email, name = '', password }) {
  const hash = await hashPassword(password)
  const { rows } = await db.query(
    `INSERT INTO admins (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id, email, name`,
    [email.toLowerCase(), name, hash],
  )
  return rows[0]
}

/** ورود: ایمیل/گذرواژه را بررسی و نشست جدید می‌سازد. null یعنی نامعتبر. */
export async function login(db, email, password) {
  const { rows } = await db.query('SELECT id, email, name, password_hash FROM admins WHERE email = $1', [email.toLowerCase()])
  const admin = rows[0]
  // حتی با ایمیل ناموجود، هزینه‌ی هش پرداخت می‌شود تا از زمان پاسخ نتوان ایمیل‌ها را حدس زد
  const ok = admin
    ? await verifyPassword(password, admin.password_hash)
    : (await verifyPassword(password, 'scrypt$16384$00$00'), false)
  if (!ok) return null

  const token = randomBytes(32).toString('base64url')
  await db.query(
    `INSERT INTO sessions (token_hash, admin_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(token), admin.id, String(config.sessionDays)],
  )
  return { token, admin: { id: admin.id, email: admin.email, name: admin.name } }
}

export async function getAdminByToken(db, token) {
  if (!token || typeof token !== 'string') return null
  const { rows } = await db.query(
    `SELECT a.id, a.email, a.name FROM sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  )
  return rows[0] ?? null
}

export const logout = (db, token) => db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
export const purgeExpiredSessions = (db) => db.query('DELETE FROM sessions WHERE expires_at <= now()')

/** تغییر گذرواژه؛ همه‌ی نشست‌های دیگر باطل می‌شوند و فقط نشست فعلی می‌ماند. */
export async function changePassword(db, adminId, currentPassword, newPassword, keepToken) {
  const { rows } = await db.query('SELECT password_hash FROM admins WHERE id = $1', [adminId])
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) return false
  const hash = await hashPassword(newPassword)
  await db.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [adminId, hash])
  await db.query('DELETE FROM sessions WHERE admin_id = $1 AND token_hash <> $2', [adminId, sha256(keepToken)])
  return true
}
