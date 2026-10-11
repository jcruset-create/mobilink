#!/usr/bin/env bash
#
# Volcado del ESQUEMA de una base, sin una sola fila de datos.
#
# Lo ejecuta una persona con credencial. Este script NO lleva credenciales ni
# las pide por teclado: lee la cadena de conexión de ORIGEN_URL, que se pone
# en el entorno de la sesión y no se guarda en ningún fichero del repositorio.
#
#   ORIGEN_URL='postgresql://…' bash scripts/staging/01-volcar-esquema.sh salida.sql
#
# Qué hace y qué no:
#   · --schema-only: definiciones, nada de contenido. Ni una fila.
#   · --no-owner --no-privileges: el DDL no arrastra dueños ni permisos de
#     roles que en pruebas no existen, que es la causa típica de que una
#     restauración muera a mitad.
#   · --schema=public: solo el esquema de la aplicación. auth, storage, cron y
#     net los gestiona Supabase y no se tocan.
#   · NO escribe en el origen. pg_dump abre una transacción de solo lectura.
set -euo pipefail

SALIDA="${1:-esquema-produccion.sql}"
: "${ORIGEN_URL:?Falta ORIGEN_URL (cadena de conexión del origen). No se escribe en ningún fichero.}"

if [[ -e "$SALIDA" ]]; then
  echo "Ya existe '$SALIDA'. No lo sobrescribo: mueve o borra el anterior." >&2
  exit 1
fi

# A dónde se está apuntando, sin enseñar la contraseña. Quien lo lanza tiene
# que reconocer el host antes de seguir.
python3 - "$ORIGEN_URL" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
print(f"Origen: host={u.hostname} puerto={u.port or 5432} base={(u.path or '/').lstrip('/')}")
PY
read -r -p "¿Es ese el origen que quieres volcar? [escribe: si] " ok
[[ "$ok" == "si" ]] || { echo "Cancelado."; exit 1; }

pg_dump "$ORIGEN_URL" \
  --schema-only --no-owner --no-privileges --schema=public \
  --file "$SALIDA"

echo "Hecho: $SALIDA ($(wc -l < "$SALIDA") líneas)"
echo
echo "AHORA, antes de restaurarlo en ninguna parte:"
echo "  bash scripts/staging/02-revisar-ddl.sh $SALIDA"
echo
echo "Y comprueba que no se ha colado ningún dato:"
echo "  grep -c '^COPY ' $SALIDA   # tiene que dar 0"
