#!/usr/bin/env bash
#
# La vuelta atrás de lo que la migración REDEFINE habiendo sido escrito por
# otra migración: las tres funciones de inventario y la vista
# `tc_marcas_contadores`.
#
#   ORIGEN_URL='postgresql://…' bash scripts/staging/07-guardar-vuelta-atras.sh vuelta-atras.sql
#
# Genera un fichero EJECUTABLE, no un apunte. Dos cosas que no salen solas:
#
#   · `pg_get_viewdef` devuelve la CONSULTA de la vista, no una sentencia:
#     hay que envolverla en un `create or replace view … as …;` o el fichero
#     no se puede ejecutar. (`pg_get_functiondef`, en cambio, sí devuelve la
#     sentencia completa.)
#   · Los PERMISOS no viajan en ninguna de las dos: se reconstruyen desde
#     `relacl` y `proacl`. Sin ellos, restaurar la definición deja los
#     objetos sin acceso para `anon`/`authenticated` y el panel deja de leer.
#
# Solo lee. No modifica nada en el origen.
set -uo pipefail

HUELLA="select md5(string_agg(d, '|' order by d)) from (
  select pg_get_functiondef(p.oid) || coalesce(p.proacl::text,'') as d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('tc_informes_inventario_por',
         'tc_informes_inventario_marca_medida','tc_informes_inventario_resumen')
  union all
  select pg_get_viewdef(c.oid, true) || coalesce(c.relacl::text,'')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='tc_marcas_contadores') x"

# ── Modo prueba: ¿este fichero devuelve de verdad lo que había? ───────────
#
#   bash 07-guardar-vuelta-atras.sh --probar <fichero.sql> <base_desechable>
#
# Guarda la huella de las definiciones Y los permisos, los ROMPE como lo
# haría una migración que los redefine, ejecuta el fichero y comprueba que la
# huella vuelve a ser la misma. Hasta que esto pasa, el fichero no es una
# vuelta atrás: es un apunte.
if [[ "${1:-}" == "--probar" ]]; then
  FICHERO="${2:?Falta el fichero de vuelta atrás}"
  BASE="${3:?Falta la base desechable}"
  case "$BASE" in banco_*|esquema_completo*) ;;
    *) echo "Base no permitida: '$BASE'. Solo bases de pruebas." >&2; exit 1;; esac
  P=(psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5433}" -U "${PGUSER:-mobilink}" -d "$BASE" -At)
  ANTES=$("${P[@]}" -c "$HUELLA")
  echo "huella antes:     $ANTES"

  # Romperlas, como haría la migración: mismo nombre y misma firma, otro
  # cuerpo, y los permisos por los suelos.
  "${P[@]}" -q -c "
    create or replace function tc_informes_inventario_resumen(p_empresa uuid default null)
      returns jsonb language sql stable as \$\$ select '{\"roto\":true}'::jsonb \$\$;
    create or replace function tc_informes_inventario_por(p_empresa uuid default null, p_dim text default 'marca')
      returns table(etiqueta text, total bigint) language sql stable as \$\$ select 'roto'::text, 0::bigint \$\$;
    create or replace function tc_informes_inventario_marca_medida(p_empresa uuid default null)
      returns table(marca text, medida text, total bigint) language sql stable as \$\$ select 'roto'::text, 'roto'::text, 0::bigint \$\$;
    create or replace view tc_marcas_contadores as
      select m.id, 0::bigint as num_modelos, 0::bigint as num_neumaticos, 0::bigint as num_vehiculos
        from tc_cat_marcas_neumatico m;
    revoke all on tc_marcas_contadores from anon, authenticated, service_role;
    revoke all on function tc_informes_inventario_resumen(uuid) from anon, authenticated, service_role;
  " > /dev/null || { echo "No he podido romperlas para la prueba" >&2; exit 1; }
  ROTO=$("${P[@]}" -c "$HUELLA")
  echo "huella rota:      $ROTO"
  [[ "$ROTO" == "$ANTES" ]] && { echo "FALLA: romperlas no ha cambiado nada; la prueba no vale" >&2; exit 1; }

  "${P[@]}" -q -v ON_ERROR_STOP=1 -f "$FICHERO" > /dev/null || { echo "FALLA: el fichero de vuelta atrás no se ejecuta" >&2; exit 1; }
  DESPUES=$("${P[@]}" -c "$HUELLA")
  echo "huella después:   $DESPUES"
  if [[ "$DESPUES" == "$ANTES" ]]; then
    echo "OK: el fichero devuelve las definiciones Y los permisos exactamente como estaban."
    exit 0
  fi
  echo "FALLA: después de ejecutarlo, las definiciones o los permisos NO son los de antes." >&2
  exit 1
