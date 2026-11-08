'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const multer = require('multer')
const config = require('../config')
const { badRequest } = require('./errors')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
})

/** نوع واقعی تصویر از روی بایت‌های ابتدای فایل (نه نام یا Content-Type ادعاشده) */
function detectImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

async function saveImage(file) {
  if (!file) throw badRequest('فایلی ارسال نشده است.')
  const ext = detectImage(file.buffer)
  if (!ext) throw badRequest('فقط تصویر JPG، PNG یا WebP مجاز است.')
  await fs.mkdir(config.uploadDir, { recursive: true })
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${ext}`
  await fs.writeFile(path.join(config.uploadDir, name), file.buffer, { flag: 'wx' })
  return `/uploads/${name}`
}

module.exports = { upload, saveImage, detectImage }
