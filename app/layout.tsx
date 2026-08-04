import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import Script from "next/script"
import "./globals.css"

const sans = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-app-sans",
  display: "swap",
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-app-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "OpenDownload — медиа из ссылки",
  description:
    "Скачивайте видео и аудио по ссылке: YouTube с выбором качества, SoundCloud, TikTok, Instagram, X, VK и другие. Работает как Telegram Mini App.",
}

export const viewport: Viewport = {
  themeColor: "#10111a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // Telegram SDK дописывает inline-стили в <html> до гидрации — глушим предупреждение
    <html lang="ru" className={`${sans.variable} ${mono.variable} bg-background`} suppressHydrationWarning>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
