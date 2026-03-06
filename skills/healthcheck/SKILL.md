# healthcheck

Офлайн-скилл для регулярной проверки состояния стерильного ClaudeClaw на VPS.

## Что проверять

1. **Daemon**
   - `systemctl is-active claudeclaw`
   - `systemctl status claudeclaw --no-pager`

2. **Firewall**
   - `iptables -L CLAUDECLAW -n -v`
   - Убедиться, что разрешены только Anthropic/Telegram/DNS resolvers/localhost

3. **Cron**
   - root cron: sanitizer + firewall refresh
   - `claudeclaw` cron: ingest checked

4. **Папки контура**
   - `/home/claudeclaw/inbox`
   - `/home/claudeclaw/checked`
   - `/home/claudeclaw/quarantine`
   - `/home/claudeclaw/checked/processed`

5. **Sanitizer pipeline**
   - есть ли свежие записи в `sanitizer.log`
   - растет ли `quarantine` аномально
   - обновляется ли `provenance-index.jsonl`

6. **Инструменты безопасности**
   - `disallowedTools` содержит `Bash`, `WebSearch`, `WebFetch`
   - Telegram allowlist содержит только владельца

## Формат отчета

Выводить короткий статус:

- `OK` / `WARN` / `FAIL`
- причина
- действие для исправления

## Режим использования

- Планово: 1-2 раза в день
- Внепланово: после изменений firewall/settings/cron
