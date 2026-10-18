import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadOnUpdate } from './pwa'

function fakeContainer(controlled: boolean) {
  const target = new EventTarget()
  return {
    controller: (controlled ? {} : null) as ServiceWorker | null,
    addEventListener: target.addEventListener.bind(target) as ServiceWorkerContainer['addEventListener'],
    takeOver: () => target.dispatchEvent(new Event('controllerchange')),
  }
}

describe('reloadOnUpdate', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reloads once when a new deploy takes over', () => {
    const sw = fakeContainer(true)
    const reload = vi.fn()
    reloadOnUpdate(sw, reload)
    sw.takeOver()
    sw.takeOver()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload on the very first install, only on the next update', () => {
    const sw = fakeContainer(false)
    const reload = vi.fn()
    reloadOnUpdate(sw, reload)
    sw.takeOver()
    expect(reload).not.toHaveBeenCalled()
    sw.takeOver()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('leaves an open dialog alone', () => {
    document.body.innerHTML = '<div role="dialog"></div>'
    const sw = fakeContainer(true)
    const reload = vi.fn()
    reloadOnUpdate(sw, reload)
    sw.takeOver()
    expect(reload).not.toHaveBeenCalled()
  })
})
