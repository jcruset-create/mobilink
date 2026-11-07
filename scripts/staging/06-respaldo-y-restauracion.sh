#!/usr/bin/env bash
#
# La copia de seguridad, y la prueba de que SIRVE.
#
# Hacer un volcado no es tener respaldo: lo que cuenta es haber restaurado y
# visto que vuelve. Esto hace las dos cosas contra bases de pruebas, antes de
# tocar nada en el entorno:
#
#   1. volcado de la base de pruebas (pg_dump --format=custom, lo mismo que
#      `npm run db:dump`);
#   2. restauración en OTRA base nueva;
#   3. comparación de los recuentos que importan entre las dos.
#
#   ORIGEN_DB=esquema_completo COPIA_DB=esquema_completo_copia \
#   bash scripts/staging/06-respaldo-y-restauracion.sh [fichero.dump]
#
# No toca producción: las dos bases tienen que llamarse como una base de
# pruebas o el script se niega.
set -uo pipefail

ORIGEN_DB="${ORIGEN_DB:-esquema_completo}"
COPIA_DB="${COPIA_DB:-${ORIGEN_DB}_copia}"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-mobilink}"
DUMP="${1:-/tmp/$ORIGEN_DB-$(date +%Y%m%d-%H%M%S).dump}"

for b in "$ORIGEN_DB" "$COPIA_DB"; do
  case "$b" in banco_*|esquema_completo*) ;;
    *) echo "Base no permitida: '$b'. Solo bases de pruebas." >&2; exit 1;; esac
done

FALLOS=0
ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }
CUENTAS="select 'intervenciones', count(*) from tc_intervenciones
 union all select 'operaciones', count(*) from operaciones_neumaticos
 union all select 'fichas', count(*) from tc_neumaticos
 union all select 'intervalos', count(*) from tc_reconstruccion_montajes
 union all select 'revisiones', count(*) from tc_reconstruccion_revisiones
 union all select 'bloqueados', count(*) from tc_importacion_bloqueados
 order by 1"

echo "1. Volcado de $ORIGEN_DB"
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ORIGEN_DB" --format=custom --file "$DUMP" \
  && ok "copia creada: $DUMP ($(du -h "$DUMP" | cut -f1))" || { mal "no se ha podido volcar"; exit 1; }

echo "2. Restauración en $COPIA_DB (base nueva, nunca encima de la original)"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -qc "drop database if exists $COPIA_DB" \
  -c "create database $COPIA_DB" || { mal "no se ha podido crear $COPIA_DB"; exit 1; }
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$COPIA_DB" --no-owner --no-privileges "$DUMP" \
  > /tmp/restore.log 2>&1
# pg_restore avisa de lo que no puede recrear (roles, extensiones); lo que
# importa es si los datos han llegado, y eso se mira comparando.
ok "restauración terminada ($(grep -c . /tmp/restore.log) aviso(s) en /tmp/restore.log)"

echo "3. ¿Vuelve lo mismo?"
A=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ORIGEN_DB" -At -F '=' -c "$CUENTAS")
B=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$COPIA_DB"  -At -F '=' -c "$CUENTAS")
if [[ "$A" == "$B" ]]; then
  ok "los recuentos coinciden"
  printf '%s\n' "$A" | sed 's/^/    /'
else
  mal "los recuentos NO coinciden"
  diff <(printf '%s\n' "$A") <(printf '%s\n' "$B") | sed 's/^/    /'
fi

echo
echo "La copia se queda en $DUMP. Para volver atrás en el entorno de pruebas:"
echo "  pg_restore -d <base_nueva> --no-owner --no-privileges $DUMP"
echo "y se cambia el destino del servidor, nunca restaurando encima de la base viva."
[[ "$FALLOS" -gt 0 ]] && exit 1
echo "Respaldo probado: el volcado se restaura y vuelve igual."
