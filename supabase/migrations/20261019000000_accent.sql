-- Accent colour picked in Settings → Appearance. Run after the earlier migrations.
-- The value is a palette id from src/lib/accents.ts; the app falls back to teal for anything else.

alter table public.user_settings
  add column if not exists accent text not null default 'teal'
    check (accent ~ '^[a-z]{1,20}$');
