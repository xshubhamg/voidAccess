import type { AuthUser } from "../services/auth.service.ts";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
