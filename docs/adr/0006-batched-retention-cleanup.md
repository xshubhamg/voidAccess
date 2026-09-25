# Run batched retention cleanup

The application runs a retention worker that deletes expired verification tokens, terminal sessions, terminal invitations, terminal email deliveries, and audit records in bounded batches. The default policy retains operational terminal data for 30 days and audit records for 365 days. Each target table has a `legal_hold_at` column, and cleanup excludes held records; an authorized operator can set or clear the hold without changing application code.

**Status:** Accepted
