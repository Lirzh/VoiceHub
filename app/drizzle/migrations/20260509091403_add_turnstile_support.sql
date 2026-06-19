ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "captchaProvider" text DEFAULT 'graphic' NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "turnstileSiteKey" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "turnstileSecretKey" text;
