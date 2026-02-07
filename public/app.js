const state = {
  csrfToken: "",
  role: "",
  currentPath: "",
  page: 1,
  pageSize: 100,
  totalPages: 1,
  recursive: false
};

const loginPanel = document.getElementById("loginPanel");
const appPanel = document.getElementById("appPanel");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const fileRows = document.getElementById("fileRows");
const breadcrumbs = document.getElementById("breadcrumbs");
const sessionInfo = document.getElementById("sessionInfo");
const loadingState = document.getElementById("loadingState");
const topProgress = document.getElementById("topProgress");
const message = document.getElementById("message");
const pageMeta = document.getElementById("pageMeta");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const logoutBtn = document.getElementById("logoutBtn");
const fileInput = document.getElementById("fileInput");
const uploadList = document.getElementById("uploadList");
const toggleRecursiveBtn = document.getElementById("toggleRecursive");
let liveSyncTimer = null;
let refreshInFlight = false;
let activeUploads = 0;

function setMessage(text, isError = true) {
  message.textContent = text || "";
  message.style.color = isError ? "#b42318" : "#116329";
}

function setLoading(active, text = "") {
  loadingState.textContent = active ? text || "Loading..." : "";
  topProgress.classList.toggle("active", Boolean(active));
}

function bytes(v) {
  if (v === null || v === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(v);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function dateFmt(ms) {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

async function api(endpoint, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (state.csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("x-csrf-token", state.csrfToken);
  }

  const res = await fetch(`/api${endpoint}`, {
    credentials: "same-origin",
    ...options,
    headers
  });

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await res.json() : null;
  if (!res.ok) {
    const msg = body?.error?.message || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

function safePathJoin(base, name) {
  if (!base) return name;
  return `${base}/${name}`;
}

function getFileKind(item) {
  if (item.type === "directory") return "dir";
  const ext = (item.name.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["mp4", "mkv", "avi", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (["pdf"].includes(ext)) return "pdf";
  if (["txt", "md", "json", "xml", "yaml", "yml", "js", "ts", "jsx", "tsx", "html", "css"].includes(ext)) return "code";
  if (["doc", "docx", "odt"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  return "file";
}

function fileKindLabel(kind) {
  if (kind === "dir") return "DIR";
  if (kind === "image") return "IMG";
  if (kind === "archive") return "ZIP";
  if (kind === "video") return "VID";
  if (kind === "audio") return "AUD";
  if (kind === "pdf") return "PDF";
  if (kind === "code") return "TXT";
  if (kind === "doc") return "DOC";
  if (kind === "sheet") return "XLS";
  return "FILE";
}

function renderBreadcrumbs() {
  breadcrumbs.innerHTML = "";
  const rootBtn = document.createElement("button");
  rootBtn.textContent = "viaSetu";
  rootBtn.addEventListener("click", () => {
    state.currentPath = "";
    state.page = 1;
    void refresh();
  });
  breadcrumbs.appendChild(rootBtn);

  const parts = state.currentPath ? state.currentPath.split("/") : [];
  let acc = "";
  for (const part of parts) {
    const sep = document.createElement("span");
    sep.textContent = "/";
    breadcrumbs.appendChild(sep);
    acc = safePathJoin(acc, part);
    const btn = document.createElement("button");
    btn.textContent = part;
    const target = acc;
    btn.addEventListener("click", () => {
      state.currentPath = target;
      state.page = 1;
      void refresh();
    });
    breadcrumbs.appendChild(btn);
  }
}

function buildActionButton(label, onClick, disabled = false) {
  const btn = document.createElement("button");
  btn.className = "small secondary";
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function scheduleUploadDismiss(item, delayMs) {
  setTimeout(() => {
    item.classList.add("fade-out");
    setTimeout(() => item.remove(), 260);
  }, delayMs);
}

function renderRows(items) {
  fileRows.innerHTML = "";
  const canWrite = state.role === "read-write";
  for (const item of items) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    const nameBtn = document.createElement("button");
    nameBtn.className = "name-btn";
    const kind = getFileKind(item);
    const icon = document.createElement("span");
    icon.className = `item-icon item-icon-${kind}`;
    icon.textContent = fileKindLabel(kind);
    const nameText = document.createElement("span");
    nameText.textContent = item.name;
    nameBtn.append(icon, nameText);
    if (item.type === "directory") {
      nameBtn.addEventListener("click", () => {
        state.currentPath = item.path;
        state.page = 1;
        void refresh();
      });
    } else {
      nameBtn.addEventListener("click", () => {
        window.open(`/api/stream?path=${encodeURIComponent(item.path)}`, "_blank", "noopener");
      });
    }
    nameCell.appendChild(nameBtn);

    const typeCell = document.createElement("td");
    typeCell.textContent = item.type;
    const sizeCell = document.createElement("td");
    sizeCell.textContent = bytes(item.size);
    const timeCell = document.createElement("td");
    timeCell.textContent = dateFmt(item.mtimeMs);

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";
    if (item.type === "file") {
      actionsCell.appendChild(buildActionButton("Download", () => {
        window.location.href = `/api/download?path=${encodeURIComponent(item.path)}`;
      }));
      actionsCell.appendChild(buildActionButton("Stream", () => {
        window.open(`/api/stream?path=${encodeURIComponent(item.path)}`, "_blank", "noopener");
      }));
    }

    actionsCell.appendChild(buildActionButton("Rename", async () => {
      const newName = window.prompt("New file/folder name:", item.name);
      if (!newName) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === item.name) return;
      const oldName = item.name;
      const oldPath = item.path;
      const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
      const optimisticPath = parent ? `${parent}/${trimmed}` : trimmed;
      item.name = trimmed;
      item.path = optimisticPath;
      nameText.textContent = trimmed;
      setMessage(`Renaming ${oldName}...`, false);
      try {
        await api("/rename", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from: oldPath, newName: trimmed })
        });
        setMessage(`Renamed to ${trimmed}`, false);
        await refresh();
      } catch (err) {
        item.name = oldName;
        item.path = oldPath;
        nameText.textContent = oldName;
        setMessage(err.message, true);
      }
    }, !canWrite));

    tr.append(nameCell, typeCell, sizeCell, timeCell, actionsCell);
    fileRows.appendChild(tr);
  }
}

async function refresh(options = {}) {
  const silent = Boolean(options.silent);
  if (refreshInFlight) return;
  refreshInFlight = true;
  if (!silent) {
    setLoading(true, "Refreshing directory...");
    setMessage("");
  }
  try {
    const data = await api(`/list?path=${encodeURIComponent(state.currentPath)}&recursive=${state.recursive}&page=${state.page}&pageSize=${state.pageSize}`);
    renderRows(data.items || []);
    state.totalPages = data.totalPages || 1;
    pageMeta.textContent = `Page ${data.page}/${state.totalPages} (${data.total} items)`;
    prevPageBtn.disabled = state.page <= 1;
    nextPageBtn.disabled = state.page >= state.totalPages;
    renderBreadcrumbs();
  } catch (err) {
    if (err.status === 401) return showLogin();
    setMessage(err.message, true);
  } finally {
    if (!silent) setLoading(false);
    refreshInFlight = false;
  }
}

async function sha256(file) {
  const buf = await file.arrayBuffer();
  const digest = globalThis.crypto?.subtle?.digest
    ? await globalThis.crypto.subtle.digest("SHA-256", buf)
    : sha256Fallback(buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((n) => n.toString(16).padStart(2, "0")).join("");
}

// SHA-256 fallback for non-secure origins where WebCrypto subtle is unavailable.
function sha256Fallback(buffer) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  const data = new Uint8Array(buffer);
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  paddedView.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t += 1) {
      w[t] = paddedView.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out.buffer;
}

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

async function uploadFile(file) {
  const item = document.createElement("div");
  item.className = "upload-item";
  const meta = document.createElement("div");
  meta.className = "upload-meta";
  const label = document.createElement("span");
  label.textContent = `${file.name}: preparing...`;
  const percent = document.createElement("span");
  percent.className = "upload-percent";
  percent.textContent = "0%";
  meta.append(label, percent);
  const track = document.createElement("div");
  track.className = "upload-progress-track";
  const fill = document.createElement("div");
  fill.className = "upload-progress-fill";
  track.appendChild(fill);
  item.append(meta, track);
  uploadList.appendChild(item);
  activeUploads += 1;

  const target = state.currentPath ? `${state.currentPath}/${file.name}` : file.name;
  try {
    const checksumSha256 = await sha256(file);
    const started = await api("/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target, totalSize: file.size, checksumSha256 })
    });

    let offset = started.offset || 0;
    const chunkSize = 4 * 1024 * 1024;
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize);
      const blob = file.slice(offset, end);
      const arr = await blob.arrayBuffer();
      await api(`/uploads/${encodeURIComponent(started.uploadId)}/chunk`, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(arr.byteLength),
          "x-chunk-offset": String(offset)
        },
        body: arr
      });
      offset = end;
      const pct = Math.max(1, Math.round((offset / file.size) * 100));
      percent.textContent = `${pct}%`;
      fill.style.width = `${pct}%`;
      label.textContent = `${file.name}: uploading...`;
    }

    await api(`/uploads/${encodeURIComponent(started.uploadId)}/commit`, { method: "POST" });
    label.textContent = `${file.name}: complete`;
    percent.textContent = "100%";
    fill.style.width = "100%";
    item.classList.add("done");
    setMessage(`Uploaded ${file.name}`, false);
    scheduleUploadDismiss(item, 4500);
  } catch (err) {
    label.textContent = `${file.name}: failed (${err.message})`;
    percent.textContent = "error";
    item.classList.add("failed");
    setMessage(err.message, true);
    scheduleUploadDismiss(item, 10000);
  } finally {
    activeUploads = Math.max(0, activeUploads - 1);
  }
}

