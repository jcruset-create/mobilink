#!/usr/bin/env bash
#
# Repasa un DDL volcado antes de restaurarlo en un entorno de pruebas.
#
# Un `pg_dump --schema-only` no es inerte: puede traer trabajos programados,
# llamadas HTTP salientes, conexiones a otras bases y disparadores de DDL. Si
# se restauran tal cual, se ejecutan en pruebas y pueden salir al mundo.
#
#   bash scripts/staging/02-revisar-ddl.sh esquema-produccion.sql
#
# No modifica el fichero: escribe <fichero>.avisos con el número de línea de
# cada hallazgo para repasarlos uno a uno y comentarlos a mano.
set -euo pipefail

DDL="${1:?Falta el fichero de DDL}"
AVISOS="$DDL.avisos"
: > "$AVISOS"
TOTAL=0

mirar() {   # mirar "etiqueta" "patrón grep -E"
  local etiqueta="$1" patron="$2" n
  n=$(grep -nEi "$patron" "$DDL" || true)
  if [[ -n "$n" ]]; then
    local c; c=$(printf '%s\n' "$n" | wc -l)
    TOTAL=$((TOTAL + c))
    { echo "## $etiqueta ($c)"; printf '%s\n' "$n"; echo; } >> "$AVISOS"
    printf '  %-42s %s\n' "$etiqueta" "$c"
  else
    printf '  %-42s —\n' "$etiqueta"
  fi
}

echo "Repasando $DDL ($(wc -l < "$DDL") líneas)"
echo
echo "Lo que no puede ejecutarse en pruebas tal cual:"
mirar "trabajos programados (pg_cron)"            "cron\.(schedule|unschedule|job)"
mirar "llamadas HTTP desde la base (pg_net)"      "net\.http_(post|get|delete)"
mirar "conexiones a otras bases (dblink/fdw)"     "dblink|postgres_fdw|create (server|user mapping)|foreign data wrapper"
mirar "disparadores de DDL (event trigger)"       "create event trigger"
mirar "replicación (publication/subscription)"    "create (publication|subscription)"
mirar "URLs dentro de funciones"                  "https?://[a-z0-9.-]+"
mirar "correo y mensajería escritos en el código" "smtp|twilio|sendgrid|whatsapp"
mirar "pagos escritos en el código"               "stripe"
echo
echo "Lo que no es peligroso pero rompe la restauración:"
mirar "dueños y permisos de roles"                "^(alter .* owner to|grant |revoke )"
mirar "extensiones que el destino puede no tener" "^create extension"
echo
echo "Y la comprobación de que no se ha colado contenido:"
FILAS=$(grep -c '^COPY ' "$DDL" || true)
printf '  %-42s %s\n' "bloques de datos (COPY)" "$FILAS"
echo
if [[ "$FILAS" != "0" ]]; then
  echo "PARA. Ese volcado trae DATOS, no solo esquema. No sirve." >&2
  exit 2
fi
echo "Hallazgos: $TOTAL · detalle con número de línea en $AVISOS"
echo
echo "Antes de restaurar, comenta a mano en el DDL lo del primer bloque."
echo "Lo del segundo se puede dejar: la restauración avisará de lo que falte."
