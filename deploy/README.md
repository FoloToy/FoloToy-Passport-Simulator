# apsimulator.folotoy.cn production deployment

Deployed 2026-09-25 to `root@39.107.90.51` (Debian 12).
Application source revision: `91b0914`. Previous release: `68153f1`.

## Architecture

- Existing Nginx 1.22.1 terminates HTTPS and proxies HTTP/WebSocket to
  `127.0.0.1:4190`. Existing sites remain unchanged.
- Official Node.js v22.23.3 Linux x64 runs under systemd as the dedicated
  `apsimulator` system user. Docker Hub was unreachable, so this deployment
  uses systemd rather than containers.
- Node archive SHA-256:
  `df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`.
- `/opt/apsimulator/releases/91b0914` contains the verified release;
  `/opt/apsimulator/current` selects the active release.
- Runtime: `/opt/apsimulator/runtime/node-v22.23.3-linux-x64/bin/node`.
- Service: `/etc/systemd/system/apsimulator.service`.
- Nginx: `/etc/nginx/sites-available/apsimulator.conf`, linked from
  `sites-enabled`; shared proxy settings in
  `/etc/nginx/snippets/apsimulator-proxy.conf`.

The service has read-only filesystem protection, no Linux capabilities,
automatic restart, a 768 MiB memory limit, and a two-CPU quota. Local firmware
upload and private network destinations are disabled. Nginx limits community
import request rates and WebSocket connections per IP. The application has an
existing global limit of 16 simultaneous network bridge sessions.

## TLS and logs

Let's Encrypt certificate files are in
`/etc/letsencrypt/live/apsimulator.folotoy.cn/`. The initial certificate expires
2026-12-24. `certbot.timer` handles renewal; the executable deploy hook
`/etc/letsencrypt/renewal-hooks/deploy/apsimulator-nginx` checks and reloads Nginx
after renewal. Registration has no contact email. HTTP redirects to HTTPS,
except the ACME webroot `/var/www/apsimulator-acme`.

Nginx access/error logs use `/var/log/nginx/apsimulator.*.log` and the existing
daily log rotation policy with 14 retained rotations. Application logs use
the system journal.

```sh
ssh root@39.107.90.51
systemctl status apsimulator
journalctl -u apsimulator -n 100 --no-pager
systemctl restart apsimulator
curl -fsS https://apsimulator.folotoy.cn/healthz
systemctl list-timers certbot.timer
certbot renew --cert-name apsimulator.folotoy.cn --dry-run --no-random-sleep-on-renew
/etc/letsencrypt/renewal-hooks/deploy/apsimulator-nginx
```

## Update and rollback

1. Run `npm test && npm run build && npm run verify:release` locally.
2. Transfer `dist/` into a new versioned directory under
   `/opt/apsimulator/releases/`, owned by root and readable by the service.
3. Run `sha256sum -c SHA256SUMS` inside that directory on the server.
4. Record `readlink /opt/apsimulator/current`. Create a temporary symlink to
   the new release, then atomically replace `current` using `mv -Tf`.
5. Restart `apsimulator`, then verify `/healthz`, the homepage, and WebSocket
   operation. On failure, atomically restore the recorded previous symlink
   and restart the service. Keep previous releases until verification passes.

Before changing Nginx, preserve its site configuration, run `nginx -t`, and
only reload after the test succeeds. `apsimulator-http.conf` is for initial
certificate bootstrap; `apsimulator.conf` is the final HTTPS configuration.

## Initial verification

- All 51 tests passed; build and all 38 release checksums passed.
- Public HTTPS homepage and health endpoint returned 200; HTTP returned 301.
- WASM served as `application/wasm`, with COOP/COEP isolation headers.
- Secure WebSocket handshake returned 101 Switching Protocols.
- Browser confirmed “FoloToy 官方 Demo 已运行”.

## Latest release verification (91b0914)

- All 72 tests passed; all 41 release checksums passed on the server.
- HTTPS health check passed and the public app.js SHA-256 matched the release.
- Previous release 68153f1 remains available; its target is recorded in
  `/opt/apsimulator/previous-release`.
- Umami integration is included but analytics remains disabled until explicitly
  configured with the enable flag and a website ID.
