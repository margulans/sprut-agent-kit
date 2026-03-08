# EVOLUTION

## 2026-03-06 — Усиление стерильной архитектуры

### Что добавлено

- Defense in depth для external data:
  - `external_content`-обертка
  - provenance/trust маркеры
  - provenance index
- Жесткий DNS egress policy (только resolvers из `resolv.conf`)
- Tool hardening: запрет `Bash`, `WebSearch`, `WebFetch`
- Структура `.ai/` для системной документации
- Офлайн skill `healthcheck` для регулярного аудита VPS

### Что это сняло

- Риск DNS exfiltration через произвольные резолверы
- Риск выполнения сетевых действий через LLM tools
- Риск неявного доверия к данным из `/checked/`
- Потерю контекста по архитектурным решениям между сессиями

## 2026-03-06 — Детерминированный автосинк VPS

### Что добавлено

- Автосинк на VPS каждые 3 часа (`reconcile-from-repo` в cron)
- Проверка целостности canonical-файлов по `checksums.sha256` перед применением
- Pinned plugin version `1.0.0` для runtime-патчей
- Режим `--dry-run` для верификации без изменений

### Что это сняло

- Риск дрейфа конфигурации между локальной и боевой версиями
- Риск недетерминированного применения патчей к случайной версии плагина
- Риск «тихой порчи» canonical-файлов перед автоприменением

## 2026-03-06 — Двухшаговый Scout flow в Telegram

### Что добавлено

- Для запросов погоды бот отвечает в 2 шага:
  - мгновенный ack: «Принял, запрашиваю у Скаута...»
  - финальный ответ после появления данных в checked
- SLA в runtime:
  - fast-path до 30 секунд
  - fallback ожидание до 3 минут
  - timeout-ответ, если данных нет

### Что это сняло

- Блокирующее ожидание без обратной связи пользователю
- Неопределенность по времени ответа при внешнем ресерче

## 2026-03-06 — Контрактный вход Scout request

### Что добавлено

- Симметричный JSON Schema для входящих запросов Скауту:
  - `ops/vps-sync/contracts/scout-request.schema.json`
  - `schema_version` и `source_bot` в request payload (`telegram.ts`)
- Контракты (`scout-request` и `scout-response`) включены в двусторонний sync (to/from VPS)

### Что это сняло

- Риск неявного формата входящего запроса в `inbox/requests`
- Риск расхождения локальной и VPS-версии контрактов

## 2026-03-06 — Separate Sanitizer VPS (signed import pipeline)

### Что добавлено

- Новый стек `ops/separate-sanitizer/*`:
  - отдельный sanitizer pipeline для второго VPS
  - signed bundle export (`manifest + sig + tar.gz`)
  - verify+atomic import на Bot VPS
  - RO-permissions для mirror `checked/canonical`
  - healthcheck timers и runbook операций
- На Bot VPS развернуты и включены:
  - `sanitizer-import.timer`
  - `checked-health.timer`

### Что это сняло

- Риск прямой связи внешних raw данных с ботами
- Риск незаметной подмены checked-контента в транзите
- Риск частичного/битого обновления mirror

## 2026-03-06 — Жесткое разделение Scout и Informer

### Что добавлено

- Зафиксировано архитектурное правило ролей:
  - `Scout` = только внешний поиск/ресерч (scheduled + on-demand)
  - `Informer` = отдельный независимый publishing-контур для 3 дайджестов
- В текущем проектном контуре `Scout` исключен из задач дайджестов и автопубликации.

### Что это сняло

- Риск смешения ответственности (исследование + редакция + публикация в одном агенте)
- Риск неконтролируемого расширения `Scout` до роли медиа-паблишера

## 2026-03-07 — Добавлен Scout VPS deploy stack

### Что добавлено

- Новый стек `ops/scout-worker/*`:
  - `scout_worker.py` (режимы `poll` и `scheduled`)
  - bootstrap `bootstrap-scout-vps.sh`
  - systemd units/timers: `scout-poll`, `scout-scan`
  - deploy script `deploy-scout-vps.sh`
  - контракты `scout-job.schema.json` и `scout-result.schema.json`
- Обновлена `.ai` документация под трехконтурную схему Bot/Sanitizer/Scout.

### Что это сняло

- Ручную сборку Scout-инфраструктуры на новом VPS
- Риск неявной роли Scout при дальнейшей реализации (поиск/ресерч без дайджестов)

## 2026-03-07 — Добавлен transport Scout -> Sanitizer и e2e скрипт

### Что добавлено

- `push-raw-to-sanitizer.sh` на Scout VPS и timer `scout-push.timer`.
- Поддержка transport-конфига через `/etc/scout/push.env` при deploy.
- Скрипт `ops/scout-worker/scripts/e2e-weather.sh` для полного прогона:
  `Scout request -> Sanitizer -> Bot checked/canonical`.

### Что это сняло

- Ручной перенос raw-файлов между Scout и Sanitizer.
- Риск неполной проверки контура без воспроизводимого e2e сценария.

### Факт внедрения

- Transport включен на боевых VPS.
- E2E `weather_lookup` подтвержден до `checked/canonical` на Bot VPS.
- Выполнен clean cutover Scout на новый VPS `159.223.23.107`.
- Legacy Scout timers на старом хосте `89.167.81.12` отключены.
- Ad-hoc E2E `web_search` подтвержден до `checked/canonical` на Bot VPS.

## 2026-03-07 — Scout расширен до полного набора ресерч-скиллов

### Что добавлено

