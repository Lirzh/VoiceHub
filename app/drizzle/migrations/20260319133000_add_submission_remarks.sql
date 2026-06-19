ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "submissionNote" text;--> statement-breakpoint
ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "submissionNotePublic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "enableSubmissionRemarks" boolean DEFAULT false NOT NULL;
