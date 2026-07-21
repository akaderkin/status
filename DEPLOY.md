# DigitalOcean App Platform (Buildpack)

UI Dockerfile’a geçmiyorsa Buildpack kullan — repo buna hazır.

## Web Service ayarları

- **Build strategy:** Buildpack (olduğu gibi bırak)
- **Build command:**
  ```
  npm run build:backend
  ```
- **Run command:**
  ```
  npm run start
  ```
- **HTTP port:** `8080` (DO `PORT` verir; API artık `PORT` dinliyor)
- **Health check:** `/health`
- Source directory: boş / `/`

## Worker (ayrı resource)

- Tip: **Worker**
- Build command: `npm run build:backend`
- Run command: `npm run start:worker`

## Env (Redis yok)

```
DATABASE_URL=...neon...
JWT_SECRET=...
ENCRYPTION_KEY=...
ADMIN_EMAIL=admin@olfe.net
ADMIN_PASSWORD=...
CORS_ORIGIN=*
PUBLIC_API_URL=https://SENIN-APP.ondigitalocean.app
STATUS_API_URL=https://SENIN-APP.ondigitalocean.app
```

`NODE_TOKEN` ekleme. `API_PORT` gerekmez.

## Cloudflare Admin (opsiyonel)

Build: `npm ci && npm run build -w @status/admin`  
Output: `apps/admin/dist`  
Env: `VITE_API_URL=https://SENIN-APP.ondigitalocean.app`