function startLiveSync() {
  if (liveSyncTimer) return;
  liveSyncTimer = setInterval(() => {
    if (appPanel.classList.contains("hidden")) return;
    if (document.hidden) return;
    if (activeUploads > 0) return;
    void refresh({ silent: true });
  }, 15000);
}

function stopLiveSync() {
  if (!liveSyncTimer) return;
  clearInterval(liveSyncTimer);
  liveSyncTimer = null;
}

function showLogin() {
  state.csrfToken = "";
  state.role = "";
  loginPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
  stopLiveSync();
}

function showApp() {
  loginPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
  startLiveSync();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  setMessage("");
  const password = document.getElementById("password").value;
  try {
    const result = await api("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    state.csrfToken = result.csrfToken;
    state.role = result.role;
    sessionInfo.textContent = `Role: ${result.role}`;
    showApp();
    await refresh();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  showLogin();
});

prevPageBtn.addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    void refresh();
  }
});

nextPageBtn.addEventListener("click", () => {
  if (state.page < state.totalPages) {
    state.page += 1;
    void refresh();
  }
});

toggleRecursiveBtn.addEventListener("click", () => {
  state.recursive = !state.recursive;
  toggleRecursiveBtn.textContent = `Recursive: ${state.recursive ? "On" : "Off"}`;
  state.page = 1;
  void refresh();
});

fileInput.addEventListener("change", async () => {
  if (state.role !== "read-write") {
    setMessage("Upload requires read-write role.", true);
    return;
  }
  const files = Array.from(fileInput.files || []);
  for (const file of files) await uploadFile(file);
  fileInput.value = "";
  await refresh();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" && !event.target.matches("input,textarea") && state.page > 1) {
    state.page -= 1;
    void refresh();
  }
  if (event.key === "ArrowRight" && !event.target.matches("input,textarea") && state.page < state.totalPages) {
    state.page += 1;
    void refresh();
  }
});

(async function bootstrap() {
  try {
    const session = await api("/auth/session");
    state.csrfToken = session.csrfToken;
    state.role = session.role;
    sessionInfo.textContent = `Role: ${session.role}`;
    showApp();
    await refresh();
  } catch {
    showLogin();
  }
})();