#!/usr/bin/env bash
# Construye un esquema COMPLETO desde supabase/migrations/*.sql, en orden de primer
# commit, en una base de pruebas, con stubs de auth/roles/storage/cron/net. Repite
# pasadas hasta que ninguna migración más aplique y deja los fallos en un fichero.
#   bash scripts/importacion-historico/construir-esquema.sh [base] [fichero_fallos]
set -u
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
DB="${1:-esquema_completo}"; comprobar_base "$DB"; FALLOS="${2:-/tmp/esquema_fallos.txt}"
cd "$RAIZ"; recrear_base "$DB"
# La marca de entorno de pruebas. Aquí se pone sin ceremonia porque la base
# acaba de crearse, el nombre ya ha pasado por comprobar_base y esto solo
# habla con 127.0.0.1. En un proyecto Supabase la pone, con todas sus
# comprobaciones, scripts/staging/00-inicializar-destino.sh.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q \
  -c "alter database \"$DB\" set mobilink.entorno = 'pruebas'"
# Los stubs van SIN ON_ERROR_STOP: una extensión que falte (uuid-ossp) no debe impedir el resto.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -q <<'SQL'
create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
create or replace function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin','supabase_auth_admin'] loop
    if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
create schema if not exists auth; create schema if not exists storage; create schema if not exists cron; create schema if not exists net; create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, created_at timestamptz default now(), encrypted_password text, email_confirmed_at timestamptz, phone text, last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb) $$;
create or replace function auth.email() returns text language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb->>'email' $$;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
grant usage on schema public to anon, authenticated, service_role;
-- Tablas del módulo Almacén y otros que NO están en supabase/migrations (se crearon
-- fuera): stubs con la forma de producción según scripts/pg17-vistas-produccion.sql.
create table if not exists clientes (id uuid primary key default gen_random_uuid(), empresa_id uuid, codigo text, nombre text, nif text, telefono text, email text, activo boolean default true);
create table if not exists productos_neumaticos (id uuid primary key default gen_random_uuid(), empresa_id uuid, marca text, modelo text, medida text, dot text, activo boolean default true, referencia_neumatico_id uuid);
create table if not exists centros (id uuid primary key default gen_random_uuid(), nombre text);
create table if not exists movimientos_stock (id uuid primary key default gen_random_uuid(), empresa_id uuid, tipo text, cantidad int, documento_referencia text, observaciones text, created_at timestamptz default now(), centro_origen_id uuid, centro_destino_id uuid, cliente_id uuid, producto_id uuid, estado text, condicion text, origen_movimiento text);
-- `jobs` es del módulo Taller y la crea el DDL de arranque de Express con
-- `id SERIAL`. El stub tiene que tener el MISMO tipo: con uuid, arrancar el
-- servidor contra esta base falla al poner la clave ajena «jobId» (integer)
-- contra «id» (uuid), y entonces no se puede probar el servidor aquí.
create table if not exists jobs (id serial primary key, created_at timestamptz default now());
create table if not exists techs (id uuid primary key default gen_random_uuid(), name text);
SQL
ORDEN=$(mktemp); for f in supabase/migrations/*.sql; do echo "$(git log --diff-filter=A --format=%at -- "$f" | tail -1) $f"; done | sort -n > "$ORDEN"
declare -A ok; pasada=0
while :; do
  pasada=$((pasada+1)); avance=0; pend=0; cp /dev/null "$FALLOS"
  while read -r ts f; do
    [ -z "$f" ] && f="$ts"; [ -z "$f" ] && continue; [ -n "${ok[$f]:-}" ] && continue
    if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" > /tmp/mig_out.txt 2>&1; then ok[$f]=1; avance=$((avance+1))
    else pend=$((pend+1)); echo "== $f" >> "$FALLOS"; grep -m1 -E "ERROR" /tmp/mig_out.txt >> "$FALLOS"; fi
  done < "$ORDEN"
  echo "pasada $pasada: aplicadas $avance, pendientes $pend"
  [ $avance -eq 0 ] && break; [ $pasada -ge 8 ] && break
done
# El stub de productos_neumaticos necesita su FK al catálogo (PostgREST la usa para los embeds del panel).
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -q -c "alter table productos_neumaticos add constraint productos_neumaticos_referencia_fk foreign key (referencia_neumatico_id) references tc_referencias_neumatico(id)" 2>/dev/null || true
# Los permisos que en Supabase pone la PLATAFORMA, no las migraciones.
#
# Ninguna migración del repositorio concede nada a anon/authenticated: en el
# proyecto real esos permisos vienen de los default privileges que Supabase
# configura al crear el esquema public. Sin ellos, cualquier RPC `security
# invoker` falla por PostgREST con «permission denied for table ...» aunque en
# psql funcione, porque psql entra como dueño y se los salta.
#
# Pero no se copia el grant global de la plataforma: se conceden por nombre
# los objetos que usa esta prueba. El fichero lleva la lista y las
# comprobaciones que paran la transacción si algo queda expuesto.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$RAIZ/scripts/staging/permisos-pruebas.sql" \
  || { echo "FALLO al aplicar scripts/staging/permisos-pruebas.sql" >&2; exit 1; }

# Y la otra propiedad que pone la plataforma: en Supabase `service_role` SE
# SALTA la RLS. Sin esto, cualquier endpoint del servidor que lea con la
# service key (el PDF del parte, por ejemplo) devuelve «no encontrado» aquí y
# funciona en producción, que es la peor forma de enterarse.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -q -c "alter role service_role bypassrls" 2>/dev/null \
  || echo "aviso: no se ha podido dar bypassrls a service_role (hace falta superusuario); los endpoints con service key leerán con RLS"

echo "aplicadas en total: ${#ok[@]} de $(wc -l < "$ORDEN") · fallos en $FALLOS · permisos concedidos por nombre (scripts/staging/permisos-pruebas.sql)"
