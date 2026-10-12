# Life Planner

A personal "life OS" that runs in the browser and installs on your phone as an app. Tasks, calendar, day planner, habits, goals and projects, study tracking, workouts, notes, reminders, analytics and a weekly review all live in one place.

It costs nothing to run. Every service below is used on its free tier, and none of them needs a card.

## What's inside

| Area | What you can do |
| --- | --- |
| **Today** | A dashboard of today's tasks, schedule, habits, upcoming deadlines, goal progress and inbox. Pick and reorder the sections in Settings. |
| **Tasks** | No date, Today, Upcoming, Overdue, All, Completed and Archived views, with grouping and sorting. Subtasks, priorities, tags, categories, estimates and recurring tasks (daily, weekdays, weekly on chosen days, monthly, yearly, "every N"). Each repeat can be completed or skipped on its own. |
| **Quick add** | Type a sentence such as `Study OS for 90 minutes tomorrow at 6 PM` or `Leetcode every weekday at 7am #dsa !high`. You see what was understood before anything is saved. |
| **Calendar** | Month, week, day and agenda views. Drag to create or move events. Repeating events can be edited or deleted for one occurrence or the whole series. Overlapping events are flagged. Times follow your time zone, including DST changes. |
| **Planner** | A day timeline with time blocks, auto-placement of unscheduled tasks into free gaps, replanning for missed blocks, and a week view. |
| **Habits** | Daily, specific weekdays, or N times per week, as yes/no or counted habits. Streaks only count the days a habit is scheduled. Includes a 20-week heatmap. |
| **Goals and projects** | Progress comes from linked tasks, milestones, a number you track, or a manual value. Milestones can depend on each other. |
| **Study** | Subjects with topics and weekly targets. The focus timer and pomodoro are based on timestamps, so they stay correct if the tab sleeps or the phone locks. Sessions can also be logged by hand. |
| **Fitness** | Workouts with sets, reps, weight or time, workout templates, personal records with estimated 1RM, and body measurements with a chart. |
| **Inbox and notes** | Capture anything, then turn it into a task, an event or a reminder. |
| **Coach** | Ranks the ideal tasks for today against your free time, works out a study pace per subject from its goal deadline and your recent study, and points out what to change (overbooked days, overdue piles, slipping habits, goals behind, your best focus hours). It is plain arithmetic in the app with no AI service. "Copy for Claude" copies a summary you can paste into a chat for deeper advice. |
| **Reminders** | In-app reminders, browser notifications while the app is open, and optional Web Push that works while the app is closed (see below). Quiet hours are respected. |
| **Analytics and weekly review** | Charts for completed tasks, study hours, study by subject, habit consistency and goals. The weekly review records wins, misses and next week's priorities. |
| **Offline** | With sync on, a copy of your data is kept on the device. Without internet you can still view and change everything; changes upload by themselves when you're back online, and a banner shows how many are waiting. |
| **Everything else** | Search, keyboard shortcuts, light and dark themes, JSON and CSV export, JSON import, and account deletion. |

**Keyboard shortcuts:** `q` or `n` opens quick add, `/` or `Ctrl/⌘ K` opens search, and `t`, `c` and `p` go to Today, Calendar and Planner.

## Stack

React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form with Zod, FullCalendar (the MIT-licensed standard plugins only), Recharts, Lucide icons, and vite-plugin-pwa. The backend is Supabase (Postgres, Auth and row-level security), with one optional Edge Function for push. Tests use Vitest, Testing Library and Playwright.

## 1. Try it locally (no account needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173. Without Supabase keys the app runs in **local mode**: everything is stored in this browser (IndexedDB) and nothing syncs. That's fine for trying it out. Use Settings → Export JSON to keep a copy.

## 2. Free sync with Supabase

