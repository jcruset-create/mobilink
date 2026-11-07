#!/usr/bin/env bash
#
# Ensayo PRELIMINAR de la restauración: ¿el DDL de `public`, volcado SIN
# propietarios ni permisos, entra en una base que imita a un proyecto Supabase
# recién creado?
#
# Preliminar, y conviene no llamarlo de otra manera. Esto corre en local sobre
# una base desechable con STUBS: roles creados a mano, esquemas auth/storage/
# extensions vacíos, pgcrypto, y cuatro funciones auth.* escritas aquí. Un
# proyecto Supabase de verdad trae GoTrue, Storage, Realtime, sus extensiones
# en el esquema `extensions`, sus propios roles con sus atributos y sus
# default privileges. Lo que falle aquí fallará allí; lo que pase aquí AÚN NO
# está validado. La compatibilidad definitiva se comprueba restaurando en el
# proyecto Supabase de pruebas, que es el único sitio donde eso se decide.
#
#   DDL=esquema-produccion.sql BASE=banco_nuevo_supabase \
#   bash scripts/staging/08-ensayar-restauracion.sh
#
# Al final dice qué NO viaja en el volcado y hay que poner aparte.
set -uo pipefail

DDL="${DDL:?Falta DDL (el fichero del volcado --schema-only)}"
BASE="${BASE:-banco_nuevo_supabase}"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-mobilink}"
case "$BASE" in banco_*|esquema_completo*) ;;
  *) echo "Base no permitida: '$BASE'. Solo bases de pruebas." >&2; exit 1;; esac
P=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$BASE" -At)

FALLOS=0
ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }
avi() { printf '  ATENCIÓN %s\n' "$1"; }

echo "1. Base nueva con STUBS que imitan un proyecto Supabase recién creado"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -qc "drop database if exists $BASE" \
  -c "create database $BASE" >/dev/null || { mal "no se ha podido crear $BASE"; exit 1; }
"${P[@]}" -q <<'SQL' >/dev/null
create extension if not exists pgcrypto;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin','supabase_auth_admin'] loop
    if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb) $$;
create or replace function auth.email() returns text language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb->>'email' $$;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
grant usage on schema public to anon, authenticated, service_role;
SQL
ok "base creada con roles, esquemas, pgcrypto y los stubs de auth.*"
avi "son stubs: esto no sustituye a restaurar en el proyecto Supabase de pruebas"

echo "2. Restaurar el DDL"
# Los ÚNICOS errores que se dan por buenos son los de esta lista: conflictos
# concretos, identificados de antemano y comprobados uno a uno. «Ya existe» a
# secas no basta como excusa: que una tabla, una función o un tipo ya existan
# en una base supuestamente nueva significa que la base no estaba limpia o que
# el volcado trae algo repetido, y eso hay que mirarlo antes de seguir.
#
#   · schema "public" already exists — PostgreSQL crea `public` al crear la
#     base, y pg_dump emite su CREATE SCHEMA igualmente. Comprobado: el
#     esquema resultante es el mismo con y sin ese error.
#
# Para añadir otro conflicto a la lista hay que escribir aquí por qué es
# inofensivo y haberlo comprobado. Cualquier otro error para la restauración.
CONOCIDOS='schema "public" already exists'
"${P[@]}" -f "$DDL" > /tmp/ensayo-restauracion.log 2>&1
grep "^psql.*ERROR" /tmp/ensayo-restauracion.log > /tmp/ensayo-errores.txt || true
ERR=$(wc -l < /tmp/ensayo-errores.txt)
grep -vF "$CONOCIDOS" /tmp/ensayo-errores.txt > /tmp/ensayo-otros.txt || true
OTROS=$(wc -l < /tmp/ensayo-otros.txt)
if [[ "$OTROS" == "0" ]]; then
  ok "restaurado · $ERR error(es), todos de la lista de conflictos previstos"
  [[ "$ERR" != "0" ]] && printf '        previstos: %s\n' "$CONOCIDOS"
else
  mal "$OTROS error(es) que NO están en la lista de conflictos previstos: la restauración se para"
  head -8 /tmp/ensayo-otros.txt | sed 's/^/        /'
  echo "        Mira /tmp/ensayo-restauracion.log. Si alguno resulta ser inofensivo,"
  echo "        se añade a CONOCIDOS en este script CON el motivo, no se ignora."
fi
printf '  objetos: %s tablas · %s funciones · %s vistas · %s políticas RLS · %s triggers\n' \
  "$("${P[@]}" -c "select count(*) from pg_tables where schemaname='public'")" \
  "$("${P[@]}" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")" \
  "$("${P[@]}" -c "select count(*) from pg_views where schemaname='public'")" \
  "$("${P[@]}" -c "select count(*) from pg_policies where schemaname='public'")" \
  "$("${P[@]}" -c "select count(*) from pg_trigger where not tgisinternal")"

echo "3. Lo que NO viaja en el volcado, comprobado en la base restaurada"
G=$("${P[@]}" -c "select count(*) from information_schema.role_table_grants where grantee='authenticated'")
[[ "$G" == "0" ]] && avi "permisos de tabla para anon/authenticated: $G (los pone permisos-pruebas.sql)" \
                  || avi "permisos de tabla para authenticated: $G (permisos-pruebas.sql los rehace por nombre)"
B=$("${P[@]}" -c "select coalesce((select rolbypassrls from pg_roles where rolname='service_role')::text,'?')")
[[ "$B" == "true" ]] && ok "service_role se salta la RLS" \
                     || avi "service_role NO se salta la RLS: es un atributo del ROL, no del volcado"
EXT=$("${P[@]}" -c "select string_agg(extname,', ' order by extname) from pg_extension")
avi "extensiones instaladas aquí: $EXT. El volcado de --schema=public no trae las de otros esquemas"
SRV=$("${P[@]}" -c "select count(*) from tc_cat_servicios" 2>/dev/null || echo "?")
if [[ "$SRV" == "0" ]]; then
  avi "tc_cat_servicios está VACÍO: son datos y no viajan. Sin ellos la importación"
  echo "           bloquea todos los albaranes con servicios («Servicio desconocido: …»)."
  echo "           Los pone scripts/staging/semilla-staging.sql."
else
  ok "tc_cat_servicios tiene $SRV fila(s)"
fi
for t in tc_empresas tc_usuarios tc_tipos_vehiculo tc_vehiculos; do
  N=$("${P[@]}" -c "select count(*) from $t" 2>/dev/null || echo "?")
  [[ "$N" == "0" ]] && avi "$t vacía (esperado: los datos no viajan; los pone la semilla)"
done

echo
if [[ "$FALLOS" -gt 0 ]]; then
  echo "$FALLOS problema(s) en la restauración. No sigas hasta resolverlos." >&2
  exit 1
fi
echo "El DDL entra en esta imitación de proyecto nuevo. Lo marcado como ATENCIÓN"
echo "hay que ponerlo aparte:"
echo "  · los permisos, con scripts/staging/permisos-pruebas.sql (por nombre, no"
echo "    con default privileges), y el bypassrls de service_role, que lo trae el rol;"
echo "  · las extensiones que use el esquema real, habilitadas ANTES de restaurar;"
echo "  · los catálogos y datos, con semilla-staging.sql."
echo
echo "Y que conste: esto es un ensayo PRELIMINAR con stubs. La compatibilidad"
echo "queda validada cuando el mismo DDL entra en el proyecto Supabase de pruebas,"
echo "no antes."
