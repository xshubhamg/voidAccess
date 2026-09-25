ALTER TABLE "audit_logs" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "terminal_at" timestamp with time zone;--> statement-breakpoint
UPDATE "email_deliveries" SET "terminal_at" = COALESCE("sent_at", "updated_at") WHERE "status" IN ('sent', 'failed') AND "terminal_at" IS NULL;
ALTER TABLE "email_deliveries" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_logs_legal_hold_at_idx" ON "audit_logs" USING btree ("legal_hold_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_terminal_at_idx" ON "email_deliveries" USING btree ("terminal_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_legal_hold_at_idx" ON "email_deliveries" USING btree ("legal_hold_at");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_legal_hold_at_idx" ON "email_verification_tokens" USING btree ("legal_hold_at");--> statement-breakpoint
CREATE INDEX "invites_status_changed_at_idx" ON "invites" USING btree ("status_changed_at");--> statement-breakpoint
CREATE INDEX "invites_legal_hold_at_idx" ON "invites" USING btree ("legal_hold_at");--> statement-breakpoint
CREATE INDEX "sessions_status_changed_at_idx" ON "sessions" USING btree ("status_changed_at");--> statement-breakpoint
CREATE INDEX "sessions_legal_hold_at_idx" ON "sessions" USING btree ("legal_hold_at");