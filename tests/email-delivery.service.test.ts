import { describe, expect, it } from "bun:test";

import type { DatabaseExecutor } from "../src/database/client.ts";
import {
  enqueueInvitationEmail,
  enqueueVerificationEmail,
} from "../src/services/email-delivery.service.ts";

function fakeDatabase() {
  const values: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (input: Record<string, unknown>) => {
        values.push(input);
      },
    }),
  } as unknown as DatabaseExecutor;

  return { db, values };
}

describe("email delivery outbox", () => {
  it("enqueues verification email with a hashed idempotency key", async () => {
    const { db, values } = fakeDatabase();

    await enqueueVerificationEmail(db, {
      to: "user@example.com",
      token: "raw-verification-token",
      userId: "user-123",
    });

    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      toEmail: "user@example.com",
      idempotencyKey: expect.stringMatching(/^email-verification\/[a-f0-9]{64}$/),
    });
    expect(values[0]).toMatchObject({
      sourceType: "email_verification",
      sourceId: "user-123",
      sourceTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(values[0]?.textBody).toMatch(/^v1\./);
    expect(values[0]?.textBody).not.toContain("raw-verification-token");
  });

  it("escapes organization names in invitation HTML", async () => {
    const { db, values } = fakeDatabase();

    await enqueueInvitationEmail(db, {
      to: "user@example.com",
      token: "raw-invitation-token",
      organizationName: "Acme <Research>",
      inviteId: "invite-123",
    });

    expect(values[0]).toMatchObject({
      idempotencyKey: "invitation/invite-123",
      sourceType: "invitation",
      sourceId: "invite-123",
      sourceTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(values[0]?.htmlBody).toMatch(/^v1\./);
    expect(values[0]?.htmlBody).not.toContain("Acme <Research>");
  });
});
