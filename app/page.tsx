import { Downloader } from "@/components/downloader"
import { SERVICE_META } from "@/lib/services"

const SUPPORTED = [
  SERVICE_META.youtube,
  SERVICE_META.soundcloud,
  SERVICE_META.tiktok,
  SERVICE_META.instagram,
  SERVICE_META.twitter,
  SERVICE_META.vk,
  SERVICE_META.reddit,
  SERVICE_META.twitch,
  SERVICE_META.vimeo,
  SERVICE_META.pinterest,
  SERVICE_META.bilibili,
]

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-6 px-4 py-8">
      <header className="flex w-full flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">OpenDownload</p>
        <h1 className="text-balance text-2xl font-semibold leading-tight">Медиа из ссылки — видео или аудио</h1>
        <p className="text-pretty text-sm leading-relaxed text-muted">
          Вставьте ссылку — сервер сам покажет доступные качества с размерами. Работает на yt-dlp и ffmpeg, без внешних
          API и ключей.
        </p>
      </header>

      <Downloader />

      <section className="flex w-full flex-col gap-3 rounded-[var(--radius)] border bg-surface p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Частые источники</h2>
        <ul className="flex flex-wrap gap-1.5">
          {SUPPORTED.map((item) => (
            <li key={item.id} className="rounded-md border bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted">
              {item.label}
            </li>
          ))}
        </ul>
        <p className="text-pretty text-xs leading-relaxed text-muted">
          Список не ограничен: yt-dlp понимает около 1800 сайтов, поэтому можно вставить ссылку и с других платформ.
        </p>
        <p className="text-pretty text-xs leading-relaxed text-muted">
          Spotify, Apple Music, Deezer, Tidal и Яндекс Музыка используют DRM — их аудиопоток технически невозможно
          сохранить, поэтому такие ссылки отклоняются с подсказкой. Для музыки используйте SoundCloud или YouTube Music.
        </p>
        <p className="text-pretty text-xs leading-relaxed text-muted">
          Скачивайте только тот контент, на который у вас есть права: собственные загрузки, материалы с открытой
          лицензией или файлы с разрешением автора.
        </p>
      </section>
    </main>
  )
}
