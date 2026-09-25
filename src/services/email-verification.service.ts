import { randomBytes } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { EMAIL_VERIFICATION_EXPIRATION } from "../config/index.ts";
import type { Database, DatabaseExecutor } from "../database/client.ts";
import { emailVerificationTokens, users } from "../database/schema/index.ts";
import { recordAudit, type AuditEvent } from "./audit.service.ts";
import { enqueueVerificationEmail } from "./email-delivery.service.ts";
import { AppError } from "../utils/AppError.ts";
import { hashToken, parseDurationMs } from "../utils/tokens.ts";

const VERIFICATION_TTL_MS = parseDurationMs(EMAIL_VERIFICATION_EXPIRATION);

function createVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueEmailVerificationToken(
  db: DatabaseExecutor,
  userId: string,
): Promise<string> {
  const token = createVerificationToken();
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  });

  return token;
}

export async function requestEmailVerification(
  db: Database,
  email: string,
  audit?: AuditEvent,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!user || user.emailVerified) return null;

    const token = await issueEmailVerificationToken(tx, user.id);
    await enqueueVerificationEmail(tx, { to: user.email, token, userId: user.id });
    if (audit) {
      await recordAudit(tx, audit);
    }
    return token;
  });
}

export async function verifyEmailToken(
  db: Database,
  token: string,
  audit?: AuditEvent,
): Promise<void> {
  const now = new Date();
  const tokenHash = hashToken(token);

  await db.transaction(async (tx) => {
    const [verification] = await tx
      .select({
        id: emailVerificationTokens.id,
        userId: emailVerificationTokens.userId,
        expiresAt: emailVerificationTokens.expiresAt,
        usedAt: emailVerificationTokens.usedAt,
      })
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!verification || verification.usedAt || verification.expiresAt <= now) {
      throw new AppError(
        "Verification token is invalid or expired",
        400,
        "INVALID_VERIFICATION_TOKEN",
      );
    }

    const [updated] = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.id, verification.id),
          isNull(emailVerificationTokens.usedAt),
        ),
      )
      .returning({ id: emailVerificationTokens.id });

    if (!updated) {
      throw new AppError(
        "Verification token is invalid or expired",
        400,
        "INVALID_VERIFICATION_TOKEN",
      );
    }

    await tx
      .update(users)
      .set({ emailVerified: true, updatedAt: now })
      .where(eq(users.id, verification.userId));

    if (audit) {
      await recordAudit(tx, audit);
    }
  });
}
