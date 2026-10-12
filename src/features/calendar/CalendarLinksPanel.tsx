import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { useSettings } from '@/settings/SettingsProvider'
import { getStore } from '@/lib/db'
import type { CalendarLinkSetting, UserSettings } from '@/lib/db/types'
import { COLOR_SWATCHES, errorMessage, uid } from '@/lib/utils'
import { importTarget } from '@/server/calendarProxy'
import { Button } from '@/components/ui/Button'
import { confirm } from '@/components/ui/Dialog'
import { Field, Input, Switch } from '@/components/ui/Field'
import { Panel } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import { feedUrl, fetchCalendar } from './useExternalCalendars'

/** 32 random bytes as base64url: the secret part of the feed address. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  } catch {
    toast.error('Could not copy. Select the address and copy it by hand.')
  }
}

export function CalendarLinksPanel() {
  const { user, mode } = useAuth()
  const { settings } = useSettings()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const links = settings.calendar_links ?? []
  const token = settings.calendar_feed_token ?? null

  /** Save to the server first so a missing database update shows as an error instead of a silent no-op. */
  const save = async (patch: Partial<UserSettings>, done?: string) => {
    if (!user) return false
    setBusy(true)
    try {
      const saved = await getStore().update('user_settings', user.id, patch as never)
      qc.setQueryData(['user_settings', 'one', user.id], (prev: UserSettings | undefined) => ({ ...(prev ?? settings), ...saved }))
      if (done) toast.success(done)
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (mode !== 'supabase') {
    return (
      <Panel id="google-calendar" title="Google Calendar">
        <p className="text-sm text-muted">Calendar links need sync (Supabase). Local mode keeps everything in this browser.</p>
      </Panel>
    )
  }

  const add = async () => {
    const target = importTarget(url)
    if (!target) return toast.error('Paste the "Secret address in iCal format" from Google Calendar (it starts with https://calendar.google.com/).')
    if (links.some((l) => l.url === target.href)) return toast.info('That calendar is already added.')
    setBusy(true)
    try {
      await fetchCalendar(target.href)
    } catch (e) {
      setBusy(false)
      return toast.error(errorMessage(e))
    }
    const link: CalendarLinkSetting = { id: uid(), name: name.trim() || 'Google Calendar', url: target.href, color: COLOR_SWATCHES[(links.length + 1) % COLOR_SWATCHES.length], enabled: true }
    if (await save({ calendar_links: [...links, link] }, 'Calendar added. Its events now show in Calendar.')) {
      setName('')
      setUrl('')
    }
  }

  const setLink = (id: string, patch: Partial<CalendarLinkSetting>) => save({ calendar_links: links.map((l) => (l.id === id ? { ...l, ...patch } : l)) })

  return (
    <section id="calendar-links">
      <Panel id="google-calendar" title="Google Calendar">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Show your plans in Google Calendar</h3>
            <p className="text-sm text-muted">
              Your events and dated tasks as a calendar Google can subscribe to. Google refreshes it on its own schedule, usually every few hours, so new changes take a while to appear there.
            </p>
            {token ? (
              <>
                <div className="flex gap-2">
                  <Input readOnly value={feedUrl(token)} aria-label="Calendar address" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" aria-label="Copy address" onClick={() => void copy(feedUrl(token))}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <ol className="list-decimal pl-5 text-sm text-muted">
                  <li>Open Google Calendar on a computer (calendar.google.com).</li>
                  <li>Next to “Other calendars”, click + and choose “From URL”.</li>
                  <li>Paste the address and click “Add calendar”. It then shows on your phone too.</li>
                </ol>
                <p className="text-xs text-muted">Anyone with this address can see your plans. If it leaks, reset it and add the new one to Google.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await confirm({ title: 'Reset the address?', message: 'The old address stops working. You will need to add the new one to Google Calendar.', confirmLabel: 'Reset' }))
                        void save({ calendar_feed_token: newToken() }, 'New address ready')
                    }}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden /> Reset address
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ calendar_feed_token: null }, 'Calendar sharing turned off')}>
                    Turn off
                  </Button>
                </div>
              </>
            ) : (
              <Button className="self-start" loading={busy} onClick={() => void save({ calendar_feed_token: newToken() })}>
                Create calendar address
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Show Google Calendar in this app</h3>
            <p className="text-sm text-muted">
              Google’s events appear in Calendar here, read-only. In Google Calendar on a computer: Settings → pick your calendar → “Integrate calendar” → copy “Secret address in iCal format”.
            </p>
            {links.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
                <Switch checked={l.enabled} onChange={(v) => void setLink(l.id, { enabled: v })} label="Show" />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${l.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `Remove ${l.name}?`, message: 'Its events stop showing here. Nothing changes in Google Calendar.', confirmLabel: 'Remove', danger: true }))
                      void save({ calendar_links: links.filter((x) => x.id !== l.id) }, 'Calendar removed')
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="grid gap-2 md:grid-cols-[10rem_1fr_auto] md:items-end">
              <Field label="Calendar name" htmlFor="cl-name">
                <Input id="cl-name" placeholder="College" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
              </Field>
              <Field label="Secret address in iCal format" htmlFor="cl-url">
                <Input id="cl-url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Button onClick={() => void add()} loading={busy} disabled={!url.trim() || links.length >= 10}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </section>
  )
}
