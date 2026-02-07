import { tooManyRequests } from "../utils/errors.js";

function touchBucket(map, key, now, windowMs) {
  const existing = map.get(key);
  if (!existing || now - existing.start > windowMs) {
    const bucket = { start: now, count: 1 };
    map.set(key, bucket);
    return bucket;
  }
  existing.count += 1;
  return existing;
}

function sweepExpiredBuckets(map, now, windowMs, hardLimit) {
  for (const [key, bucket] of map) {
    if (now - bucket.start > windowMs) map.delete(key);
  }

  if (map.size <= hardLimit) return;
  const entries = Array.from(map.entries()).sort((a, b) => a[1].start - b[1].start);
  const removeCount = map.size - hardLimit;
  for (let i = 0; i < removeCount; i += 1) map.delete(entries[i][0]);
}

export function createRateLimiter(options) {
  const ipBuckets = new Map();
  const sessionBuckets = new Map();
  const ipWindowMs = options.ipWindowSeconds * 1000;
  const sessionWindowMs = options.sessionWindowSeconds * 1000;
  let requestCount = 0;

  return function rateLimiter(req, _res, next) {
    const now = Date.now();
    requestCount += 1;
    if (requestCount % 128 === 0) {
      sweepExpiredBuckets(ipBuckets, now, ipWindowMs, 20_000);
      sweepExpiredBuckets(sessionBuckets, now, sessionWindowMs, 20_000);
    }

    const ipKey = req.clientIp || req.ip || "unknown";
    const ipBucket = touchBucket(ipBuckets, ipKey, now, ipWindowMs);
    if (ipBucket.count > options.ipMaxRequests) {
      return next(tooManyRequests("RATE_LIMIT_IP", "Too many requests from this IP."));
    }

    if (req.session) {
      const sid = req.session.id;
      const sessionBucket = touchBucket(sessionBuckets, sid, now, sessionWindowMs);
      if (sessionBucket.count > options.sessionMaxRequests) {
        return next(tooManyRequests("RATE_LIMIT_SESSION", "Too many requests from this session."));
      }
    }

    next();
  };
}

export function createLoginProtector(options) {
  const attempts = new Map();
  const windowMs = options.windowSeconds * 1000;
  let operations = 0;

  function cleanup(now) {
    for (const [key, record] of attempts) {
      const lockExpired = !record.lockedUntil || record.lockedUntil <= now;
      if (lockExpired && now - record.windowStart > windowMs) {
        attempts.delete(key);
      }
    }
    if (attempts.size <= 20_000) return;
    const entries = Array.from(attempts.entries()).sort((a, b) => a[1].windowStart - b[1].windowStart);
    for (let i = 0; i < attempts.size - 20_000; i += 1) attempts.delete(entries[i][0]);
  }

  return {
    checkLocked(key) {
      const now = Date.now();
      operations += 1;
      if (operations % 128 === 0) cleanup(now);
      const record = attempts.get(key);
      if (!record) return { locked: false };

      if (record.lockedUntil && record.lockedUntil > now) {
        return { locked: true, retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
      }

      if (now - record.windowStart > options.windowSeconds * 1000) {
        attempts.delete(key);
        return { locked: false };
      }

      return { locked: false };
    },

    registerFailure(key) {
      const now = Date.now();
      operations += 1;
      if (operations % 128 === 0) cleanup(now);
      let record = attempts.get(key);
      if (!record || now - record.windowStart > windowMs) {
        record = { count: 0, windowStart: now, lockedUntil: 0 };
        attempts.set(key, record);
      }
      record.count += 1;
      if (record.count >= options.maxAttempts) {
        record.lockedUntil = now + options.lockoutSeconds * 1000;
      }
      return record;
    },

    clear(key) {
      attempts.delete(key);
    }
  };
}
