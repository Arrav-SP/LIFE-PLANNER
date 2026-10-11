import { render, screen } from '@testing-library/react'
import { ProgressBar } from './misc'

describe('ProgressBar', () => {
  it('treats value as a 0–1 ratio', () => {
    render(<ProgressBar value={0.6} label="Half-ish" />)
    const bar = screen.getByRole('progressbar', { name: 'Half-ish' })
    expect(bar).toHaveAttribute('aria-valuenow', '60')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('60%')
  })
  it('clamps out-of-range and invalid values', () => {
    render(<ProgressBar value={1.7} label="Over" />)
    render(<ProgressBar value={NaN} label="Empty" />)
    expect(screen.getByRole('progressbar', { name: 'Over' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('progressbar', { name: 'Empty' })).toHaveAttribute('aria-valuenow', '0')
  })
})
