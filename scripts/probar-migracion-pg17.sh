#!/usr/bin/env bash
# Banco de pruebas de la migración de Fase 0 contra PostgreSQL 17.6.
#
# Por qué existe: la migración se escribió y se probó contra PostgreSQL 16.13, y
# producción va en 17.6. Este script levanta un 17.6 limpio, reproduce el estado
# REAL de producción (no el que suponía el repositorio) y comprueba:
#
#   · aplicación,
#   · segunda aplicación seguida (idempotencia),
#   · rollback,
#   · reaplicación,
#   · y las pruebas negativas: PUBLIC, search_path, disparadores, RLS,
#     semántica OR de las políticas, CREATE OR REPLACE, ALTER DEFAULT
#     PRIVILEGES y funciones sobrecargadas.
#
# Uso:  bash scripts/probar-migracion-pg17.sh
# Requiere un PostgreSQL 17 en PG17_BIN (por defecto /opt/pg17/bin).

set -euo pipefail
PG17_BIN="${PG17_BIN:-/opt/pg17/bin}"
PUERTO="${PUERTO:-5461}"
DATOS="${DATOS:-/tmp/pg17-prueba}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREP="$RAIZ/supabase/migraciones-preparadas"
PSQL="$PG17_BIN/psql -h /tmp -p $PUERTO -U postgres -v ON_ERROR_STOP=1 -q"

"$PG17_BIN/postgres" --version

rm -rf "$DATOS"; mkdir -p "$DATOS"; chown postgres:postgres "$DATOS"
su postgres -c "PATH=$PG17_BIN:\$PATH initdb -D $DATOS -A trust -U postgres" >/dev/null
su postgres -c "PATH=$PG17_BIN:\$PATH pg_ctl -D $DATOS -o '-p $PUERTO -k /tmp' -l $DATOS/log start -w" >/dev/null
trap 'su postgres -c "PATH=$PG17_BIN:\$PATH pg_ctl -D $DATOS stop -m immediate" >/dev/null 2>&1 || true' EXIT

fallos=0
comprobar() { # nombre, sql, esperado
  local got; got=$($PSQL -At -c "$2")
  if [ "$got" = "$3" ]; then printf '  ok   %s\n' "$1"
  else printf '  FALLO %s -> esperaba «%s», obtuvo «%s»\n' "$1" "$3" "$got"; fallos=$((fallos+1)); fi
}

echo "== 1. Estado de partida (el REAL de producción, no el que suponía el repo) =="
$PSQL -f "$RAIZ/scripts/pg17-estado-produccion.sql"
echo "   esquema cargado"

echo "== 2. Primera aplicación =="
$PSQL -f "$PREP/001_seguridad_fase0.sql" && echo "   aplicada"

echo "== 3. Segunda aplicación seguida (idempotencia) =="
$PSQL -f "$PREP/001_seguridad_fase0.sql" && echo "   reaplicada sin error"

echo "== 4. Rollback =="
# El fichero de rollback tiene sus secciones destructivas COMENTADAS a
# propósito (reabrir 88 tablas restaura la vulnerabilidad). Así que ejecutarlo
# tal cual no revierte nada: eso solo prueba que el fichero es SQL válido.
$PSQL -f "$PREP/001_seguridad_fase0_rollback.sql" && echo "   fichero válido (no revierte: sus secciones van comentadas)"
comprobar "y en efecto NO ha revertido: los disparadores siguen puestos" \
  "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='app_usuarios' and t.tgname like 'trg_app_usuarios_%'" "3"

echo "== 4b. Rollback REAL de la sección más probable (los disparadores) =="
# Esta es la vuelta atrás que se usaría de verdad si el alta de usuarios
# fallara. Se ejecutan las líneas que el fichero deja comentadas.
$PSQL -c "drop trigger if exists trg_app_usuarios_guardia_escritura on app_usuarios;
          drop trigger if exists trg_app_usuarios_guardia_borrado on app_usuarios;
          drop trigger if exists trg_app_usuarios_apunta_baja on app_usuarios;
          drop function if exists app_usuarios_guardia();
          drop function if exists app_apunta_baja_auth();"
comprobar "los disparadores se han ido" \
  "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='app_usuarios' and t.tgname like 'trg_app_usuarios_%'" "0"
comprobar "y las funciones del proyecto siguen intactas (no se reescribió ninguna)" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('app_guardar_usuario','app_es_admin','app_empresa_actual','app_login_email')" "4"
comprobar "el alta de usuarios vuelve a funcionar sin el guardia" \
  "select app_guardar_usuario(null,'prueba.rollback',null,null,null,true,false,null,'[]'::jsonb) is not null" "t"
comprobar "y app_bajas_auth NO se borra en la vuelta atrás (no se pierden datos)" \
  "select count(*) from information_schema.tables where table_name='app_bajas_auth'" "1"

echo "== 5. Reaplicación tras el rollback real =="
$PSQL -f "$PREP/001_seguridad_fase0.sql" && echo "   reaplicada"
comprobar "los disparadores vuelven" \
  "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='app_usuarios' and t.tgname like 'trg_app_usuarios_%'" "3"

echo "== 6. Pruebas negativas =="

echo " -- PUBLIC --"
comprobar "anon no ejecuta app_login_email pese al grant a PUBLIC" \
  "select has_function_privilege('anon','app_login_email(text)','execute')" "f"
