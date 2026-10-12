import { Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { LoginPage, ResetPasswordPage } from '@/auth/LoginPage'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { AppShell } from '@/components/layout/AppShell'
import { Toaster } from '@/components/ui/toast'
import { ConfirmHost } from '@/components/ui/Dialog'
import { ListSkeleton } from '@/components/ui/misc'
import { useReminderEngine } from '@/features/reminders/ReminderCenter'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineSync } from '@/features/offline/OfflineSync'
import { PAGES } from './pages'

export const queryClient = new QueryClient({
  defaultOptions: {
    // 'always': without internet the store answers from this device's copy, so never pause.
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1, networkMode: 'always' },
    mutations: { retry: 0, networkMode: 'always' },
  },
})

function Engine() {
  useReminderEngine()
  return null
}

function Gate({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth()
  if (!ready)
    return (
      <div className="mx-auto max-w-md p-10">
        <ListSkeleton rows={3} />
      </div>
    )
  if (!user) return <LoginPage />
  return (
    <SettingsProvider>
      <Engine />
      <OfflineSync />
      {children}
    </SettingsProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="*"
              element={
                <Gate>
                  <AppShell>
                    <ErrorBoundary>
                      <Suspense fallback={<ListSkeleton rows={5} />}>
                        <Routes>
                          {PAGES.map((p) => (
                            <Route key={p.path} path={p.path} element={<p.Component />} />
                          ))}
                          <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                      </Suspense>
                    </ErrorBoundary>
                  </AppShell>
                </Gate>
              }
            />
          </Routes>
        </BrowserRouter>
        <Toaster />
        <ConfirmHost />
      </AuthProvider>
    </QueryClientProvider>
  )
}


