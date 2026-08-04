"use client"

type Option = { value: string; label: string }

export function OptionRow({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: readonly Option[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1.5"
        data-disabled={disabled ? "true" : undefined}
      >
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={[
                "rounded-md border px-3 py-1.5 font-mono text-xs transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-40",
                active
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface-2 text-muted hover:text-foreground",
              ].join(" ")}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
