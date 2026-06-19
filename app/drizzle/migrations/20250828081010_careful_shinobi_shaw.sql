DO $$ BEGIN
  ALTER TABLE "NotificationSettings" DROP CONSTRAINT "NotificationSettings_userId_unique";
EXCEPTION
  WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "User" DROP CONSTRAINT "User_username_unique";
EXCEPTION
  WHEN undefined_object THEN null;
END $$;
