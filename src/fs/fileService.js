import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { badRequest, conflict, notFound, payloadTooLarge } from "../utils/errors.js";

function splitName(relPath) {
  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  return { dir: dir === "." ? "" : dir, base };
}

async function hashFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export class FileService {
  constructor(policy, config) {
    this.policy = policy;
    this.config = config;
    this.uploadStateDir = path.resolve(process.cwd(), "uploads-state");
    this.uploads = new Map();
    this.pathLocks = new Set();
    this.uploadTtlMs = Math.max(60_000, (config.uploadTtlSeconds || 3600) * 1000);
    this.uploadCleanupTimer = setInterval(() => {
      void this.cleanupExpiredUploads();
    }, 60_000);
    this.uploadCleanupTimer.unref();
  }

  async init() {
    await fsp.mkdir(this.uploadStateDir, { recursive: true });
  }

  acquireLock(relativePath) {
    if (this.pathLocks.has(relativePath)) {
      throw conflict("PATH_BUSY", "Target path currently has an active write operation.");
    }
    this.pathLocks.add(relativePath);
  }

  releaseLock(relativePath) {
    this.pathLocks.delete(relativePath);
  }

  async list(userPath, recursive, page, pageSize) {
    const { fullPath, relativePath } = this.policy.resolveInsideRoot(userPath);
    await this.policy.assertNoSymlinkEscape(fullPath);

    const rootStat = await fsp.stat(fullPath).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      throw notFound("DIRECTORY_NOT_FOUND", "Directory does not exist.");
    }

    const entries = [];
    const stack = [{ abs: fullPath, rel: relativePath }];

    while (stack.length > 0) {
      const current = stack.pop();
      const dirents = await fsp.readdir(current.abs, { withFileTypes: true });

      for (const dirent of dirents) {
        const abs = path.join(current.abs, dirent.name);
        const rel = current.rel ? `${current.rel}/${dirent.name}` : dirent.name;
        const st = await fsp.lstat(abs).catch(() => null);
        if (!st) continue;
        if (st.isSymbolicLink()) continue;

        entries.push({
          path: rel,
          name: dirent.name,
          type: st.isDirectory() ? "directory" : "file",
          size: st.isDirectory() ? null : st.size,
          mtimeMs: st.mtimeMs
        });

        if (recursive && st.isDirectory()) stack.push({ abs, rel });
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    const total = entries.length;
    const start = (page - 1) * pageSize;
    const items = entries.slice(start, start + pageSize);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  async createReadStream(userPath) {
    const { fullPath } = this.policy.resolveInsideRoot(userPath);
    await this.policy.assertNoSymlinkEscape(fullPath);
    await this.policy.assertRegularFileSafe(fullPath);
    return fs.createReadStream(fullPath);
  }

  async statFile(userPath) {
    const { fullPath, relativePath } = this.policy.resolveInsideRoot(userPath);
    await this.policy.assertNoSymlinkEscape(fullPath);
    await this.policy.assertRegularFileSafe(fullPath);
    const st = await fsp.stat(fullPath);
    return { fullPath, relativePath, size: st.size, mtimeMs: st.mtimeMs };
  }

  async remove(userPath) {
    const { fullPath } = this.policy.resolveInsideRoot(userPath);
    await this.policy.assertNoSymlinkEscape(fullPath);
    const st = await fsp.lstat(fullPath).catch(() => null);
    if (!st) throw notFound("NOT_FOUND", "Path does not exist.");
    if (st.isSymbolicLink()) throw badRequest("SYMLINK_BLOCKED", "Symlink deletion is blocked.");

    if (st.isDirectory()) {
      await fsp.rm(fullPath, { recursive: true, force: false });
    } else if (st.isFile()) {
      if (st.nlink > 1) throw badRequest("HARDLINK_BLOCKED", "Hardlinked files are blocked.");
      await fsp.unlink(fullPath);
    } else {
      throw badRequest("UNSUPPORTED_TYPE", "Unsupported filesystem object type.");
    }
  }

  async rename(userPath, newName) {
    const safeName = String(newName || "").trim();
    if (!safeName || safeName.includes("/") || safeName.includes("\\")) {
      throw badRequest("INVALID_NAME", "newName must be a single valid filename.");
    }

    const { fullPath, relativePath } = this.policy.resolveInsideRoot(userPath);
    await this.policy.assertNoSymlinkEscape(fullPath);

    const parts = splitName(relativePath);
    const targetRel = parts.dir ? `${parts.dir}/${safeName}` : safeName;
    const { fullPath: target } = this.policy.resolveInsideRoot(targetRel);

    const existing = await fsp.lstat(fullPath).catch(() => null);
    if (!existing) throw notFound("NOT_FOUND", "Path does not exist.");
    if (existing.isSymbolicLink()) throw badRequest("SYMLINK_BLOCKED", "Symlink rename is blocked.");

    const targetExists = await fsp.lstat(target).catch(() => null);
    if (targetExists) throw conflict("TARGET_EXISTS", "Target already exists.");

    await fsp.rename(fullPath, target);
    return { path: targetRel };
  }

  startUpload(userPath, totalSize, checksumHex) {
    if (!Number.isInteger(totalSize) || totalSize < 0) {
      throw badRequest("INVALID_SIZE", "totalSize must be a non-negative integer.");
    }
    if (totalSize > this.config.maxUploadSizeBytes) {
      throw payloadTooLarge("UPLOAD_TOO_LARGE", "Upload exceeds configured size limit.");
    }
    const normalizedChecksum = String(checksumHex || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/i.test(normalizedChecksum)) {
      throw badRequest("INVALID_CHECKSUM", "checksumSha256 must be a 64-char hex SHA-256 string.");
    }

    const { fullPath, relativePath } = this.policy.resolveInsideRoot(userPath);
    const uploadId = crypto.randomUUID();
    const tempPath = path.join(this.uploadStateDir, `${uploadId}.part`);
    this.acquireLock(relativePath);

    const meta = {
      uploadId,
      relativePath,
      destination: fullPath,
      tempPath,
      totalSize,
      checksumHex: normalizedChecksum,
      createdAt: Date.now()
    };
    this.uploads.set(uploadId, meta);
    return { uploadId, offset: 0 };
  }

  getUpload(uploadId) {
    const meta = this.uploads.get(uploadId);
    if (!meta) throw notFound("UPLOAD_NOT_FOUND", "Upload session does not exist.");
    return meta;
  }

  async getUploadOffset(uploadId) {
    const meta = this.getUpload(uploadId);
    const st = await fsp.stat(meta.tempPath).catch(() => null);
    return st ? st.size : 0;
  }

  async appendChunk(uploadId, offset, readableStream, chunkLength) {
    const meta = this.getUpload(uploadId);
    if (!Number.isInteger(offset) || offset < 0) {
      throw badRequest("INVALID_OFFSET", "Chunk offset must be a non-negative integer.");
    }
    if (!Number.isInteger(chunkLength) || chunkLength <= 0) {
      throw badRequest("INVALID_CHUNK", "Chunk must provide a valid Content-Length.");
    }
    if (chunkLength > this.config.maxChunkSizeBytes) {
      throw payloadTooLarge("CHUNK_TOO_LARGE", "Chunk exceeds configured maximum size.");
    }

    const currentOffset = await this.getUploadOffset(uploadId);
    if (offset !== currentOffset) throw conflict("OFFSET_MISMATCH", "Chunk offset does not match current upload offset.");

    const newTotal = currentOffset + chunkLength;
    if (newTotal > meta.totalSize) {
      throw payloadTooLarge("UPLOAD_TOO_LARGE", "Chunk would exceed declared upload size.");
    }

    await fsp.mkdir(path.dirname(meta.destination), { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(meta.tempPath, { flags: "a" });
      let received = 0;
      readableStream.on("data", (chunk) => { received += chunk.length; });
      readableStream.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => {
        if (received !== chunkLength) return reject(badRequest("CHUNK_LENGTH_MISMATCH", "Received chunk length mismatch."));
        resolve();
      });
      readableStream.pipe(ws);
    });

    return { offset: newTotal, done: newTotal === meta.totalSize };
  }

  async commitUpload(uploadId) {
    const meta = this.getUpload(uploadId);
    await this.policy.assertNoSymlinkEscape(path.dirname(meta.destination));

    const st = await fsp.stat(meta.tempPath).catch(() => null);
    if (!st || st.size !== meta.totalSize) throw conflict("UPLOAD_INCOMPLETE", "Upload is incomplete; cannot commit.");

    const computed = await hashFileSha256(meta.tempPath);
    if (computed !== meta.checksumHex) throw badRequest("CHECKSUM_MISMATCH", "Upload checksum validation failed.");

    const existing = await fsp.lstat(meta.destination).catch(() => null);
    if (existing && existing.isSymbolicLink()) throw badRequest("SYMLINK_BLOCKED", "Cannot overwrite a symlink path.");
    if (existing && existing.isFile() && existing.nlink > 1) {
      throw badRequest("HARDLINK_BLOCKED", "Cannot overwrite a hardlinked file.");
    }

    await fsp.rename(meta.tempPath, meta.destination);
    this.uploads.delete(uploadId);
    this.releaseLock(meta.relativePath);
    return { path: meta.relativePath, size: meta.totalSize };
  }

  async cleanupExpiredUploads() {
    const now = Date.now();
    const expired = [];
    for (const [id, meta] of this.uploads) {
      if (now - meta.createdAt > this.uploadTtlMs) expired.push(id);
    }
    for (const id of expired) await this.abortUpload(id);
  }

  async abortUpload(uploadId) {
    const meta = this.uploads.get(uploadId);
    if (!meta) return;
    this.uploads.delete(uploadId);
    this.releaseLock(meta.relativePath);
    await fsp.rm(meta.tempPath, { force: true }).catch(() => {});
  }

  async shutdown() {
    clearInterval(this.uploadCleanupTimer);
    const ids = Array.from(this.uploads.keys());
    for (const id of ids) await this.abortUpload(id);
  }
}
