import { spawn } from "node:child_process"
import { type NextRequest, NextResponse } from "next/server"
import { getFfmpeg, getYtDlp } from "@/lib/binaries"
import { BASE_ARGS } from "@/lib/ytdlp"
import { detectService, isValidUrl, normalizeUrl } from "@/lib/services"

export const runtime = "nodejs"
export const maxDuration = 300

/** Селектор формата подставляется в аргументы, поэтому фильтруем его жёстко. */
const SAFE_FORMAT = /^[\w+\-.[\]<=>*]{1,80}$/

const AUDIO_FORMATS = new Set(["mp3", "opus", "m4a", "wav", "flac"])

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mp3: "audio/mpeg",
  opus: "audio/opus",
  m4a: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
}

/** Аргументы ffmpeg для настоящей перекодировки в выбранный формат. */
function audioEncoderArgs(format: string): string[] {
  switch (format) {
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", "320k", "-f", "mp3"]
    case "opus":
      return ["-c:a", "libopus", "-b:a", "192k", "-f", "opus"]
    case "flac":
      return ["-c:a", "flac", "-f", "flac"]
    case "wav":
      return ["-c:a", "pcm_s16le", "-f", "wav"]
    default:
      // m4a: дорожка YouTube уже AAC, копируем без потери качества.
      return ["-c:a", "copy", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"]
  }
}

function safeFilename(name: string, ext: string) {
  const cleaned = name
    .replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  return `${cleaned || "download"}.${ext}`
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const url = normalizeUrl(params.get("url") ?? "")
  const format = params.get("format") ?? "best"
  const audioFormat = params.get("audioFormat") ?? ""
  const title = params.get("title") ?? "download"

  if (!url || !isValidUrl(url)) {
    return NextResponse.json({ ok: false, message: "Некорректная ссылка." }, { status: 400 })
  }
  if (!SAFE_FORMAT.test(format)) {
    return NextResponse.json({ ok: false, message: "Некорректный формат." }, { status: 400 })
  }
  if (detectService(url).drm) {
    return NextResponse.json({ ok: false, message: "Материал защищён DRM." }, { status: 422 })
  }

  const wantsAudio = AUDIO_FORMATS.has(audioFormat)
  let bin: string
  let ffmpeg: string | null
  try {
    ;[bin, ffmpeg] = await Promise.all([getYtDlp(), getFfmpeg()])
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка"
    return NextResponse.json({ ok: false, message }, { status: 503 })
  }

  if (wantsAudio && !ffmpeg) {
    return NextResponse.json(
      { ok: false, message: "Для конвертации в аудио нужен ffmpeg, но он недоступен на сервере." },
      { status: 503 },
    )
  }

  const args = [...BASE_ARGS, "--no-part", "-o", "-"]
  if (ffmpeg) args.push("--ffmpeg-location", ffmpeg)
  if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES)

  let ext: string
  if (wantsAudio) {
    // Извлекаем исходную дорожку, перекодировку делаем сами в ffmpeg (см. ниже):
    // потоковый `-x` пишет контейнер, который нельзя досоздать в stdout.
    args.push("-f", format === "best" ? "ba/b" : format)
    ext = audioFormat
  } else {
    args.push("-f", format)
    if (format.includes("+")) {
      // mp4 в stdout нельзя финализировать (moov-атом пишется в конец), поэтому
      // склеенные дорожки отдаём в matroska — он потоковый по своей природе.
      ext = "mkv"
      args.push("--merge-output-format", "mkv")
    } else {
      ext = params.get("ext") ?? "mp4"
    }
  }
  args.push(url)

  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })

  let stderr = ""
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4000) stderr += String(chunk)
  })

  // Аудио: гоним поток yt-dlp через ffmpeg, чтобы на выходе был настоящий кодек.
  let encoder: ReturnType<typeof spawn> | null = null
  if (wantsAudio && ffmpeg) {
    encoder = spawn(ffmpeg, ["-v", "error", "-i", "pipe:0", "-vn", ...audioEncoderArgs(audioFormat), "pipe:1"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    encoder.stderr?.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += String(chunk)
    })
    child.stdout.pipe(encoder.stdin!)
    // Обрыв пайпа при отмене — это норма, глушим шум в логах.
    encoder.stdin!.on("error", () => {})
  }

  const source = encoder ?? child

  // Ждём первый байт: пока ответ не начат, ошибку ещё можно отдать статусом и текстом,
  // иначе пользователь получил бы пустой файл с кодом 200.
  const firstChunk = await new Promise<Buffer | null>((resolve) => {
    const onData = (chunk: Buffer) => {
      source.stdout!.pause()
      cleanup()
      resolve(chunk)
    }
    const onEnd = () => {
      cleanup()
      resolve(null)
    }
    const cleanup = () => {
      source.stdout!.off("data", onData)
      source.stdout!.off("end", onEnd)
      source.off("close", onEnd)
      source.off("error", onEnd)
    }
    source.stdout!.on("data", onData)
    source.stdout!.on("end", onEnd)
    source.on("close", onEnd)
    source.on("error", onEnd)
  })

  if (!firstChunk) {
    child.kill("SIGKILL")
    encoder?.kill("SIGKILL")
    console.log("[v0] download produced no data:", stderr.slice(0, 400))
    const notAvailable = /Requested format is not available/i.test(stderr)
    return NextResponse.json(
      {
        ok: false,
        message: notAvailable
          ? "Это качество больше недоступно — обновите список форматов."
          : "Сервер не смог получить файл. Попробуйте другое качество.",
      },
      { status: 502 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      controller.enqueue(new Uint8Array(firstChunk))
      const finish = (error?: Error) => {
        if (closed) return
        closed = true
        if (error) controller.error(error)
        else controller.close()
      }

      const killAll = () => {
        child.kill("SIGKILL")
        encoder?.kill("SIGKILL")
      }

      source.stdout!.on("data", (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk))
        } catch {
          killAll()
        }
      })
      source.stdout!.on("end", () => finish())
      source.on("error", (error) => finish(error))
      source.on("close", (code) => {
        if (code === 0) return finish()
        console.log("[v0] download failed, code", code, stderr.slice(0, 400))
        finish(new Error("Скачивание прервалось"))
      })

      // Пользователь закрыл вкладку — не держим процессы зря.
      request.signal.addEventListener("abort", () => {
        killAll()
        finish()
      })

      // Поток был остановлен, пока мы ждали первый байт.
      source.stdout!.resume()
    },
    cancel() {
      child.kill("SIGKILL")
      encoder?.kill("SIGKILL")
    },
  })

  const filename = safeFilename(title, ext)
  return new Response(stream, {
    headers: {
      // Размер заранее неизвестен: поток формируется на ходу.
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
