import { forbidden } from "../utils/errors.js";
import { timingSafeEqual } from "./network.js";

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireCsrf(req, _res, next) {
  if (!mutatingMethods.has(req.method)) return next();
  if (!req.session) return next(forbidden("CSRF_DENIED", "Missing authenticated session."));

  const token = req.get("x-csrf-token") || "";
  if (!token || !timingSafeEqual(token, req.session.csrfToken)) {
    return next(forbidden("CSRF_DENIED", "CSRF token is missing or invalid."));
  }

  next();
}

