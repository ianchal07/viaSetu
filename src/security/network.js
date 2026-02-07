import crypto from "node:crypto";

function isIPv4Private(host) {
  const parts = host.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function normalizeIp(ip) {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

export function assertLanHost(host) {
  if (!host || !isIPv4Private(host)) {
    throw new Error("HOST must be a non-loopback private LAN IPv4 address.");
  }
}

export function createLanRuntimeGuard() {
  return function lanRuntimeGuard(req, res, next) {
    const ip = normalizeIp(req.socket?.remoteAddress || "");
    if (!isIPv4Private(ip)) {
      res.status(403).json({
        error: {
          code: "LAN_ONLY",
          message: "Request rejected: only private LAN clients are allowed."
        }
      });
      return;
    }
    req.clientIp = ip;
    next();
  };
}

export function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(a || "", "utf8");
  const bBuf = Buffer.from(b || "", "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

