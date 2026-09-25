import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { and, asc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  APP_URL,
  EMAIL_OUTBOX_ENCRYPTION_KEY,
  EMAIL_VERIFICATION_EXPIRATION,
  INVITE_EXPIRATION,
  JWT_SECRET,
} from "../config/index.ts";
import type { Database, DatabaseExecutor } from "../database/client.ts";
import { emailDeliveries, emailVerificationTokens, invites } from "../database/schema/index.ts";
import { hashToken } from "../utils/tokens.ts";
import { logger } from "../utils/logger.ts";

const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;
const LOCK_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const VERIFICATION_EXPIRY_LABEL = durationLabel(EMAIL_VERIFICATION_EXPIRATION);
const INVITATION_EXPIRY_LABEL = durationLabel(INVITE_EXPIRATION);

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  sourceType?: "email_verification" | "invitation";
  sourceId?: string;
  sourceTokenHash?: string;
}

export type EmailProvider = (message: EmailMessage) => Promise<{ providerMessageId: string }>;

export interface EmailDeliverySummary {
  claimed: number;
  sent: number;
  failed: number;
  discarded: number;
}

export class PermanentEmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmailDeliveryError";
  }
}

type EmailDeliveryRow = typeof emailDeliveries.$inferSelect;

function outboxEncryptionKey(): Buffer {
  if (EMAIL_OUTBOX_ENCRYPTION_KEY) {
    const key = Buffer.from(EMAIL_OUTBOX_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      throw new Error("EMAIL_OUTBOX_ENCRYPTION_KEY must decode to 32 bytes");
    }
    return key;
  }

  return createHash("sha256").update(JWT_SECRET).digest();
}

const OUTBOX_KEY = outboxEncryptionKey();

function encryptBody(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", OUTBOX_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptBody(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new PermanentEmailDeliveryError("Email delivery body is invalid");
  }

  const decipher = createDecipheriv("aes-256-gcm", OUTBOX_KEY, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function enqueueEmail(db: DatabaseExecutor, message: EmailMessage): Promise<void> {
  await db.insert(emailDeliveries).values({
    toEmail: message.to,
    subject: message.subject,
    textBody: encryptBody(message.text),
    htmlBody: encryptBody(message.html),
    idempotencyKey: message.idempotencyKey,
    sourceType: message.sourceType ?? null,
    sourceId: message.sourceId ?? null,
    sourceTokenHash: message.sourceTokenHash ?? null,
  });
}

export async function enqueueVerificationEmail(
  db: DatabaseExecutor,
  input: { to: string; token: string; userId: string },
): Promise<void> {
  const verificationUrl = `${APP_URL}/verify-email?token=${encodeURIComponent(input.token)}`;
  await enqueueEmail(db, {
    to: input.to,
    subject: "Verify your voidAccess email",
    text: `Verify your voidAccess email by opening this link: ${verificationUrl}\n\nThis link expires in ${VERIFICATION_EXPIRY_LABEL}.`,
    html: `<p>Verify your voidAccess email by opening this link:</p><p><a href="${verificationUrl}">Verify email</a></p><p>This link expires in ${VERIFICATION_EXPIRY_LABEL}.</p>`,
    idempotencyKey: `email-verification/${hashToken(input.token)}`,
    sourceType: "email_verification",
    sourceId: input.userId,
    sourceTokenHash: hashToken(input.token),
  });
}

export async function enqueueInvitationEmail(
  db: DatabaseExecutor,
  input: { to: string; token: string; organizationName: string; inviteId: string },
): Promise<void> {
  const invitationUrl = `${APP_URL}/invites/accept?token=${encodeURIComponent(input.token)}`;
  await enqueueEmail(db, {
    to: input.to,
    subject: `Join ${input.organizationName} on voidAccess`,
    text: `You have been invited to join ${input.organizationName} on voidAccess.\n\nAccept the invitation: ${invitationUrl}\n\nThis invitation expires in ${INVITATION_EXPIRY_LABEL}.`,
    html: `<p>You have been invited to join <strong>${escapeHtml(input.organizationName)}</strong> on voidAccess.</p><p><a href="${invitationUrl}">Accept invitation</a></p><p>This invitation expires in ${INVITATION_EXPIRY_LABEL}.</p>`,
    idempotencyKey: `invitation/${input.inviteId}`,
    sourceType: "invitation",
    sourceId: input.inviteId,
    sourceTokenHash: hashToken(input.token),
  });
}

function durationLabel(value: string): string {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return value;
  const unit = match[2];
  const label =
    unit === "m" ? "minutes" : unit === "h" ? "hours" : unit === "d" ? "days" : "seconds";
  return `${match[1]} ${label}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function retryDelayMs(attempts: number): number {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

async function isDeliveryActive(db: Database, row: EmailDeliveryRow): Promise<boolean> {
  if (!row.sourceId || !row.sourceType) return true;
  const now = new Date();

  if (row.sourceType === "email_verification") {
    const tokenHash = row.sourceTokenHash;
    const [verification] = await db
      .select({ tokenHash: emailVerificationTokens.tokenHash })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, row.sourceId),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return verification?.tokenHash === tokenHash;
  }

  if (row.sourceType === "invitation") {
    const tokenHash = row.sourceTokenHash;
    const [invite] = await db
      .select({ tokenHash: invites.tokenHash })
      .from(invites)
      .where(
        and(
          eq(invites.id, row.sourceId),
          eq(invites.status, "pending"),
          gt(invites.expiresAt, now),
        ),
      )
      .limit(1);
    return invite?.tokenHash === tokenHash;
  }

  return false;
}

async function claimEmailDeliveries(db: Database, limit: number): Promise<EmailDeliveryRow[]> {
  const now = new Date();
  const staleLock = new Date(now.getTime() - LOCK_TIMEOUT_MS);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(emailDeliveries)
      .where(
        and(
          lte(emailDeliveries.nextAttemptAt, now),
          or(
            and(eq(emailDeliveries.status, "pending"), isNull(emailDeliveries.lockedAt)),
            and(
              eq(emailDeliveries.status, "processing"),
              isNotNull(emailDeliveries.lockedAt),
              lt(emailDeliveries.lockedAt, staleLock),
            ),
          ),
        ),
      )
      .orderBy(asc(emailDeliveries.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    const claimed: EmailDeliveryRow[] = [];

    for (const row of rows) {
      const [updated] = await tx
        .update(emailDeliveries)
        .set({
          status: "processing",
          lockedAt: now,
          leaseId: randomUUID(),
          attempts: sql`${emailDeliveries.attempts} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(emailDeliveries.id, row.id),
            or(
              and(eq(emailDeliveries.status, "pending"), isNull(emailDeliveries.lockedAt)),
              and(
                eq(emailDeliveries.status, "processing"),
                isNotNull(emailDeliveries.lockedAt),
                lt(emailDeliveries.lockedAt, staleLock),
              ),
            ),
          ),
        )
        .returning();

      if (updated) claimed.push(updated);
    }

    return claimed;
  });
}

