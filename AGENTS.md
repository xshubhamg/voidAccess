# voidAccess Project Instructions

## Project overview

- voidAccess is a Team Access Control API.
- The implementation roadmap is maintained in `TODO.md`.
- The project is currently in its foundational setup phase; database, authentication, organizations, RBAC, and audit features are not implemented yet unless present in the codebase.

## Technology

- TypeScript with strict mode enabled.
- Express 5 for the HTTP server.
- Zod for request and configuration validation.
- Pino and `pino-http` for application and request logging.
- Use Bun for package scripts and dependency management.
- Use ESM imports with explicit `.ts` extensions.

## Repository structure

- `src/index.ts` - application entrypoint: verifies database connectivity, starts listening, wires graceful shutdown.
- `src/app.ts` - Express app factory (`buildApp()`): middleware and route registration.
- `src/routes/` - route definitions mounted in `app.ts`.
- `src/services/` - domain services (e.g. auth); receive the `Database` instance as a parameter.
- `src/middleware/` - Express middleware, including logging, errors, request validation, and authentication.
- `src/utils/` - shared utilities such as `AppError` and logging.
- `src/database/client.ts` - pg pool + Drizzle client with `connectDatabase()` / `closeDatabase()` lifecycle helpers.
- `src/validations/` - reusable Zod schemas.
- `tests/` - automated tests.
- `TODO.md` - feature roadmap and learning checklist.

## Application conventions

- Use `AppError` for expected application errors.
- Pass middleware errors to Express with `next(error)` so the global error handler can process them.
- Preserve the standard error response format:

  ```json
  {
    "success": false,
    "message": "...",
    "error": { "code": "..." }
  }
  ```

- Validate route `body`, `query`, and `params` with the route-scoped `validateRequest()` middleware.
- Keep reusable field schemas in `src/validations/common.schemas.ts`; keep domain-specific request schemas in separate validation files.
- Do not trust client-provided ownership, actor, audit, or security-sensitive fields; derive them server-side.
- Never log passwords, tokens, cookies, authorization headers, or other secrets.

## Commands

- Start with watch mode: `bun run server`
- Start once: `bun run dev`
- Lint: `bun run lint`
- Format files: `bun run format`
- Check formatting: `bun run format:check`
- Type-check: `bunx tsc --noEmit`

## Development workflow

- Read only the files relevant to the requested task and verify assumptions against the current code.
- Preserve unrelated user changes in the working tree.
- Do not modify `.env` or commit secrets.
- Add or update tests when changing behavior.
- Run linting and type-checking after implementation; run relevant tests when available.
- If a repository-wide check fails because of an unrelated pre-existing issue, report it without changing unrelated files.
- Keep changes small and grouped by feature so they can be committed and reviewed independently.

## Current implementation guidance

- Configuration validation, database integration, authentication, tenant isolation, RBAC, sessions, invitations, and audit logging should follow the order described in `TODO.md`.
- Do not add future domain models or infrastructure prematurely unless the task specifically requires them.
- Prefer dependency injection for repositories and services once the database layer is introduced.