fi

SALIDA="${1:-vuelta-atras-inventario.sql}"
: "${ORIGEN_URL:?Falta ORIGEN_URL (cadena de conexión de la base de la que guardar la vuelta atrás)}"
[[ -e "$SALIDA" ]] && { echo "Ya existe '$SALIDA'. No lo sobrescribo." >&2; exit 1; }

psql "$ORIGEN_URL" -At -v ON_ERROR_STOP=1 > "$SALIDA" <<'SQL'
with objetos as (
  -- Las tres funciones de inventario, con su definición completa.
  select 1 as grupo, p.oid::regprocedure::text as nombre,
         pg_get_functiondef(p.oid) || ';' as cuerpo,
         p.proacl as acl, 'function'::text as clase
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('tc_informes_inventario_por',
                       'tc_informes_inventario_marca_medida',
                       'tc_informes_inventario_resumen')
  union all
  -- Y la vista, envuelta para que se pueda ejecutar, con sus reloptions
  -- (security_invoker, si lo lleva) delante.
  select 2, c.oid::regclass::text,
         'create or replace view ' || c.oid::regclass::text ||
         coalesce(' with (' || array_to_string(c.reloptions, ', ') || ')', '') ||
         ' as' || E'\n' || pg_get_viewdef(c.oid, true),
         c.relacl, 'view'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname = 'tc_marcas_contadores'
),
ordenados as (select *, row_number() over (order by grupo, nombre) as pos from objetos),
lineas as (
  select pos, 0 as sub, '-- ── ' || nombre || ' ' || repeat('─', greatest(1, 58 - length(nombre))) as linea
    from ordenados
  union all
  select pos, 1, cuerpo from ordenados
  union all
  -- Los permisos, uno por uno, tal como están ahora.
  select o.pos, 2 + row_number() over (partition by o.pos order by a.grantee, a.privilege_type)::int,
         'grant ' || a.privilege_type || ' on ' ||
         case when o.clase = 'function' then 'function ' else '' end || o.nombre ||
         ' to ' || coalesce(nullif(a.grantee::regrole::text, '-'), 'public') || ';'
    from ordenados o, aclexplode(o.acl) a
  union all
  select pos, 9999, '' from ordenados
)
select linea from (
  select 0 as pos, 0 as sub,
         '-- Vuelta atrás de los informes de inventario y de la vista de marcas.' as linea
  union all select 0, 1, '-- Generado por scripts/staging/07-guardar-vuelta-atras.sh el ' || now()::date
  union all select 0, 2, '-- Ejecutable tal cual: definiciones COMPLETAS y permisos incluidos.'
  union all select 0, 3, '--'
  union all select 0, 4, '-- Si un «create or replace view» falla porque la vista nueva tiene otras'
  union all select 0, 5, '-- columnas, hay que borrarla antes: «drop view tc_marcas_contadores;» y'
  union all select 0, 6, '-- volver a ejecutar. Mira primero qué depende de ella.'
  union all select 0, 7, ''
  union all select pos::int, sub::int, linea from lineas
) x order by pos, sub;
SQL

N=$(grep -ci "^create or replace" "$SALIDA" || true)
G=$(grep -c "^grant " "$SALIDA" || true)
echo "Escrito $SALIDA: $N definición(es) y $G permiso(s)."
if [[ "$N" -lt 4 ]]; then
  echo "AVISO: esperaba 4 definiciones (3 funciones + 1 vista). Comprueba qué falta." >&2
fi
echo
echo "Esto NO es una vuelta atrás hasta que se prueba. En una base desechable:"
echo "  bash scripts/staging/07-guardar-vuelta-atras.sh --probar $SALIDA <base_desechable>"
