import express from "express";
import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import { Readable } from "node:stream";
import { badRequest } from "./utils/errors.js";
import { requireAuth, requireWriteRole } from "./security/auth.js";

function parsePositiveInt(value, fallback, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function sanitizePathInput(value) {
  return String(value || "").trim();
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const value = rangeHeader.slice(6);
  const [rawStart, rawEnd] = value.split("-");
  const start = rawStart === "" ? null : Number.parseInt(rawStart, 10);
  const end = rawEnd === "" ? null : Number.parseInt(rawEnd, 10);
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) return null;

  let realStart = start;
  let realEnd = end;
  if (realStart === null) {
    const suffix = realEnd;
    if (suffix === null || suffix <= 0) return null;
    realStart = Math.max(0, size - suffix);
    realEnd = size - 1;
  } else if (realEnd === null || realEnd >= size) {
    realEnd = size - 1;
  }
  if (realStart > realEnd || realStart < 0) return null;
  return { start: realStart, end: realEnd };
}

export function createApiRouter(context) {
  const router = express.Router();
  const { config, fileService, loginProtector, sessionStore, passwordVerifier } = context;

  function resolveScopedPath(requestedPath) {
    const base = sanitizePathInput(config.listBaseDir);
    const requested = sanitizePathInput(requestedPath);
    if (!base) return requested;
    if (!requested) return base;
    if (requested === base || requested.startsWith(`${base}/`)) return requested;
    return `${base}/${requested}`;
  }

  router.get("/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  router.post("/auth/login", express.json({ limit: "8kb" }), async (req, res, next) => {
    try {
      const password = String(req.body?.password || "");
      const ip = req.clientIp || "unknown";
      const lockKey = `${ip}`;
      const locked = loginProtector.checkLocked(lockKey);
      if (locked.locked) {
        return res.status(429).json({
          error: { code: "AUTH_LOCKED", message: "Too many failed attempts.", retryAfterSeconds: locked.retryAfterSeconds }
        });
      }

      let role = null;
      if (config.authReadWriteHash && await passwordVerifier(password, config.authReadWriteHash)) {
        role = "read-write";
      } else if (config.authReadOnlyHash && await passwordVerifier(password, config.authReadOnlyHash)) {
        role = "read-only";
      }

      if (!role) {
        loginProtector.registerFailure(lockKey);
        return res.status(401).json({ error: { code: "AUTH_FAILED", message: "Invalid credentials." } });
      }

      loginProtector.clear(lockKey);
      const session = sessionStore.create({
        role,
        clientIp: req.clientIp || "",
        userAgent: String(req.get("user-agent") || "")
      });
      res.cookie("sid", session.id, {
        signed: true,
        httpOnly: true,
        secure: config.sessionCookieSecure,
        sameSite: "strict",
        maxAge: config.sessionTtlSeconds * 1000
      });
      return res.json({ role, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/logout", requireAuth, async (req, res) => {
    sessionStore.destroy(req.session.id);
    res.clearCookie("sid", {
      signed: true,
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: "strict"
    });
    res.json({ ok: true });
  });

  router.get("/auth/session", requireAuth, (req, res) => {
    res.json({
      role: req.session.role,
      csrfToken: req.session.csrfToken,
      expiresAt: new Date(req.session.expiresAt).toISOString()
    });
  });

  router.get("/list", requireAuth, async (req, res, next) => {
    try {
      const userPath = resolveScopedPath(req.query.path);
      const recursive = String(req.query.recursive || "false").toLowerCase() === "true";
      const page = parsePositiveInt(req.query.page, 1, Number.MAX_SAFE_INTEGER);
      const pageSize = parsePositiveInt(req.query.pageSize, config.listPageSizeDefault, config.listPageSizeMax);
      const result = await fileService.list(userPath, recursive, page, pageSize);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/download", requireAuth, async (req, res, next) => {
    try {
      const userPath = resolveScopedPath(req.query.path);
      const fileInfo = await fileService.statFile(userPath);
      const stream = await fileService.createReadStream(userPath);
      const type = mime.lookup(fileInfo.relativePath) || "application/octet-stream";
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Length", String(fileInfo.size));
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(fileInfo.relativePath)}"`);
      res.setHeader("Cache-Control", "no-store");
      stream.on("error", (err) => next(err));
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  });

  router.get("/stream", requireAuth, async (req, res, next) => {
    try {
      const userPath = resolveScopedPath(req.query.path);
      const fileInfo = await fileService.statFile(userPath);
      const range = parseRange(req.headers.range, fileInfo.size);
      const type = mime.lookup(fileInfo.relativePath) || "application/octet-stream";

      if (!range) {
        res.status(200);
        res.setHeader("Content-Type", type);
        res.setHeader("Content-Length", String(fileInfo.size));
        res.setHeader("Accept-Ranges", "bytes");
        const fullStream = fs.createReadStream(fileInfo.fullPath);
        fullStream.on("error", (err) => next(err));
        fullStream.pipe(res);
        return;
      }

      const length = range.end - range.start + 1;
      res.status(206);
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Length", String(length));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${fileInfo.size}`);
      const partialStream = fs.createReadStream(fileInfo.fullPath, { start: range.start, end: range.end });
      partialStream.on("error", (err) => next(err));
      partialStream.pipe(res);
    } catch (err) {
      next(err);
    }
  });

  router.post("/uploads", requireAuth, requireWriteRole, express.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      const targetPath = resolveScopedPath(req.body?.path);
      const totalSize = Number.parseInt(String(req.body?.totalSize || ""), 10);
      const checksumSha256 = String(req.body?.checksumSha256 || "").toLowerCase();
      if (!targetPath) throw badRequest("INVALID_PATH", "path is required.");
      const started = fileService.startUpload(targetPath, totalSize, checksumSha256);
      res.status(201).json(started);
    } catch (err) {
      next(err);
    }
  });

  router.get("/uploads/:id", requireAuth, requireWriteRole, async (req, res, next) => {
    try {
      const offset = await fileService.getUploadOffset(req.params.id);
      res.json({ uploadId: req.params.id, offset });
    } catch (err) {
      next(err);
    }
  });

  router.put("/uploads/:id/chunk", requireAuth, requireWriteRole, express.raw({ type: "application/octet-stream", limit: `${config.maxChunkSizeBytes}b` }), async (req, res, next) => {
    try {
      const offset = Number.parseInt(String(req.get("x-chunk-offset") || ""), 10);
      const chunkLength = Number.parseInt(String(req.get("content-length") || ""), 10);
      if (!Buffer.isBuffer(req.body)) throw badRequest("INVALID_CHUNK", "Raw chunk body required.");
      const stream = Readable.from(req.body);
      const result = await fileService.appendChunk(req.params.id, offset, stream, chunkLength);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/uploads/:id/commit", requireAuth, requireWriteRole, async (req, res, next) => {
    try {
      const result = await fileService.commitUpload(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/uploads/:id", requireAuth, requireWriteRole, async (req, res, next) => {
    try {
      await fileService.abortUpload(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/rename", requireAuth, requireWriteRole, express.json({ limit: "8kb" }), async (req, res, next) => {
    try {
      const from = resolveScopedPath(req.body?.from);
      const newName = String(req.body?.newName || "");
      if (!from) throw badRequest("INVALID_PATH", "from path is required.");
      const result = await fileService.rename(from, newName);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } });
  });

  return router;
}
