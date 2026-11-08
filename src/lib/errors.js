'use strict'

class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

const badRequest = (message, details) => new HttpError(400, message, details)
const unauthorized = (message = 'ابتدا وارد شوید.') => new HttpError(401, message)
const notFound = (message = 'یافت نشد.') => new HttpError(404, message)
const conflict = (message, details) => new HttpError(409, message, details)

module.exports = { HttpError, badRequest, unauthorized, notFound, conflict }
