ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "allowOAuthRegistration" boolean DEFAULT false NOT NULL;