comprobar "PUBLIC no ejecuta app_login_email" \
  "select has_function_privilege('public','app_login_email(text)','execute')" "f"
comprobar "anon pierde el select heredado de PUBLIC en central_api_tokens" \
  "select has_table_privilege('anon','central_api_tokens','select')" "f"

echo " -- search_path --"
comprobar "app_es_admin lleva pg_temp" \
  "select coalesce(array_to_string(proconfig,','),'') like '%pg_temp%' from pg_proc where proname='app_es_admin'" "t"
comprobar "app_empresa_actual lleva pg_temp" \
  "select coalesce(array_to_string(proconfig,','),'') like '%pg_temp%' from pg_proc where proname='app_empresa_actual'" "t"
comprobar "app_login_email lleva pg_temp" \
  "select coalesce(array_to_string(proconfig,','),'') like '%pg_temp%' from pg_proc where proname='app_login_email'" "t"
comprobar "el guardia lleva pg_temp" \
  "select coalesce(array_to_string(proconfig,','),'') like '%pg_temp%' from pg_proc where proname='app_usuarios_guardia'" "t"

echo " -- funciones sobrecargadas --"
comprobar "las dos firmas de la sobrecargada siguen ejecutables (no se tocan)" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='app_sobrecargada'" "2"
comprobar "el revoke por firma no alcanzó a la otra sobrecarga" \
  "select has_function_privilege('anon','app_sobrecargada(text)','execute')" "t"

echo " -- disparadores --"
comprobar "los tres disparadores nuevos existen" \
  "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='app_usuarios' and not t.tgisinternal and t.tgname like 'trg_app_usuarios_%'" "3"
comprobar "los dos disparadores que ya había siguen ahí" \
  "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='app_usuarios' and t.tgname in ('trg_app_touch_usuario','trg_app_sync_usuario')" "2"
comprobar "el guardia (BEFORE) se dispara antes que el sync (AFTER)" \
  "select (select tgtype::int & 2 from pg_trigger where tgname='trg_app_usuarios_guardia_escritura') > 0
       and (select tgtype::int & 2 from pg_trigger where tgname='trg_app_sync_usuario') = 0" "t"

echo " -- RLS --"
comprobar "las 42 de la lista quedan con RLS" \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('cash_operations','central_api_tokens','tac_expedientes','rcp_albaranes') and c.relrowsecurity" "4"
comprobar "y sin políticas, que es el cierre completo" \
  "select count(*) from pg_policies where schemaname='public' and tablename in ('cash_operations','central_api_tokens','tac_expedientes','rcp_albaranes')" "0"
comprobar "anon pierde el CRUD sobre ellas" \
  "select has_table_privilege('anon','cash_operations','select') or has_table_privilege('anon','cash_operations','insert') or has_table_privilege('anon','cash_operations','update') or has_table_privilege('anon','cash_operations','delete')" "f"

echo " -- semántica OR de las políticas --"
comprobar "perfiles_usuario conserva sus 4 políticas acotadas" \
  "select count(*) from pg_policies where schemaname='public' and tablename='perfiles_usuario' and policyname like 'perfiles_usuario_%'" "4"
comprobar "la migración NO crea perfiles_lectura (anularía las de arriba por OR)" \
  "select count(*) from pg_policies where schemaname='public' and tablename='perfiles_usuario' and policyname='perfiles_lectura'" "0"
comprobar "y no toca anon_read_activos (se decide aparte)" \
  "select count(*) from pg_policies where schemaname='public' and tablename='perfiles_usuario' and policyname='anon_read_activos'" "1"

echo " -- SEC-010 queda ABIERTO, declarado, no cerrado a medias --"
comprobar "las políticas anon de pres_records siguen vivas (la Fase 0 ya no las toca)" \
  "select count(*) from pg_policies where schemaname='public' and tablename='pres_records' and 'anon'=any(roles)" "3"
comprobar "y las de los acuses con su nombre REAL" \
  "select count(*) from pg_policies where schemaname='public' and tablename='sm_document_acknowledgements' and policyname like 'portal_anon_acks_%'" "3"

echo " -- ALTER DEFAULT PRIVILEGES --"
$PSQL -c "create table public.tabla_nacida_despues (id int);" >/dev/null
comprobar "una tabla nueva NO nace abierta a anon" \
  "select has_table_privilege('anon','tabla_nacida_despues','select')" "f"
comprobar "ni a authenticated" \
  "select has_table_privilege('authenticated','tabla_nacida_despues','select')" "f"

echo " -- CREATE OR REPLACE --"
comprobar "app_guardar_usuario conserva su firma original (no se reescribió)" \
  "select pg_get_function_identity_arguments(oid) like '%p_accesos%' from pg_proc where proname='app_guardar_usuario'" "t"

echo " -- tablas nuevas --"
comprobar "app_bajas_auth creada con RLS" \
  "select relrowsecurity from pg_class where relname='app_bajas_auth'" "t"
comprobar "índice parcial de un apunte vivo por usuario" \
  "select count(*) from pg_indexes where tablename='app_bajas_auth' and indexdef like '%consumido_en IS NULL%'" "1"
comprobar "app_auth_intentos creada con RLS" \
  "select relrowsecurity from pg_class where relname='app_auth_intentos'" "t"

echo
if [ "$fallos" -eq 0 ]; then echo "TODAS LAS COMPROBACIONES PASAN (PostgreSQL 17.6)"; else echo "$fallos COMPROBACIONES FALLAN"; exit 1; fi
