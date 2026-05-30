# YouTube Quize-Mode

Chrome-расширение (MV3), которое превращает просмотр обучающих видео на YouTube в интерактивный курс: режим «Учеба», субтитры с таймкодами, паузы и quiz по материалу видео.

## Текущий статус (v0.1.0)

| Компонент | Статус |
|-----------|--------|
| Идентификация пользователя (Google ID / anonymous) | ✅ |
| Toggle «Режим учёбы» в popup | ✅ |
| Загрузка транскрипта YouTube с таймкодами | ✅ |
| Backend API (auth + quiz generate) | ✅ |
| Генерация вопросов (3 MCQ на чанк, 5 мин) | ✅ |
| Пауза плеера + quiz overlay | ✅ |
| Preload следующих чанков (~30 сек до паузы) | ✅ |
| Счётчик квоты в popup / Premium | 🔜 |

## Быстрый старт (разработка расширения)

1. Откройте Chrome → `chrome://extensions`
2. Включите **Режим разработчика**
3. **Load unpacked** → выберите папку проекта
4. Откройте watch-страницу YouTube, включите **Режим учёбы** в popup
5. Дождитесь `pauseTimestampMs` (или перемотайте близко к таймкоду) — пауза и **3 вопроса подряд** в overlay

### Тест UX (quiz overlay)

1. Backend запущен, режим учёбы включён, видео с субтитрами
2. В Console: `Question block registered` с `pauseTimestampMs` и `questionCount: 3`
3. Дождитесь таймкода или перемотайте на ~10 сек до него
4. Ответьте на **все 3 вопроса** (варианты перемешиваются)
5. **≤1 ошибка** → «Продолжить» → видео играет
6. **≥2 ошибки** → «Пересмотреть фрагмент» → rewind на начало чанка (5 мин) + **новая генерация** 3 вопросов

## Быстрый старт (backend)

1. Скопируйте и заполните ключи:

```bash
cp .env.example .env
# DEEPSEEK_API_KEY, API_SESSION_SECRET
```

2. Запустите API (локально на **3001**, см. `PORT` и `API_BASE_URL` в `.env`; URL дублируется в [`api-client.js`](api-client.js)):

```bash
cd server
npm install
npm run dev
```

3. Проверка:

```bash
curl http://localhost:3001/health
```

4. Расширение обращается к `http://localhost:3001` — backend должен быть запущен **до** открытия YouTube с режимом учёбы.

## Структура проекта

```
edtube/
├── manifest.json       # MV3: permissions, content scripts, popup
├── background.js       # Service worker: identity, GENERATE_QUESTION
├── api-client.js       # Session bootstrap + POST /v1/quiz/generate
├── content.js          # YouTube: study mode, transcript, quiz generation
├── transcript.js       # Выбор дорожки субтитров, парсинг, bridge API
├── transcript-chunk.js # Разбиение сегментов на чанки ~7 мин
├── quiz-player.js      # pause/play/seek, timeupdate polling
├── quiz-overlay.js     # MCQ overlay UI
├── quiz-overlay.css
├── quiz-scheduler.js   # пауза по таймкоду, preload чанков
├── page-bridge.js      # Page context: Innertube, timedtext, fetch intercept
├── popup.html / popup.js
├── server/             # Node.js backend (DeepSeek, quota, auth)
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
| **Расширение** (`chrome.storage.local`) | `studyModeEnabled`, `anonymousUserId`, `sessionToken`, `sessionExpiresAt`, `quotaCache` |

```bash
cp .env.example .env
# заполните DEEPSEEK_API_KEY — файл не коммитится
```

## Спецификация продукта

Полное описание MVP, user flow и промпт LLM: [`gemini-code-1780132248999.md`](gemini-code-1780132248999.md).

## Permissions (manifest)

- `storage`, `identity`, `identity.email` — user id, study mode
- `https://*.youtube.com/*` — content script, субтитры
- `http://localhost:3001/*` — локальный backend API (dev)
- `api.openai.com`, `generativelanguage.googleapis.com`, `oai.hconeai.com` — legacy в manifest; LLM идёт через backend + DeepSeek
