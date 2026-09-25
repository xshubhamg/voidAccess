# voidAccess

Team Access Control API built with Express, TypeScript, Drizzle ORM, PostgreSQL, Redis, Zod, and Pino.

## Requirements

- Bun
- Docker with Compose

## Local setup

```sh
docker compose up -d
cp .env.example .env
bun install
bun run db:migrate
bun run db:seed
bun run server
```

The Compose services expose PostgreSQL on `5433` and Redis on `6380`. Set `DATABASE_URL` and `REDIS_URL` to match those ports.

The application validates environment configuration on startup. Required settings include `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRATION`, and `JWT_REFRESH_EXPIRATION`. Email verification and invitation expiry default to `24h` and `7d`; override them with `EMAIL_VERIFICATION_EXPIRATION` and `INVITE_EXPIRATION`.

## API surface

- `/health` liveness and `/health/ready` PostgreSQL + Redis readiness
- `/auth` registration, login, refresh rotation, logout, logout-all, and email verification
- `/organizations` organization list, create, update, delete, and ownership transfer
- `/organizations/:orgId/roles` tenant-scoped role CRUD
- `/organizations/:orgId/members` member list, role updates, and removal
- `/organizations/:orgId/invites` invitation list, create, and revoke
- `/invites/accept` authenticated invitation acceptance
- `/organizations/:orgId/audit-logs` permission-gated audit history

Access tokens are session-bound and are rejected after logout or session expiry. Refresh tokens rotate once; reuse revokes the user’s active sessions. Invitations target existing email-verified users and are single-use, expiring, and tenant-scoped.

Authentication uses `Authorization: Bearer <access-token>`. Access and refresh JWTs use separate signing keys and explicit token types. All request bodies, query parameters, and route parameters are validated with Zod. Expected errors use the standard envelope:

```json
{
  "success": false,
  "message": "...",
  "error": { "code": "..." }
}
```

## Verification

```sh
bun test
bun run lint
bun run format:check
bunx tsc --noEmit
```

`TRUST_PROXY_HOPS` controls how many reverse-proxy hops Express trusts for `req.ip`; leave it at `0` unless the API is behind a trusted proxy.

## Production hardening

- Run behind TLS and a trusted reverse proxy; configure `TRUST_PROXY_HOPS` and proxy-level request/header/keep-alive timeouts for the real chain. Bun does not reliably enforce Node server timeout properties.
- Generate independent JWT secrets of at least 32 characters and store them in a secrets manager.
- Use private PostgreSQL and Redis network access. The Compose file binds both services to loopback for local development only.
- Run `drizzle-kit migrate` as a release step before starting new application instances.
- The built-in rate limiter uses Redis so limits are shared across API replicas. Treat Redis availability as part of the request-path availability budget.
- Configure `RESEND_API_KEY`, a verified `EMAIL_FROM`, and an HTTPS `APP_URL` in production. The application uses a PostgreSQL email outbox and background worker with retries and Resend idempotency keys.
- Retention cleanup runs every hour by default, deleting terminal sessions, verification tokens, invitations, and email deliveries after 30 days and audit logs after 365 days. Configure the windows with `RETENTION_TERMINAL_DAYS`, `RETENTION_AUDIT_DAYS`, and `RETENTION_CLEANUP_INTERVAL`; apply legal holds before deletion.
- Monitor `/health/ready`; it checks PostgreSQL and Redis, returns `503` when either is unavailable, and should be wired to load-balancer health checks. Monitor PostgreSQL saturation, Redis failures, authentication failures, and audit-write failures.

The system architecture, trust boundaries, invariants, Mermaid diagrams, and decision register are documented in [docs/architecture.md](docs/architecture.md). Domain vocabulary is in [CONTEXT.md](CONTEXT.md), and durable decisions are recorded in [docs/adr](docs/adr/).
