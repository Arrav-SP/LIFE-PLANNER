import { COLOR_SWATCHES, cn } from '@/lib/utils'

export function ColorPicker({ value, onChange, label = 'Color' }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition', value === c ? 'ring-2 ring-fg' : 'hover:scale-110')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}
