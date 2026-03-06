# VPS Sync

Единая двусторонняя синхронизация между репозиторием и боевым VPS.

## Что синхронизируем

- `canonical/claudeclaw-settings.json` → `/home/claudeclaw/.claude/claudeclaw/settings.json`
- `canonical/sanitizer.py` → `/home/claudeclaw/sanitizer/sanitizer.py`
- `canonical/ingest-checked.sh` → `/home/claudeclaw/sanitizer/ingest-checked.sh`
- `canonical/claudeclaw-firewall.sh` → `/usr/local/bin/claudeclaw-firewall.sh`

Дополнительно:
- runtime-патчи ClaudeClaw plugin (`telegram.ts`, `preflight.ts`) через `claudeclaw-reconcile-from-repo.sh`
- контроль целостности canonical-файлов через `canonical/checksums.sha256`
- контракт запроса Информера: `contracts/informer-request.schema.json`
- контракт ответа Информера: `contracts/informer-response.schema.json`

## Правило секретов

- В репозитории **не храним** живой Telegram токен.
- В `canonical/claudeclaw-settings.json` поле `telegram.token` = `__KEEP_REMOTE__`.
- При `sync-to-vps` токен сохраняется из текущего файла на сервере.

## Команды

Из корня репозитория:

```bash
bash ops/vps-sync/scripts/sync-to-vps.sh
bash ops/vps-sync/scripts/sync-from-vps.sh
```

Автосинк (ручной запуск):

```bash
bash ops/vps-sync/scripts/auto-sync.sh
```

Переопределить сервер:

```bash
VPS_HOST=1.2.3.4 VPS_USER=root bash ops/vps-sync/scripts/sync-to-vps.sh
```

## Рекомендованный цикл

1. Правки в `ops/vps-sync/canonical/*`
2. `sync-to-vps`
3. Проверка `systemctl status claudeclaw`
4. При hotfix на VPS — `sync-from-vps` и commit в репозиторий

## Автоматический режим (VPS, каждые 3 часа)

На сервере настроен root cron:

```bash
0 */3 * * * /usr/local/bin/claudeclaw-reconcile-from-repo.sh >> /var/log/claudeclaw-reconcile.log 2>&1
```

Скрипт `/usr/local/bin/claudeclaw-reconcile-from-repo.sh`:

- берёт canonical-файлы из `/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/`
- проверяет checksums перед применением
- использует pinned plugin version `1.0.0` (детерминированный runtime target)
- применяет их к runtime-файлам ClaudeClaw
- сохраняет токен Telegram с сервера (если в canonical `__KEEP_REMOTE__`)
- пере-применяет firewall и перезапускает `claudeclaw.service`

Dry-run верификация на VPS:

```bash
/usr/local/bin/claudeclaw-reconcile-from-repo.sh --dry-run
```
