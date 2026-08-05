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
    // -x извлекает звук и перекодирует его в выбранный контейнер.
    args.push("-f", format === "best" ? "ba/b" : format, "-x", "--audio-format", audioFormat, "--audio-quality", "0")
    ext = audioFormat
  } else {
    args.push("-f", format)
    // Склейка двух дорожек всегда даёт mp4, одиночный поток остаётся как есть.
    ext = format.includes("+") ? "mp4" : (params.get("ext") ?? "mp4")
    if (format.includes("+")) args.push("--merge-output-format", "mp4")
  }
  args.push(url)

  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })

  let stderr = ""
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4000) stderr += String(chunk)
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const finish = (error?: Error) => {
        if (closed) return
        closed = true
        if (error) controller.error(error)
        else controller.close()
      }

      child.stdout.on("data", (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk))
        } catch {
          child.kill("SIGKILL")
        }
      })
      child.stdout.on("end", () => finish())
      child.on("error", (error) => finish(error))
      child.on("close", (code) => {
        if (code === 0) return finish()
        console.log("[v0] download failed, code", code, stderr.slice(0, 400))
        finish(new Error("Скачивание прервалось"))
      })

      // Пользователь закрыл вкладку — не держим процесс зря.
      request.signal.addEventListener("abort", () => {
        child.kill("SIGKILL")
        finish()
      })
    },
    cancel() {
      child.kill("SIGKILL")
    },
  })

  const filename = safeFilename(title, ext)
  return new Response(stream, {
    headers: {
      // Размер заранее неизвестен: поток формируется на ходу.
      "Content-Type": wantsAudio ? `audio/${audioFormat === "m4a" ? "mp4" : audioFormat}` : "video/mp4",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
