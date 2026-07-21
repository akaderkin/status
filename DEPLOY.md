# Deploy

## Cloudflare Pages — Admin (önerilen)

Sadece admin UI. API Cloudflare Pages’te çalışmaz.

1. Cloudflare → Workers & Pages → Create → Connect `akaderkin/status`
2. Ayarlar:
   - **Build command:** `npm ci && npm run build -w @status/admin`
   - **Build output directory:** `apps/admin/dist`
   - **Root:** `/`
3. Env (Build):
   - `VITE_API_URL` = `https://api.senin-domain.com` (API URL’in)
4. Deploy

Login sonrası admin API’ye CORS ile bağlanır → API’de:
```
CORS_ORIGIN=https://status-admin.pages.dev,https://admin.senin-domain.com
```

## API + Worker (zorunlu ayrı host)

IMAP worker + Prisma uzun süreç ister. Seçenekler:

- DigitalOcean App Platform → **Dockerfile** Web Service + Worker  
  (`apps/api/Dockerfile`, `apps/worker/Dockerfile`) — Functions/buildpack değil
- Fly.io / Railway / tek Droplet + docker compose

```bash
doctl apps create --spec .do/app.yaml
```

Buildpack (Heroku-style) kullanırsan `npm run build` artık `prisma generate` yapar.
