import { describe, expect, it, vi, afterEach } from 'vitest'
import { inQuietHours, notificationPermission, showBrowserNotification } from './notify'

describe('quiet hours', () => {
  it('handles same-day and overnight ranges', () => {
    expect(inQuietHours({ quiet_hours_start: '13:00', quiet_hours_end: '14:00' }, 13 * 60 + 30)).toBe(true)
    expect(inQuietHours({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' }, 23 * 60)).toBe(true)
    expect(inQuietHours({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' }, 6 * 60 + 59)).toBe(true)
    expect(inQuietHours({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' }, 7 * 60)).toBe(false)
    expect(inQuietHours({ quiet_hours_start: null, quiet_hours_end: null }, 0)).toBe(false)
  })
})

describe('browser notifications', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reports unsupported when the API is missing', () => {
    expect(notificationPermission()).toBe('unsupported')
  })
  it('does not notify when permission is denied', async () => {
    const ctor = vi.fn()
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'denied' }))
    expect(notificationPermission()).toBe('denied')
    expect(await showBrowserNotification('t', 'b', '/', 'x')).toBe(false)
    expect(ctor).not.toHaveBeenCalled()
  })
  it('notifies when granted', async () => {
    const ctor = vi.fn()
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'granted' }))
    expect(await showBrowserNotification('t', 'b', '/', 'x')).toBe(true)
    expect(ctor).toHaveBeenCalledOnce()
  })
})
