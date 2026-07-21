# Status Backend — Olfe & İncinet ISS

Tek merkezi multi-tenant status backend. Native probe agent’lar (HTTP/TCP/ICMP), IMAP (Türk Telekom bakım mailleri) ve public status API + premium admin paneli.

## Stack

- **API:** Node.js + TypeScript + Fastify + Prisma + PostgreSQL
- **Worker:** IMAP poll (timer)
- **Admin:** Vite + React (cyberpunk HUD)
- **Agent:** Go (tek binary, systemd / Docker, uzaktan install)

## Hızlı başlangıç

```bash
cp .env.example .env
# DATABASE_URL: Neon veya local Postgres
# PUBLIC_API_URL: dışarıdan erişilen API (agent install için)

npm install
npm run build -w @status/shared
npm run agent:build
npm run db:generate
npm run db:push
npm run db:seed

npm run dev:api
npm run dev:worker
npm run dev:admin
```

- API: http://localhost:3000
- Admin: http://localhost:5173
- Login: `ADMIN_EMAIL` / `ADMIN_PASSWORD`

## Kendi node’unu kur (uzaktan)

1. Admin → **Probe Nodes** → Create (`istanbul`, `denizli`, `eu-1`…)
2. Çıkan one-liner’ı VPS’te çalıştır:

```bash
curl -fsSL "$API_URL/v1/agent/install.sh" | sudo bash -s -- \
  --api-url "$API_URL" \
  --token "$NODE_TOKEN"
```

Script binary indirir, `/etc/status-agent/agent.env` yazar, systemd `status-agent` enable eder.

3. Admin → **Monitors** → HTTP / TCP / ICMP check + hangi node’larda çalışacağı
4. Dashboard’da monitor kartları ve node **online** görünmeli

Release binary üretimi:

```bash
npm run agent:build
# → apps/api/public/agent/status-agent-linux-amd64|arm64 ...
```

Endpoints:

- `GET /v1/agent/meta`
- `GET /v1/agent/install.sh`
- `GET /v1/agent/download/:os/:arch`
- `GET /v1/agent/systemd.service`

## Public API

| Endpoint | Açıklama |
|----------|----------|
| `GET /v1/:tenant/status` | Overall + components + aktif bakım/incident |
| `GET /v1/:tenant/incidents` | Incident listesi |
| `GET /v1/:tenant/uptime` | Agent check uptime özeti |

Seed tenant’lar: `olfe`, `incinet`.

## Native probes

- **HTTP:** method, headers, body, keyword, SSL expiry, expected status
- **TCP:** host:port dial
- **ICMP:** ping (exec `ping` fallback)

## IMAP / Türk Telekom

Admin → **IMAP / TT** → hesap + filtre. Worker mailleri `pending` maintenance yapar → **Maintenances**’tan onay.

## Admin paneli

- Dashboard (monitor grid, latency heartbeats, auto-refresh)
- Tenants / Services
- IMAP (test, edit)
- Probe Nodes (install one-liner, rotate, enable)
- Monitors (HTTP/TCP/ICMP, detail charts, results)
- Maintenances (manuel + TT onay)
- Incidents (status progression)

## Ortam değişkenleri

- `DATABASE_URL`
- `JWT_SECRET`, `ENCRYPTION_KEY`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- `PUBLIC_API_URL` (opsiyonel; install komutları için)
- `STATUS_API_URL`
- `IMAP_POLL_INTERVAL_MS`, `AGENT_STALE_MS`
- `CORS_ORIGIN`
