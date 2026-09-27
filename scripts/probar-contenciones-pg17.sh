#!/usr/bin/env bash
# Prueba las dos contenciones urgentes contra PostgreSQL 17.6 de laboratorio:
#   005  vistas con privilegios del propietario (SEC-068)
#   007  escritura anonima en Safety (SEC-008 ampliado)
#
# Mide antes y despues, y comprueba la vuelta atras de las dos.
#
# NINGUNA de estas pruebas toca produccion: se ejecutan contra una instancia
# local y efimera que se borra al terminar.
set -uo pipefail
PG17_BIN="${PG17_BIN:-/opt/pg17/bin}"; PUERTO="${PUERTO:-5473}"; DATOS="${DATOS:-/tmp/pg17-cont}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; PREP="$RAIZ/supabase/migraciones-preparadas"
PSQL="$PG17_BIN/psql -h /tmp -p $PUERTO -U postgres -At"
rm -rf "$DATOS"; mkdir -p "$DATOS"; chown postgres:postgres "$DATOS"
su postgres -c "PATH=$PG17_BIN:\$PATH initdb -D $DATOS -A trust -U postgres" >/dev/null
su postgres -c "PATH=$PG17_BIN:\$PATH pg_ctl -D $DATOS -o '-p $PUERTO -k /tmp' -l $DATOS/log start -w" >/dev/null
trap 'su postgres -c "PATH=$PG17_BIN:\$PATH pg_ctl -D $DATOS stop -m immediate" >/dev/null 2>&1; rm -rf "$DATOS"' EXIT

fallos=0
escribir() { local out; out=$($PSQL -c "begin; set local role $1; $2; select 'RES:PASA'; rollback;" 2>&1)
  if echo "$out" | grep -q "RES:PASA"; then echo "PASA"; else echo "denegado"; fi; }
leer() { local out; out=$($PSQL -c "begin; set local role $1; select 'RES:'||count(*) from $2; rollback;" 2>&1)
  if echo "$out" | grep -q "RES:"; then echo "$out"|grep -o 'RES:[0-9]*'|cut -d: -f2; else echo "denegado"; fi; }
esperar() { if [ "$2" = "$3" ]; then printf '  ok    %s\n' "$1"; else printf '  FALLO %s -> esperaba «%s», obtuvo «%s»\n' "$1" "$3" "$2"; fallos=$((fallos+1)); fi; }

$PSQL -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/pg17-safety-produccion.sql" >/dev/null 2>&1 || { echo "fallo cargando safety"; exit 1; }
echo "PostgreSQL: $($PG17_BIN/postgres --version)"

echo
echo "===== 007 · SAFETY ====="
echo "-- ANTES --"
esperar "anon LEE el fichero de personal"       "$(leer anon sea_employees)" "1"
esperar "anon MODIFICA el fichero de personal"  "$(escribir anon "update sea_employees set dni_nie='X'")" "PASA"
esperar "anon BORRA formacion"                  "$(escribir anon "delete from sea_training_records")" "PASA"
esperar "anon INSERTA una autorizacion de riesgo" "$(escribir anon "insert into sea_employee_authorizations (employee_id) values (gen_random_uuid())")" "PASA"
esperar "anon lee el pin_hash"                  "$(leer anon "(select pin_hash from sea_employees) x")" "1"

$PSQL -q -v ON_ERROR_STOP=1 -f "$PREP/007_contencion_safety.sql" >/dev/null 2>&1 && echo "007 aplicada" || { echo "FALLO aplicando 007"; exit 1; }
$PSQL -q -v ON_ERROR_STOP=1 -f "$PREP/007_contencion_safety.sql" >/dev/null 2>&1 && echo "007 reaplicada (idempotente)" || { echo "FALLO en la 2a pasada"; exit 1; }

