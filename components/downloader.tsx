"use client"

import { useMemo, useState } from "react"
import { AlertCircle, ArrowDownToLine, AudioLines, CheckCircle2, Link2, Loader2, Music4, Video } from "lucide-react"
import { OptionRow } from "@/components/option-row"
import { detectService, isValidUrl } from "@/lib/services"
import { useTelegram } from "@/lib/use-telegram"

type Mode = "video" | "audio"

type Format = {
  id: string
  kind: Mode
  label: string
  detail: string
  ext: string
  needsMux: boolean
  height?: number
  bitrate?: number
  size?: number
}

type MediaInfo = {
  title: string
  uploader?: string
  duration?: number
  thumbnail?: string
  extractor: string
  isLive: boolean
  video: Format[]
  audio: Format[]
}

type Result = { info: MediaInfo; canMux: boolean; service: string; url: string }

type Feedback = { tone: "error" | "success" | "info"; text: string } | null

/** Целевой контейнер аудио: пустая строка — оставить исходный кодек. */
const AUDIO_TARGETS = [
  { value: "", label: "Как в источнике" },
  { value: "mp3", label: "MP3 320" },
  { value: "opus", label: "Opus" },
  { value: "flac", label: "FLAC" },
  { value: "wav", label: "WAV" },
]

