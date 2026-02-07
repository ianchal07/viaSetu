# LAN File Share (Security-Hardened)

Production-oriented Node.js + Express web application that exposes a single host filesystem root to authenticated LAN clients through a browser-only interface.

## Security properties

- LAN-only bind and runtime enforcement (private IPv4 clients only)
- Startup refusal for public or loopback host bind values
- No discovery protocols (no UPnP/NAT traversal/broadcast)
- Session authentication (HTTP-only cookie), role-based authorization
- bcrypt password verification support (read-only and read-write hashes)
- CSRF token enforcement for mutating requests
- In-memory IP/session rate limiting and brute-force lockout
- Strict path sandbox rooted at `ROOT_DIR`
- Path traversal rejection and symlink escape blocking
- Hardlinked file blocking (`nlink > 1`)
- MIME sniffing disabled, strict CSP, no inline scripts
- Structured JSON logging and centralized error mapping

## Project structure

- `src/server.js`: app bootstrap, middleware, security headers, shutdown
- `src/routes.js`: REST API routes
- `src/fs/pathPolicy.js`: path normalization, root confinement checks
- `src/fs/fileService.js`: listing, stream/download, upload/commit, rename/delete
- `src/security/*`: auth/session/csrf/rate-limit/network guards
- `public/*`: browser UI (HTML/CSS/JS)

## Prerequisites

- Node.js 20+

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and configure:

- `HOST`: private LAN interface IP on host, e.g. `192.168.1.10`
- `PORT`: service port, e.g. `8080`
- `ROOT_DIR`: absolute directory to expose
- `SESSION_SECRET`: long random secret (>=24 chars)
- `AUTH_READWRITE_HASH` and/or `AUTH_READONLY_HASH`: bcrypt hashes

3. Generate bcrypt hash example:

```bash
node -e "import('bcrypt').then(async b=>{console.log(await b.default.hash('your-password',12));process.exit(0);})"
```

4. Start service:

```bash
npm start
```

## LAN access

- Open from another LAN device in browser: `http://<HOST>:<PORT>`
- Service rejects non-private client IPs at runtime.

## API overview

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/list?path=&recursive=&page=&pageSize=`
- `GET /api/download?path=`
- `GET /api/stream?path=`
- `POST /api/uploads` (start upload)
- `GET /api/uploads/:id` (offset)
- `PUT /api/uploads/:id/chunk` (raw chunk)
- `POST /api/uploads/:id/commit`
- `DELETE /api/uploads/:id`
- `POST /api/rename`
- `DELETE /api/delete`

## Notes

- Upload commit validates both declared size and SHA-256 checksum.
- Uploads use temporary `.part` files under `uploads-state/` and atomic rename on commit.
- Concurrent writes to same path are blocked via path locks.
- Listing reflects live filesystem state (no cache).

