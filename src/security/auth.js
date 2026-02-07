import { forbidden, unauthorized } from "../utils/errors.js";

export function attachSession(sessionStore) {
  return function sessionMiddleware(req, _res, next) {
    const sid = req.signedCookies?.sid;
    const session = sessionStore.get(sid);
    if (!session) {
      req.session = null;
      return next();
    }

    const reqIp = req.clientIp || "";
    const reqUserAgent = String(req.get("user-agent") || "");
    if (session.clientIp !== reqIp || session.userAgent !== reqUserAgent) {
      sessionStore.destroy(session.id);
      req.session = null;
      return next();
    }

    req.session = session;
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.session) {
    return next(unauthorized("AUTH_REQUIRED", "Authentication is required."));
  }
  next();
}

export function requireWriteRole(req, _res, next) {
  if (!req.session) return next(unauthorized("AUTH_REQUIRED", "Authentication is required."));
  if (req.session.role !== "read-write") {
    return next(forbidden("WRITE_FORBIDDEN", "This action requires read-write permissions."));
  }
  next();
}
