ALTER TABLE "audit_logs" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "refresh_token_jti" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "permission_version" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_role_id_roles_id_fk";--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role_id_roles_id_fk";--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE cascade;