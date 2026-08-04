# OpenDownload

Telegram Mini App / веб-приложение для сохранения видео и аудио по ссылке.

- YouTube — видео с выбором качества (144p…4K) и кодека (H.264 / VP9 / AV1)
- Аудио — MP3 / Opus / OGG / WAV с выбором битрейта (64…320 kbps)
- SoundCloud, TikTok, Instagram, X, VK, Reddit, Twitch Clips, Vimeo, Pinterest, Bilibili
- Загрузка внутри Telegram через нативный `downloadFile` (Bot API 7.6+), с откатом на внешний браузер

## Почему старая версия не работала

`index.html` обращался к `https://api.cobalt.tools/api/json` прямо из браузера. Этот публичный
эндпоинт закрыт (актуальный API — v10 с другим путём и авторизацией), а браузерный запрос ещё и
блокировался CORS. Теперь запрос идёт через серверный роут `app/api/resolve/route.ts`: ключи не
попадают в клиент, CORS отсутствует, ошибки бэкенда переводятся в понятные сообщения.

## Переменные окружения

Добавьте в настройках проекта (шестерёнка → Vars) или в `.env.local`:

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `COBALT_API_URL` | да | Адрес cobalt-совместимого инстанса, например `https://cobalt.example.com` |
| `COBALT_API_KEY` | зависит от инстанса | Ключ доступа. Можно указать как `abc123` или как `Api-Key abc123` |

Без `COBALT_API_URL` приложение работает, но на запрос отвечает подсказкой о настройке.

## Как получить бэкенд (COBALT_API_URL)

Приложение говорит по протоколу [cobalt](https://github.com/imputnet/cobalt) v10+ — это открытый
self-hosted сервис извлечения медиа. Публичный инстанс авторы закрыли специально, поэтому нужен свой.

### 1. Свой инстанс через Docker (рекомендуется)

На любом VPS с Docker:

```bash
mkdir cobalt && cd cobalt
curl -O https://raw.githubusercontent.com/imputnet/cobalt/main/docs/examples/docker-compose.example.yml
mv docker-compose.example.yml docker-compose.yml
```

В `docker-compose.yml` задайте:

```yaml
environment:
  API_URL: "https://cobalt.example.com/" # ваш домен с HTTPS, обязательно со слешем
  API_KEY_URL: "file:///keys.json"       # включает авторизацию по ключу
volumes:
  - ./keys.json:/keys.json:ro
```

Создайте `keys.json` (UUID — это и есть ваш `COBALT_API_KEY`):

```json
{
  "b5c7160a-b00d-4f2c-9f9e-0f1b3d6c4a11": {
    "name": "opendownload",
    "limit": 50
  }
}
```

UUID сгенерируйте командой `uuidgen` (или `python -c "import uuid;print(uuid.uuid4())"`).

Запуск: `docker compose up -d`. Домен направьте на порт 9000 через Caddy/Nginx с HTTPS —
Telegram Mini App работает только по HTTPS.

Полная инструкция: <https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md>

### 2. Готовый чужой инстанс

Список сообщества: <https://instances.cobalt.best>. Возьмите адрес инстанса, у которого в колонке
про API-ключ указано, что ключи выдаются, и запросите ключ у владельца. Учтите: чужой инстанс может
исчезнуть или ограничить лимиты.

### 3. Альтернативный совместимый API

Если хотите другой бэкенд (например коммерческий RapidAPI-сервис), правьте только
`app/api/resolve/route.ts` — весь сетевой код и маппинг параметров собран там, в одном месте:

- `payload` — что уходит в апстрим (`videoQuality`, `audioFormat`, `audioBitrate`, `youtubeVideoCodec`)
- `headers.Authorization` — схема авторизации (`Api-Key`, `Bearer`, `X-RapidAPI-Key` и т.п.)
- блоки `data?.status === ...` — разбор ответа в общий формат `{ ok, kind, url, filename }`

Клиент менять не нужно.

### YouTube: приватные и 18+ видео

Для таких видео инстансу нужны cookies YouTube — см. `cookies.example.json` в репозитории cobalt.
Без них приложение вернёт сообщение «YouTube требует авторизацию».

## Подключение к Telegram

1. `@BotFather` → `/newbot` → получите токен.
2. `/newapp` → выберите бота → укажите URL деплоя (Publish в v0 или Vercel).
3. `/setmenubutton` → задайте кнопку меню, открывающую Mini App.

Тема Telegram подхватывается автоматически: `themeParams` мапятся в CSS-токены, так что приложение
выглядит родным и в светлой, и в тёмной теме.

## Про Spotify и подобные сервисы

Spotify, Apple Music, Deezer, Tidal, Яндекс Музыка отдают аудио только в зашифрованном виде (DRM).
Обход этой защиты — не техническая задача, а нарушение условий сервиса и авторских прав, поэтому
такие ссылки приложение отклоняет с объяснением. Официальный Spotify Web API отдаёт только
метаданные и 30-секундные превью — если нужен поиск/плейлисты по метаданным, это можно добавить
отдельно.

Для музыки используйте SoundCloud (многие авторы разрешают загрузку) и YouTube Music.
