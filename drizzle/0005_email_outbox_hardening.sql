ALTER TABLE "email_deliveries" ADD COLUMN "source_type" varchar(40);--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
CREATE INDEX "email_deliveries_source_type_source_id_idx" ON "email_deliveries" USING btree ("source_type","source_id");