import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, LogOut, Moon, Monitor, Sun, Trash2, Upload } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useAuth } from '@/auth/AuthProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { getStore } from '@/lib/db'
import { eq } from '@/lib/db/store'
import { TABLES, type TableName, type UserSettings } from '@/lib/db/types'
import { browserTimeZone, formatInstant, isValidTimeZone, WEEKDAY_LONG } from '@/lib/dates'
import { cn, COLOR_SWATCHES, errorMessage, plural } from '@/lib/utils'
import { env } from '@/lib/env'
import { ACCENTS, accentColors, DEFAULT_ACCENT } from '@/lib/accents'
import { useScrollIntoView } from '@/lib/useScrollIntoView'
import { Button } from '@/components/ui/Button'
import { confirm } from '@/components/ui/Dialog'
import { Field, Input, Select, Switch } from '@/components/ui/Field'
import { PageHeader, Panel, Segmented } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import { REMINDER_CHOICES } from '@/features/tasks/TaskEditor'
import { notificationPermission, requestNotificationPermission } from '@/features/reminders/notify'
import { download, exportAll, importAll, toCSV } from '@/lib/export'
import { CalendarLinksPanel } from '@/features/calendar/CalendarLinksPanel'
import { currentSubscription, pushAvailable, subscribePush, unsubscribePush } from '@/lib/push'

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York']
  }
})()

