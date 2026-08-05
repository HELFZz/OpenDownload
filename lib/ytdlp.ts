import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getYtDlp } from "@/lib/binaries"

const execFileAsync = promisify(execFile)

export type MediaFormat = {
  /** Строка селектора для yt-dlp, например "137+140". */
  id: string
  kind: "video" | "audio"
  label: string
  detail: string
  ext: string
  /** Требуется склейка двух дорожек через ffmpeg. */
  needsMux: boolean
  height?: number
  bitrate?: number
  size?: number
}

export type MediaInfo = {
  title: string
  uploader?: string
  duration?: number
  thumbnail?: string
  extractor: string
  isLive: boolean
  video: MediaFormat[]
  audio: MediaFormat[]
}

type RawFormat = {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  fps?: number
  abr?: number
  tbr?: number
  filesize?: number
  filesize_approx?: number
  protocol?: string
  format_note?: string
}

const BASE_ARGS = [
  "--no-warnings",
  "--no-playlist",
  "--no-progress",
  "--ignore-config",
  // Часть сайтов отдаёт данные только «браузерному» клиенту.
  "--user-agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
]

function humanSize(bytes?: number) {
  if (!bytes) return ""
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} ГБ` : `${mb.toFixed(1)} МБ`
}

function hasVideo(f: RawFormat) {
  return Boolean(f.vcodec && f.vcodec !== "none")
}
function hasAudio(f: RawFormat) {
  return Boolean(f.acodec && f.acodec !== "none")
}
function sizeOf(f: RawFormat) {
  return f.filesize ?? f.filesize_approx ?? undefined
}

/** Кодек в человекочитаемом виде: av01.0.05M → AV1. */
function codecName(codec?: string) {
  if (!codec) return ""
  if (codec.startsWith("av01")) return "AV1"
  if (codec.startsWith("vp9") || codec.startsWith("vp09")) return "VP9"
  if (codec.startsWith("vp8")) return "VP8"
  if (codec.startsWith("avc") || codec.startsWith("h264")) return "H.264"
  if (codec.startsWith("hev") || codec.startsWith("hvc")) return "HEVC"
  return codec.split(".")[0].toUpperCase()
}

export class YtDlpError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message)
  }
}

/** Приводим болтливые ошибки yt-dlp к понятному пользователю тексту. */
function translate(stderr: string): string {
  const text = stderr.toLowerCase()

  if (text.includes("sign in to confirm you're not a bot") || text.includes("confirm your age")) {
    return "YouTube требует подтверждения, что запрос не от бота. Обычно помогает повторная попытка или свои cookies (YTDLP_COOKIES)."
  }
  if (text.includes("private video") || text.includes("is private")) return "Это приватная запись — доступ закрыт автором."
  if (text.includes("members-only") || text.includes("join this channel")) {
    return "Доступно только участникам канала по подписке."
  }
  if (text.includes("age") && text.includes("restrict")) return "Возрастное ограничение: нужны cookies авторизованного аккаунта."
  if (text.includes("video unavailable")) return "Запись недоступна — возможно, удалена или заблокирована в этом регионе."
  if (text.includes("copyright") || text.includes("removed by")) return "Запись удалена по жалобе на нарушение авторских прав."
  if (text.includes("geo") && text.includes("restrict")) return "Запись заблокирована в регионе, где расположен сервер."
  if (text.includes("unsupported url") || text.includes("no suitable extractor")) {
    return "Этот сайт не поддерживается. Проверьте ссылку или пришлите её на страницу самой записи."
  }
  if (text.includes("404") || text.includes("not found")) return "Страница не найдена — ссылка битая или запись удалена."
  if (text.includes("drm") || text.includes("protected by drm")) return "Материал защищён DRM — скачивание невозможно."
  if (text.includes("timed out") || text.includes("timeout")) return "Источник не ответил вовремя. Попробуйте ещё раз."
  if (text.includes("requested format is not available")) return "Выбранное качество недоступно для этой записи."

  const firstError = stderr
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("ERROR:"))

  return firstError?.replace(/^ERROR:\s*/, "") || "Не удалось обработать ссылку."
}

async function runJson(url: string): Promise<any> {
  const bin = await getYtDlp()
  const args = [...BASE_ARGS, "-J", url]
  if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES)

  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: 90_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return JSON.parse(stdout)
  } catch (error: any) {
    const stderr = String(error?.stderr ?? error?.message ?? "")
    console.log("[v0] yt-dlp failed:", stderr.slice(0, 400))
    if (error?.killed || error?.signal === "SIGTERM") {
      throw new YtDlpError("Обработка заняла больше 90 секунд и была прервана.", stderr)
    }
    throw new YtDlpError(translate(stderr), stderr)
  }
}

export async function getMediaInfo(url: string): Promise<MediaInfo> {
  const data = await runJson(url)
  // Плейлист/канал: берём первую запись, чтобы не качать сотни файлов.
  const entry = data?._type === "playlist" ? (data.entries?.[0] ?? data) : data
  const formats: RawFormat[] = Array.isArray(entry?.formats) ? entry.formats : []

  const bestAudio = formats
    .filter((f) => !hasVideo(f) && hasAudio(f))
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0]

  // Одна карточка на каждое разрешение: берём самый компактный вариант.
  const byHeight = new Map<number, RawFormat>()
  for (const f of formats) {
    if (!hasVideo(f) || !f.height) continue
    if (f.protocol === "mhtml") continue
    const current = byHeight.get(f.height)
    if (!current) {
      byHeight.set(f.height, f)
      continue
    }
    const better =
      // Готовый файл со звуком всегда предпочтительнее склейки.
      (hasAudio(f) && !hasAudio(current)) || (hasAudio(f) === hasAudio(current) && (sizeOf(f) ?? 1e15) < (sizeOf(current) ?? 1e15))
    if (better) byHeight.set(f.height, f)
  }

  const video: MediaFormat[] = [...byHeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, f]) => {
      const needsMux = !hasAudio(f) && Boolean(bestAudio)
      const totalSize = needsMux ? (sizeOf(f) ?? 0) + (sizeOf(bestAudio!) ?? 0) || undefined : sizeOf(f)
      const parts = [codecName(f.vcodec), f.fps ? `${Math.round(f.fps)} fps` : "", humanSize(totalSize)].filter(Boolean)

      return {
        id: needsMux ? `${f.format_id}+${bestAudio!.format_id}` : f.format_id,
        kind: "video" as const,
        label: height >= 2160 ? "4K" : height >= 1440 ? "1440p" : `${height}p`,
        detail: parts.join(" · "),
        // Склеенные дорожки отдаются в mkv: mp4 нельзя финализировать в потоке.
        ext: needsMux ? "mkv" : (f.ext ?? "mp4"),
        needsMux,
        height,
        size: totalSize,
      }
    })

  const audio: MediaFormat[] = formats
    .filter((f) => !hasVideo(f) && hasAudio(f))
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))
    .slice(0, 4)
    .map((f) => {
      const rate = Math.round(f.abr ?? f.tbr ?? 0)
      return {
        id: f.format_id,
        kind: "audio" as const,
        label: rate ? `${rate} kbps` : (f.format_note ?? f.ext ?? "audio"),
        detail: [codecName(f.acodec) || f.ext?.toUpperCase(), humanSize(sizeOf(f))].filter(Boolean).join(" · "),
        ext: f.ext ?? "m4a",
        needsMux: false,
        bitrate: rate,
        size: sizeOf(f),
      }
    })

  // Некоторые источники (TikTok, Instagram) отдают один готовый файл без разбивки.
  if (video.length === 0 && audio.length === 0 && entry?.url) {
    video.push({
      id: entry.format_id ?? "best",
      kind: "video",
      label: "Оригинал",
      detail: humanSize(sizeOf(entry)),
      ext: entry.ext ?? "mp4",
      needsMux: false,
      size: sizeOf(entry),
    })
  }

  return {
    title: entry?.title ?? "Без названия",
    uploader: entry?.uploader ?? entry?.channel ?? undefined,
    duration: entry?.duration ?? undefined,
    thumbnail: entry?.thumbnail ?? undefined,
    extractor: entry?.extractor_key ?? entry?.extractor ?? "unknown",
    isLive: Boolean(entry?.is_live),
    video,
    audio,
  }
}

export { BASE_ARGS, translate as translateYtDlpError }
