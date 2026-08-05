import { type NextRequest, NextResponse } from "next/server"
import { getFfmpeg } from "@/lib/binaries"
import { YtDlpError, getMediaInfo } from "@/lib/ytdlp"
import { detectService, isValidUrl, normalizeUrl } from "@/lib/services"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  let body: { url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, message: "Некорректный запрос." }, { status: 400 })
  }

  const url = normalizeUrl(body.url ?? "")
  if (!url || !isValidUrl(url)) {
    return NextResponse.json({ ok: false, message: "Вставьте корректную ссылку." }, { status: 400 })
  }

  const service = detectService(url)
  if (service.drm) {
    return NextResponse.json(
      {
        ok: false,
        message: `${service.label} отдаёт треки только с DRM-защитой, скачать их нельзя. Попробуйте найти запись на SoundCloud или YouTube Music.`,
      },
      { status: 422 },
    )
  }

  try {
    const [info, ffmpeg] = await Promise.all([getMediaInfo(url), getFfmpeg()])

    if (info.isLive) {
      return NextResponse.json(
        { ok: false, message: "Это прямая трансляция — дождитесь её окончания и повторите." },
        { status: 422 },
      )
    }
    if (info.video.length === 0 && info.audio.length === 0) {
      return NextResponse.json({ ok: false, message: "Для этой ссылки не нашлось доступных файлов." }, { status: 422 })
    }

    // Без ffmpeg склейка и конвертация в mp3 недоступны — сообщаем об этом клиенту.
    return NextResponse.json({
      ok: true,
      canMux: Boolean(ffmpeg),
      service: service.label,
      info,
    })
  } catch (error) {
    if (error instanceof YtDlpError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 422 })
    }
    const message = error instanceof Error ? error.message : "неизвестная ошибка"
    console.log("[v0] info route failed:", message)
    return NextResponse.json({ ok: false, message: `Движок скачивания недоступен: ${message}` }, { status: 503 })
  }
}
