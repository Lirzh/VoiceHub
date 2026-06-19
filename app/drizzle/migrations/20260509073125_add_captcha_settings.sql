ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "captchaEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "captchaMaxFailures" integer DEFAULT 3 NOT NULL;