- В `scout_worker.py` добавлены task types:
  - `web_search`, `deep_research`, `reddit_scan`, `youtube_transcribe`,
    `summarize_text`, `analyze_topic`, `skills_catalog`.
- Добавлен каталог skill-документов `ops/scout-worker/skills/*`.
- Контракты `scout-job` и `scout-result` расширены под новые типы задач.
- Контракты `ops/vps-sync/contracts/scout-request|response` синхронизированы с новым task-моделью.
- Добавлены новые task types для поисков:
  - `youtube_search`
  - `social_search`
  - `messenger_channels_search`
- В `telegram.ts` введены два режима обработки Scout-запросов:
  - `fast` для быстрых поисков (weather/web/youtube/social/messenger),
  - `research` для тяжёлых запросов (`deep_research`) с late-delivery после timeout.
- Добавлен hard guardrail для класса "актуальные факты":
  - при признаках свежих фактов (latest/current/сейчас + вопрос + предметный маркер)
  - запрещён ответ из локальной памяти без внешнего контура Scout.
- В контуре доставки добавлен event-driven fast lane через `systemd .path`:
  - Scout: `scout-poll.path`, `scout-push.path`,
  - Sanitizer: `sanitizer-sanitize.path`, `sanitizer-export.path`,
  - Bot: `sanitizer-import.path`.
- Добавлен недостающий транспорт запросов `Bot -> Scout`:
  - script `push-requests-to-scout.sh`,
  - units `scout-request-push.timer|path`,
  - SSH trust `claudeclaw@Bot -> scout@Scout`.
- Исправлены path-trigger'ы fast-lane:
  - `sanitizer-export.path` переведен на `PathModified=/srv/sanitizer/checked/canonical`,
  - `sanitizer-import.path` переведен на `PathModified=/home/claudeclaw/import/inbox`,
  - import больше не падает на промежуточной раскладке bundle (`invalid bundle layout` -> retry).

### Что это сняло

- Ограничение Scout только на `weather_lookup`.
- Зависимость от ручной расшифровки возможностей Scout по коду без формального каталога скиллов.

## 2026-03-07 — MVP Twin Sync для ClaudeClaw/OpenClaw

### Что добавлено

- Новый модуль `ops/twin-sync/*`:
  - `twin_orchestrator.py` (append-only memory ledger, knowledge view, p2p relay, config diff proposals)
  - `publish_twin_artifact.py` (публикация memory/config/hint артефактов)
  - `twin_runtime_bridge.py` (автопубликация config snapshots + memory events при изменении хеша)
  - `send_proposals_digest.py` (Telegram digest новых proposal-файлов владельцу)
  - `apply_twin_proposal.py` (owner approve/reject + controlled apply non-sensitive changes)
  - systemd units `twin-orchestrator.service|timer`
  - systemd units `twin-runtime-bridge.service|timer`
  - systemd units `twin-proposals-digest.service|timer`
  - deploy script `deploy-twin-orchestrator.sh`
- Новые контракты:
  - `ops/vps-sync/contracts/twin-memory-event.schema.json`
  - `ops/vps-sync/contracts/twin-config-snapshot.schema.json`
  - `ops/vps-sync/contracts/twin-config-proposal.schema.json`
- Proposal-loop по конфигам зафиксирован как owner-controlled (`auto_apply=false`).

### Что это сняло

- Ручной обмен практиками и конфиг-идеями между двумя агентами.
- Отсутствие единого журнала памяти для близнецов.
- Риск «тихого» автоприменения конфигов без подтверждения владельца.
- Ручной вход в сервер для применения каждого proposal после согласования.
- Ручной ввод approve/reject команд для каждого предложения (one-tap inline callbacks).
- Привязку twin-stack к конкретному пользователю `/home/claudeclaw` на чистых VPS.
- Потерю контекста «когда и чем обменивались близнецы» в обычном Telegram-диалоге.

## 2026-03-08 — Контрактный stateful router для Telegram Scout

### Что добавлено

- Добавлен `ops/vps-sync/runtime/router_contract.ts` с единым контрактом решения роутинга:
  - explicit scout,
  - explicit assistant,
  - state/cache intercept,
  - defer в guard + ownership-check.
- Добавлен `ops/vps-sync/runtime/router_state.ts` с per-chat состоянием:
  - `lastRoute`,
  - `lastScoutRequestId`,
  - TTL для follow-up контекста.
- `telegram.ts` переведён на контрактный switch по `RouterAction` вместо разрозненных веток.
- Добавлены регрессионные фикстуры `router_fixtures.json` и раннер `router_test_runner.ts`.

### Что это сняло

- Неустойчивость роутинга из-за ad-hoc патчей под отдельные фразы.
- Повторные вызовы Scout на короткие уточнения после уже полученного ответа.
- Непрозрачность при отладке: теперь решение роутинга формализовано одним контрактом.

## 2026-03-08 — Устойчивый late-delivery Scout после timeout

### Что добавлено

- В `ops/vps-sync/runtime/telegram.ts` расширен поиск результатов Scout:
  - поддержка `SCOUT_CHECKED_DIRS` (список директорий через `, : ;`),
  - fallback на `SCOUT_CHECKED_DIR`,
  - дефолтный поиск в `checked/canonical` и `checked/research` для `claudeclaw` и `adjutant`.
- Добавлены debug-сообщения для late-delivery:
  - момент постановки фонового ожидания,
  - истечение окна ожидания без результата,
  - недоступные директории checked.

### Что это сняло

- Риск потери позднего ответа при несовпадении runtime-пути `checked/*` между окружениями.
- «Тихие» зависания без достаточной диагностики в сценарии timeout -> wait-in-background.
