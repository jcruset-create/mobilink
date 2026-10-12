#!/usr/bin/env bash
#
# La vuelta atrás de lo que la migración REDEFINE habiendo sido escrito por
# otra migración.
#
#   ORIGEN_URL='postgresql://…' bash scripts/staging/07-guardar-vuelta-atras.sh vuelta-atras.sql
#
# Por defecto cubre lo del paso 5b del procedimiento: las tres funciones de
# inventario y la vista `tc_marcas_contadores`. Con FUNCIONES y VISTAS se le
# puede dar cualquier otra lista, que es como lo usa el preflight de
# producción para cubrir TODO lo que el PR redefine y ya existe:
#
#   FUNCIONES='tc_anular_operacion,tc_informes_montajes' VISTAS='tc_marcas_contadores' \
#   ORIGEN_URL=… bash scripts/staging/07-guardar-vuelta-atras.sh salida.sql
#
# Genera un fichero EJECUTABLE, no un apunte. Lo que no sale solo:
#
#   · `pg_get_viewdef` devuelve la CONSULTA de la vista, no una sentencia:
#     hay que envolverla en un `create or replace view … as …;` o el fichero
#     no se puede ejecutar. (`pg_get_functiondef`, en cambio, sí devuelve la
#     sentencia completa.) Y sus `reloptions` —`security_invoker`,
#     `security_barrier`, `check_option`— van en el propio `create`.
#   · Los PERMISOS no viajan en ninguna de las dos: se reconstruyen desde
#     `relacl` y `proacl`. Sin ellos, restaurar la definición deja los
#     objetos sin acceso para `anon`/`authenticated` y el panel deja de leer.
#   · Devolver los permisos no es solo CONCEDER los que había: hay que RETIRAR
#     antes los que haya puestos en ese momento, o una concesión posterior
#     sobrevive a la vuelta atrás. Por eso cada objeto lleva delante un bloque
#     que revoca a todos sus concesionarios ACTUALES, sean los que sean, y
#     después concede exactamente los guardados.
#   · PUBLIC no es un rol: en `aclexplode` llega como `grantee = 0` y en el
#     `grant` se escribe `public`, sin comillas. Un `quote_ident('public')`
#     generaría un rol llamado «public» que no existe.
#   · `with grant option` se pierde si no se escribe: va en `is_grantable`.
#   · El DUEÑO también se guarda: un `create or replace` lo conserva, pero si
#     hay que recrear el objeto a mano, sin esta línea cambia.
#   · Un objeto sin ACL explícita (`proacl is null`) NO se toca: su estado es
#     «lo que PostgreSQL da por defecto», y eso no se puede reconstruir con
#     grants sin dejar una ACL explícita que ya no es la misma. Se anota.
#
# Solo lee. No modifica nada en el origen.
set -uo pipefail