function formatDuration(seconds?: number) {
  if (!seconds) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const pad = (value: number) => String(value).padStart(2, "0")
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function Downloader() {
  const { isTelegram, saveFile, haptic } = useTelegram()

  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<Mode>("video")
  const [audioTarget, setAudioTarget] = useState("mp3")
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [result, setResult] = useState<Result | null>(null)

  const service = useMemo(() => (url.trim() ? detectService(url) : null), [url])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return

    if (!isValidUrl(url)) {
      setResult(null)
      setFeedback({ tone: "error", text: "Введите корректную ссылку, например https://youtu.be/..." })
      haptic("error")
      return
    }

    setLoading(true)
    setResult(null)
    setFeedback({ tone: "info", text: "Читаем ссылку и собираем форматы..." })
    haptic("tap")

    try {
      const response = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await response.json()

      if (!response.ok || !data.ok) {
        setFeedback({ tone: "error", text: data.message ?? "Не удалось обработать ссылку." })
        haptic("error")
        return
      }

      const info = data.info as MediaInfo
      setResult({ info, canMux: data.canMux, service: data.service, url: url.trim() })
      setMode(info.video.length > 0 ? "video" : "audio")

      if (info.isLive) {
        setFeedback({ tone: "info", text: "Это прямой эфир: запись пойдёт с текущего момента, остановите её вручную." })
      } else if (!data.canMux) {
        setFeedback({
          tone: "info",
          text: "ffmpeg недоступен: качества с отдельной звуковой дорожкой и конвертация выключены.",
        })
      } else {
        setFeedback({ tone: "success", text: "Форматы готовы — выберите нужный." })
      }
      haptic("success")
    } catch {
      setFeedback({ tone: "error", text: "Сеть недоступна. Попробуйте ещё раз." })
      haptic("error")
    } finally {
      setLoading(false)
    }
  }

  function startDownload(format: Format) {
    if (!result) return
    haptic("tap")
    setBusyId(format.id)

    const params = new URLSearchParams({
      url: result.url,
      format: format.id,
      ext: format.ext,
      title: result.info.title,
    })
    if (format.kind === "audio" && audioTarget) params.set("audioFormat", audioTarget)

    const ext = format.kind === "audio" && audioTarget ? audioTarget : format.ext
    // Сервер собирает файл на ходу и отдаёт его потоком с Content-Disposition.
    saveFile(`/api/download?${params.toString()}`, `${result.info.title}.${ext}`)

    setFeedback({
      tone: "success",
      text: isTelegram ? "Файл готов — подтвердите загрузку в Telegram." : "Загрузка началась. Большие файлы собираются на ходу.",
    })
    setTimeout(() => setBusyId(null), 2500)
  }

  const formats = result ? (mode === "video" ? result.info.video : result.info.audio) : []

  return (
    <section className="flex w-full max-w-md flex-col gap-4">
      {/* Ввод ссылки */}
      <form onSubmit={handleSubmit} className="relative overflow-hidden rounded-[var(--radius)] border bg-surface">
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 p-4">
          <label htmlFor="media-url" className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <Link2 className="size-3.5" aria-hidden="true" />
            Ссылка на медиа
          </label>
          <input
            id="media-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full rounded-lg border bg-surface-2 px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
          />

          {service && (
            <p className="font-mono text-[11px] text-muted">
              Определён источник: <span className="text-foreground">{service.label}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowDownToLine className="size-4" aria-hidden="true" />
            )}
            {loading ? "Читаем" : "Показать форматы"}
          </button>
        </div>
      </form>

      {/* Статус */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "flex items-start gap-2 rounded-[var(--radius)] border p-3 text-sm",
            feedback.tone === "error" ? "border-danger/40 text-danger" : "border-border text-muted",
          ].join(" ")}
        >
          {feedback.tone === "error" ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : feedback.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <span className="mt-1 flex h-3.5 items-end gap-0.5" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <span key={index} className="bar block w-0.5 bg-accent" style={{ height: "100%", animationDelay: `${index * 0.15}s` }} />
              ))}
            </span>
          )}
          <span className="text-pretty">{feedback.text}</span>
        </div>
      )}

      {/* Найденная запись */}
      {result && (
        <div className="flex flex-col gap-4 rounded-[var(--radius)] border bg-surface p-4">
          <div className="flex gap-3">
            {result.info.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.info.thumbnail || "/placeholder.svg"}
                alt=""
                crossOrigin="anonymous"
                className="h-16 w-24 shrink-0 rounded-lg border object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{result.info.title}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted">
                {[result.info.uploader, formatDuration(result.info.duration), result.service].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {/* Видео / Аудио */}
          <div className="flex gap-1.5" role="tablist" aria-label="Тип файла">
            {(
              [
                { value: "video", label: "Видео", icon: Video, count: result.info.video.length },
                { value: "audio", label: "Аудио", icon: Music4, count: result.info.audio.length },
              ] as const
            ).map((item) => {
              const active = mode === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={item.count === 0}
                  onClick={() => setMode(item.value)}
                  className={[
                    "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface-2 text-muted",
                  ].join(" ")}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              )
            })}
          </div>

          {mode === "audio" && result.info.audio.length > 0 && (
            <OptionRow
              label="Конвертировать в"
              options={AUDIO_TARGETS.map((target) => ({
                ...target,
                disabled: target.value !== "" && !result.canMux,
              }))}
              value={audioTarget}
              onChange={setAudioTarget}
            />
          )}

          {/* Список форматов */}
          <ul className="flex flex-col gap-2">
            {formats.map((format) => {
              const blocked = format.needsMux && !result.canMux
              const busy = busyId === format.id
              const converting = format.kind === "audio" && Boolean(audioTarget)
              const ext = converting ? audioTarget : format.ext
              return (
                <li key={format.id}>
                  <button
                    type="button"
                    disabled={blocked || busy}
                    onClick={() => startDownload(format)}
                    className="flex w-full items-center gap-3 rounded-lg border bg-surface-2 px-3 py-3 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-muted">
                      {format.kind === "video" ? (
                        <Video className="size-4" aria-hidden="true" />
                      ) : (
                        <AudioLines className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        {format.label}
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{ext}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
                        {blocked
                          ? "нужен ffmpeg на сервере"
                          : converting
                            ? // При перекодировке размер исходника — только ориентир.
                              `источник ${format.detail}`
                            : format.detail || "размер неизвестен"}
                      </span>
                    </span>
                    {busy ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
                    ) : (
                      <ArrowDownToLine className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {formats.length === 0 && (
            <p className="font-mono text-[11px] text-muted">В этой категории для ссылки нет доступных форматов.</p>
          )}
        </div>
      )}

      {!result && !loading && (
        <p className="text-center font-mono text-[11px] leading-relaxed text-muted">
          {isTelegram
            ? "Вставьте ссылку — файл придёт прямо в чат."
            : "YouTube, TikTok, SoundCloud, Instagram, X, VK и ещё около двух тысяч сайтов."}
        </p>
      )}
    </section>
  )
}
