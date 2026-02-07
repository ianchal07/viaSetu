export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(code, message, details) {
  return new HttpError(400, code, message, details);
}

export function forbidden(code, message, details) {
  return new HttpError(403, code, message, details);
}

export function unauthorized(code, message, details) {
  return new HttpError(401, code, message, details);
}

export function notFound(code, message, details) {
  return new HttpError(404, code, message, details);
}

export function conflict(code, message, details) {
  return new HttpError(409, code, message, details);
}

export function tooManyRequests(code, message, details) {
  return new HttpError(429, code, message, details);
}

export function payloadTooLarge(code, message, details) {
  return new HttpError(413, code, message, details);
}

export function mapError(err) {
  if (err instanceof HttpError) return err;
  return new HttpError(500, "INTERNAL_ERROR", "Internal server error");
}

