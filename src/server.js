import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "node:path";
import { config, validateConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";
import { mapError } from "./utils/errors.js";
import { assertLanHost, createLanRuntimeGuard } from "./security/network.js";
import { SessionStore } from "./security/sessionStore.js";
import { attachSession } from "./security/auth.js";
import { requireCsrf } from "./security/csrf.js";
import { createRateLimiter, createLoginProtector } from "./security/rateLimit.js";
import { verifyPassword } from "./security/password.js";
import { PathPolicy } from "./fs/pathPolicy.js";
import { FileService } from "./fs/fileService.js";
import { createApiRouter } from "./routes.js";

const logger = createLogger(config.logLevel);

async function main() {
  validateConfig();
  assertLanHost(config.host);
  if (!config.sessionCookieSecure) {
    logger.warn("insecure_cookie_transport", {
      message: "SESSION_COOKIE_SECURE=false allows session cookies over HTTP; use HTTPS in production."
    });
  }

  const pathPolicy = new PathPolicy(config.rootDir);
  await pathPolicy.ensureRootValid();

  const sessionStore = new SessionStore(config.sessionTtlSeconds);
  const fileService = new FileService(pathPolicy, config);
  await fileService.init();

  const loginProtector = createLoginProtector({
    windowSeconds: config.loginWindowSeconds,
    maxAttempts: config.loginMaxAttempts,
    lockoutSeconds: config.loginLockoutSeconds
  });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        "upgrade-insecure-requests": null
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false
  }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(createLanRuntimeGuard());
  app.use(cookieParser(config.sessionSecret));
  app.use(attachSession(sessionStore));

  app.use(createRateLimiter({
    ipWindowSeconds: config.rateIpWindowSeconds,
    ipMaxRequests: config.rateIpMaxRequests,
    sessionWindowSeconds: config.rateSessionWindowSeconds,
    sessionMaxRequests: config.rateSessionMaxRequests
  }));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/auth/login") || req.path.startsWith("/api/health")) return next();
    return requireCsrf(req, res, next);
  });

  app.use("/api", createApiRouter({
    config,
    fileService,
    loginProtector,
    sessionStore,
    passwordVerifier: verifyPassword
  }));

  app.use(express.static(path.resolve(process.cwd(), "public"), {
    etag: false,
    extensions: ["html"],
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    }
  }));

  app.use((err, req, res, _next) => {
    const mapped = mapError(err);
    logger.error("request_failed", {
      code: mapped.code,
      status: mapped.status,
      message: mapped.message,
      path: req.path,
      method: req.method,
      ip: req.clientIp || req.socket?.remoteAddress || "unknown"
    });
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message, details: mapped.details || undefined }
    });
  });

  const server = app.listen(config.port, config.host, () => {
    logger.info("server_started", { host: config.host, port: config.port, rootDir: config.rootDir });
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("server_shutdown_start", { signal });

    server.close(async () => {
      await fileService.shutdown();
      sessionStore.stop();
      logger.info("server_shutdown_complete", {});
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("server_shutdown_forced", {});
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  const startupLogger = createLogger("error");
  startupLogger.error("startup_failed", { message: err.message });
  process.exit(1);
});
