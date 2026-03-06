#!/bin/bash
set -euo pipefail

CLAW_USER="claudeclaw"
ANTHROPIC_IPS=("160.79.104.10")
TELEGRAM_IPS=("149.154.166.110")

iptables -D OUTPUT -m owner --uid-owner "$CLAW_USER" -j CLAUDECLAW 2>/dev/null || true
iptables -F CLAUDECLAW 2>/dev/null || true
iptables -X CLAUDECLAW 2>/dev/null || true

iptables -N CLAUDECLAW
iptables -A CLAUDECLAW -o lo -j ACCEPT
iptables -A CLAUDECLAW -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

DNS_SERVERS=$(awk '/^nameserver / {print $2}' /etc/resolv.conf | awk '/^[0-9.]+$/' | tr '\n' ' ')
for dns_ip in $DNS_SERVERS; do
  iptables -A CLAUDECLAW -d "$dns_ip" -p udp --dport 53 -j ACCEPT
  iptables -A CLAUDECLAW -d "$dns_ip" -p tcp --dport 53 -j ACCEPT
done

for ip in "${ANTHROPIC_IPS[@]}"; do
  iptables -A CLAUDECLAW -d "$ip" -p tcp --dport 443 -j ACCEPT
done

for ip in "${TELEGRAM_IPS[@]}"; do
  iptables -A CLAUDECLAW -d "$ip" -p tcp --dport 443 -j ACCEPT
done
iptables -A CLAUDECLAW -d 149.154.160.0/20 -p tcp --dport 443 -j ACCEPT
iptables -A CLAUDECLAW -d 91.108.0.0/16 -p tcp --dport 443 -j ACCEPT

iptables -A CLAUDECLAW -j LOG --log-prefix "CLAUDECLAW-BLOCKED: " --log-level 4
iptables -A CLAUDECLAW -j DROP

iptables -I OUTPUT 1 -m owner --uid-owner "$CLAW_USER" -j CLAUDECLAW

echo "Firewall rules applied for $CLAW_USER"
echo "DNS allowed only to: ${DNS_SERVERS:-<none>}"
echo "Anthropic IPs: ${ANTHROPIC_IPS[*]}"
echo "Telegram IPs: ${TELEGRAM_IPS[*]}"
iptables -L CLAUDECLAW -n -v
