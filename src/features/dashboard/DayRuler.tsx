import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '@/settings/SettingsProvider'
import { dayWindow } from '@/features/planner/logic'
import { freeToday } from '@/features/coach/logic'
import { formatInstant, formatTime } from '@/lib/dates'
import { formatMinutes, plural } from '@/lib/utils'
import { linkTo } from '@/lib/links'
import { rulerPos, rulerSpan } from './ruler'

export interface RulerItem {
  key: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  color: string | null
  kind: 'event' | 'block' | 'task'
}

/** Today's waking hours as one strip: what's booked, where now is, and how much is still free. */
export function DayRuler({ items }: { items: RulerItem[] }) {
  const { settings, tz, today } = useSettings()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const { dayStart, dayEnd } = dayWindow(today, settings.day_start_hour, settings.day_end_hour, tz)
  const time = (d: Date) => formatTime(d, tz, settings.time_format)
  const timed = items.filter((i) => !i.allDay)
  // Same busy time as the Coach (events and blocks), so both pages agree on what's free.
  const free = freeToday(timed.filter((i) => i.kind !== 'task'), dayStart, dayEnd, now).minutes

  const status =
    now < dayStart
      ? `Your day starts at ${time(dayStart)}`
      : now >= dayEnd
        ? 'Day done'
        : `Now ${time(now)} · ${free ? `${formatMinutes(free)} free` : 'no free time left'} before ${time(dayEnd)}`

  const hours = Math.round((dayEnd.getTime() - dayStart.getTime()) / 3_600_000)
  const step = hours <= 12 ? 2 : hours <= 18 ? 3 : 4
  const labels = Array.from({ length: Math.floor(hours / step) + 1 }, (_, i) => new Date(dayStart.getTime() + i * step * 3_600_000))
  const nowAt = rulerPos(now, dayStart, dayEnd)
  const live = now >= dayStart && now < dayEnd

  return (
    <Link
      to={linkTo.planner(today)}
      aria-label={`Today ${time(dayStart)} to ${time(dayEnd)}, ${plural(timed.length, 'item')} scheduled. ${status}. Open day plan.`}
      className="group mb-6 block rounded-xl"
    >
      <div aria-hidden>
        <div className="relative h-9">
          <div
            className="absolute inset-0 overflow-hidden rounded-lg border border-line bg-surface transition-colors group-hover:border-muted/40"
            style={{ backgroundImage: `repeating-linear-gradient(to right, rgb(var(--line)) 0 1px, transparent 1px ${100 / hours}%)` }}
          >
            {timed.map((i) => {
              const s = rulerSpan(i.start, i.end, dayStart, dayEnd)
              if (!s) return null
              return (
                <span
                  key={i.key}
                  title={`${time(i.start)} ${i.title}`}
                  className="absolute inset-y-1.5 rounded-[5px] opacity-90"
                  style={{ left: `${s.left}%`, width: `max(${s.width}%, 3px)`, background: i.color ?? (i.kind === 'block' ? 'rgb(var(--warning))' : 'rgb(var(--accent) / 0.4)') }}
                />
              )
            })}
            <span className="absolute inset-y-0 left-0 bg-surface/60" style={{ width: `${nowAt}%` }} />
          </div>
          {live && (
            <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-accent" style={{ left: `${nowAt}%` }}>
              <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-accent" />
            </span>
          )}
        </div>
        <div className="tabular relative mt-1 h-4 text-xs text-muted">
          {labels.map((d, i) => {
            const left = rulerPos(d, dayStart, dayEnd)
            return (
              <span key={i} className="absolute" style={{ left: `${left}%`, transform: `translateX(-${left}%)` }}>
                {formatInstant(d, tz, settings.time_format === 'HH:mm' ? 'HH' : 'ha')}
              </span>
            )
          })}
        </div>
      </div>
      <p className="mt-1.5 text-sm text-muted">{status}</p>
    </Link>
  )
}
