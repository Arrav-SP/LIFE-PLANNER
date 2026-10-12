import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/env', () => ({
  env: { supabaseUrl: 'https://abcd.supabase.co', supabaseKey: 'pk', vapidPublicKey: '', mode: 'supabase' },
}))

const auth = {
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
}
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth }) }))
vi.mock('@/lib/db', () => ({ getOfflineStore: () => null }))

const { AuthProvider, useAuth } = await import('./AuthProvider')

function Who() {
  const { ready, user } = useAuth()
  return <p>{ready ? (user ? `user:${user.id}` : 'signed out') : 'loading'}</p>
}

describe('AuthProvider offline', () => {
  it('keeps the saved user when the session cannot be refreshed offline', async () => {
    localStorage.setItem('sb-abcd-auth-token', JSON.stringify({ access_token: 'x', user: { id: 'u-1', email: 'a@b.c' } }))
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    )
    expect(await screen.findByText('user:u-1')).toBeInTheDocument()
  })

  it('shows the sign-in screen when there is no saved session', async () => {
    localStorage.clear()
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    )
    expect(await screen.findByText('signed out')).toBeInTheDocument()
  })
})
