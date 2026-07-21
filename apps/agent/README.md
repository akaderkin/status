# Status Probe Agent

Remote multi-location checker for Olfe / İncinet ISS status backend (v1.2.0).

Supports **HTTP** (method/headers/body/keyword/SSL expiry), **TCP**, and **ICMP** ping.

## Quick remote install (Linux)

On the VPS (Istanbul / Denizli / EU):

```bash
export API_URL="https://your-status-api.example.com"
export NODE_TOKEN="sn_...."   # from Admin → Probe Nodes

curl -fsSL "$API_URL/v1/agent/install.sh" | sudo bash -s -- \
  --api-url "$API_URL" \
  --token "$NODE_TOKEN"
```

This downloads the matching binary, writes `/etc/status-agent/agent.env`, and enables systemd `status-agent`.

## Manual / Docker

```bash
go build -o status-agent .
STATUS_API_URL=https://api.example.com NODE_TOKEN=sn_xxx ./status-agent
```

```bash
docker build -t status-agent .
docker run -d --name status-agent --restart=always \
  -e STATUS_API_URL=https://api.example.com \
  -e NODE_TOKEN=sn_xxx \
  status-agent
```

## Cross-compile releases

From repo root:

```bash
./apps/agent/build-release.sh
```

Outputs to `apps/api/public/agent/`.
