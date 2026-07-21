# DigitalOcean App Platform

Önemli: Bu repo **Functions değil**. `packages/` klasörü DO Functions’ı tetikliyordu; artık `libs/`.

## Mevcut bozuk App’i düzelt

1. App’i **sil** (Functions olarak oluşturulmuş)
2. **Create App** → GitHub `akaderkin/status`
3. Resource olarak şunları ekle (Detect edilen Function’ları **Add etme / Remove**):
   - **Web Service**
     - Type: Dockerfile
     - Dockerfile path: `apps/api/Dockerfile`
     - HTTP port: `3000`
     - Health check: `/health`
   - **Worker**
     - Type: Dockerfile  
     - Dockerfile path: `apps/worker/Dockerfile`
4. Environment variables’ı ekle
5. Valkey → Trusted Sources → bu App

Veya spec ile:

```bash
doctl apps create --spec .do/app.yaml
```

## Cloudflare Admin

`apps/admin` → Cloudflare Pages. DO’ya koyma.
