#!/usr/bin/env bash
# deploy-lock.sh — punto de entrada único para deploys de panel-secretarias.
# Impide disparar el deploy hook de Render si no han pasado al menos 10 minutos
# desde el último push, evitando saturar la cola de compilaciones.

set -euo pipefail

LOCK_FILE="/tmp/panel_secretarias_last_deploy"
MIN_INTERVAL=600   # 10 minutos en segundos
HOOK_URL="https://api.render.com/deploy/srv-d8c8b0q8qa3s73fpb1ng?key=afKT9V9X1OI"

now=$(date +%s)

if [[ -f "$LOCK_FILE" ]]; then
  last=$(cat "$LOCK_FILE")
  elapsed=$(( now - last ))
  remaining=$(( MIN_INTERVAL - elapsed ))

  if (( elapsed < MIN_INTERVAL )); then
    mins=$(( remaining / 60 ))
    secs=$(( remaining % 60 ))
    echo "⛔  Deploy bloqueado. Último deploy hace ${elapsed}s."
    echo "    Espera ${mins}m ${secs}s más antes de volver a desplegar."
    exit 1
  fi
fi

echo "✅  Ventana de tiempo OK. Iniciando deploy..."

# 1. Push a GitHub (el GitHub Action dispara el hook automáticamente)
git push origin main

# Registrar timestamp del deploy
echo "$now" > "$LOCK_FILE"
echo "🚀  Push enviado. Render procesará el deploy en unos minutos."
echo "    Próximo deploy permitido en: $(date -d "@$(( now + MIN_INTERVAL ))" '+%H:%M:%S' 2>/dev/null || date -r $(( now + MIN_INTERVAL )) '+%H:%M:%S')"
