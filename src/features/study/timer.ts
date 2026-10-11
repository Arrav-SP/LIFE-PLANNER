/**
 * Focus timer maths. Everything is derived from timestamps, never from
 * counting ticks, so the timer stays correct across refreshes, sleep and
 * background tabs.
 */
export interface TimerState {
  sessionId: string
  mode: 'timer' | 'pomodoro'
  startedAt: number
  /** When paused, the moment the pause began. */
  pausedAt: number | null
  /** Total paused time before the current pause, in ms. */
  pausedMs: number
  workMinutes: number
  breakMinutes: number
  plannedMinutes: number | null
}

/** Active (unpaused) milliseconds so far. */
export function activeMs(s: TimerState, now: number): number {
  const end = s.pausedAt ?? now
  return Math.max(0, end - s.startedAt - s.pausedMs)
}

export interface PomodoroStatus {
  phase: 'work' | 'break'
  /** ms left in the current phase */
  remainingMs: number
  completed: number
  /** Active work time, excluding breaks */
  workMs: number
}

export function pomodoro(s: TimerState, now: number): PomodoroStatus {
  const t = activeMs(s, now)
  const work = s.workMinutes * 60000
  const brk = s.breakMinutes * 60000
  const cycle = work + brk
  const cycles = Math.floor(t / cycle)
  const into = t - cycles * cycle
  const inWork = into < work
  return {
    phase: inWork ? 'work' : 'break',
    remainingMs: inWork ? work - into : cycle - into,
    completed: cycles + (inWork ? 0 : 1),
    workMs: cycles * work + Math.min(into, work),
  }
}

export function pause(s: TimerState, now: number): TimerState {
  return s.pausedAt ? s : { ...s, pausedAt: now }
}

export function resume(s: TimerState, now: number): TimerState {
  return s.pausedAt ? { ...s, pausedMs: s.pausedMs + (now - s.pausedAt), pausedAt: null } : s
}

/** Minutes to record when the session ends. Pomodoro counts work time only. */
export function focusMinutes(s: TimerState, now: number): number {
  const ms = s.mode === 'pomodoro' ? pomodoro(s, now).workMs : activeMs(s, now)
  return Math.round(ms / 60000)
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const KEY = 'lp-focus-timer'

export function loadTimer(): TimerState | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? (JSON.parse(v) as TimerState) : null
  } catch {
    return null
  }
}

export function saveTimer(s: TimerState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable; the open session row still records the start */
  }
}
