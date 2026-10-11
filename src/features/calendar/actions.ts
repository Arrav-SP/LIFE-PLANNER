import { useCallback } from 'react'
import { getStore } from '@/lib/db'
import { eq, type Insert } from '@/lib/db/store'
import { useInvalidate } from '@/lib/db/hooks'
import { toast } from '@/components/ui/toast'
import { confirm } from '@/components/ui/Dialog'
import { errorMessage } from '@/lib/utils'
import { useSettings } from '@/settings/SettingsProvider'
import { syncEventReminders } from '@/features/reminders/sync'
import type { CalendarEvent, EventOverride } from '@/lib/db/types'
import type { EventInstance } from './logic'

export type Scope = 'one' | 'all'

export function useEventActions() {
  const { tz } = useSettings()
  const invalidate = useInvalidate()

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | null> => {
      try {
        const r = await fn()
        if (success) toast.success(success)
        return r
      } catch (e) {
        toast.error(errorMessage(e))
        return null
      } finally {
        invalidate('events')
      }
    },
    [invalidate],
  )

  const create = useCallback(
    (values: Partial<CalendarEvent>) =>
      run(async () => {
        const ev = await getStore().insert('events', { timezone: tz, ...values } as Insert<'events'>)
        await syncEventReminders(ev, tz)
        return ev
      }, 'Event added'),
    [run, tz],
  )

  const update = useCallback(
    (ev: CalendarEvent, values: Partial<CalendarEvent>, msg = 'Event saved') =>
      run(async () => {
        const saved = await getStore().update('events', ev.id, values)
        await syncEventReminders(saved, tz)
        return saved
      }, msg),
    [run, tz],
  )

  /** Change a single occurrence of a recurring event. */
  const overrideOccurrence = useCallback(
    (inst: EventInstance, override: EventOverride, msg = 'This event updated') =>
      run(async () => {
        const merged = { ...(inst.exception?.override ?? {}), ...override }
        await getStore().upsert('event_exceptions', { event_id: inst.event.id, occurrence_start: inst.originalStart, cancelled: false, override: merged }, ['event_id', 'occurrence_start'])
        await syncEventReminders(inst.event, tz)
      }, msg),
    [run, tz],
  )

  const remove = useCallback(
    async (inst: EventInstance | { event: CalendarEvent }, scope: Scope) => {
      if (scope === 'one' && 'originalStart' in inst && inst.recurring) {
        return run(async () => {
          await getStore().upsert('event_exceptions', { event_id: inst.event.id, occurrence_start: inst.originalStart, cancelled: true, override: {} }, ['event_id', 'occurrence_start'])
          await syncEventReminders(inst.event, tz)
        }, 'Event removed from this day')
      }
      const ok = await confirm({
        title: inst.event.recurrence ? 'Delete the whole series?' : 'Delete this event?',
        message: inst.event.recurrence ? `Every occurrence of “${inst.event.title}” will be deleted.` : `“${inst.event.title}” will be permanently deleted.`,
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return null
      return run(async () => {
        await getStore().removeWhere('reminders', [eq('source_type', 'event'), eq('source_id', inst.event.id)])
        await getStore().remove('events', inst.event.id)
      }, 'Event deleted')
    },
    [run, tz],
  )

  /** Move or resize an instance (from drag and drop). */
  const move = useCallback(
    (inst: EventInstance, start: Date, end: Date, allDay: boolean) => {
      if (inst.recurring) return overrideOccurrence(inst, { start_at: start.toISOString(), end_at: end.toISOString(), all_day: allDay }, 'Moved this occurrence')
      return update(inst.event, { start_at: start.toISOString(), end_at: end.toISOString(), all_day: allDay }, 'Event moved')
    },
    [overrideOccurrence, update],
  )

  return { create, update, overrideOccurrence, remove, move }
}
