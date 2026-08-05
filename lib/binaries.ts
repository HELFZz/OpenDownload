import { execFile } from "node:child_process"
import { chmod, mkdir, rename, stat } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * yt-dlp распространяется как автономный бинарник со встроенным Python,
 * поэтому его достаточно скачать один раз — никакого pip и venv не нужно.
 */
const RELEASES: Record<string, string> = {
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
  "darwin-x64": "yt-dlp_macos",
  "darwin-arm64": "yt-dlp_macos",
  "win32-x64": "yt-dlp.exe",
}

const CACHE_DIR = join(tmpdir(), "opendownload")
const BIN_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
const CACHED_BIN = join(CACHE_DIR, BIN_NAME)

let ytdlpPromise: Promise<string> | null = null

async function isExecutable(path: string) {
  try {
    const info = await stat(path)
    // Скачанный не до конца файл лучше считать отсутствующим.
    return info.isFile() && info.size > 1_000_000
  } catch {
    return false
  }
}

async function onPath(): Promise<string | null> {
  for (const candidate of ["yt-dlp", "yt-dlp_linux"]) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 15_000 })
      return candidate
    } catch {
      // идём дальше
    }
  }
  return null
}

async function download(): Promise<string> {
  const asset = RELEASES[`${process.platform}-${process.arch}`]
  if (!asset) {
    throw new Error(`Для платформы ${process.platform}-${process.arch} нет готового бинарника yt-dlp.`)
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`
  console.log("[v0] downloading yt-dlp:", url)

  const response = await fetch(url, { signal: AbortSignal.timeout(180_000), redirect: "follow" })
  if (!response.ok || !response.body) {
    throw new Error(`Не удалось скачать yt-dlp (HTTP ${response.status}).`)
  }

  await mkdir(CACHE_DIR, { recursive: true })
  // Пишем во временный файл, чтобы параллельные запросы не читали половину файла.
  const partial = `${CACHED_BIN}.${process.pid}.part`
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(partial))
  await chmod(partial, 0o755)
  await rename(partial, CACHED_BIN)

  console.log("[v0] yt-dlp ready at", CACHED_BIN)
  return CACHED_BIN
}

/** Путь к yt-dlp: переменная окружения → системный PATH → кеш → скачивание. */
export function getYtDlp(): Promise<string> {
  if (!ytdlpPromise) {
    ytdlpPromise = (async () => {
      const configured = process.env.YTDLP_PATH
      if (configured && (await isExecutable(configured))) return configured

      const system = await onPath()
      if (system) return system

      if (await isExecutable(CACHED_BIN)) return CACHED_BIN

      return download()
    })().catch((error) => {
      ytdlpPromise = null // разрешаем повторную попытку после сбоя сети
      throw error
    })
  }
  return ytdlpPromise
}

/** Путь к ffmpeg — нужен для склейки видео с аудио и конвертации в mp3. */
export async function getFfmpeg(): Promise<string | null> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    // Бандлер не должен трогать этот путь: нужен настоящий файл на диске.
    const require = createRequire(import.meta.url)
    const resolved = require("ffmpeg-static") as string | { default?: string }
    const path = typeof resolved === "string" ? resolved : resolved?.default
    if (path && (await isExecutable(path))) return path
  } catch (error) {
    console.log("[v0] ffmpeg-static unavailable:", error instanceof Error ? error.message : error)
  }
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 15_000 })
    return "ffmpeg"
  } catch {
    return null
  }
}
