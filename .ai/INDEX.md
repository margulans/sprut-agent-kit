# .ai INDEX

## Назначение

Папка `.ai/` хранит живую документацию по стерильной архитектуре ClaudeClaw.

## Порядок чтения

1. `ARCHITECTURE.md` — как устроена система и границы доверия
2. `SNAPSHOT.md` — текущее состояние VPS и сервисов
3. `BACKLOG.md` (в корне проекта) — план работ и статус
4. `ROUTING.md` — маршруты данных и provenance
5. `INFRA.md` — инфраструктурные зависимости и лимиты
6. `RUNBOOK.md` — операционные процедуры (rotation/incidents/rollback)
7. `EVOLUTION.md` — журнал изменений по ценности
8. `ops/scout-worker/README.md` — внешний контур Scout VPS (deploy и contracts)
9. `ops/twin-sync/README.md` — синхронизация близнецов ClaudeClaw/OpenClaw

## Правила актуализации

- После изменения архитектуры обновлять `ARCHITECTURE.md` и `SNAPSHOT.md`.
- После инфраструктурных изменений обновлять `INFRA.md`.
- После изменения операционных процедур обновлять `RUNBOOK.md`.
- После внедрения новой ценности добавлять запись в `EVOLUTION.md`.
