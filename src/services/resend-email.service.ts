import { Resend } from "resend";

import { EMAIL_FROM, RESEND_API_KEY } from "../config/index.ts";
import {
  PermanentEmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
} from "./email-delivery.service.ts";

const PERMANENT_ERROR_NAMES = new Set([
  "invalid_api_key",
  "missing_api_key",
  "restricted_api_key",
  "invalid_from_address",
  "validation_error",
  "missing_required_field",
  "invalid_parameter",
  "invalid_access",
  "security_error",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "suspended_api_key",
  "invalid_permission",
  "not_found",
  "method_not_allowed",
  "invalid_region",
]);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Resend request timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export const sendResendEmail: EmailProvider = async (message: EmailMessage) => {
  if (!resend || !EMAIL_FROM) {
    throw new PermanentEmailDeliveryError("Resend email delivery is not configured");
  }

  const { data, error } = await withTimeout(
    resend.emails.send(
      {
        from: EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      { idempotencyKey: message.idempotencyKey },
    ),
    60_000,
  );

  if (error) {
    if (PERMANENT_ERROR_NAMES.has(error.name)) {
      throw new PermanentEmailDeliveryError(error.message);
    }
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error("Resend returned no message id");
  }

  return { providerMessageId: data.id };
};
