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

- `/health` liveness and `/health/ready` database readiness
- `/auth` registration, login, refresh rotation, logout, logout-all, and email verification
- `/organizations` organization list, create, update, delete, and ownership transfer
- `/organizations/:orgId/roles` tenant-scoped role CRUD
- `/organizations/:orgId/members` member list, role updates, and removal
- `/organizations/:orgId/invites` invitation list, create, and revoke
- `/invites/accept` authenticated invitation acceptance
- `/organizations/:orgId/audit-logs` permission-gated audit history

Access tokens are session-bound and are rejected after logout or session expiry. Refresh tokens rotate once; reuse revokes the user’s active sessions. Invitations target existing email-verified users and are single-use, expiring, and tenant-scoped.

Authentication uses `Authorization: Bearer <access-token>`. All request bodies, query parameters, and route parameters are validated with Zod. Expected errors use the standard envelope:

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
