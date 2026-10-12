import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { listenForInstall } from '@/lib/install'
import { InstallButton } from './InstallButton'

listenForInstall()

function firePrompt(outcome: 'accepted' | 'dismissed') {
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  })
  act(() => {
    window.dispatchEvent(e)
  })
  return e
}

describe('InstallButton', () => {
  it('shows install steps when the browser offers no prompt', async () => {
    render(<InstallButton variant="sidebar" />)
    await userEvent.click(screen.getByRole('button', { name: 'Install app' }))
    expect(screen.getByRole('dialog', { name: 'Install Life Planner' })).toBeVisible()
    expect(screen.getByText(/Install app/, { selector: 'b' })).toBeInTheDocument()
  })

  it('uses the browser prompt when available and hides once installed', async () => {
    render(<InstallButton variant="icon" />)
    const e = firePrompt('accepted')
    expect(e.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Install app' }))
    expect(e.prompt).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
