# YouTube Quize-Mode

Chrome-расширение (MV3), которое превращает просмотр обучающих видео на YouTube в интерактивный курс: режим «Учеба», субтитры с таймкодами, в перспективе — паузы и quiz по материалу видео.

## Текущий статус (v0.1.0)

| Компонент | Статус |
|-----------|--------|
| Идентификация пользователя (Google ID / anonymous) | ✅ |
| Toggle «Режим учёбы» в popup | ✅ |
| Загрузка транскрипта YouTube с таймкодами | ✅ |
| Запросы к LLM / quiz-оверлей | 🔜 |
| Backend API | 🔜 |
| Счётчик квоты / Premium | 🔜 |

## Быстрый старт (разработка расширения)

1. Откройте Chrome → `chrome://extensions`
2. Включите **Режим разработчика**
3. **Load unpacked** → выберите папку проекта
4. Откройте watch-страницу YouTube, включите **Режим учёбы** в popup
5. В DevTools на вкладке YouTube → Console → `[Quize-Mode] Transcript loaded:`

## Структура проекта

```
edtube/
├── manifest.json       # MV3: permissions, content scripts, popup
├── background.js       # Service worker: identity, (будущее: API client)
├── content.js          # YouTube: study mode, transcript init, SPA
├── transcript.js       # Выбор дорожки субтитров, парсинг, bridge API
├── page-bridge.js      # Page context: Innertube, timedtext, fetch intercept
├── popup.html / popup.js
├── .env.example        # Шаблон ключей для BACKEND (не для расширения)
├── gemini-code-1780132248999.md   # Product / MVP spec
└── docs/
    └── ARCHITECTURE.md # Техническая архитектура
```

## Архитектура (кратко)

- **Расширение** — тонкий клиент: субтитры, UI, идентификация `userId`.
- **Backend API** (ваш сервер) — LLM-ключи (DeepSeek), лимиты, Premium, генерация вопросов.
- Ключи LLM **не хранятся** в Chrome extension. Шаблон для сервера: [`.env.example`](.env.example).

Подробнее: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Ключи API

| Где | Что хранить |
|-----|-------------|
| **Сервер** (`.env`) | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `LLM_PROVIDER`, `LLM_MODEL`, `API_SESSION_SECRET` |
| **Расширение** (`chrome.storage.local`) | `studyModeEnabled`, `anonymousUserId`, (будущее) `sessionToken`, кэш quota |

```bash
cp .env.example .env
# заполните DEEPSEEK_API_KEY — файл не коммитится
```

## Спецификация продукта

Полное описание MVP, user flow и промпт LLM: [`gemini-code-1780132248999.md`](gemini-code-1780132248999.md).

## Permissions (manifest)

- `storage`, `identity`, `identity.email` — user id, study mode
- `https://*.youtube.com/*` — content script, субтитры
- `api.openai.com`, `generativelanguage.googleapis.com`, `oai.hconeai.com` — legacy в manifest; LLM идёт через ваш backend + DeepSeek; host_permissions расширения будут заменены на `API_BASE_URL`
