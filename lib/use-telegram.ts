"use client"

import { useCallback, useEffect, useState } from "react"

type TelegramWebApp = {
  ready: () => void
  expand: () => void
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void
  downloadFile?: (params: { url: string; file_name: string }, callback?: (accepted: boolean) => void) => void
  disableVerticalSwipes?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  showAlert?: (message: string) => void
  themeParams?: Record<string, string>
  colorScheme?: "light" | "dark"
  version?: string
  platform?: string
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void
    notificationOccurred: (type: "error" | "success" | "warning") => void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

/** Сопоставление переменных темы Telegram с токенами дизайна */
const THEME_MAP: Record<string, string> = {
  bg_color: "--background",
  secondary_bg_color: "--surface",
  section_bg_color: "--surface-2",
  text_color: "--foreground",
  hint_color: "--muted",
  button_color: "--accent",
  button_text_color: "--accent-foreground",
  destructive_text_color: "--danger",
  section_separator_color: "--border",
}

function versionAtLeast(version: string | undefined, target: string) {
  if (!version) return false
  const a = version.split(".").map(Number)
  const b = target.split(".").map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}

export function useTelegram() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)

  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!app || typeof app.ready !== "function") return

    app.ready()
    app.expand()
    app.disableVerticalSwipes?.()

    const params = app.themeParams ?? {}
    const root = document.documentElement
    for (const [key, token] of Object.entries(THEME_MAP)) {
      const value = params[key]
      if (value) root.style.setProperty(token, value)
    }
    if (params.bg_color) {
      app.setHeaderColor?.(params.bg_color)
      app.setBackgroundColor?.(params.bg_color)
    }

    setWebApp(app)
  }, [])

  /**
   * Скачивание внутри Telegram:
   *  1) downloadFile (Bot API 7.6+) — нативный диалог загрузки;
   *  2) openLink — внешний браузер;
   *  3) обычный браузер — <a download>.
   */
  const saveFile = useCallback(
    (url: string, filename: string) => {
      if (webApp?.downloadFile && versionAtLeast(webApp.version, "7.6")) {
        try {
          webApp.downloadFile({ url, file_name: filename })
          return "telegram-native"
        } catch {
          // падаем на openLink
        }
      }
      if (webApp?.openLink) {
        webApp.openLink(url, { try_instant_view: false })
        return "telegram-browser"
      }
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      anchor.rel = "noopener"
      anchor.target = "_blank"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return "browser"
    },
    [webApp],
  )

  const haptic = useCallback(
    (type: "success" | "error" | "tap") => {
      if (!webApp?.HapticFeedback) return
      if (type === "tap") webApp.HapticFeedback.impactOccurred("light")
      else webApp.HapticFeedback.notificationOccurred(type)
    },
    [webApp],
  )

  return { webApp, isTelegram: Boolean(webApp), saveFile, haptic }
}
