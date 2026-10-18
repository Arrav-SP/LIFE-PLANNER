-- Exam / finish-by date on a study subject, so the Coach can pace it without a goal.
-- Run after the earlier migrations.

alter table public.subjects
  add column if not exists target_date date;
