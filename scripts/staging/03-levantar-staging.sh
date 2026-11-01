#!/usr/bin/env bash
#
# Restaura un DDL ya repasado en la base de PRUEBAS ya inicializada.
#
#   DATABASE_URL='postgresql://…' REF_PRUEBAS=… REF_PRODUCCION=… \
#   SUPABASE_URL=… VITE_SUPABASE_URL=… \
#   bash scripts/staging/03-levantar-staging.sh esquema-produccion.sql
#
# Orden, que importa:
#   1. La comprobación de operaciones: destino autorizado Y marca. La marca ya
#      tiene que estar: la pone 00-inicializar-destino.sh sobre la base nueva
#      y vacía, ANTES de restaurar. Aquí no se pone ninguna marca.
#   2. Se niega a tocar una base que ya tenga tablas tc_*.
#   3. Restaura el DDL.
#   4. Aplica los permisos de la base de pruebas.
#
# Producción no tiene la marca y no se le pone.
set -euo pipefail

DDL="${1:?Falta el fichero de DDL ya repasado}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Compatibilidad: antes esto se llamaba DESTINO_URL.
export DATABASE_URL="${DATABASE_URL:-${DESTINO_URL:-}}"
: "${DATABASE_URL:?Falta DATABASE_URL (cadena de conexión de la base de PRUEBAS)}"

if [[ ! -f "$DDL.avisos" ]]; then
  echo "No veo '$DDL.avisos': repasa el DDL antes de restaurarlo." >&2
  echo "  bash scripts/staging/02-revisar-ddl.sh $DDL" >&2
  exit 1
fi

echo "── Comprobación de operaciones (destino Y marca) ────────────────"
bash "$AQUI/00-comprobar-destino.sh"
echo

YA=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_tables where schemaname='public' and tablename like 'tc\_%'")
if [[ "$YA" != "0" ]]; then
  echo "PARA. Esa base ya tiene $YA tablas tc_*: no es una base vacía de pruebas." >&2
  exit 2
fi
read -r -p "¿Restauro el esquema en ese destino? [escribe: si] " ok
[[ "$ok" == "si" ]] || { echo "Cancelado."; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$DDL"

echo
echo "── Permisos de la base de pruebas ───────────────────────────────"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$AQUI/permisos-pruebas.sql"
DESTINO_URL="$DATABASE_URL" bash "$AQUI/10-comprobar-permisos.sh"

echo
echo "Siguiente: la semilla de datos sintéticos (vuelve a pasar por el control)."
echo "  bash scripts/staging/00-comprobar-destino.sh && \\"
echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f scripts/staging/semilla-staging.sql"
