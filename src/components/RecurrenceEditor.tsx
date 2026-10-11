import type { Recurrence, Weekday } from '@/lib/db/types'
import { describeRecurrence } from '@/lib/recurrence'
import { WEEKDAY_SHORT } from '@/lib/dates'
import { Field, Input, Select } from './ui/Field'
import { cn } from '@/lib/utils'

type Mode = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'

function modeOf(r: Recurrence | null): Mode {
  if (!r) return 'none'
  if (r.interval > 1) return 'custom'
  if (r.freq === 'daily') return 'daily'
  if (r.freq === 'weekly') {
    const d = r.byWeekday ?? []
    if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x as Weekday))) return 'weekdays'
    return d.length > 1 ? 'custom' : 'weekly'
  }
  if (r.freq === 'monthly') return r.byMonthDay ? 'custom' : 'monthly'
  return 'yearly'
}

export function RecurrenceEditor({ value, onChange, idPrefix = 'rec' }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void; idPrefix?: string }) {
  const mode = modeOf(value)
  const set = (m: Mode) => {
    const until = value?.until ?? null
    switch (m) {
      case 'none':
        return onChange(null)
      case 'daily':
        return onChange({ freq: 'daily', interval: 1, until })
      case 'weekdays':
        return onChange({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5], until })
      case 'weekly':
        return onChange({ freq: 'weekly', interval: 1, until })
      case 'monthly':
        return onChange({ freq: 'monthly', interval: 1, until })
      case 'yearly':
        return onChange({ freq: 'yearly', interval: 1, until })
      case 'custom':
        return onChange({ freq: 'weekly', interval: 1, byWeekday: value?.byWeekday?.length ? value.byWeekday : [1], until })
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <Field label="Repeat" htmlFor={`${idPrefix}-mode`}>
        <Select id={`${idPrefix}-mode`} value={mode} onChange={(e) => set(e.target.value as Mode)}>
          <option value="none">Does not repeat</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday (Mon–Fri)</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
          <option value="yearly">Every year</option>
          <option value="custom">Custom…</option>
        </Select>
      </Field>
      {mode === 'custom' && value && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Every" htmlFor={`${idPrefix}-interval`} className="w-20">
              <Input
                id={`${idPrefix}-interval`}
                type="number"
                min={1}
                max={365}
                value={value.interval}
                onChange={(e) => onChange({ ...value, interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              />
            </Field>
            <Field label="Unit" htmlFor={`${idPrefix}-freq`} className="flex-1">
              <Select
                id={`${idPrefix}-freq`}
                value={value.freq}
                onChange={(e) => {
                  const freq = e.target.value as Recurrence['freq']
                  onChange({ ...value, freq, byWeekday: freq === 'weekly' ? value.byWeekday ?? [1] : undefined, byMonthDay: freq === 'monthly' ? value.byMonthDay : undefined })
                }}
              >
                <option value="daily">days</option>
                <option value="weekly">weeks</option>
                <option value="monthly">months</option>
                <option value="yearly">years</option>
              </Select>
            </Field>
            {value.freq === 'monthly' && (
              <Field label="On day" htmlFor={`${idPrefix}-mday`} className="w-24">
                <Input
                  id={`${idPrefix}-mday`}
                  type="number"
                  min={1}
                  max={31}
                  value={value.byMonthDay ?? ''}
                  placeholder="Start"
                  onChange={(e) => onChange({ ...value, byMonthDay: e.target.value ? Math.max(1, Math.min(31, Number(e.target.value))) : undefined })}
                />
              </Field>
            )}
          </div>
          {value.freq === 'weekly' && (
            <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = value.byWeekday?.includes(d as Weekday)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const cur = value.byWeekday ?? []
                      const next = on ? cur.filter((x) => x !== d) : [...cur, d as Weekday]
                      onChange({ ...value, byWeekday: next.length ? next : cur })
                    }}
                    className={cn('h-9 w-11 rounded-lg border text-xs font-medium', on ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted hover:bg-surface-2')}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {value && (
        <Field label="Ends" htmlFor={`${idPrefix}-until`} hint={describeRecurrence(value)}>
          <Input id={`${idPrefix}-until`} type="date" value={value.until ?? ''} onChange={(e) => onChange({ ...value, until: e.target.value || null })} />
        </Field>
      )}
    </div>
  )
}
