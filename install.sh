#!/usr/bin/env bash
set -euo pipefail

# SPRUT Agent Kit Installation Script
# Установка ClaudeClaw + надстройка одной командой

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

log_info() {
  echo -e "${GREEN}✓${RESET} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${RESET} $1"
}

log_error() {
  echo -e "${RED}✗${RESET} $1"
}

log_header() {
  echo -e "\n${BOLD}$1${RESET}"
}

check_requirements() {
  log_header "Проверка зависимостей"

  if ! command -v bun &> /dev/null; then
    log_error "Bun не установлен."
    read -p "Установить Bun сейчас? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      curl -fsSL https://bun.sh/install | bash
      source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null || true
    else
      log_error "Bun необходим для работы. Прерываем установку."
      exit 1
    fi
  fi
  log_info "Bun: $(bun --version)"

  if ! command -v sqlite3 &> /dev/null; then
    log_warn "SQLite3 не установлен (опционально для отладки памяти)"
  else
    log_info "SQLite3: $(sqlite3 --version | cut -d' ' -f1)"
  fi

  if ! command -v git &> /dev/null; then
    log_error "Git не установлен"
    exit 1
  fi
  log_info "Git: $(git --version | cut -d' ' -f3)"

  if ! command -v claude &> /dev/null; then
    log_error "Claude Code не установлен. Установите: https://claude.ai/download"
    exit 1
  fi
  log_info "Claude Code: установлен"
}

install_claudeclaw() {
  log_header "Установка ClaudeClaw"

  # Проверяем установлен ли ClaudeClaw
  if claude plugin list 2>/dev/null | grep -q "claudeclaw"; then
    log_info "ClaudeClaw уже установлен"
    return
  fi

  log_info "Устанавливаем ClaudeClaw из marketplace..."

  # Добавляем marketplace плагин
  if ! claude plugin marketplace add moazbuilds/claudeclaw 2>/dev/null; then
    log_warn "Не удалось добавить из marketplace, пробуем альтернативный метод..."
  fi

  # Устанавливаем плагин
  if claude plugin install claudeclaw 2>/dev/null; then
    log_info "ClaudeClaw установлен"
  else
    log_error "Не удалось установить ClaudeClaw автоматически"
    log_info "Установите вручную: claude plugin install claudeclaw"
    exit 1
  fi
}

setup_config() {
  log_header "Настройка конфигурации"

  local config_file="$HOME/.claude/claudeclaw/settings.json"
  mkdir -p "$(dirname "$config_file")"

  if [ -f "$config_file" ]; then
    log_warn "Конфиг уже существует: $config_file"
    return
  fi

  log_info "Создаём базовый конфиг..."

  # Запрашиваем Telegram ID
  read -p "Введите ваш Telegram ID (или оставьте пустым): " telegram_id
  telegram_id=${telegram_id:-0}

  # Запрашиваем timezone
  read -p "Введите timezone (например Asia/Tbilisi, или UTC): " timezone
  timezone=${timezone:-UTC}

  cat > "$config_file" <<EOF
{
  "model": "claude-opus-4-6",
  "api": "anthropic",
  "fallback": {
    "model": "claude-sonnet-4-5-20250929",
    "api": "anthropic"
  },
  "timezone": "$timezone",
  "timezoneOffsetMinutes": 0,
  "heartbeat": {
    "enabled": false,
    "interval": 15,
    "prompt": "",
    "excludeWindows": []
  },
  "telegram": {
    "token": "",
    "allowedUserIds": [$telegram_id]
  },
  "security": {
    "level": "moderate",
    "allowedTools": [],
    "disallowedTools": []
  },
  "web": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 4632
  },
  "memory": {
    "enabled": true,
    "openaiApiKeyPath": "~/.env",
    "maxResults": 5,
    "vectorWeight": 0.7,
    "textWeight": 0.3,
    "decayRate": 0.02,
    "autoExtract": true
  }
}
EOF

  log_info "Конфиг создан: $config_file"
}

import_soul() {
  log_header "Импорт души агента"

  local soul_dest="$HOME/sprut-agent-kit"
  mkdir -p "$soul_dest"

  if [ -f "$(pwd)/SOUL.md" ] && [ -f "$(pwd)/AGENTS.md" ]; then
    cp "$(pwd)/SOUL.md" "$soul_dest/"
    cp "$(pwd)/AGENTS.md" "$soul_dest/"
    log_info "SOUL.md и AGENTS.md скопированы в $soul_dest"
  else
    log_warn "Файлы SOUL.md или AGENTS.md не найдены"
  fi

  if [ -f "$(pwd)/claudeclaw.json" ]; then
    cp "$(pwd)/claudeclaw.json" "$soul_dest/"
    log_info "claudeclaw.json скопирован"
  fi
}

