import crypto from "node:crypto";

export class SessionStore {
  constructor(ttlSeconds) {
    this.ttlMs = ttlSeconds * 1000;
    this.sessions = new Map();
    this.timer = setInterval(() => this.cleanup(), 60_000);
    this.timer.unref();
  }

  create(data) {
    const id = crypto.randomBytes(32).toString("hex");
    const csrfToken = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    const session = {
      id,
      csrfToken,
      role: data.role,
      clientIp: data.clientIp || "",
      userAgent: data.userAgent || "",
      createdAt: now,
      expiresAt: now + this.ttlMs,
      lastSeenAt: now
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    session.lastSeenAt = Date.now();
    session.expiresAt = Date.now() + this.ttlMs;
    return session;
  }

  destroy(id) {
    if (!id) return;
    this.sessions.delete(id);
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}
