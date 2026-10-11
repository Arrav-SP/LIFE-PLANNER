-- OPTIONAL: run the push function every minute (free on the Supabase Free plan:
-- about 43,000 invocations a month against a 500,000 limit).
-- Run this once in the Supabase SQL editor AFTER deploying the function.
-- Replace the two placeholders first. Do not commit your real secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-due-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-due-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- To stop it later:
-- select cron.unschedule('send-due-reminders');
