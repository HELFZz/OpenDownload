/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static указывает на бинарник на диске — бандлить его нельзя.
  serverExternalPackages: ["ffmpeg-static"],
  // Путь к ffmpeg вычисляется через createRequire, поэтому трейсер его не видит.
  // Без этого на Vercel в функцию попадёт только index.js без самого бинарника.
  outputFileTracingIncludes: {
    "/api/download": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/info": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ]
  },
}

export default nextConfig
