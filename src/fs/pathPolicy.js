import fs from "node:fs/promises";
import path from "node:path";
import { badRequest, forbidden, notFound } from "../utils/errors.js";

const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
]);

function normalizeUserPath(userPath) {
  const raw = String(userPath || "").trim();
  if (!raw || raw === "/") return "";
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw badRequest("INVALID_PATH", "Path traversal is not allowed.");
    }
    if (/[:*?"<>|]/.test(part)) {
      throw badRequest("INVALID_PATH", "Path contains invalid characters.");
    }
    if (part.endsWith(".") || part.endsWith(" ")) {
      throw badRequest("INVALID_PATH", "Path segments cannot end with dot or space.");
    }
    if (WINDOWS_RESERVED_NAMES.has(part.toLowerCase())) {
      throw badRequest("INVALID_PATH", "Path contains a reserved filename.");
    }
  }
  return parts.join(path.sep);
}

export class PathPolicy {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  resolveInsideRoot(userPath) {
    const normalized = normalizeUserPath(userPath);
    const full = path.resolve(this.rootDir, normalized);
    const rel = path.relative(this.rootDir, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw forbidden("PATH_OUTSIDE_ROOT", "Target path escapes configured root.");
    }
    return { fullPath: full, relativePath: rel === "" ? "" : rel.replaceAll("\\", "/") };
  }

  async ensureRootValid() {
    let stat;
    try {
      stat = await fs.stat(this.rootDir);
    } catch {
      throw new Error(`ROOT_DIR does not exist: ${this.rootDir}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`ROOT_DIR is not a directory: ${this.rootDir}`);
    }
    await fs.access(this.rootDir);
  }

  async assertNoSymlinkEscape(fullPath) {
    let current = fullPath;
    while (true) {
      if (current === this.rootDir || current.length < this.rootDir.length) break;
      const st = await fs.lstat(current).catch(() => null);
      if (st && st.isSymbolicLink()) {
        const real = await fs.realpath(current);
        const rel = path.relative(this.rootDir, real);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw forbidden("SYMLINK_ESCAPE", "Symlink escaping root is not allowed.");
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  async assertRegularFileSafe(fullPath) {
    const st = await fs.lstat(fullPath).catch(() => null);
    if (!st) throw notFound("NOT_FOUND", "Path does not exist.");
    if (st.isSymbolicLink()) {
      throw forbidden("SYMLINK_BLOCKED", "Symlink targets are blocked.");
    }
    if (!st.isFile()) {
      throw badRequest("NOT_A_FILE", "Path is not a regular file.");
    }
    if (st.nlink > 1) {
      throw forbidden("HARDLINK_BLOCKED", "Hardlinked files are not allowed.");
    }
  }
}

