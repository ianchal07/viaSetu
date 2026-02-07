import fs from "node:fs";
import path from "node:path";

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const rootDirRaw = String(process.env.ROOT_DIR || "").trim();
const rootDir = rootDirRaw ? path.resolve(rootDirRaw) : "";

export const config = {
  host: process.env.HOST || "",
  port: parseInteger(process.env.PORT, 8080),
  rootDir,
  listBaseDir: String(process.env.LIST_BASE_DIR || "").trim(),
  maxUploadSizeBytes: parseInteger(process.env.MAX_UPLOAD_SIZE_BYTES, 1024 * 1024 * 1024),
  maxChunkSizeBytes: parseInteger(process.env.MAX_CHUNK_SIZE_BYTES, 8 * 1024 * 1024),
  uploadTtlSeconds: parseInteger(process.env.UPLOAD_TTL_SECONDS, 3600),
  listPageSizeDefault: parseInteger(process.env.LIST_PAGE_SIZE_DEFAULT, 100),
  listPageSizeMax: parseInteger(process.env.LIST_PAGE_SIZE_MAX, 500),
  sessionSecret: process.env.SESSION_SECRET || "",
  authReadWriteHash: process.env.AUTH_READWRITE_HASH || "",
  authReadOnlyHash: process.env.AUTH_READONLY_HASH || "",
  sessionTtlSeconds: parseInteger(process.env.SESSION_TTL_SECONDS, 3600),
  sessionCookieSecure: parseBoolean(process.env.SESSION_COOKIE_SECURE, false),
  loginWindowSeconds: parseInteger(process.env.LOGIN_WINDOW_SECONDS, 300),
  loginMaxAttempts: parseInteger(process.env.LOGIN_MAX_ATTEMPTS, 5),
  loginLockoutSeconds: parseInteger(process.env.LOGIN_LOCKOUT_SECONDS, 900),
  rateIpWindowSeconds: parseInteger(process.env.RATE_IP_WINDOW_SECONDS, 60),
  rateIpMaxRequests: parseInteger(process.env.RATE_IP_MAX_REQUESTS, 240),
  rateSessionWindowSeconds: parseInteger(process.env.RATE_SESSION_WINDOW_SECONDS, 60),
  rateSessionMaxRequests: parseInteger(process.env.RATE_SESSION_MAX_REQUESTS, 180),
  logLevel: process.env.LOG_LEVEL || "info"
};

export function validateConfig() {
  if (!config.host) {
    throw new Error("HOST is required and must be a private LAN IPv4 address.");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("PORT must be a valid TCP port (1-65535).");
  }
  if (!config.rootDir) {
    throw new Error("ROOT_DIR is required.");
  }
  if (!config.sessionSecret || config.sessionSecret.length < 24) {
    throw new Error("SESSION_SECRET is required and must be at least 24 characters.");
  }
  if (!config.authReadWriteHash && !config.authReadOnlyHash) {
    throw new Error("At least one auth hash must be configured (AUTH_READWRITE_HASH or AUTH_READONLY_HASH).");
  }
}
