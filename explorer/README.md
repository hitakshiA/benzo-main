# benzo-explorer

The branded **BenzoNet block explorer**, a Blockscout deployment for
**`explorer.benzo.space`**, with the Caddy edge that also fronts
`rpc.benzo.space` and `stats.benzo.space`.

BenzoNet is a `validatorOnly` sovereign L1 (chain `68420`, gas token **BGAS**),
so no public explorer can index it, we self-host one. This repo is the
deployment config, not application code (Blockscout is upstream). Backend +
contracts live in [`Miny-Labs/benzo`](https://github.com/Miny-Labs/benzo).

**Live:** https://explorer.benzo.space · RPC https://rpc.benzo.space

## Architecture

```
internet ─▶ Caddy :443 (host-net, auto-TLS)
             ├─ explorer.benzo.space ─▶ 127.0.0.1:8090  (Blockscout nginx → frontend + /api)
             ├─ stats.benzo.space    ─▶ 127.0.0.1:8091  (Blockscout stats)
             └─ rpc.benzo.space      ─▶ 127.0.0.1:9650  (native node, POST → /ext/bc/<id>/rpc)

Blockscout backend ─▶ host.docker.internal:19650 ─(socat)─▶ 127.0.0.1:9650  (native avalanchego)
```

The node runs **natively** on the VM (systemd `avalanchego.service`) on
`127.0.0.1:9650`; a `socat` bridge exposes it to containers, and the node's
`http-allowed-hosts` is `*` (safe, it's internal-only behind the firewall).

## Deploy runbook (on the VM)

1. **Node bridge**, `socat` service so containers reach the native node:
   ```
   sudo tee /etc/systemd/system/benzonet-rpc-bridge.service <<'EOF'
   [Unit]
   After=network.target docker.service
   [Service]
   ExecStart=/usr/bin/socat TCP-LISTEN:19650,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9650
   Restart=always
   [Install]
   WantedBy=multi-user.target
   EOF
   sudo systemctl enable --now benzonet-rpc-bridge
   ```
2. **Node accepts proxied Host**, add `"http-allowed-hosts": "*"` to
   `~/.avalanchego/configs/node.json`, `sudo systemctl restart avalanchego`.
3. **Blockscout**, `git clone https://github.com/blockscout/blockscout`, copy
   `docker-compose.override.yml` from this repo into `blockscout/docker-compose/`,
   set `BENZONET_BLOCKCHAIN_ID` in a `.env` there, then `docker compose up -d`.
4. **Caddy**, copy `caddy/` here, substitute `BENZONET_BLOCKCHAIN_ID`, then:
   ```
   docker run -d --name benzo-caddy --network host --restart unless-stopped \
     -v $PWD/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
     -v $PWD/caddy/brand:/srv/brand:ro -v benzo-caddy-data:/data caddy:2
   ```
5. **DNS**, A-records `explorer` / `rpc` / `stats.benzo.space` → the VM IP; open
   firewall 80/443; keep the node ports private.

## Gotchas (learned)
- The `latest` backend requires DB TLS → the `db` service self-signs + `ssl=on`.
- The node is pruned → `ETHEREUM_JSONRPC_DISABLE_ARCHIVE_BALANCES=true`.
- NFT-media / user-ops indexers crash without writable dets → disabled.
- Blockscout's nginx needs the `visualizer`/`stats` upstreams up, or it won't
  start, run the full `docker compose up -d`.

## Brand
Benzo mark (`caddy/brand/`), violet `#7342E2`, dark "vault" `#161E2D`, BGAS
currency. Tokens per [`Miny-Labs/benzo`](https://github.com/Miny-Labs/benzo) brand kit.
