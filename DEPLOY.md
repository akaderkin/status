# DigitalOcean App Platform

Bu repo **Functions değil**, **Dockerfile Web Service + Worker**.

## Yeni App oluştururken

1. Create App → GitHub → `akaderkin/status`
2. Auto-detect’i **yoksay** / Functions seçme
3. Manuel ekle:
   - **Web Service** → Dockerfile path: `apps/api/Dockerfile` → HTTP port `3000`
   - **Worker** → Dockerfile path: `apps/worker/Dockerfile`
4. Env secrets’ları ekle (DATABASE_URL, REDIS_URL, JWT_SECRET, …)
5. Valkey’i Trusted Sources’ta App’e aç

Hazır spec: [`.do/app.yaml`](.do/app.yaml)

```bash
doctl apps create --spec .do/app.yaml
```

## Cloudflare Admin

Admin’i DO’ya koyma. `apps/admin` → Cloudflare Pages (`dist`).
