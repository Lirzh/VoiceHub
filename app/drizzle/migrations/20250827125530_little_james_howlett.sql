DO $$ BEGIN
  ALTER TABLE "Semester" DROP CONSTRAINT "Semester_name_unique";
EXCEPTION
  WHEN undefined_object THEN null;
END $$;
