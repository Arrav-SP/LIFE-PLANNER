import { BarChart3, BookOpen, CalendarDays, CheckSquare, Dumbbell, Flag, Home, Inbox, Repeat, Sparkles, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  group: 'main' | 'track' | 'review'
  /** Can be hidden from the menu in Settings (for trackers someone doesn't use). */
  optional?: boolean
}

// Merged pages live as tabs or views: the planner is Calendar's Day view, Projects
// are in Goals, Analytics is Review's Trends tab. Reminders open from the bell,
// Search from its icon or Ctrl+K, Settings from the gear.
export const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: Home, group: 'main' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, group: 'main' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, group: 'main' },
  { to: '/inbox', label: 'Inbox & notes', icon: Inbox, group: 'main' },
  { to: '/coach', label: 'Coach', icon: Sparkles, group: 'main' },
  { to: '/habits', label: 'Habits', icon: Repeat, group: 'track', optional: true },
  { to: '/goals', label: 'Goals', icon: Flag, group: 'track' },
  { to: '/study', label: 'Study', icon: BookOpen, group: 'track', optional: true },
  { to: '/fitness', label: 'Fitness', icon: Dumbbell, group: 'track', optional: true },
  { to: '/review', label: 'Review', icon: BarChart3, group: 'review' },
]

export const MOBILE_TABS = ['/', '/tasks', '/calendar', '/habits']
