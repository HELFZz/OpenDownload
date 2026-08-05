import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  ОТКУДА БЕРЁТСЯ БЭКЕНД
 * ────────────────────────────────────────────────────────────────────────────
 *  Приоритет:
 *    1. Инстанс, введённый пользователем в интерфейсе (хранится в localStorage
 *       браузера и приходит в теле запроса). Ничего настраивать не нужно.
 *    2. Переменные окружения проекта — если хочется зашить инстанс по умолчанию
 *       для всех посетителей:
 *
 *         COBALT_API_URL   — один адрес, например https://cobalt.example.com
 *         COBALT_API_URLS  — несколько адресов через запятую (перебор по порядку)
 *         COBALT_API_KEY   — ключ, если инстанс требует авторизацию
 *
 *  Инстансы без авторизации работают вообще без ключа.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type Candidate = { url: string; apiKey?: string; source: "user" | "env" }

/** Диапазоны, куда запрещено ходить — защита от SSRF во внутреннюю сеть. */
function isBlockedAddress(address: string): boolean {
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc")) return true
  if (address.startsWith("fd")) return true

  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false

  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // metadata / link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

export type NormalizeResult = { ok: true; url: string } | { ok: false; message: string }

/** Проверяет и приводит адрес инстанса к виду https://host[:port] */
export async function normalizeInstanceUrl(raw: string): Promise<NormalizeResult> {
  let candidate = raw.trim()
  if (!candidate) return { ok: false, message: "Адрес инстанса пустой." }
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, message: "Адрес инстанса выглядит некорректно." }
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, message: "Поддерживаются только адреса http:// и https://" }
  }

  const host = parsed.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return {
      ok: false,
      message: "Локальный адрес недоступен с сервера. Пробросьте инстанс наружу (например, через Cloudflare Tunnel).",
    }
  }

  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
    if (addresses.length === 0) return { ok: false, message: "Не удалось определить IP адреса инстанса." }
    if (addresses.some((entry) => isBlockedAddress(entry.address))) {
      return { ok: false, message: "Адреса внутренней сети запрещены. Используйте публичный домен инстанса." }
    }
  } catch {
    return { ok: false, message: `Домен ${host} не найден. Проверьте адрес инстанса.` }
  }

  return { ok: true, url: `${parsed.protocol}//${parsed.host}` }
}

/** Собирает список инстансов для перебора: сначала пользовательский, затем из env. */
export function collectCandidates(userUrl?: string, userKey?: string): Candidate[] {
  const list: Candidate[] = []
  const seen = new Set<string>()

  const push = (url: string | undefined, apiKey: string | undefined, source: Candidate["source"]) => {
    const value = url?.trim()
    if (!value) return
    const dedupeKey = value.replace(/\/+$/, "").toLowerCase()
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    list.push({ url: value, apiKey: apiKey?.trim() || undefined, source })
  }

  push(userUrl, userKey, "user")

  const envKey = process.env.COBALT_API_KEY
  push(process.env.COBALT_API_URL, envKey, "env")
  for (const entry of (process.env.COBALT_API_URLS ?? "").split(",")) {
    push(entry, envKey, "env")
  }

  return list
}

export function authHeader(apiKey?: string): Record<string, string> {
  if (!apiKey) return {}
  return { Authorization: apiKey.startsWith("Api-Key ") ? apiKey : `Api-Key ${apiKey}` }
}
