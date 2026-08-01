# Infrastructure

This directory has two intentionally separate deployment profiles.

- [`compose/`](compose/) is the loopback-only development stack for MySQL,
  application Redis, isolated LiveKit Redis, MinIO, and LiveKit.
- [`production/`](production/) is the reviewed TX4H4G release, backup,
  rollback, Caddy, and CampusHub coexistence package.

The production package is the only authoritative public-routing design. It
reuses `sun227454.online` for LiveKit's standard `/rtc/v1` signaling path and
for path-style MinIO URLs under `/openbmb-assets/*`; no `rtc.*` or `assets.*`
DNS records are required.

## Local development

Copy `compose/.env.example` to the ignored `compose/.env`, replace every empty
secret independently, and run:

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.yml up -d
```

On Windows, the non-destructive health and isolation checks are available as:

```powershell
.\infra\scripts\verify-local-stack.ps1
```

Do not run `docker compose down -v`; `-v` deletes the named data volumes.

## Production

Start with [`production/README.md`](production/README.md). The production
workflow keeps CampusHub as the fallback site and does not reuse or mutate its
database, backend, or volumes. Secrets live only in `/etc/openbmb` on the
server and must never be committed.
