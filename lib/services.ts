export type ServiceId =
  | "youtube"
  | "soundcloud"
  | "tiktok"
  | "instagram"
  | "twitter"
  | "vk"
  | "pinterest"
  | "reddit"
  | "twitch"
  | "vimeo"
  | "bilibili"
  | "drm"
  | "unknown"

export type ServiceInfo = {
  id: ServiceId
  label: string
  /** Поддерживает ли выбор качества видео */
  video: boolean
  /** Поддерживает ли извлечение аудио */
  audio: boolean
  /** Поток защищён DRM — скачивание невозможно */
  drm?: boolean
  note?: string
}

const MATCHERS: { id: ServiceId; hosts: string[] }[] = [
  { id: "youtube", hosts: ["youtube.com", "youtu.be", "music.youtube.com", "m.youtube.com"] },
  { id: "soundcloud", hosts: ["soundcloud.com", "on.soundcloud.com", "snd.sc"] },
  { id: "tiktok", hosts: ["tiktok.com", "vt.tiktok.com", "vm.tiktok.com"] },
  { id: "instagram", hosts: ["instagram.com", "instagr.am", "ddinstagram.com"] },
  { id: "twitter", hosts: ["twitter.com", "x.com", "t.co"] },
  { id: "vk", hosts: ["vk.com", "vkvideo.ru", "vk.ru"] },
  { id: "pinterest", hosts: ["pinterest.com", "pin.it"] },
  { id: "reddit", hosts: ["reddit.com", "redd.it"] },
  { id: "twitch", hosts: ["twitch.tv", "clips.twitch.tv"] },
  { id: "vimeo", hosts: ["vimeo.com"] },
  { id: "bilibili", hosts: ["bilibili.com", "b23.tv"] },
  // Платформы с DRM — технически не извлекаются, показываем понятную ошибку
  { id: "drm", hosts: ["spotify.com", "open.spotify.com", "music.apple.com", "deezer.com", "tidal.com", "music.yandex.ru"] },
]

export const SERVICE_META: Record<ServiceId, ServiceInfo> = {
  youtube: { id: "youtube", label: "YouTube", video: true, audio: true },
  soundcloud: { id: "soundcloud", label: "SoundCloud", video: false, audio: true },
  tiktok: { id: "tiktok", label: "TikTok", video: true, audio: true },
  instagram: { id: "instagram", label: "Instagram", video: true, audio: true },
  twitter: { id: "twitter", label: "X / Twitter", video: true, audio: true },
  vk: { id: "vk", label: "VK", video: true, audio: true },
  pinterest: { id: "pinterest", label: "Pinterest", video: true, audio: true },
  reddit: { id: "reddit", label: "Reddit", video: true, audio: true },
  twitch: { id: "twitch", label: "Twitch Clips", video: true, audio: true },
  vimeo: { id: "vimeo", label: "Vimeo", video: true, audio: true },
  bilibili: { id: "bilibili", label: "Bilibili", video: true, audio: true },
  drm: {
    id: "drm",
    label: "Стриминг с DRM",
    video: false,
    audio: false,
    drm: true,
    note: "Аудио на Spotify / Apple Music / Deezer / Tidal защищено DRM и не может быть извлечено. Вставьте ссылку на трек с SoundCloud или YouTube Music.",
  },
  unknown: { id: "unknown", label: "Ссылка", video: true, audio: true },
}

export function detectService(rawUrl: string): ServiceInfo {
  let host = ""
  try {
    host = new URL(normalizeUrl(rawUrl)).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return SERVICE_META.unknown
  }

  for (const matcher of MATCHERS) {
    if (matcher.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return SERVICE_META[matcher.id]
    }
  }
  return SERVICE_META.unknown
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

export function isValidUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeUrl(raw))
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".")
  } catch {
    return false
  }
}