FUNCIONES="${FUNCIONES:-tc_informes_inventario_por,tc_informes_inventario_marca_medida,tc_informes_inventario_resumen}"
VISTAS="${VISTAS:-tc_marcas_contadores}"
# Las listas, como literales SQL: 'a','b','c'
en_sql() { python3 -c "
import sys
xs=[x.strip() for x in sys.argv[1].split(',') if x.strip()]
print(','.join(\"'\"+x.replace(\"'\",\"''\")+\"'\" for x in xs) or \"''\")" "$1"; }
L_FN=$(en_sql "$FUNCIONES"); L_VI=$(en_sql "$VISTAS")

HUELLA="select md5(string_agg(d, '|' order by d)) from (
  select pg_get_functiondef(p.oid) || coalesce(p.proacl::text,'') || p.proowner::text as d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ($L_FN)
  union all
  select pg_get_viewdef(c.oid, true) || coalesce(c.relacl::text,'')
         || coalesce(array_to_string(c.reloptions,','),'') || c.relowner::text
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ($L_VI)) x"

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
    -- Y los dos casos que una vuelta atrás floja NO deshace: una concesión
    -- AÑADIDA después (que hay que retirar, no solo volver a conceder lo que
    -- había) y un «with grant option» (que se pierde si no se escribe).
    grant all on function tc_informes_inventario_por(uuid, text) to anon with grant option;
    grant all on tc_marcas_contadores to anon with grant option;
    grant execute on function tc_informes_inventario_marca_medida(uuid) to public;
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

TMP=$(mktemp); trap 'rm -f "$TMP" "$TMP.err"' EXIT
if ! psql "$ORIGEN_URL" -X -q -At -v ON_ERROR_STOP=1 > "$TMP" 2>"$TMP.err" <<SQL
with objetos as (
  select 1 as grupo,
         'public.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ident,
         pg_get_functiondef(p.oid) || ';' as cuerpo,
         p.proacl as acl, pg_get_userbyid(p.proowner) as dueno,
         'function'::text as clase, 'proacl'::text as col_acl, 'pg_proc'::text as catalogo,
         '(select f.oid from pg_proc f join pg_namespace fn on fn.oid = f.pronamespace' ||
         ' where fn.nspname = ''public'' and f.proname = ' || quote_literal(p.proname) ||
         ' and pg_get_function_identity_arguments(f.oid) = ' ||
         quote_literal(pg_get_function_identity_arguments(p.oid)) || ')' as localizador
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ($L_FN)
  union all
  select 2,
         'public.' || quote_ident(c.relname),
         'create or replace view public.' || quote_ident(c.relname) ||
         coalesce(' with (' || array_to_string(c.reloptions, ', ') || ')', '') ||
         ' as' || E'\n' || pg_get_viewdef(c.oid, true),
         c.relacl, pg_get_userbyid(c.relowner),
         'view', 'relacl', 'pg_class',
         quote_literal('public.' || quote_ident(c.relname)) || '::regclass'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname in ($L_VI)
),
ordenados as (select *, row_number() over (order by grupo, ident) as pos from objetos),
lineas as (
  select pos, 0 as sub, '-- ── ' || ident || ' ' || repeat('─', greatest(1, 56 - length(ident))) as linea
    from ordenados
  union all
  select pos, 1, cuerpo from ordenados
  union all
  -- El dueño. Un «create or replace» lo conserva, pero si hay que recrear el
  -- objeto a mano, sin esto cambia.
  select pos, 2, 'alter ' || clase || ' ' || ident || ' owner to ' || quote_ident(dueno) || ';'
    from ordenados
  union all
  -- Retirar lo que haya puesto EN EL MOMENTO DE EJECUTARSE, no lo que había
  -- al guardar: si no, una concesión posterior sobrevive a la vuelta atrás.
  select pos, 3,
         'do \$vuelta\$ declare g text; begin' || E'\n' ||
         '  for g in select case when a.grantee = 0 then ''public''' || E'\n' ||
         '                       else quote_ident(pg_get_userbyid(a.grantee)) end' || E'\n' ||
         '             from ' || catalogo || ' o, aclexplode(o.' || col_acl || ') a' || E'\n' ||
         '            where o.oid = ' || localizador ||
                      ' and o.' || col_acl || ' is not null' || E'\n' ||
         '            group by 1 loop' || E'\n' ||
         '    execute format(''revoke all on ' ||
         case when clase = 'function' then 'function' else 'table' end ||
         ' ' || ident || ' from %s'', g);' || E'\n' ||
         '  end loop; end \$vuelta\$;'
    from ordenados where acl is not null
  union all
  -- Y conceder exactamente lo guardado: PUBLIC como tal, sin comillas, y con
  -- «grant option» donde lo hubiera.
  select o.pos, 10 + row_number() over (partition by o.pos order by a.grantee, a.privilege_type)::int,
         'grant ' || a.privilege_type || ' on ' ||
         case when o.clase = 'function' then 'function ' else 'table ' end || o.ident ||
         ' to ' || case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end ||
         case when a.is_grantable then ' with grant option' else '' end || ';'
    from ordenados o, aclexplode(o.acl) a
   where o.acl is not null
  union all
  select pos, 10, '-- Sin ACL explícita: se queda como PostgreSQL la deja por defecto.'
    from ordenados where acl is null
  union all
  select pos, 9999, '' from ordenados
)
select linea from (
  select 0 as pos, 0 as sub, '-- Vuelta atrás de los objetos que una migración redefine.' as linea
  union all select 0, 1, '-- Generado por scripts/staging/07-guardar-vuelta-atras.sh el ' || now()::date
  union all select 0, 2, '-- Ejecutable tal cual: definición completa, dueño y permisos exactos.'
  union all select 0, 3, '--'
  union all select 0, 4, '-- Cada objeto RETIRA primero los permisos que tenga puestos en el momento'
  union all select 0, 5, '-- de ejecutarse y después concede los de aquí: así no sobrevive ninguna'
  union all select 0, 6, '-- concesión posterior. PUBLIC va sin comillas, que no es un rol.'
  union all select 0, 7, '--'
  union all select 0, 8, '-- Si un «create or replace view» falla porque la vista nueva tiene otras'
  union all select 0, 9, '-- columnas, hay que borrarla antes y volver a ejecutar. Mira primero qué'
  union all select 0, 10, '-- depende de ella.'
  union all select 0, 11, ''
  union all select pos::int, sub::int, linea from lineas
) x order by pos, sub;
SQL
then
  echo "La consulta que genera la vuelta atrás ha fallado. No escribo nada:" >&2
  sed 's/^/  /' "$TMP.err" >&2; exit 1
fi
# Que no se cuele un mensaje de error DENTRO del SQL de recuperación.
if grep -nE '^(psql:|ERROR:|FATAL:|WARNING:|DETALLE:|DETAIL:|HINT:)' "$TMP"; then
  echo "Hay mensajes de error dentro del fichero generado. No lo doy por bueno." >&2
  exit 1
fi
mv "$TMP" "$SALIDA"

N=$(grep -ci "^create or replace" "$SALIDA" || true)
G=$(grep -c "^grant " "$SALIDA" || true)
echo "Escrito $SALIDA: $N definición(es) y $G permiso(s)."
ESPERADAS=$(python3 -c "
import sys
print(len([x for x in (sys.argv[1]+','+sys.argv[2]).split(',') if x.strip()]))" "$FUNCIONES" "$VISTAS")
if [[ "$N" -lt "$ESPERADAS" ]]; then
  echo "AVISO: esperaba $ESPERADAS definición(es) y hay $N. Lo que falte es que todavía" >&2
  echo "       no existe en esa base, que para un objeto NUEVO del PR es lo normal." >&2
fi
echo
echo "Esto NO es una vuelta atrás hasta que se prueba. En una base desechable:"
echo "  bash scripts/staging/07-guardar-vuelta-atras.sh --probar $SALIDA <base_desechable>"
