#!/usr/bin/env bash
# El banco SQL de la migración en una base limpia. Imprime PASA/FALLA y el total.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
BASE="${1:-banco_imp}"; recrear_base "$BASE"; cd "$RAIZ"
SALIDA=$(PSQL -d "$BASE" -f supabase/pruebas/importacion_historico.sql 2>&1 | grep -E "PASA|FALLA|ERROR" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //')
echo "$SALIDA" | grep -vE "^PASA" || true
echo "PASA: $(echo "$SALIDA" | grep -c '^PASA') · FALLA: $(echo "$SALIDA" | grep -c '^FALLA')"