import_memory() {
  log_header "Импорт памяти (опционально)"

  read -p "Путь к памяти основного агента (или Enter для пропуска): " main_agent_memory

  if [ -z "$main_agent_memory" ]; then
    log_info "Пропускаем импорт памяти"
    return
  fi

  main_agent_memory="${main_agent_memory/#\~/$HOME}"

  if [ ! -d "$main_agent_memory" ]; then
    log_warn "Директория не найдена: $main_agent_memory"
    log_info "Пропускаем импорт памяти"
    return
  fi

  log_info "Импорт памяти из $main_agent_memory..."

  local script_dir="$HOME/.claude/plugins/cache/claudeclaw/claudeclaw/1.0.0"
  local import_script="/tmp/import-memory-$(date +%s).ts"

  cat > "$import_script" <<'EOF'
import { storeMemory, initMemory } from "$HOME/.claude/plugins/cache/claudeclaw/claudeclaw/1.0.0/src/memory";

await initMemory();

// Здесь нужно добавить логику парсинга файлов памяти основного агента
// и вызовы storeMemory() для каждого факта

console.log("Импорт завершён");
EOF

  log_warn "Автоматический импорт памяти требует доработки"
  log_info "Скрипт создан: $import_script"
  log_info "Запустите вручную: bun $import_script"
}

install_skills() {
  log_header "Установка skills (опционально)"

  local skills_dir="$HOME/.claude/skills"

  read -p "Установить базовые skills? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Пропускаем установку skills"
    return
  fi

  mkdir -p "$skills_dir"

  # Если есть директория skills в репозитории - копируем
  if [ -d "$(pwd)/skills" ]; then
    log_info "Копируем skills из репозитория..."
    cp -r "$(pwd)/skills"/* "$skills_dir/"
    log_info "Skills установлены"
  else
    log_warn "Директория skills не найдена в $(pwd)"
  fi
}

setup_daemon() {
  log_header "Настройка daemon (опционально)"

  read -p "Настроить автозапуск daemon через launchd? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Пропускаем настройку daemon"
    return
  fi

  local plist_file="$HOME/Library/LaunchAgents/com.claudeclaw.daemon.plist"
  local plugin_dir="$HOME/.claude/plugins/cache/claudeclaw/claudeclaw/1.0.0"

  cat > "$plist_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeclaw.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME/.bun/bin/bun</string>
    <string>run</string>
    <string>$plugin_dir/src/index.ts</string>
    <string>start</string>
    <string>--web</string>
    <string>--replace-existing</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/.claudeclaw/logs/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.claudeclaw/logs/daemon.error.log</string>
</dict>
</plist>
EOF

  mkdir -p "$HOME/.claudeclaw/logs"

  launchctl unload "$plist_file" 2>/dev/null || true
  launchctl load "$plist_file"

  log_info "Daemon настроен и запущен"
  log_info "Логи: $HOME/.claudeclaw/logs/"
  log_info "Web UI: http://localhost:4632"
}

print_summary() {
  log_header "Установка завершена ⚡"

  echo ""
  echo "Что дальше:"
  echo ""
  echo "1. Отредактируйте конфиг: ~/.claude/claudeclaw/settings.json"
  echo "   - Добавьте Telegram bot token (если нужен)"
  echo "   - Настройте timezone и allowedUserIds"
  echo ""
  echo "2. Проверьте душу агента: ~/sprut-agent-kit/SOUL.md"
  echo "   - Адаптируйте под себя"
  echo ""
  echo "3. Запустите daemon:"
  echo "   cd ~/.claude/plugins/cache/claudeclaw/claudeclaw/1.0.0"
  echo "   bun run src/index.ts start --web"
  echo ""
  echo "4. Откройте Web UI: http://localhost:4632"
  echo ""
  echo "Документация: https://github.com/AlekseiUL/sprut-agent-kit"
  echo ""
}

main() {
  echo -e "${BOLD}SPRUT Agent Kit Installation ⚡${RESET}"
  echo "ClaudeClaw + готовая конфигурация"
  echo ""

  check_requirements
  install_claudeclaw
  setup_config
  import_soul
  import_memory
  install_skills
  setup_daemon
  print_summary
}

main
