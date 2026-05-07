import type { AuthUser } from "./index.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser | null;
    }
  }
}

export {};
