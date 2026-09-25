# Keep role deletion database-safe

Role deletion is blocked in the service when memberships or pending invitations reference the role, and the role row is locked before those checks. The membership and invitation foreign keys use `ON DELETE RESTRICT` as the final concurrency guard. Application checks provide useful errors; the database constraint prevents a check/delete race from silently cascading access away.

**Status:** Accepted
