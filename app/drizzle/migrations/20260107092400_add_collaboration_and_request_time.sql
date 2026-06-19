DO $$ BEGIN
  CREATE TYPE "public"."collaborator_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collaboration_logs"
(
    "id"              uuid PRIMARY KEY         DEFAULT gen_random_uuid() NOT NULL,
    "collaborator_id" uuid                                               NOT NULL,
    "action"          varchar(50)                                        NOT NULL,
    "operator_id"     integer                                            NOT NULL,
    "ip_address"      text,
    "created_at"      timestamp with time zone DEFAULT now()             NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "RequestTime"
(
    "id"          serial PRIMARY KEY         NOT NULL,
    "createdAt"   timestamp(6) DEFAULT now() NOT NULL,
    "updatedAt"   timestamp(6) DEFAULT now() NOT NULL,
    "name"        text                       NOT NULL,
    "startTime"   timestamp                  NOT NULL,
    "endTime"     timestamp                  NOT NULL,
    "enabled"     boolean      DEFAULT true  NOT NULL,
    "description" text,
    "expected"    bigint       DEFAULT 0     NOT NULL,
    "accepted"    bigint       DEFAULT 0     NOT NULL,
    "past"        boolean      DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "song_collaborators"
(
    "id"         uuid PRIMARY KEY         DEFAULT gen_random_uuid() NOT NULL,
    "song_id"    integer                                            NOT NULL,
    "user_id"    integer                                            NOT NULL,
    "status"     "collaborator_status"    DEFAULT 'PENDING'         NOT NULL,
    "created_at" timestamp with time zone DEFAULT now()             NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now()             NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "hitRequestId" integer;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "enableRequestTimeLimitation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "forceBlockAllRequests" boolean DEFAULT false NOT NULL;
