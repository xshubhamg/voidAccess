# Domain vocabulary

- **User**: An authenticated identity with a password and verification state.
- **Organization**: A tenant that owns roles, memberships, invitations, and organization-scoped audit history.
- **Membership**: The relationship that grants a user access to one organization. Membership is the source of tenant authorization.
- **Owner**: The user identified by an organization's authoritative `owner_id`; ownership is transferred explicitly, not inferred from a generic role assignment.
- **System role**: A shared immutable role such as Owner, Admin, Member, or Viewer.
- **Custom role**: An organization-scoped role with an explicit permission set.
- **Permission**: A named authorization capability such as `member.read` or `audit.read`.
- **Invitation**: A single-use, expiring credential allowing an existing verified user to join an organization with a selected role.
- **Session**: A revocable authentication session identified by a session ID. Refresh tokens rotate within that session.
- **Audit event**: A record of a mutating action, its server-derived actor, organization scope, resource, and request metadata.
- **Tenant context**: The organization and membership resolved from authenticated server-side request state, never from a client-supplied ownership or actor value.
