"use client"

import { useMemo, useState } from "react"
import { AlertCircle, ArrowDownToLine, CheckCircle2, Link2, Loader2, Music4, Video } from "lucide-react"
import { type InstanceConfig, InstanceSettings } from "@/components/instance-settings"
import { OptionRow } from "@/components/option-row"
import { useTelegram } from "@/lib/use-telegram"
import {
  AUDIO_BITRATES,
  AUDIO_FORMATS,
  detectService,
  isValidUrl,
  VIDEO_CODECS,
  VIDEO_QUALITIES,
} from "@/lib/services"

type Mode = "video" | "audio"

type PickerItem = { type: string; url: string; thumb: string | null; filename: string }

type Result =
  | { kind: "file"; url: string; filename: string; service: string }
  | { kind: "picker"; items: PickerItem[]; audio: string | null; service: string }

type Feedback = { tone: "error" | "success" | "info"; text: string } | null

export function Downloader() {
  const { isTelegram, saveFile, haptic } = useTelegram()

  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<Mode>("video")
  const [videoQuality, setVideoQuality] = useState("1080")
  const [videoCodec, setVideoCodec] = useState("h264")
  const [audioFormat, setAudioFormat] = useState("mp3")
  const [audioBitrate, setAudioBitrate] = useState("320")
  const [instance, setInstance] = useState<InstanceConfig>({ url: "", apiKey: "" })
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [result, setResult] = useState<Result | null>(null)

  const service = useMemo(() => (url.trim() ? detectService(url) : null), [url])
  const audioOnlyService = service ? service.audio && !service.video : false
  const effectiveMode: Mode = audioOnlyService ? "audio" : mode

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
    setFeedback({ tone: "info", text: "Обрабатываем ссылку..." })
    haptic("tap")

    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          instance: instance.url,
          apiKey: instance.apiKey,
          downloadMode: effectiveMode === "audio" ? "audio" : "auto",
          videoQuality,
          youtubeVideoCodec: videoCodec,
          audioFormat,
          audioBitrate,
        }),
      })
      const data = await response.json()

      if (!response.ok || !data.ok) {
        setFeedback({ tone: "error", text: data.message ?? "Не удалось обработать ссылку." })
        haptic("error")
        return
      }

      if (data.kind === "picker") {
        setResult({ kind: "picker", items: data.items, audio: data.audio, service: data.service })
        setFeedback({ tone: "success", text: "Найдено несколько файлов — выберите нужные." })
        haptic("success")
        return
      }

      const file: Result = { kind: "file", url: data.url, filename: data.filename, service: data.service }
      setResult(file)
      const how = saveFile(file.url, file.filename)
      setFeedback({
        tone: "success",
        text:
          how === "telegram-native"
            ? "Файл готов — подтвердите загрузку в Telegram."
            : how === "telegram-browser"
              ? "Файл готов — загрузка открыта во внешнем браузере."
              : "Файл готов — загрузка началась.",
      })
      haptic("success")
    } catch {
      setFeedback({ tone: "error", text: "Сеть недоступна. Попробуйте ещё раз." })
      haptic("error")
    } finally {
      setLoading(false)
    }
  }

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

          {/* Режим */}
          <div className="flex gap-1.5">
            {(
              [
                { value: "video", label: "Видео", icon: Video },
                { value: "audio", label: "Аудио", icon: Music4 },
              ] as const
            ).map((item) => {
              const active = effectiveMode === item.value
              const disabled = item.value === "video" && audioOnlyService
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(item.value)}
                  aria-pressed={active}
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

          {/* Параметры */}
          {effectiveMode === "video" ? (
            <div className="flex flex-col gap-4">
              <OptionRow label="Качество" options={VIDEO_QUALITIES} value={videoQuality} onChange={setVideoQuality} />
              <OptionRow label="Кодек (YouTube)" options={VIDEO_CODECS} value={videoCodec} onChange={setVideoCodec} />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <OptionRow label="Формат" options={AUDIO_FORMATS} value={audioFormat} onChange={setAudioFormat} />
              <OptionRow
                label="Битрейт"
                options={AUDIO_BITRATES}
                value={audioBitrate}
                onChange={setAudioBitrate}
                disabled={audioFormat === "best" || audioFormat === "wav"}
              />
            </div>
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
            {loading ? "Обработка" : effectiveMode === "audio" ? "Скачать аудио" : "Скачать видео"}
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
                <span
                  key={index}
                  className="bar block w-0.5 bg-accent"
                  style={{ height: "100%", animationDelay: `${index * 0.15}s` }}
                />
              ))}
            </span>
          )}
          <span className="text-pretty">{feedback.text}</span>
        </div>
      )}

      {/* Повторное скачивание / выбор из нескольких файлов */}
      {result?.kind === "file" && (
        <button
          type="button"
          onClick={() => saveFile(result.url, result.filename)}
          className="flex items-center justify-between gap-3 rounded-[var(--radius)] border bg-surface p-3 text-left text-sm"
        >
          <span className="truncate font-mono text-xs text-foreground">{result.filename}</span>
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-accent">Скачать снова</span>
        </button>
      )}

      {result?.kind === "picker" && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border bg-surface p-3">
          {result.audio && (
            <button
              type="button"
              onClick={() => saveFile(result.audio as string, "audio.mp3")}
              className="rounded-lg border border-accent px-3 py-2 text-left font-mono text-xs text-accent"
            >
              Скачать аудиодорожку
            </button>
          )}
          <div className="grid grid-cols-3 gap-2">
            {result.items.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                onClick={() => saveFile(item.url, `${index + 1}.${item.type === "photo" ? "jpg" : "mp4"}`)}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border bg-surface-2 font-mono text-[11px] text-muted"
              >
                <ArrowDownToLine className="size-4" aria-hidden="true" />
                {item.type === "photo" ? "фото" : "видео"} {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <InstanceSettings config={instance} onChange={setInstance} />

      {!isTelegram && (
        <p className="text-center font-mono text-[11px] text-muted">
          Открыто в браузере. Внутри Telegram загрузка идёт через нативный диалог Mini App.
        </p>
      )}
    </section>
  )
}
