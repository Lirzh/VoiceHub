DO $$ BEGIN
  CREATE TYPE "public"."replay_request_status" AS ENUM('PENDING', 'FULFILLED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "song_replay_requests" ADD COLUMN IF NOT EXISTS "status" "replay_request_status" DEFAULT 'PENDING' NOT NULL;
