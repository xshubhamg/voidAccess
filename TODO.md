# voidAccess — Implementation Roadmap

Team Access Control API. Phases are ordered; each builds on the previous.
Marked ✅ items reflect the current codebase state.

## Phase 1 — Foundation ✅

- [x] Express 5 app with JSON/urlencoded body limits (`src/app.ts`)
- [x] Pino + pino-http request logging (`src/middleware/httpLogger.ts`, `src/utils/logger.ts`)
- [x] Global error handler with standard error envelope (`src/middleware/errorHandler.ts`)
- [x] `AppError` utility (`src/utils/appError.ts`)
- [x] Rate limiting via express-rate-limit
- [x] Zod env validation (`src/config/index.ts`, `src/validations/env.schemas.ts`)

## Phase 2 — Database ✅

- [x] Docker Compose for Postgres 16 (port 5433) and Redis 7 (port 6380)
- [x] Drizzle ORM node-postgres pool client (`src/database/client.ts`)
- [x] Full schema: users, organizations, roles, permissions, role_permissions,
      memberships, sessions, invites, audit_logs (`src/database/schema/index.ts`)
- [x] Migrations generated and applied (`drizzle/0000_init.sql`, `0001_role_fk_cascade.sql`)
- [x] Seed script: 12 permissions, 4 system roles (Owner/Admin/Member/Viewer),
      role-permission mappings (`src/database/seed.ts` → `bun run db:seed`)

## Phase 3 — Authentication ✅

- [x] Password hashing with argon2id (`@node-rs/argon2`)
- [x] Register endpoint, duplicate email → 409 (email verification flow deferred)
- [x] Login endpoint issuing JWT access + refresh tokens
- [x] Refresh token rotation persisted in `sessions` table (sha256 hash stored,
      unique `jti` per issuance, status lifecycle). Replaying a logged-out or
      expired session token revokes all of the user's sessions
      (`TOKEN_REUSE_DETECTED`); replaying a rotated-away token is rejected as invalid.
- [x] Logout / logout-all (revoke session rows)
- [x] Auth middleware (`src/middleware/authenticate.ts`): verifies access token,
      loads user, attaches `req.user`
- [x] Never log secrets; derive ip/user-agent actor metadata server-side

## Phase 4 — Organizations ✅

- [x] Create organization (creator becomes Owner, gets membership row in a transaction)
      (`src/services/organization.service.ts`, `src/routes/organization.routes.ts`)
- [x] Slug generation + uniqueness handling (server-side slugify with random-suffix
      retry on unique violation; `src/utils/slug.ts`)
- [x] Update/delete organization (Owner only) (`src/middleware/requireOrgOwner.ts`)
- [x] Tenant resolution middleware (org from route param + membership check,
      404 anti-enumeration for non-members) (`src/middleware/resolveTenant.ts`)

## Phase 5 — RBAC ✅

- [x] Permission guard middleware driven by `role_permissions` joins
      (`src/middleware/requirePermission.ts`); 403 `PERMISSION_DENIED` lists
      the missing permissions
- [x] Custom role CRUD within an organization (`src/services/role.service.ts`,
      `src/routes/role.routes.ts`, `src/validations/role.schemas.ts`): system
      roles immutable, reserved names rejected, deletion blocked while the
      role is assigned to members or referenced by pending invites
- [x] Role assignment on membership update (`src/services/membership.service.ts`):
      the owner's own membership is locked and only the owner can grant the
      system Owner role; member endpoints land in Phase 6
- [x] Cache resolved permissions in Redis (300s TTL, invalidated on role
      update/delete, cache failures fall back to the database —
      `src/services/permission.service.ts`, `src/database/redis.ts`, wired
      into the app lifecycle in `src/index.ts`)

## Phase 6 — Memberships & Invitations

- [x] Invite create/list/revoke (token hashed at rest, expiry enforced)
- [x] Accept invite → membership row creation in transaction
- [x] Member list/remove/update-role endpoints (`src/routes/member.routes.ts`)
      with tenant resolution, permission guards, and owner protection

## Phase 7 — Audit Logging

- [x] Audit service writing to `audit_logs` on all mutating actions in the mutation transaction
- [x] Read endpoint gated by `audit.read` permission
- [x] Derive ip/user-agent server-side; store metadata jsonb

## Learning Checklist

- [ ] Drizzle relational queries vs manual joins trade-offs
- [ ] Partial unique indexes (used for system vs org-scoped role names)
- [ ] JWT rotation + reuse detection strategy
- [ ] Postgres enum migration pitfalls (session_status, invite_status)

## Commands

| Command | Purpose |
| --- | --- |
| `bun run server` | Dev server with watch mode |
| `bun run dev` | Run once |
| `bun run db:migrate` | Apply migrations |
| `bun run db:seed` | Seed permissions/roles |
| `bun run db:studio` | Drizzle Studio UI |
| `bunx tsc --noEmit` | Type-check |
| `bun run lint` | oxlint |
