import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { AppError } from "./errors";
import { query } from "./db";
import type { UserRole } from "@map/shared/contracts";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: "pending_verification" | "active" | "suspended" | "deletion_pending" | "deleted";
  emailVerified: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

type AccessTokenPayload = {
  sub: string;
  role: UserRole;
};

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function signAccessToken(user: AuthUser): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL as NonNullable<jwt.SignOptions["expiresIn"]>
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw new AppError(401, "AUTH_REQUIRED", "Invalid or expired access token");
  }
}

export async function loadUser(userId: string): Promise<AuthUser | null> {
  const result = await query<{
    id: string;
    email: string;
    display_name: string;
    role: UserRole;
    status: AuthUser["status"];
    email_verified_at: Date | null;
    deleted_at: Date | null;
  }>(
    `SELECT id, email, display_name, role, status, email_verified_at, deleted_at
     FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row || row.deleted_at || row.status === "deleted") return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at)
  };
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  const token = extractBearer(request);
  if (!token) throw new AppError(401, "AUTH_REQUIRED", "Authentication required");
  const payload = verifyAccessToken(token);
  const user = await loadUser(payload.sub);
  if (!user) throw new AppError(401, "AUTH_REQUIRED", "Account is unavailable");
  if (user.status === "suspended") throw new AppError(403, "FORBIDDEN", "Account is suspended");
  request.user = user;
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await authenticate(request);
}

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  if (extractBearer(request)) await authenticate(request);
}

export async function requireVerifiedContributor(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (!request.user?.emailVerified) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Email verification is required");
  }
}

export async function requireModerator(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (request.user?.role !== "moderator" && request.user?.role !== "admin") {
    throw new AppError(403, "FORBIDDEN", "Moderator permission required");
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (request.user?.role !== "admin") {
    throw new AppError(403, "FORBIDDEN", "Administrator permission required");
  }
}
