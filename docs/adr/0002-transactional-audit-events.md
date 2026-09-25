# Commit audit events with mutations

Each mutating service operation writes its audit event inside the same PostgreSQL transaction as the domain mutation. This preserves the invariant that a successful mutation has an audit record and makes audit failure roll back the mutation. Organization deletion records the event before deleting the organization so the nullable organization reference preserves history.

**Status:** Accepted
