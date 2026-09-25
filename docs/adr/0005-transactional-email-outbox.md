# Deliver transactional email through a PostgreSQL outbox

Verification and invitation mutations enqueue email rows in the same PostgreSQL transaction. A background worker claims rows with `SKIP LOCKED` and lease identifiers, discards messages whose source token is no longer active, encrypts message bodies with AES-256-GCM, sends them through Resend with an idempotency key, retries transient failures with exponential backoff, and clears bodies after terminal delivery. This prevents a successful account or invitation mutation from depending on a synchronous email provider call and keeps raw tokens out of logs and plaintext database columns.

**Status:** Accepted