1. Create a free account at [supabase.com](https://supabase.com) and a new project on the **Free** plan. No card is needed. Pick the region nearest you (Mumbai for India).
2. Create the database tables. Either:
   - open **SQL Editor**, paste the whole of `supabase/migrations/20261012000000_initial_schema.sql`, and run it, or
   - with the [Supabase CLI](https://supabase.com/docs/guides/cli): `npx supabase login`, `npx supabase link --project-ref <your-ref>`, then `npx supabase db push`.
3. Under **Authentication → Sign In / Providers → Email**, keep email sign-in on. Supabase's built-in email sender only sends a handful of emails per hour. For a personal app, either:
   - turn **Confirm email** off, so you can sign in straight after signing up, or
   - leave it on and sign up with the email address that owns the Supabase account.
4. Under **Authentication → URL Configuration**, set the **Site URL** to where the app runs (`http://localhost:5173` for now). Add your deployed URL later.
5. Under **Project Settings → API Keys**, copy the project URL and the **publishable** key (older projects call it the `anon` key).
6. Copy `.env.example` to `.env.local` and fill in:

   ```
   VITE_SUPABASE_URL=https://<your-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```

7. Restart `npm run dev` and create your account.

> Never put the `service_role` or secret key in `.env.local` or anywhere in the frontend. The publishable key is safe in the browser because every table is protected by row-level security.

**Moving local-mode data into your account:** in local mode, go to Settings → Export JSON. Then sign in to the synced app and use Settings → Import JSON. Records that already exist are skipped.

## 3. Deploy for free

### Vercel (Hobby plan, free)

1. Sign in at [vercel.com](https://vercel.com) with GitHub and import this repository. Private repos work on Hobby.
2. Vercel detects Vite. `vercel.json` already handles page routing and caching.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, plus `VITE_VAPID_PUBLIC_KEY` if you use push. Then deploy.
4. In Supabase → Authentication → URL Configuration, set the Site URL to the Vercel URL and add it under **Redirect URLs**.

### Netlify (free plan) as an alternative

Import the repo with build command `npm run build` and publish directory `dist`. `public/_redirects` already handles routing. Set the same environment variables.

## 4. Install on your phone

The app is a PWA and needs the deployed HTTPS URL.

- **Android (Chrome):** open the site, tap ⋮ → **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** open the site, tap Share → **Add to Home Screen**. You need iOS 16.4 or later for notifications, and they only work from the Home Screen app.

## 5. Optional: notifications while the app is closed (Web Push)

Browser timers stop when the app is closed, so in-app and browser reminders only fire while the app is open. To be notified while it is closed, set up push. The same function also schedules the next reminder for anything that repeats (habits, repeating tasks and events, and repeating custom reminders), so they keep coming without opening the app. It is also free: once a minute comes to about 43,000 function calls a month, against a free limit of 500,000.

1. Generate VAPID keys once: `npx web-push generate-vapid-keys`.
2. Add the **public** key to the frontend as `VITE_VAPID_PUBLIC_KEY`, both locally and in Vercel/Netlify.
3. Store the function secrets in Supabase. The private key goes only here. Use any long random string as the cron secret.

   ```bash
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<long-random-string>
   ```

4. Deploy the function: `npx supabase functions deploy send-due-reminders --no-verify-jwt`. The function checks `CRON_SECRET` itself.
   Without the CLI, create a function named `send-due-reminders` in the dashboard (Edge Functions → Deploy a new function → Via Editor), paste the whole of `supabase/functions/send-due-reminders/index.ts`, and turn off **Verify JWT** in its settings.
5. Open `supabase/optional/push_cron.sql`, replace `YOUR-PROJECT-REF` and `YOUR-CRON-SECRET`, and run it in the SQL Editor. Don't commit the edited file.
6. In the app, go to Settings → Notifications and turn on push for this device.

## 6. Optional: Google Calendar

Two one-way links, both free and without a Google Cloud account:

- **Your plans in Google Calendar.** The app publishes your events and dated tasks as a calendar feed. Google Calendar subscribes to it ("Other calendars → From URL") and refreshes it on its own schedule, usually every few hours.
- **Google Calendar in the app.** Paste a calendar's "Secret address in iCal format" and its events show read-only in the app's Calendar.

Setup, once:

1. In the SQL Editor, run `supabase/migrations/20261013000000_calendar_links.sql`.
2. Create an Edge Function named `calendar` (dashboard: Edge Functions → Deploy a new function → Via Editor), paste the whole of `supabase/functions/calendar/index.ts`, deploy, and turn off **Verify JWT** in its settings. With the CLI: `npx supabase functions deploy calendar --no-verify-jwt`. Optionally set the secret `APP_URL` to your app's address so feed entries link back to it.
3. In the app, open Settings → Google Calendar.

Real-time two-way sync would need Google's Calendar API and a Google Cloud project, so it isn't used.

## Free-tier limits worth knowing

- **Supabase Free:** 500 MB database, 50,000 monthly active users, 500,000 Edge Function calls a month, and 2 free projects. **A Free project pauses after 7 days without activity.** Opening the app counts as activity. If it does pause, press Restore in the dashboard; your data is kept.
- **Vercel Hobby / Netlify Free:** far more bandwidth and builds than one person needs.
- **GitHub Actions:** the CI in `.github/workflows/ci.yml` uses the free monthly minutes that come with the account.

The app never needs a paid plan, a trial or a card. If a provider ever asks for one, stop and don't enter it.

## Development

```bash
npm run dev         # dev server
npm run build       # type-check and production build
npm run typecheck
npm run lint
npm test            # unit and component tests (Vitest)
npm run test:e2e    # browser tests on desktop and phone (Playwright, local mode)
npm run test:db     # row-level security tests against a throwaway local Postgres
npm run icons       # regenerate PWA icons
npm run functions:build  # bundle supabase/functions-src into supabase/functions
```

`test:db` needs PostgreSQL 15+ binaries installed (`initdb`, `pg_ctl`). Set `PG_BIN` if they aren't on your `PATH`. It starts a temporary database on port 54329, loads the migration, and checks that one user can never read or change another user's rows.

### Project layout

```
src/
  features/      one folder per area (tasks, calendar, planner, habits, goals, study, fitness, notes, reminders, analytics, …)
  lib/db/        data layer: SupabaseStore and LocalStore (IndexedDB) behind one interface, the OfflineStore that
                 keeps a device copy and an outbox of offline changes, plus React Query hooks
  lib/           dates and time zones, recurrence, export/import, push helpers
  server/        server-side jobs shared with the Edge Functions (tested with Vitest)
  components/    shared UI and layout
supabase/
  migrations/    the full schema with RLS
  functions/     deployable Edge Functions (generated; do not edit)
  functions-src/ their source, bundled by `npm run functions:build`
  optional/      push_cron.sql
db/tests/        RLS tests
e2e/             Playwright tests
```

## Security

- Every user table has row-level security. Ownership comes from the signed-in session (`auth.uid()`), never from data the browser sends. Database triggers set `user_id` and reject links to rows you don't own.
- The browser only ever holds the publishable key. The service-role key and the VAPID private key exist only as Edge Function secrets.
- `.env*` files are git-ignored, and `.env.example` contains placeholders only.
- CSV export neutralises spreadsheet formulas.
- **Delete account** (Settings) removes your auth user and, through cascades, every row you own.
- Keep this repository **private**.

## Known limitations

- Without push set up, reminders only fire while the app is open, and repeating reminders schedule their next occurrence when you open the app. The app never claims otherwise.
- Offline changes are merged with "last change wins". If the same item is edited on two devices while one is offline, the later upload replaces the earlier edit. A change the server refuses (for example, editing something already deleted on another device) is dropped and the app says so.
- Opening the app for the first time on a device needs internet. Account deletion and "delete all data" also need internet.
- iOS only delivers web notifications to a Home Screen–installed app on iOS 16.4+.
- Natural-language quick add understands English phrases for dates, times, durations, repeats, `#tags` and `!priority`. Always check the preview.
- Supabase's built-in email is rate-limited. See step 3 of the Supabase setup.
