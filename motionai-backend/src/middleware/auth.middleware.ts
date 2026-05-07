import type { NextFunction, Request, Response } from "express";
import { getSupabaseAuthClient } from "../services/supabase.service.js";
import { logger } from "../utils/logger.js";
import type { AuthUser } from "../types/index.js";

function extractBearerToken(req: Request): string | null {
  const header = req.header("authorization");

  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new Error("Authorization header must use Bearer token format");
  }

  return token;
}

export async function optionalSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      req.authUser = null;
      next();
      return;
    }

    const authClient = getSupabaseAuthClient();
    const { data, error } = await authClient.auth.getUser(token);

    if (error || !data.user) {
      logger.warn({
        msg: "Supabase auth token validation failed",
        error: error?.message ?? "Unknown auth error",
        requestId: res.locals["requestId"] as string,
      });
      res.status(401).json({
        error: "Invalid or expired Supabase access token",
        requestId: res.locals["requestId"] as string,
      });
      return;
    }

    req.authUser = {
      id: data.user.id,
      email: data.user.email ?? null,
      isAnonymous: data.user.is_anonymous ?? false,
    } satisfies AuthUser;

    next();
  } catch (err) {
    if (err instanceof Error) {
      res.status(401).json({
        error: err.message,
        requestId: res.locals["requestId"] as string,
      });
      return;
    }

    next(err);
  }
}
