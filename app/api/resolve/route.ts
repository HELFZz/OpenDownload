import { type NextRequest, NextResponse } from "next/server"
import { authHeader, collectCandidates, normalizeInstanceUrl } from "@/lib/backend"
import { detectService, isValidUrl, normalizeUrl } from "@/lib/services"

/**
 * Приложение общается с cobalt-совместимым API (v10+).
 * Адрес инстанса можно ввести прямо в интерфейсе — либо задать через
 * переменные окружения. Подробнее: lib/backend.ts и README.md.
 */

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
  let body: Partial<CobaltRequest> & { url?: string; instance?: string; apiKey?: string }
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

  const candidates = collectCandidates(body.instance, body.apiKey)
  if (candidates.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        needsSetup: true,
        message: "Инстанс не указан. Откройте «Настройки инстанса» ниже и впишите адрес сервера cobalt.",
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

  // Ошибки, при которых имеет смысл попробовать следующий инстанс из списка.
  const RETRYABLE = new Set([
    "error.api.auth.key.missing",
    "error.api.auth.key.invalid",
    "error.api.auth.key.not_found",
    "error.api.auth.jwt.missing",
    "error.api.auth.turnstile.missing",
    "error.api.rate_exceeded",
    "error.api.fetch.rate",
    "error.api.service.disabled",
    "error.api.service.unsupported",
  ])

  let lastMessage = "Ни один инстанс не ответил."

  for (const candidate of candidates) {
    const normalized = await normalizeInstanceUrl(candidate.url)
    if (!normalized.ok) {
      lastMessage = normalized.message
      continue
    }

    let data: any
    try {
      const upstream = await fetch(normalized.url + "/", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "OpenDownload/1.0",
          ...authHeader(candidate.apiKey),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      })

      const text = await upstream.text()
      try {
        data = JSON.parse(text)
      } catch {
        console.log("[v0] non-json response:", upstream.status, text.slice(0, 200))
        lastMessage = `По адресу ${normalized.url} отвечает не cobalt (HTTP ${upstream.status}).`
        continue
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError"
      lastMessage = timedOut
        ? `Инстанс ${normalized.url} не ответил за 30 секунд.`
        : `Инстанс ${normalized.url} недоступен.`
      continue
    }

    if (data?.status === "error") {
      const code = data?.error?.code as string | undefined
      console.log("[v0] upstream error:", code)
      lastMessage = humanizeError(code)
      if (code && RETRYABLE.has(code)) continue
      return NextResponse.json({ ok: false, message: lastMessage, code }, { status: 422 })
    }

    if (data?.status === "tunnel" || data?.status === "redirect") {
      return NextResponse.json({
        ok: true,
        kind: "file",
        url: data.url as string,
        filename: (data.filename as string) ?? "download",
        service: service.label,
        instance: normalized.url,
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
        instance: normalized.url,
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
          instance: normalized.url,
          raw: true,
        })
      }
    }

    console.log("[v0] unexpected payload:", JSON.stringify(data).slice(0, 300))
    lastMessage = "Инстанс вернул неожиданный ответ."
  }

  return NextResponse.json({ ok: false, message: lastMessage }, { status: 502 })
}
