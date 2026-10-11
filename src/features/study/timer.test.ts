import { activeMs, focusMinutes, pause, pomodoro, resume, type TimerState } from './timer'

const base: TimerState = { sessionId: 's', mode: 'pomodoro', startedAt: 0, pausedAt: null, pausedMs: 0, workMinutes: 25, breakMinutes: 5, plannedMinutes: null }
const min = 60000

describe('focus timer', () => {
  it('excludes paused time', () => {
    let s = pause(base, 10 * min)
    expect(activeMs(s, 20 * min)).toBe(10 * min)
    s = resume(s, 20 * min)
    expect(activeMs(s, 25 * min)).toBe(15 * min)
  })

  it('derives pomodoro phases from elapsed time', () => {
    expect(pomodoro(base, 10 * min)).toMatchObject({ phase: 'work', completed: 0, remainingMs: 15 * min })
    expect(pomodoro(base, 27 * min)).toMatchObject({ phase: 'break', completed: 1, remainingMs: 3 * min })
    expect(pomodoro(base, 31 * min)).toMatchObject({ phase: 'work', completed: 1 })
  })

  it('counts only work time for pomodoro sessions', () => {
    expect(focusMinutes(base, 60 * min)).toBe(50)
    expect(focusMinutes({ ...base, mode: 'timer' }, 60 * min)).toBe(60)
  })
})
