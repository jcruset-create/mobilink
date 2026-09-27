#!/usr/bin/env bash
# Matriz de privilegios EFECTIVOS de las vistas, ejercida de verdad contra un
# PostgreSQL 17.6 de laboratorio con el esquema y las politicas reales.
#
# No consulta el catalogo: EJECUTA cada operacion como cada rol y anota si pasa.
# Un grant dice lo que esta concedido; solo la ejecucion dice lo que ocurre,
# porque entre medias estan la RLS, el predicado de la vista y la
# actualizabilidad automatica.
#
# Toda escritura va dentro de una transaccion con ROLLBACK: no deja ni una fila.
#
# Uso: bash scripts/probar-vistas-pg17.sh
set -uo pipefail
PG17_BIN="${PG17_BIN:-/opt/pg17/bin}"
PUERTO="${PUERTO:-5471}"
DATOS="${DATOS:-/tmp/pg17-vistas}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL="$PG17_BIN/psql -h /tmp -p $PUERTO -U postgres -At"

rm -rf "$DATOS"; mkdir -p "$DATOS"; chown postgres:postgres "$DATOS"
su postgres -c "PATH=$PG17_BIN:\$PATH initdb -D $DATOS -A trust -U postgres" >/dev/null
su postgres -c "PATH=$PG17_BIN:\$PATH pg_ctl -D $DATOS -o '-p $PUERTO -k /tmp' -l $DATOS/log start -w" >/dev/null
trap 'su postgres -c "PATH=$PG17_BIN:\$PATH pg_ctl -D $DATOS stop -m immediate" >/dev/null 2>&1; rm -rf "$DATOS"' EXIT

$PSQL -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/pg17-vistas-produccion.sql" >/dev/null 2>&1 || { echo "fallo cargando el esquema"; exit 1; }

# Ejecuta una operacion como un rol y dice si paso.
#
# El resultado se marca con «RES:» a proposito: psql escupe tambien las lineas
# de BEGIN/SET/ROLLBACK, y leer «la ultima linea» daba ROLLBACK como si fuera el
# resultado. Con el marcador no hay ambiguedad.
#
# Si la operacion falla, la transaccion queda abortada y el select del marcador
# tambien falla: la ausencia de «RES:» ES la respuesta.
escribir() { # rol, sql -> «ESCRIBE n» / «pasa, 0 filas» / denegado
  local out tag
  out=$($PSQL -c "begin; set local role $1; $2; select 'RES:PASA'; rollback;" 2>&1)
  if ! echo "$out" | grep -q "RES:PASA"; then echo "denegado"; return; fi
  # La etiqueta de psql dice cuantas filas toco. Importa la diferencia: en las
  # vistas con predicado, UPDATE y DELETE pasan pero afectan a 0 filas, mientras
  # que el INSERT si escribe, porque no hay WITH CHECK OPTION que lo frene.
  tag=$(echo "$out" | grep -oE '^(INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+)$' | head -1)
  local n; n=$(echo "$tag" | grep -oE '[0-9]+$')
  if [ "${n:-0}" -gt 0 ]; then echo "ESCRIBE $n"; else echo "0 filas"; fi
}
leer() { # rol, relacion -> n filas visibles / denegado
  local out
  out=$($PSQL -c "begin; set local role $1; select 'RES:' || count(*) from $2; rollback;" 2>&1)
  if echo "$out" | grep -q "RES:"; then echo "$out" | grep -o 'RES:[0-9]*' | cut -d: -f2
  else echo "denegado"; fi
}

echo "PostgreSQL: $($PG17_BIN/postgres --version)"
echo
echo "Escenario: usuario SIN ningun privilegio de aplicacion (tc_admin=0, almacen_admin=0,"
echo "adm_read=0). Es el caso del atacante que solo tiene la clave publicable, y el del"
echo "autenticado de otra app del proyecto."
echo
printf '%-30s | %-6s | %-8s | %-9s | %-8s | %-8s | %-8s\n' "vista" "actbl" "anon SEL" "anon INS" "anon UPD" "anon DEL" "auth SEL"
printf -- '-%.0s' {1..92}; echo
for v in adm_ot_estado tc_clientes_almacen tc_productos_almacen tc_marcas_contadores traspasos_auditoria_detalle; do
  case $v in
    adm_ot_estado)               ins="insert into adm_ot_estado (ot_number) values ('X')";;
    tc_clientes_almacen)         ins="insert into tc_clientes_almacen (codigo,nombre,nif) values ('HACK','Intruso','X0')";;
    tc_productos_almacen)        ins="insert into tc_productos_almacen (marca,modelo,medida) values ('H','H','H')";;
    tc_marcas_contadores)        ins="insert into tc_marcas_contadores (id) values (gen_random_uuid())";;
    traspasos_auditoria_detalle) ins="insert into traspasos_auditoria_detalle (accion,codigo_personal) values ('X','Y')";;
  esac
  act=$($PSQL -c "select 'RES:'||is_updatable from information_schema.views where table_name='$v';" 2>&1 | grep -o 'RES:.*' | cut -d: -f2)
  printf '%-30s | %-6s | %-8s | %-9s | %-8s | %-8s | %-8s\n' "$v" "$act" \
    "$(leer anon $v)" \
    "$(escribir anon "$ins")" \
    "$(escribir anon "update $v set id = id")" \
    "$(escribir anon "delete from $v")" \
    "$(leer authenticated $v)"
