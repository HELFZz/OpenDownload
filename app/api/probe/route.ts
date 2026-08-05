import { type NextRequest, NextResponse } from "next/server"
import { authHeader, normalizeInstanceUrl } from "@/lib/backend"

/** Проверка инстанса: доступен ли он и требует ли ключ. */
export async function POST(request: NextRequest) {
  let body: { instance?: string; apiKey?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, message: "Некорректный запрос." }, { status: 400 })
  }

  const normalized = await normalizeInstanceUrl(body.instance ?? "")
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, message: normalized.message }, { status: 400 })
  }

  try {
    const response = await fetch(normalized.url + "/", {
      headers: { Accept: "application/json", ...authHeader(body.apiKey) },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    })

    const data = await response.json().catch(() => null)

    if (!data?.cobalt) {
      return NextResponse.json(
        { ok: false, message: `По этому адресу отвечает не cobalt (HTTP ${response.status}).` },
        { status: 502 },
      )
    }

    const services = Array.isArray(data.cobalt.services) ? data.cobalt.services.length : 0
    return NextResponse.json({
      ok: true,
      url: normalized.url,
      version: data.cobalt.version ?? "неизвестна",
      services,
      needsKey: Boolean(data.cobalt.turnstileSitekey) || response.status === 401,
    })
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "не ответил за 12 секунд" : "недоступен"
    return NextResponse.json({ ok: false, message: `Инстанс ${reason}.` }, { status: 502 })
  }
}
