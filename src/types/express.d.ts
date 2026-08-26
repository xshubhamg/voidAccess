import type { TenantMembership, TenantOrganization } from "../middleware/resolveTenant.ts";
import type { AuthUser } from "../services/auth.service.ts";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      organization?: TenantOrganization;
      membership?: TenantMembership;
    }
  }
}
