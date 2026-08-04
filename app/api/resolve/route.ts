import { type NextRequest, NextResponse } from "next/server"
import { detectService, isValidUrl, normalizeUrl } from "@/lib/services"

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  НАСТРОЙКА БЭКЕНДА
 * ────────────────────────────────────────────────────────────────────────────
 *  Приложение общается с cobalt-совместимым API (v10+).
 *  Добавьте в переменные окружения проекта:
 *
 *    COBALT_API_URL   — адрес инстанса, например https://cobalt.example.com
 *    COBALT_API_KEY   — ключ доступа (если инстанс требует авторизацию)
 *
 *  Как получить — смотрите README.md в корне проекта.
 * ────────────────────────────────────────────────────────────────────────────
 */
const COBALT_API_URL = process.env.COBALT_API_URL
const COBALT_API_KEY = process.env.COBALT_API_KEY

type CobaltRequest = {
  url: string
  downloadMode?: "auto" | "audio" | "mute"
  videoQuality?: string
  audioFormat?: string
  audioBitrate?: string
  youtubeVideoCodec?: string
  filenameStyle?: "classic" | "pretty" | "basic" | "nerdy"
  alwaysProxy?: boolean
}

const ERROR_MESSAGES: Record<string, string> = {
  "error.api.link.invalid": "Ссылка не распознана.",
  "error.api.link.unsupported": "Этот сервис не поддерживается инстансом.",
  "error.api.service.unsupported": "Этот сервис не поддерживается инстансом.",
  "error.api.service.disabled": "Поддержка этого сервиса отключена на инстансе.",
  "error.api.fetch.empty": "Сервис не вернул медиафайл (возможно, приватная или удалённая запись).",
  "error.api.fetch.fail": "Не удалось получить файл с сервиса. Попробуйте позже.",
  "error.api.fetch.rate": "Сервис ограничил частоту запросов. Подождите немного.",
  "error.api.fetch.critical": "Сервис изменил API — инстанс нужно обновить.",
  "error.api.youtube.login": "YouTube требует авторизацию для этого видео (18+ или приватное).",
  "error.api.youtube.token_expired": "Токен YouTube на инстансе истёк. Обновите его.",
  "error.api.youtube.no_hls_streams": "Нет доступных потоков для этого качества.",
  "error.api.youtube.codec": "Выбранный кодек недоступен для этого видео.",
  "error.api.content.video.unavailable": "Видео недоступно (регион или приватность).",
  "error.api.content.video.age": "Видео с возрастным ограничением — нужна авторизация на инстансе.",
  "error.api.content.video.private": "Это приватная запись.",
  "error.api.content.video.region": "Запись недоступна в регионе сервера.",
  "error.api.content.too_long": "Запись слишком длинная для этого инстанса.",
  "error.api.auth.key.missing": "Инстанс требует API-ключ. Заполните COBALT_API_KEY.",
  "error.api.auth.key.invalid": "API-ключ отклонён инстансом. Проверьте COBALT_API_KEY.",
  "error.api.auth.key.not_found": "API-ключ не найден на инстансе.",
  "error.api.auth.jwt.missing": "Инстанс требует авторизацию (turnstile/jwt) — используйте инстанс с API-ключом.",
  "error.api.auth.turnstile.missing": "Инстанс требует прохождение turnstile — используйте инстанс с API-ключом.",
  "error.api.rate_exceeded": "Превышен лимит запросов к инстансу. Подождите.",
}

function humanizeError(code: string | undefined): string {
  if (!code) return "Инстанс вернул ошибку без описания."
  return ERROR_MESSAGES[code] ?? `Инстанс вернул ошибку: ${code}`
}

export async function POST(request: NextRequest) {
  let body: Partial<CobaltRequest> & { url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, message: "Некорректный запрос." }, { status: 400 })
  }

  const rawUrl = typeof body.url === "string" ? body.url : ""
  if (!isValidUrl(rawUrl)) {
    return NextResponse.json({ ok: false, message: "Введите корректную ссылку." }, { status: 400 })
  }

  const url = normalizeUrl(rawUrl)
  const service = detectService(url)

  if (service.id === "drm") {
    return NextResponse.json({ ok: false, message: service.note }, { status: 422 })
  }

  if (!COBALT_API_URL) {
    return NextResponse.json(
      {
        ok: false,
        needsSetup: true,
        message:
          "Бэкенд не настроен: добавьте переменную окружения COBALT_API_URL (и при необходимости COBALT_API_KEY). Инструкция — в README.md.",
      },
      { status: 503 },
    )
  }

  const payload: CobaltRequest = {
    url,
    downloadMode: body.downloadMode ?? "auto",
    videoQuality: body.videoQuality ?? "1080",
    audioFormat: body.audioFormat ?? "mp3",
    audioBitrate: body.audioBitrate ?? "320",
    youtubeVideoCodec: body.youtubeVideoCodec ?? "h264",
    filenameStyle: "pretty",
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "OpenDownload/1.0",
  }
  if (COBALT_API_KEY) {
    headers.Authorization = COBALT_API_KEY.startsWith("Api-Key ") ? COBALT_API_KEY : `Api-Key ${COBALT_API_KEY}`
  }

  try {
    const upstream = await fetch(COBALT_API_URL.replace(/\/+$/, "") + "/", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    })

    const text = await upstream.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      console.log("[v0] non-json upstream response:", upstream.status, text.slice(0, 200))
      return NextResponse.json(
        { ok: false, message: `Инстанс ответил не в формате JSON (HTTP ${upstream.status}). Проверьте COBALT_API_URL.` },
        { status: 502 },
      )
    }

    if (data?.status === "error") {
      const code = data?.error?.code as string | undefined
      console.log("[v0] upstream error:", code)
      return NextResponse.json({ ok: false, message: humanizeError(code), code }, { status: 422 })
    }

    if (data?.status === "tunnel" || data?.status === "redirect") {
      return NextResponse.json({
        ok: true,
        kind: "file",
        url: data.url as string,
        filename: (data.filename as string) ?? "download",
        service: service.label,
      })
    }

    if (data?.status === "picker") {
      const items = Array.isArray(data.picker) ? data.picker : []
      return NextResponse.json({
        ok: true,
        kind: "picker",
        audio: data.audio ?? null,
        items: items.map((item: any, index: number) => ({
          type: item.type ?? "photo",
          url: item.url as string,
          thumb: item.thumb ?? null,
          filename: `${index + 1}`,
        })),
        service: service.label,
      })
    }

    // cobalt 11 "local-processing" — отдаём первый прямой поток
    if (data?.status === "local-processing") {
      const first = Array.isArray(data.tunnel) ? data.tunnel[0] : undefined
      if (first) {
        return NextResponse.json({
          ok: true,
          kind: "file",
          url: first as string,
          filename: data?.output?.filename ?? "download",
          service: service.label,
          raw: true,
        })
      }
    }

    console.log("[v0] unexpected upstream payload:", JSON.stringify(data).slice(0, 300))
    return NextResponse.json({ ok: false, message: "Неожиданный ответ инстанса." }, { status: 502 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown"
    console.log("[v0] upstream request failed:", message)
    return NextResponse.json(
      { ok: false, message: "Не удалось связаться с инстансом. Проверьте COBALT_API_URL и доступность сервера." },
      { status: 502 },
    )
  }
}
