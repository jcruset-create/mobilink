#!/usr/bin/env bash
#
# Restaura un DDL ya repasado en una base de PRUEBAS y la marca como tal.
#
#   DESTINO_URL='postgresql://…' bash scripts/staging/03-levantar-staging.sh esquema-produccion.sql
#
# Tres cosas, en este orden:
#   1. Se niega a tocar una base que no esté vacía de TyreControl. Así no se
#      puede confundir el destino con una base que ya tiene datos.
#   2. Restaura el DDL.
#   3. MARCA la base: `mobilink.entorno = 'pruebas'`. Esa marca es lo que
#      comprueban después los demás scripts y lo que hay que mirar antes de
#      arrancar Express, porque el arranque hace DDL sobre DATABASE_URL.
#
# Producción no tiene esa marca y no se le pone.
set -euo pipefail

DDL="${1:?Falta el fichero de DDL ya repasado}"
: "${DESTINO_URL:?Falta DESTINO_URL (cadena de conexión de la base de PRUEBAS)}"

if [[ ! -f "$DDL.avisos" ]]; then
  echo "No veo '$DDL.avisos': repasa el DDL antes de restaurarlo." >&2
  echo "  bash scripts/staging/02-revisar-ddl.sh $DDL" >&2
  exit 1
fi

python3 - "$DESTINO_URL" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
print(f"Destino: host={u.hostname} puerto={u.port or 5432} base={(u.path or '/').lstrip('/')}")
PY

YA=$(psql "$DESTINO_URL" -At -c "select count(*) from pg_tables where schemaname='public' and tablename like 'tc_%'")
if [[ "$YA" != "0" ]]; then
  echo "PARA. Esa base ya tiene $YA tablas tc_*: no es una base vacía de pruebas." >&2
  exit 2
fi
read -r -p "¿Restauro el esquema en ese destino? [escribe: si] " ok
[[ "$ok" == "si" ]] || { echo "Cancelado."; exit 1; }

psql "$DESTINO_URL" -v ON_ERROR_STOP=0 -f "$DDL"

# La marca. Hace falta una reconexión para que se lea.
BASE=$(psql "$DESTINO_URL" -At -c "select current_database()")
psql "$DESTINO_URL" -c "alter database \"$BASE\" set mobilink.entorno = 'pruebas'"
echo
echo "Marcada como entorno de pruebas. Compruébalo en una conexión NUEVA:"
echo "  psql \"\$DESTINO_URL\" -At -c \"select current_setting('mobilink.entorno', true)\""
echo
echo "Siguiente: la semilla de datos sintéticos."
echo "  psql \"\$DESTINO_URL\" -f scripts/staging/semilla-staging.sql"
