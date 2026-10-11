import { Component, type ReactNode } from 'react'
import { Button } from './ui/Button'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    const chunk = /dynamically imported module|Loading chunk/i.test(this.state.error.message)
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="font-semibold">{chunk ? 'A newer version of the app is available.' : 'This page hit an error.'}</p>
        <p className="mt-1 text-sm text-muted">{chunk ? 'Reload to continue.' : this.state.error.message}</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}
