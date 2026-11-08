'use strict'

const FA = '۰۱۲۳۴۵۶۷۸۹'
const AR = '٠١٢٣٤٥٦٧٨٩'

/** ارقام فارسی/عربی → لاتین */
function toLatinDigits(value) {
  return String(value).replace(/[۰-۹٠-٩]/g, (ch) => {
    const i = FA.indexOf(ch)
    return String(i >= 0 ? i : AR.indexOf(ch))
  })
}

/** یکسان‌سازی «ي ك» عربی به «ی ک» فارسی و حذف کاراکترهای کنترلی جهت‌دهی */
function normFa(value) {
  return String(value)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‎‏‪-‮]/g, '')
}

/** شماره‌ی موبایل ایران → 09xxxxxxxxx یا null */
function normalizePhone(value) {
  let digits = toLatinDigits(value).replace(/[\s\-()+]/g, '')
  if (digits.startsWith('0098')) digits = '0' + digits.slice(4)
  else if (digits.startsWith('98') && digits.length === 12) digits = '0' + digits.slice(2)
  else if (/^9\d{9}$/.test(digits)) digits = '0' + digits
  return /^09\d{9}$/.test(digits) ? digits : null
}

/** برای ILIKE: کاراکترهای ویژه را escape می‌کند */
const likePattern = (q) => `%${normFa(q).trim().replace(/[\\%_]/g, '\\$&')}%`

module.exports = { toLatinDigits, normFa, normalizePhone, likePattern }