export function SettingsPage() {
  const { settings, update } = useSettings()
  const { user, signOut, mode } = useAuth()
  // /settings#notifications (and other section ids) scrolls to that section.
  const { hash } = useLocation()
  useScrollIntoView(hash.slice(1) || null, true)
  const [name, setName] = useState(settings.display_name)
  useEffect(() => setName(settings.display_name), [settings.display_name])

  const set = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => void update({ [k]: v } as Partial<UserSettings>)
  const notif = (patch: Partial<UserSettings['notifications']>) => void update({ notifications: { ...settings.notifications, ...patch } })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Settings" subtitle={mode === 'local' ? 'Local mode: everything is stored in this browser.' : user?.email ?? undefined} />

      <Panel title="Profile">
        <Field label="Your name" htmlFor="st-name" hint="Used in the greeting on Today.">
          <Input id="st-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => name !== settings.display_name && set('display_name', name.trim())} />
        </Field>
      </Panel>

      <Panel title="Date and time">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone" htmlFor="st-tz" hint={settings.timezone !== browserTimeZone() ? `This device is set to ${browserTimeZone()}.` : 'Matches this device.'}>
            <Select id="st-tz" value={settings.timezone} onChange={(e) => isValidTimeZone(e.target.value) && set('timezone', e.target.value)}>
              {(ZONES.includes(settings.timezone) ? ZONES : [settings.timezone, ...ZONES]).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Week starts on" htmlFor="st-ws">
            <Select id="st-ws" value={settings.week_start} onChange={(e) => set('week_start', Number(e.target.value) as UserSettings['week_start'])}>
              {[1, 0, 6].map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LONG[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time format" htmlFor="st-tf">
            <Select id="st-tf" value={settings.time_format} onChange={(e) => set('time_format', e.target.value as UserSettings['time_format'])}>
              <option value="HH:mm">24-hour ({formatInstant(new Date(), settings.timezone, 'HH:mm')})</option>
              <option value="h:mm a">12-hour ({formatInstant(new Date(), settings.timezone, 'h:mm a')})</option>
            </Select>
          </Field>
          <Field label="Date format" htmlFor="st-df">
            <Select id="st-df" value={settings.date_format} onChange={(e) => set('date_format', e.target.value)}>
              {['d MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'].map((f) => (
                <option key={f} value={f}>
                  {formatInstant(new Date(), settings.timezone, f)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel title="Appearance">
        <Segmented
          label="Theme"
          value={settings.theme}
          onChange={(v) => set('theme', v)}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          {settings.theme === 'light' ? <Sun className="h-3.5 w-3.5" /> : settings.theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
          {settings.theme === 'system' ? 'Follows your device setting.' : `Always ${settings.theme}.`}
        </p>
        <p className="mb-2 mt-5 text-sm font-medium">Accent colour</p>
        <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => {
            const on = (settings.accent ?? DEFAULT_ACCENT) === a.id
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={a.name}
                title={a.name}
                onClick={() => set('accent', a.id)}
                className={cn('h-8 w-8 rounded-full border border-line ring-offset-2 ring-offset-surface transition', on ? 'ring-2 ring-fg' : 'hover:scale-110')}
                style={{ background: `rgb(${accentColors(a).swatch.join(' ')})` }}
              />
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          {ACCENTS.find((a) => a.id === (settings.accent ?? DEFAULT_ACCENT))?.name ?? 'Teal'}. Used for buttons, links and highlights, and in light mode to tint the background. Buttons and links are deepened a little in light mode so text stays readable.
        </p>
      </Panel>

      <Panel title="Planner">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Day starts" htmlFor="st-ds">
            <Select id="st-ds" value={settings.day_start_hour} onChange={(e) => set('day_start_hour', Number(e.target.value))}>
              {Array.from({ length: 13 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day ends" htmlFor="st-de">
            <Select id="st-de" value={settings.day_end_hour} onChange={(e) => set('day_end_hour', Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => 13 + i).map((h) => (
                <option key={h} value={h}>
                  {h === 24 ? '24:00' : `${String(h).padStart(2, '0')}:00`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default task length" htmlFor="st-dtm">
            <Select id="st-dtm" value={settings.default_task_minutes} onChange={(e) => set('default_task_minutes', Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <NotificationSettings notif={notif} />

      <Panel title="Quiet hours">
        <p className="mb-3 text-sm text-muted">Reminders that fall in quiet hours wait in the bell without a pop-up or sound.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" htmlFor="st-qs">
            <Input id="st-qs" type="time" value={settings.quiet_hours_start ?? ''} onChange={(e) => set('quiet_hours_start', e.target.value || null)} />
          </Field>
          <Field label="To" htmlFor="st-qe">
            <Input id="st-qe" type="time" value={settings.quiet_hours_end ?? ''} onChange={(e) => set('quiet_hours_end', e.target.value || null)} />
          </Field>
          {(settings.quiet_hours_start || settings.quiet_hours_end) && (
            <Button variant="ghost" onClick={() => void update({ quiet_hours_start: null, quiet_hours_end: null })}>
              Turn off
            </Button>
          )}
        </div>
      </Panel>

      <CalendarLinksPanel />
      <CategoriesPanel />
      <DataPanel />

      <Panel title="Account">
        <div className="flex flex-col gap-4">
          {mode === 'supabase' && (
            <Button variant="outline" className="self-start" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </Button>
          )}
          <div className="rounded-lg border border-danger/30 p-3">
            <p className="text-sm font-medium text-danger">{mode === 'supabase' ? 'Delete account' : 'Erase all local data'}</p>
            <p className="mb-3 mt-1 text-sm text-muted">
              {mode === 'supabase'
                ? 'Permanently deletes your account and every task, event, habit, note and log. Export your data first if you want a copy.'
                : 'Deletes everything stored by Life Planner in this browser.'}
            </p>
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await confirm({
                  title: mode === 'supabase' ? 'Delete your account for good?' : 'Erase all local data?',
                  message: 'This cannot be undone.',
                  confirmLabel: mode === 'supabase' ? 'Delete account' : 'Erase everything',
                  danger: true,
                })
                if (!ok) return
                try {
                  if (mode === 'supabase') await getStore().deleteAccount()
                  else await getStore().clearAll()
                  try {
                    localStorage.removeItem('lp-focus-timer')
                  } catch {
                    /* ignore */
                  }
                  window.location.assign('/')
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> {mode === 'supabase' ? 'Delete account' : 'Erase data'}
            </Button>
          </div>
        </div>
      </Panel>
      <p className="pb-4 text-center text-xs text-subtle">Life Planner · {env.mode === 'local' ? 'local mode' : 'synced with Supabase'}</p>
    </div>
  )
}

/** A one-off reminder a minute from now. The push server sends it to every device that has push on. */
async function sendTestPush() {
  try {
    const at = new Date(Date.now() + 60_000)
    await getStore().insert('reminders', {
      source_type: 'custom',
      source_id: null,
      title: 'Test notification',
      body: 'Push works on this device.',
      url: '/settings#notifications',
      remind_at: at.toISOString(),
      dedupe_key: `custom:test:${at.getTime()}`,
    })
    window.dispatchEvent(new Event('lp:reminders-changed'))
    toast.success('Sent. Close the app or lock your phone now; it should arrive within 2 minutes.')
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

function NotificationSettings({ notif }: { notif: (p: Partial<UserSettings['notifications']>) => void }) {
  const { settings } = useSettings()
  const [perm, setPerm] = useState(notificationPermission())
  const [pushOn, setPushOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const avail = pushAvailable()
  useEffect(() => {
    void currentSubscription().then((s) => setPushOn(!!s))
  }, [])
  const offsets = (key: 'task_default_offsets' | 'event_default_offsets') => (
    <div className="flex flex-wrap gap-1.5">
      {REMINDER_CHOICES.map((c) => {
        const cur = settings.notifications[key] ?? []
        const on = cur.includes(c.v)
        return (
          <button
            key={c.v}
            type="button"
            aria-pressed={on}
            onClick={() => notif({ [key]: on ? cur.filter((x) => x !== c.v) : [...cur, c.v].sort((a, b) => a - b) })}
            className={cn('rounded-full border px-3 py-1 text-sm', on ? 'border-accent bg-accent-soft' : 'border-line text-muted hover:bg-surface-2')}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
  return (
    <section id="notifications">
      <Panel title="Notifications">
        <div className="flex flex-col gap-4">
          <Switch checked={settings.notifications.in_app !== false} onChange={(v) => notif({ in_app: v })} label="Show reminders inside the app" />
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              checked={!!settings.notifications.browser && perm === 'granted'}
              onChange={async (v) => {
                if (v && perm !== 'granted') {
                  const p = await requestNotificationPermission()
                  setPerm(p)
                  if (p !== 'granted') return toast.error(p === 'denied' ? 'Notifications are blocked. Allow them in your browser’s site settings.' : 'Notifications are not available in this browser.')
                }
                notif({ browser: v })
              }}
              label="Browser notifications while the app is open in the background"
            />
          </div>
          <div>
            <Switch
              checked={pushOn}
              onChange={async (v) => {
                if (!avail.ok) return
                setBusy(true)
                try {
                  if (v) await subscribePush()
                  else await unsubscribePush()
                  setPushOn(v)
                  // Push is per device: turning it off here must not stop it on your other devices.
                  if (v && settings.notifications.push === false) notif({ push: true })
                  toast.success(v ? 'Push notifications on for this device' : 'Push turned off for this device')
                } catch (e) {
                  toast.error(errorMessage(e))
                } finally {
                  setBusy(false)
                }
              }}
              label={busy ? 'Working…' : 'Push notifications when the app is closed (this device)'}
            />
            {!avail.ok && <p className="mt-1 text-xs text-muted">{avail.reason}</p>}
            {avail.ok && pushOn && (
              <>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void sendTestPush()}>
                  Send a test notification
                </Button>
                <PushCheck />
              </>
            )}
          </div>
          <Switch checked={settings.notifications.habit_reminders !== false} onChange={(v) => notif({ habit_reminders: v })} label="Habit reminders" />
          <Field label="Default reminders for new timed tasks">{offsets('task_default_offsets')}</Field>
          <Field label="Default reminders for new events">{offsets('event_default_offsets')}</Field>
        </div>
      </Panel>
    </section>
  )
}

/** What the server knows about push for this account, so a missing notification can be traced. */
function PushCheck() {
  const { tz, settings } = useSettings()
  const subs = useList('push_subscriptions')
  const last = useList('notification_log', { filters: [eq('channel', 'push')], order: [{ field: 'created_at', ascending: false }], limit: 1 })
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    void currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null))
  }, [subs.data])
  if (subs.isLoading || last.isLoading || endpoint === undefined) return null
  const saved = !!endpoint && (subs.data ?? []).some((x) => x.endpoint === endpoint)
  const l = last.data?.[0]
  const when = l ? formatInstant(l.created_at, tz, `d MMM, ${settings.time_format}`) : ''
  const lines: { tone: 'ok' | 'warn'; text: string }[] = [
    saved
      ? { tone: 'ok', text: `This device is saved on the server (${plural((subs.data ?? []).length, 'device')} with push in total).` }
      : { tone: 'warn', text: 'This device is not saved on the server, so pushes cannot reach it. Turn the switch above off and on again.' },
    !l
      ? { tone: 'warn', text: 'The server has not sent any push yet. If the test does not arrive within 2 minutes, the push function or its every-minute schedule is not running: check Supabase → Edge Functions → send-due-reminders → Logs.' }
      : l.status === 'delivered'
        ? { tone: 'ok', text: `Last push accepted by the push service: “${l.title}” at ${when}. If it did not show, check the phone's notification settings for Chrome and Life Planner, and battery saver.` }
        : { tone: 'warn', text: `Last push (“${l.title}”, ${when}) ${l.status === 'suppressed' ? 'was held back' : 'failed'}: ${l.detail || 'no reason given'}` },
  ]
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3 text-xs" aria-label="Push check">
      <p className="mb-1.5 font-semibold">Push check</p>
      <ul className="flex flex-col gap-1.5">
        {lines.map((x) => (
          <li key={x.text} className={cn(x.tone === 'warn' ? 'text-warning' : 'text-muted')}>
            {x.tone === 'warn' ? '⚠ ' : '✓ '}
            {x.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CategoriesPanel() {
  const cats = useList('categories', { order: [{ field: 'sort_order' }, { field: 'name' }] })
  const invalidate = useInvalidate()
  const [name, setName] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('categories')
    }
  }
  return (
    <Panel title="Categories">
      <p className="mb-3 text-sm text-muted">Group tasks, events and time blocks, for example College, UPSC, Health or Personal.</p>
      <ul className="mb-3 flex flex-col gap-1">
        {(cats.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`Color for ${c.name}`}
              value={c.color}
              onChange={(e) => void run(() => getStore().update('categories', c.id, { color: e.target.value }))}
              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <Input aria-label="Category name" defaultValue={c.name} className="h-9 flex-1" onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && void run(() => getStore().update('categories', c.id, { name: e.target.value.trim() }))} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${c.name}`}
              onClick={async () => {
                if (await confirm({ title: `Delete “${c.name}”?`, message: 'Items in this category are kept and become uncategorised.', confirmLabel: 'Delete', danger: true })) await run(() => getStore().remove('categories', c.id))
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void run(() => getStore().insert('categories', { name: name.trim(), color: COLOR_SWATCHES[(cats.data?.length ?? 0) % COLOR_SWATCHES.length], sort_order: cats.data?.length ?? 0 })).then(() => setName(''))
        }}
      >
        <Input aria-label="New category" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={!name.trim()}>
          Add
        </Button>
      </form>
    </Panel>
  )
}

function DataPanel() {
  const [table, setTable] = useState<TableName>('tasks')
  const [busy, setBusy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const invalidate = useInvalidate()
  const stamp = new Date().toISOString().slice(0, 10)
  return (
    <Panel id="data" title="Your data">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            loading={busy === 'json'}
            onClick={async () => {
              setBusy('json')
              try {
                download(`life-planner-${stamp}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json')
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setBusy('')
              }
            }}
          >
            <Download className="h-4 w-4" aria-hidden /> Export everything (JSON)
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Table to export as CSV" value={table} onChange={(e) => setTable(e.target.value as TableName)} className="w-56">
            {TABLES.filter((t) => t !== 'push_subscriptions').map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            loading={busy === 'csv'}
            onClick={async () => {
              setBusy('csv')
              try {
                const rows = (await getStore().list(table)) as unknown as Record<string, unknown>[]
                if (!rows.length) return toast.info('That table is empty.')
                download(`life-planner-${table}-${stamp}.csv`, toCSV(rows), 'text/csv')
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setBusy('')
              }
            }}
          >
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </Button>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setBusy('import')
              try {
                const res = await importAll(JSON.parse(await f.text()))
                for (const t of TABLES) invalidate(t)
                toast.success(`Imported ${res.inserted} items${res.skipped ? `, skipped ${res.skipped} already present` : ''}`)
              } catch (err) {
                toast.error(errorMessage(err))
              } finally {
                setBusy('')
              }
            }}
          />
          <Button variant="outline" loading={busy === 'import'} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden /> Import a JSON export
          </Button>
          <p className="mt-1 text-xs text-muted">Use this to move from local mode to your synced account. Items that already exist are skipped.</p>
        </div>
      </div>
    </Panel>
  )
}
