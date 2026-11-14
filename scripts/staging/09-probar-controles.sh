#!/usr/bin/env bash
#
# Prueba los DOS controles del destino sobre bases locales de usar y tirar:
# el de inicialización de un proyecto nuevo y el de operaciones posteriores.
# Comprueba tanto que dejan pasar lo que deben como que rechazan lo que no.
#
#   bash scripts/staging/09-probar-controles.sh
#
# No sale de 127.0.0.1 y solo toca una base llamada `esquema_completo_ctrl`,
# que crea y borra. No necesita Supabase ni red.
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-mobilink}"
BASE=esquema_completo_ctrl
URL="postgresql://$PGUSER@$PGHOST:$PGPORT/$BASE"
export REF_PRUEBAS="proyectodepruebas" REF_PRODUCCION="proyectodeproduccion"
export SUPABASE_URL="http://127.0.0.1:3002" VITE_SUPABASE_URL="http://127.0.0.1:3002"

FALLOS=0
caso() { printf '\n── %s\n' "$1"; }
ok()   { printf '  OK    %s\n' "$1"; }
mal()  { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }

recrear() {
  psql "postgresql://$PGUSER@$PGHOST:$PGPORT/postgres" -q -c "drop database if exists $BASE" >/dev/null 2>&1
  psql "postgresql://$PGUSER@$PGHOST:$PGPORT/postgres" -q -c "create database $BASE" >/dev/null
}
marca() { psql "$URL" -At -c "select coalesce(current_setting('mobilink.entorno', true), '(sin marca)')" 2>/dev/null; }
trap 'psql "postgresql://'"$PGUSER"'@'"$PGHOST"':'"$PGPORT"'/postgres" -q -c "drop database if exists '"$BASE"'" >/dev/null 2>&1' EXIT

recrear

caso "1. Base nueva SIN marcar: la comprobación de operaciones tiene que rechazarla"
SALIDA=$(DATABASE_URL="$URL" bash "$AQUI/00-comprobar-destino.sh" 2>&1); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "rechazada (código $CODIGO)" || mal "la ha dejado pasar sin marca"
grep -q "NO está marcada como pruebas" <<<"$SALIDA" && ok "dice que falta la marca" || mal "no explica que falta la marca"
grep -q "00-inicializar-destino.sh" <<<"$SALIDA" && ok "manda a la inicialización" || mal "no dice cómo marcarla"
grep -q "No la pongas a mano" <<<"$SALIDA" && ok "avisa de no ponerla a mano" || mal "no avisa de ponerla a mano"

caso "2. Destino equivocado: el host de PRODUCCIÓN"
SALIDA=$(DATABASE_URL="postgresql://u@db.$REF_PRODUCCION.supabase.co:5432/postgres" \
         bash "$AQUI/00-comprobar-destino.sh" 2>&1); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "la comprobación de operaciones lo rechaza (código $CODIGO)" || mal "ha dejado pasar producción"
grep -q "PRODUCCIÓN" <<<"$SALIDA" && ok "lo dice con todas las letras" || mal "no dice que es producción"
grep -q "ni siquiera se ha abierto conexión" <<<"${SALIDA,,}" && ok "ni se conecta" || mal "no deja claro que no se conecta"
SALIDA=$(DATABASE_URL="postgresql://u@db.$REF_PRODUCCION.supabase.co:5432/postgres" \
         bash "$AQUI/00-inicializar-destino.sh" 2>&1 <<<"marcar como pruebas"); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "la inicialización también lo rechaza (código $CODIGO)" || mal "la inicialización ha dejado pasar producción"
grep -q "NO se inicializa nada y NO se marca nada" <<<"$SALIDA" && ok "y no marca nada" || mal "no deja claro que no marca"

caso "3. Destino desconocido: ni el de pruebas ni local"
for URL_MALA in "postgresql://u@db.otroproyecto.supabase.co:5432/postgres" "postgresql://u@192.0.2.50:5432/postgres"; do
  SALIDA=$(DATABASE_URL="$URL_MALA" bash "$AQUI/00-comprobar-destino.sh" 2>&1); CODIGO=$?
  [[ $CODIGO -ne 0 ]] && ok "rechazado: $URL_MALA" || mal "ha dejado pasar $URL_MALA"
  SALIDA=$(DATABASE_URL="$URL_MALA" bash "$AQUI/00-inicializar-destino.sh" 2>&1 <<<"marcar como pruebas"); CODIGO=$?
  [[ $CODIGO -ne 0 ]] && ok "la inicialización también lo rechaza" || mal "la inicialización ha dejado pasar $URL_MALA"
done