echo "-- DESPUES --"
esperar "anon YA NO modifica el fichero"        "$(escribir anon "update sea_employees set dni_nie='X'")" "denegado"
esperar "anon YA NO borra formacion"            "$(escribir anon "delete from sea_training_records")" "denegado"
esperar "anon YA NO inserta autorizaciones"     "$(escribir anon "insert into sea_employee_authorizations (employee_id) values (gen_random_uuid())")" "denegado"
esperar "el portal SIGUE leyendo al empleado"   "$(leer anon sea_employees)" "1"
esperar "y el embebido de empresa (PortalFicha)" "$(leer anon sea_companies)" "1"
esperar "y el de centro de trabajo"             "$(leer anon sea_work_centers)" "1"
esperar "SeaHub sigue leyendo formacion"        "$(leer anon sea_training_records)" "1"
esperar "el panel autenticado sigue escribiendo" "$(escribir authenticated "update sea_employees set cargo='Jefa'")" "PASA"
echo "-- las seis comprobaciones de revision --"
# 1. Ninguna policy de authenticated eliminada por error.
esperar "1· las 10 policies de authenticated siguen intactas" \
  "$($PSQL -c "select 'RES:'||count(*) from pg_policies where schemaname='public'
      and tablename like 'sea\_%' and 'authenticated'=any(roles);" | grep -o 'RES:[0-9]*' | cut -d: -f2)" "10"
# 2. (cubierta arriba: el panel autenticado sigue escribiendo)
# 3. sea_companies y sea_work_centers conservan SOLO lectura para anon.
esperar "3· sea_companies deja a anon solo SELECT" \
  "$($PSQL -c "select 'RES:'||string_agg(cmd,',' order by cmd) from pg_policies
      where tablename='sea_companies' and 'anon'=any(roles);" | grep -o 'RES:.*' | cut -d: -f2)" "SELECT"
esperar "3· sea_work_centers deja a anon solo SELECT" \
  "$($PSQL -c "select 'RES:'||string_agg(cmd,',' order by cmd) from pg_policies
      where tablename='sea_work_centers' and 'anon'=any(roles);" | grep -o 'RES:.*' | cut -d: -f2)" "SELECT"
# 4. Ningun WITH CHECK de anon vivo en sea_*.
esperar "4· no queda ningun WITH CHECK de anon" \
  "$($PSQL -c "select 'RES:'||count(*) from pg_policies where schemaname='public'
      and tablename like 'sea\_%' and 'anon'=any(roles) and with_check is not null;" | grep -o 'RES:[0-9]*' | cut -d: -f2)" "0"
esperar "4· ni ninguna policy de anon que no sea SELECT" \
  "$($PSQL -c "select 'RES:'||count(*) from pg_policies where schemaname='public'
      and tablename like 'sea\_%' and 'anon'=any(roles) and cmd<>'SELECT';" | grep -o 'RES:[0-9]*' | cut -d: -f2)" "0"
# 5. Y tampoco por grants, que es el otro control.
esperar "5· anon no conserva INSERT/UPDATE/DELETE por grants en ninguna de las 10" \
  "$($PSQL -c "select 'RES:'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname like 'sea\_%'
        and (has_table_privilege('anon',c.oid,'insert') or has_table_privilege('anon',c.oid,'update')
          or has_table_privilege('anon',c.oid,'delete'));" | grep -o 'RES:[0-9]*' | cut -d: -f2)" "0"
esperar "5· y conserva el SELECT en las 10, que es lo que usa el portal" \
  "$($PSQL -c "select 'RES:'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname like 'sea\_%'
        and has_table_privilege('anon',c.oid,'select');" | grep -o 'RES:[0-9]*' | cut -d: -f2)" "10"
# 6. La idempotencia ya se ejerce arriba aplicandola dos veces seguidas.

echo "-- lo que NO cierra, declarado --"
esperar "anon SIGUE leyendo el pin_hash (abierto a proposito)" "$(leer anon "(select pin_hash from sea_employees) x")" "1"
echo "-- cambio de comportamiento declarado --"
$PSQL -q -c "update sea_employees set activo=false;" >/dev/null
esperar "anon deja de ver a un empleado de baja" "$(leer anon sea_employees)" "0"
$PSQL -q -c "update sea_employees set activo=true;" >/dev/null

