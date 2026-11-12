#!/usr/bin/env bash
# Publica o player em https://canva.claudemembers.com.br (VPS Loki, Caddy).
#
# Uso:  npm run deploy
#
# 1. Gera dist/ com `npm run build`.
# 2. Envia dist/ para /var/www/canva/ na Loki por rsync (apaga lá o que não
#    existir mais em dist/).
# 3. Confere pelo HTTPS que o index.html publicado é igual ao local.
#
# Variáveis opcionais:
#   LOKI_HOST  destino SSH. Padrão: tenta o alias `loki` do ~/.ssh/config e,
#              se não conectar, usa o nome canva.claudemembers.com.br (a rede
#              daqui é IPv6 com NAT64 e o literal IPv4 às vezes expira).
#   LOKI_KEY   chave SSH usada no contorno por nome. Padrão: ~/.ssh/vps_agente
set -euo pipefail

cd "$(dirname "$0")/.."

SITE_URL="https://canva.claudemembers.com.br"
DESTINO="/var/www/canva/"
LOKI_KEY="${LOKI_KEY:-$HOME/.ssh/vps_agente}"
SSH_OPTS=(-o ConnectTimeout=10 -o BatchMode=yes)

if [[ -n "${LOKI_HOST:-}" ]]; then
  HOST="$LOKI_HOST"
elif ssh "${SSH_OPTS[@]}" loki true 2>/dev/null; then
  HOST="loki"
else
  echo "Alias 'loki' não conectou; usando canva.claudemembers.com.br." >&2
  HOST="canva.claudemembers.com.br"
  SSH_OPTS+=(-i "$LOKI_KEY" -l root)
fi

echo "==> Gerando dist/"
npm run build

if [[ ! -f dist/index.html || ! -f dist/slides.js ]]; then
  echo "dist/ incompleto (falta index.html ou slides.js); nada foi enviado." >&2
  exit 1
fi

echo "==> Enviando dist/ para $HOST:$DESTINO"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p '$DESTINO'"
# Uma única origem (dist/) para um único destino: o --delete só limpa o que
# saiu de dist/. Sem -o/-g para os arquivos não ficarem com o uid do Mac.
rsync -rlpt --delete --exclude '.DS_Store' \
  -e "ssh ${SSH_OPTS[*]}" \
  dist/ "$HOST:$DESTINO"
ssh "${SSH_OPTS[@]}" "$HOST" "chown -R caddy:caddy '$DESTINO'"

echo "==> Verificando $SITE_URL"
CODIGO="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE_URL/")"
if [[ "$CODIGO" != "200" ]]; then
  echo "Falhou: $SITE_URL/ respondeu $CODIGO" >&2
  exit 1
fi
if curl -sS "$SITE_URL/" | cmp -s - dist/index.html; then
  echo "OK: $SITE_URL/ responde 200 e o index.html é igual ao local."
else
  echo "Atenção: $SITE_URL/ responde 200, mas o index.html difere do local." >&2
  exit 1
fi