done

echo
echo "== Lo mismo, pero mirando la tabla base directamente =="
printf '%-30s | %-14s | %-14s\n' "tabla base" "anon SELECT" "anon INSERT"
printf -- '-%.0s' {1..64}; echo
printf '%-30s | %-14s | %-14s\n' "clientes" "$(leer anon clientes)" "$(escribir anon "insert into clientes (codigo,nombre) values ('D','D')")"
printf '%-30s | %-14s | %-14s\n' "adm_work_orders" "$(leer anon adm_work_orders)" "$(escribir anon "insert into adm_work_orders (ot_number) values ('D')")"
printf '%-30s | %-14s | %-14s\n' "traspasos_auditoria" "$(leer anon traspasos_auditoria)" "$(escribir anon "insert into traspasos_auditoria (accion) values ('D')")"
printf '%-30s | %-14s | %-14s\n' "productos_neumaticos" "$(leer anon productos_neumaticos)" "$(escribir anon "insert into productos_neumaticos (marca) values ('D')")"

echo
echo "== Lo que ve anon de la credencial, a traves de la vista =="
$PSQL -c "begin; set local role anon;
  select 'RES: codigo_personal visible para anon -> ' || coalesce(string_agg(codigo_personal,', '),'(nada)')
    from traspasos_auditoria_detalle; rollback;" 2>&1 | grep -o 'RES:.*' || echo "denegado"

echo
echo "=================================================================="
echo "== Y AHORA, CON LA CONTENCION 005 APLICADA =="
echo "=================================================================="
$PSQL -q -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/migraciones-preparadas/005_contencion_vistas.sql" >/dev/null 2>&1 \
  && echo "005 aplicada" || { echo "FALLO aplicando 005"; exit 1; }
echo
printf '%-30s | %-8s | %-9s | %-8s | %-8s | %-14s\n' "vista" "anon SEL" "anon INS" "anon UPD" "anon DEL" "panel (auth)"
printf -- '-%.0s' {1..92}; echo
for v in adm_ot_estado tc_clientes_almacen tc_productos_almacen tc_marcas_contadores; do
  case $v in
    adm_ot_estado)        ins="insert into adm_ot_estado (ot_number) values ('X')";;
    tc_clientes_almacen)  ins="insert into tc_clientes_almacen (codigo,nombre,nif) values ('HACK','Intruso','X0')";;
    tc_productos_almacen) ins="insert into tc_productos_almacen (marca,modelo,medida) values ('H','H','H')";;
    tc_marcas_contadores) ins="insert into tc_marcas_contadores (id) values (gen_random_uuid())";;
  esac
  # El panel entra autenticado y con el privilegio de su modulo puesto.
  panel=$($PSQL -c "begin; set local role authenticated;
     set local prueba.tc_admin = '1'; set local prueba.adm_read = '1';
     select 'RES:' || count(*) from $v; rollback;" 2>&1 | grep -o 'RES:[0-9]*' | cut -d: -f2)
  printf '%-30s | %-8s | %-9s | %-8s | %-8s | %-14s\n' "$v" \
    "$(leer anon $v)" "$(escribir anon "$ins")" \
    "$(escribir anon "update $v set id = id")" "$(escribir anon "delete from $v")" \
    "${panel:-denegado} filas"
done

echo
echo "== ¿Queda algo escrito? (tiene que ser el recuento inicial) =="
$PSQL -c "select 'clientes=' || count(*) || ' traspasos_auditoria=' ||
  (select count(*) from traspasos_auditoria) from clientes;"