echo "-- vuelta atras de 007 --"
$PSQL -q -c "
  drop policy if exists sea_anon_companies_lectura on sea_companies;
  drop policy if exists sea_anon_centers_lectura on sea_work_centers;
  create policy sea_anon_all on sea_employees for all to anon using (true) with check (true);
  create policy sea_anon_companies on sea_companies for all to anon using (true) with check (true);
  create policy sea_anon_centers on sea_work_centers for all to anon using (true) with check (true);
  create policy sea_anon_training on sea_training_records for all to anon using (true) with check (true);
  grant insert, update, delete on sea_employees, sea_companies, sea_work_centers,
    sea_training_records to anon;" >/dev/null 2>&1
esperar "la vuelta atras restaura la escritura" "$(escribir anon "update sea_employees set dni_nie='X'")" "PASA"

echo
echo "===== 005 · VISTAS ====="
$PSQL -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/pg17-vistas-produccion.sql" >/dev/null 2>&1
echo "-- ANTES --"
esperar "anon lee OTs por la vista"     "$(leer anon adm_ot_estado)" "1"
esperar "anon lee OTs directamente"     "$(leer anon adm_work_orders)" "0"
esperar "anon ESCRIBE clientes por la vista" "$(escribir anon "insert into tc_clientes_almacen (codigo,nombre,nif) values ('H','H','H')")" "PASA"
esperar "anon BORRA el catalogo de marcas"   "$(escribir anon "delete from tc_marcas_contadores")" "PASA"

$PSQL -q -v ON_ERROR_STOP=1 -f "$PREP/005_contencion_vistas.sql" >/dev/null 2>&1 && echo "005 aplicada" || { echo "FALLO aplicando 005"; exit 1; }
$PSQL -q -v ON_ERROR_STOP=1 -f "$PREP/005_contencion_vistas.sql" >/dev/null 2>&1 && echo "005 reaplicada (idempotente)" || { echo "FALLO en la 2a pasada"; exit 1; }

echo "-- DESPUES --"
esperar "anon ya no lee OTs"                 "$(leer anon adm_ot_estado)" "denegado"
esperar "anon ya no escribe clientes"        "$(escribir anon "insert into tc_clientes_almacen (codigo,nombre,nif) values ('H','H','H')")" "denegado"
esperar "anon ya no borra el catalogo"       "$(escribir anon "delete from tc_marcas_contadores")" "denegado"
panel=$($PSQL -c "begin; set local role authenticated; set local prueba.adm_read='1';
  select 'RES:'||count(*) from adm_ot_estado; rollback;" 2>&1 | grep -o 'RES:[0-9]*' | cut -d: -f2)
esperar "el panel sigue leyendo adm_ot_estado (ya como invoker)" "${panel:-denegado}" "1"
# La 005 ya no lleva los `alter default privileges`: se sacaron a su sitio, la
# Fase D. Esto lo fija, para que no vuelvan a colarse aqui sin decidirlo.
$PSQL -q -c "create table if not exists prueba_nacida_despues (id int);" >/dev/null 2>&1
esperar "005 ya NO toca los privilegios por defecto" \
  "$($PSQL -c "select 'RES:'||has_table_privilege('anon','prueba_nacida_despues','select');" | grep -o 'RES:.*' | cut -d: -f2)" "true"
esperar "adm_ot_estado quedo como invoker" \
  "$($PSQL -c "select 'RES:'||coalesce(array_to_string(reloptions,','),'-') from pg_class where relname='adm_ot_estado';" | grep -o 'RES:.*' | cut -d: -f2)" \
  "security_invoker=true"

echo "-- vuelta atras de 005 --"
$PSQL -q -c "alter view adm_ot_estado reset (security_invoker);
  grant select, insert, update, delete on adm_ot_estado, tc_clientes_almacen,
    tc_productos_almacen, tc_marcas_contadores to anon, authenticated;" >/dev/null 2>&1
esperar "la vuelta atras restaura el acceso" "$(leer anon adm_ot_estado)" "1"

echo
if [ "$fallos" -eq 0 ]; then echo "TODAS LAS COMPROBACIONES PASAN (PostgreSQL 17.6)"; else echo "$fallos COMPROBACIONES FALLAN"; exit 1; fi
