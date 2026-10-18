import { useSearchParams } from 'react-router-dom'
import { PlannerPage } from '@/features/planner/PlannerPage'
import { CalendarPage } from './CalendarPage'

/** /calendar: the Day view is the planner timeline, every other view is the calendar. */
export function CalendarHub() {
  const [params] = useSearchParams()
  return params.get('view') === 'day' ? <PlannerPage /> : <CalendarPage />
}
