-- Google Calendar (or any calendar app) links. Optional; run after the initial schema.
--
-- calendar_feed_token: secret part of the URL a calendar app subscribes to.
--   Only the calendar Edge Function (service role) looks rows up by it.
-- calendar_links: calendars shown read-only inside the app, each
--   { "id", "name", "url", "color", "enabled" }. The URLs are private
--   (Google's "secret address in iCal format"); row-level security on
--   user_settings keeps them to their owner.

alter table public.user_settings
  add column if not exists calendar_feed_token text unique
    check (calendar_feed_token is null or calendar_feed_token ~ '^[A-Za-z0-9_-]{32,64}$');

alter table public.user_settings
  add column if not exists calendar_links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(calendar_links) = 'array' and jsonb_array_length(calendar_links) <= 10);