async function markEmailSent(
  db: Database,
  row: EmailDeliveryRow,
  providerMessageId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(emailDeliveries)
    .set({
      status: "sent",
      providerMessageId,
      sentAt: now,
      lockedAt: null,
      leaseId: null,
      textBody: null,
      htmlBody: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, row.id),
        eq(emailDeliveries.status, "processing"),
        eq(emailDeliveries.leaseId, row.leaseId!),
      ),
    );
}

async function markEmailFailed(db: Database, row: EmailDeliveryRow, error: unknown): Promise<void> {
  const permanent =
    error instanceof PermanentEmailDeliveryError || row.attempts >= MAX_DELIVERY_ATTEMPTS;
  const now = new Date();
  const message = error instanceof Error ? error.message : "Email delivery failed";

  await db
    .update(emailDeliveries)
    .set({
      status: permanent ? "failed" : "pending",
      nextAttemptAt: permanent
        ? row.nextAttemptAt
        : new Date(now.getTime() + retryDelayMs(row.attempts)),
      lockedAt: null,
      leaseId: null,
      lastError: message.slice(0, 1000),
      textBody: permanent ? null : row.textBody,
      htmlBody: permanent ? null : row.htmlBody,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, row.id),
        eq(emailDeliveries.status, "processing"),
        eq(emailDeliveries.leaseId, row.leaseId!),
      ),
    );
}

async function markEmailObsolete(db: Database, row: EmailDeliveryRow): Promise<void> {
  await db
    .update(emailDeliveries)
    .set({
      status: "failed",
      lockedAt: null,
      leaseId: null,
      lastError: "Email source token is no longer active",
      textBody: null,
      htmlBody: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailDeliveries.id, row.id),
        eq(emailDeliveries.status, "processing"),
        eq(emailDeliveries.leaseId, row.leaseId!),
      ),
    );
}

export async function processEmailDeliveries(
  db: Database,
  provider: EmailProvider,
  limit = DEFAULT_BATCH_SIZE,
): Promise<EmailDeliverySummary> {
  const rows = await claimEmailDeliveries(db, limit);
  let sent = 0;
  let failed = 0;
  let discarded = 0;

  for (const row of rows) {
    if (!(await isDeliveryActive(db, row))) {
      await markEmailObsolete(db, row);
      discarded += 1;
      continue;
    }

    if (!row.textBody || !row.htmlBody) {
      await markEmailFailed(
        db,
        row,
        new PermanentEmailDeliveryError("Email delivery body is missing"),
      );
      failed += 1;
      continue;
    }

    try {
      const result = await provider({
        to: row.toEmail,
        subject: row.subject,
        text: decryptBody(row.textBody),
        html: decryptBody(row.htmlBody),
        idempotencyKey: row.idempotencyKey,
      });
      await markEmailSent(db, row, result.providerMessageId);
      sent += 1;
    } catch (error) {
      await markEmailFailed(db, row, error);
      failed += 1;
    }
  }

  return { claimed: rows.length, sent, failed, discarded };
}

export function startEmailDeliveryWorker(
  db: Database,
  provider: EmailProvider,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  let stopped = false;
  let running = false;

  const run = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const summary = await processEmailDeliveries(db, provider);
      if (summary.claimed > 0) {
        logger.info(summary, "Email delivery batch processed");
      }
    } catch (error) {
      logger.error({ err: error }, "Email delivery worker batch failed");
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), pollIntervalMs);
  timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
