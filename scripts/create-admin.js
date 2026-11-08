'use strict'
// استفاده: npm run create-admin -- you@example.com "رمز-حداقل-۸-نویسه" "نام نمایشی"
// اگر ادمین با این ایمیل وجود داشته باشد، رمزش عوض می‌شود.
const db = require('../src/db')
const { hashPassword } = require('../src/lib/auth')
const { createAdmin } = require('../src/repo/admin')
const { migrate } = require('../src/migrate')

const [email, password, name = 'مدیر'] = process.argv.slice(2)

async function main() {
  if (!email || !email.includes('@') || !password || password.length < 8) {
    throw new Error('استفاده: npm run create-admin -- <email> <password (حداقل ۸ نویسه)> [name]')
  }
  await migrate()
  const admin = await createAdmin(db, { email: email.trim().toLowerCase(), name, passwordHash: await hashPassword(password) })
  console.log(`✔ ادمین ${admin.email} آماده است. ورود: /admin/`)
}

main()
  .catch((err) => {
    console.error('✘', err.message)
    process.exitCode = 1
  })
  .finally(() => db.close())
