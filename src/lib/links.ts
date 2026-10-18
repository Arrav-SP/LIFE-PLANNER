// One place for the in-app addresses of each kind of item, so every page links
// to things the same way. Each page reads its own parameter and opens the item.

import type { DateKey } from './db/types'

export const linkTo = {
  task: (id: string) => `/tasks?view=all&task=${id}`,
  event: (id: string) => `/calendar?event=${id}`,
  calendarDay: (date: DateKey) => `/calendar?date=${date}`,
  planner: (date: DateKey, mode: 'day' | 'week' = 'day') => `/calendar?view=${mode}&date=${date}`,
  goal: (id: string) => `/goals?goal=${id}`,
  project: (id: string) => `/goals?tab=projects&project=${id}`,
  habit: (id: string) => `/habits?habit=${id}`,
  subject: (id: string) => `/study?subject=${id}`,
  note: (id: string) => `/inbox?note=${id}`,
  week: (weekStart: DateKey) => `/review?week=${weekStart}`,
}

/** Where a note's "Became a …" badge points, given what it was turned into. */
export function convertedLink(kind: string | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null
  if (kind === 'task') return linkTo.task(id)
  if (kind === 'event') return linkTo.event(id)
  if (kind === 'reminder') return '/reminders'
  return null
}
