ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "oauthRedirectUri" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "oauthStateSecret" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "oauthProviders" text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "githubOAuthEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "githubClientId" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "githubClientSecret" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "casdoorOAuthEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "casdoorServerUrl" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "casdoorClientId" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "casdoorClientSecret" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "casdoorOrganizationName" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "googleOAuthEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "googleClientId" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "googleClientSecret" text;