caso "4. Los ficheros SQL no se ejecutan en una base sin marcar"
for f in permisos-pruebas.sql semilla-staging.sql; do
  SALIDA=$(psql "$URL" -v ON_ERROR_STOP=1 -f "$AQUI/$f" 2>&1); CODIGO=$?
  [[ $CODIGO -ne 0 ]] && ok "$f se niega (código $CODIGO)" || mal "$f se ha ejecutado sin marca"
  grep -qi "no esta\|no está" <<<"$SALIDA" && ok "  y dice por qué" || mal "  sin explicación"
done

caso "5. Inicialización en condiciones: base nueva y vacía"
[[ "$(marca)" == "(sin marca)" ]] && ok "antes no hay marca" || mal "ya venía marcada: $(marca)"
SALIDA=$(DATABASE_URL="$URL" bash "$AQUI/00-inicializar-destino.sh" 2>&1 <<<"marcar como pruebas"); CODIGO=$?
[[ $CODIGO -eq 0 ]] && ok "la inicialización pasa (código $CODIGO)" || { mal "ha fallado"; echo "$SALIDA" | sed 's/^/        /'; }
[[ "$(marca)" == "pruebas" ]] && ok "y ahora la base está marcada" || mal "no ha marcado la base"

caso "6. Sin confirmar, no se marca"
recrear
SALIDA=$(DATABASE_URL="$URL" bash "$AQUI/00-inicializar-destino.sh" 2>&1 <<<"si"); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "cancela si no se escribe la frase (código $CODIGO)" || mal "ha marcado con una confirmación floja"
[[ "$(marca)" == "(sin marca)" ]] && ok "y la base sigue sin marca" || mal "la ha marcado igualmente"

caso "7. Operaciones sobre la base ya inicializada"
DATABASE_URL="$URL" bash "$AQUI/00-inicializar-destino.sh" >/dev/null 2>&1 <<<"marcar como pruebas"
SALIDA=$(DATABASE_URL="$URL" bash "$AQUI/00-comprobar-destino.sh" 2>&1); CODIGO=$?
[[ $CODIGO -eq 0 ]] && ok "ahora sí pasa la comprobación de operaciones" || { mal "sigue sin pasar"; echo "$SALIDA" | sed 's/^/        /'; }

caso "8. La inicialización no se repite sobre una base ya marcada"
SALIDA=$(DATABASE_URL="$URL" bash "$AQUI/00-inicializar-destino.sh" 2>&1 <<<"marcar como pruebas"); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "se niega (código $CODIGO)" || mal "ha vuelto a inicializar una base ya marcada"
grep -q "YA está marcada" <<<"$SALIDA" && ok "y dice que ya lo estaba" || mal "no lo explica"

caso "9. La inicialización no marca una base que ya tiene esquema"
recrear
psql "$URL" -q -c "create table tc_vehiculos (id uuid primary key)" >/dev/null
SALIDA=$(DATABASE_URL="$URL" bash "$AQUI/00-inicializar-destino.sh" 2>&1 <<<"marcar como pruebas"); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "se niega con tablas tc_* ya creadas (código $CODIGO)" || mal "ha marcado una base con esquema"
grep -q "la base no está vacía" <<<"$SALIDA" && ok "y dice que no está vacía" || mal "no lo explica"
[[ "$(marca)" == "(sin marca)" ]] && ok "y no la ha marcado" || mal "la ha marcado igualmente"

caso "10. La marca sola no abre la puerta: el destino se sigue mirando"
recrear
DATABASE_URL="$URL" bash "$AQUI/00-inicializar-destino.sh" >/dev/null 2>&1 <<<"marcar como pruebas"
SALIDA=$(DATABASE_URL="$URL" SUPABASE_URL="https://$REF_PRODUCCION.supabase.co" \
         bash "$AQUI/00-comprobar-destino.sh" 2>&1); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "con la marca puesta pero SUPABASE_URL de producción, rechaza (código $CODIGO)" \
                    || mal "la marca ha tapado un SUPABASE_URL de producción"
SALIDA=$(DATABASE_URL="$URL" STRIPE_SECRET_KEY="sk_live_loquesea" \
         bash "$AQUI/00-comprobar-destino.sh" 2>&1); CODIGO=$?
[[ $CODIGO -ne 0 ]] && ok "y con credenciales externas definidas, también (código $CODIGO)" \
                    || mal "ha dejado pasar credenciales externas"

echo
if [[ "$FALLOS" -gt 0 ]]; then echo "$FALLOS comprobación(es) sin pasar." >&2; exit 1; fi
echo "Los dos controles del destino se comportan como deben."
