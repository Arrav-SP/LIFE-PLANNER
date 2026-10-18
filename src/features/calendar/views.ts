// Calendar's views. Day is the planner timeline (src/features/planner); the
// others are FullCalendar. The URL's ?view= picks one, so links can open a view.

export type CalView = 'month' | 'week' | 'day' | 'agenda'

export const CAL_VIEWS: { value: CalView; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
]

export type FcView = 'dayGridMonth' | 'timeGridWeek' | 'listWeek'

export const FC_VIEW: Record<Exclude<CalView, 'day'>, FcView> = { month: 'dayGridMonth', week: 'timeGridWeek', agenda: 'listWeek' }

export const calView = (fc: FcView): CalView => (fc === 'dayGridMonth' ? 'month' : fc === 'listWeek' ? 'agenda' : 'week')

export const isCalView = (v: string | null): v is CalView => CAL_VIEWS.some((o) => o.value === v)
