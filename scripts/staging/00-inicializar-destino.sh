#!/usr/bin/env bash
#
# PASO 0 de un proyecto NUEVO, y una sola vez: identificar el proyecto de
# pruebas autorizado, comprobar que la base está vacía y marcarla. Después de
# esto —y solo después— se puede restaurar.
#
#   DATABASE_URL=…  REF_PRUEBAS=<subdominio del proyecto de pruebas> \
#   REF_PRODUCCION=<subdominio del de producción> \
#   bash scripts/staging/00-inicializar-destino.sh
#
# Por qué existe aparte de 00-comprobar-destino.sh: esa comprobación exige la
# marca `mobilink.entorno = 'pruebas'`, y una base recién creada no la tiene.
# Si fuera el propio control el que la pusiera, el control no valdría para
# nada. Así que ponerla es un paso explícito que antes:
#
#   1. identifica el proyecto de pruebas autorizado y el destino de conexión,
#   2. rechaza producción sin llegar a conectarse,
#   3. comprueba que la base es NUEVA (sin esquema de la aplicación, sin
#      datos, sin marca previa),
#   4. pide confirmación escrita,
#   5. y solo entonces marca.
#
# No se le pone la marca a una base «para que pase el control»: si la base ya
# tiene esquema o datos, este script se niega y hay que mirar qué base es.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/destino-comun.sh"

: "${DATABASE_URL:?Falta DATABASE_URL: no se puede inicializar nada}"
: "${REF_PRUEBAS:?Falta REF_PRUEBAS (subdominio del proyecto Supabase de pruebas)}"
: "${REF_PRODUCCION:?Falta REF_PRODUCCION (subdominio del de producción, para descartarlo)}"

echo "INICIALIZACIÓN DE UN PROYECTO NUEVO DE PRUEBAS"
echo
echo "1. El proyecto autorizado y el destino de la conexión"
echo "   proyecto de pruebas autorizado: $REF_PRUEBAS"
echo "   proyecto de producción (a descartar): $REF_PRODUCCION"
if ! comprobar_destino_conexion; then
  echo
  echo "El destino no está autorizado. NO se inicializa nada y NO se marca nada." >&2
  exit 1
fi

echo
echo "2. Los proyectos Supabase del servidor"
comprobar_proyecto_supabase no

echo
echo "3. Credenciales externas"
comprobar_credenciales_externas

echo
echo "4. ¿Es una base NUEVA?"
if ! psql "$DATABASE_URL" -At -c "select 1" >/dev/null 2>&1; then
  mal "no se puede conectar con DATABASE_URL"
  echo; echo "Sin conexión no hay nada que comprobar. NO se marca." >&2; exit 1
fi
MARCA=$(leer_marca)
if [[ -n "$MARCA" ]]; then
  mal "la base YA está marcada como '$MARCA': esto no es un proyecto nuevo"
  echo "        Si es la de pruebas de siempre, usa 00-comprobar-destino.sh."
  echo "        Si no sabes de dónde sale la marca, PARA y averígualo."
else
  ok "no tiene marca previa"
fi
TC=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_tables where schemaname='public' and tablename like 'tc\_%'" 2>/dev/null)
[[ "$TC" == "0" ]] && ok "no hay ninguna tabla tc_* en public" \
                   || mal "ya hay $TC tablas tc_*: la base no está vacía"
OTRAS=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_tables where schemaname='public'" 2>/dev/null)
[[ "$OTRAS" == "0" ]] && ok "el esquema public no tiene ninguna tabla" \
                      || printf '  AVISO %s\n' "public ya tiene $OTRAS tabla(s); mira qué son antes de restaurar"
FUN=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tc\_%'" 2>/dev/null)
[[ "$FUN" == "0" ]] && ok "no hay funciones tc_* en public" || mal "ya hay $FUN funciones tc_*"

echo
if [[ "$FALLOS" -gt 0 ]]; then
  echo "$FALLOS comprobación(es) sin pasar. NO se marca la base y NO se restaura nada." >&2
  exit 1
fi

BASE_REAL=$(psql "$DATABASE_URL" -At -c "select current_database()")
echo "Todo en orden. Se va a marcar la base '$BASE_REAL' de $HOST como entorno de PRUEBAS."
echo "Producción no lleva esa marca y no se le pone nunca."
read -r -p "¿Marco esta base? [escribe: marcar como pruebas] " respuesta
[[ "$respuesta" == "marcar como pruebas" ]] || { echo "Cancelado. No se ha tocado nada."; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "alter database \"$BASE_REAL\" set mobilink.entorno = 'pruebas'" \
  || { echo "No se ha podido marcar la base." >&2; exit 1; }

echo
echo "Marcada. La marca se lee en una conexión NUEVA:"
echo "  psql \"\$DATABASE_URL\" -At -c \"select current_setting('mobilink.entorno', true)\""
echo
echo "A partir de aquí, TODO lo que escriba pasa primero por la comprobación de"
echo "operaciones, que exige destino autorizado Y marca:"
echo "  bash scripts/staging/00-comprobar-destino.sh"
