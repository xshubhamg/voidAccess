# Version role permission cache entries

Redis remains an optional read-through cache, but role permission entries are keyed by the PostgreSQL `permission_version`. Permission changes increment that version in the same transaction as the role update, and cache invalidation uses non-blocking Redis `SCAN`. This prevents a failed delete or a concurrent stale write from making a revoked permission effective under the old cache key.

**Status:** Accepted
