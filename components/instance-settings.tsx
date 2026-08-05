"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, ChevronDown, Loader2, Server, XCircle } from "lucide-react"

const STORAGE_URL = "opendownload.instance.url"
const STORAGE_KEY = "opendownload.instance.key"

export type InstanceConfig = { url: string; apiKey: string }

type Status = { tone: "ok" | "fail"; text: string } | null

export function InstanceSettings({
  config,
  onChange,
}: {
  config: InstanceConfig
  onChange: (next: InstanceConfig) => void
}) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  // Читаем сохранённые настройки после монтирования, чтобы не ломать гидрацию.
  useEffect(() => {
    const url = window.localStorage.getItem(STORAGE_URL) ?? ""
    const apiKey = window.localStorage.getItem(STORAGE_KEY) ?? ""
    if (url || apiKey) onChange({ url, apiKey })
    else setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(next: InstanceConfig) {
    onChange(next)
    window.localStorage.setItem(STORAGE_URL, next.url)
    window.localStorage.setItem(STORAGE_KEY, next.apiKey)
    setStatus(null)
  }

  async function check() {
    setChecking(true)
    setStatus(null)
    try {
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance: config.url, apiKey: config.apiKey }),
      })
      const data = await response.json()
      setStatus(
        data.ok
          ? { tone: "ok", text: `Работает: cobalt ${data.version}, сервисов ${data.services}.` }
          : { tone: "fail", text: data.message ?? "Инстанс не отвечает." },
      )
    } catch {
      setStatus({ tone: "fail", text: "Не удалось выполнить проверку." })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="rounded-[var(--radius)] border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <Server className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Настройки инстанса</span>
        <span className="truncate font-mono text-[11px] text-foreground">
          {config.url ? config.url.replace(/^https?:\/\//, "") : "не задан"}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t p-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="instance-url" className="font-mono text-[11px] text-muted">
              Адрес сервера cobalt
            </label>
            <input
              id="instance-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={config.url}
              onChange={(event) => update({ ...config, url: event.target.value })}
              placeholder="https://cobalt.example.com"
              className="w-full rounded-lg border bg-surface-2 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="instance-key" className="font-mono text-[11px] text-muted">
              API-ключ — только если инстанс его требует
            </label>
            <input
              id="instance-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={config.apiKey}
              onChange={(event) => update({ ...config, apiKey: event.target.value })}
              placeholder="можно оставить пустым"
              className="w-full rounded-lg border bg-surface-2 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
            />
          </div>

          <button
            type="button"
            onClick={check}
            disabled={checking || !config.url.trim()}
            className="flex items-center justify-center gap-2 rounded-lg border border-accent px-3 py-2.5 font-mono text-xs uppercase tracking-widest text-accent disabled:opacity-40"
          >
            {checking && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {checking ? "Проверяем" : "Проверить связь"}
          </button>

          {status && (
            <p
              className={`flex items-start gap-2 text-xs ${status.tone === "ok" ? "text-accent" : "text-danger"}`}
              role="status"
              aria-live="polite"
            >
              {status.tone === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="text-pretty">{status.text}</span>
            </p>
          )}

          <p className="text-pretty font-mono text-[11px] leading-relaxed text-muted">
            Настройки хранятся только в вашем браузере. Как поднять бесплатный инстанс за пару минут — в README.md
            (Docker + Cloudflare Tunnel, без VPS и без оплаты).
          </p>
        </div>
      )}
    </div>
  )
}
