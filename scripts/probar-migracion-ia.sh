#!/usr/bin/env bash
# Banco de pruebas de la migración de IA (contador de consumo + resumen de
# vehículo) contra un PostgreSQL de verdad.
#
# Por qué existe: los permisos de una migración no se comprueban leyéndola.
# `revoke`, RLS y políticas interactúan de formas que solo se ven ejecutando,
# y el caso que de verdad importa —que un cliente no pueda tocar los límites
# de otro ni ver su consumo— no lo cubre ninguna prueba de TypeScript.
#
# Qué comprueba:
#   · que aplica sobre el esquema real (fase1 + fase2 + fase3),
#   · que aplicarla dos veces seguidas no rompe nada (idempotencia),
#   · que anon y authenticated NO pueden escribir en ninguna de las tablas,
#     ni siquiera si alguien les ha concedido permisos antes (se simula el
#     `grant all` que Supabase hace de oficio sobre lo nuevo de public),
#   · que un cliente solo ve SU consumo y SUS resúmenes,
#   · que la tabla de coordinación no existe para el cliente,
#   · que la vuelta atrás deja la base como estaba y se puede reaplicar.
#
# Uso:  su postgres -c "bash scripts/probar-migracion-ia.sh"
#       (o con PSQL_BASE apuntando a otro servidor con permiso de createdb)
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$RAIZ/supabase/migrations"
BASE="${BASE:-banco_ia_pruebas}"
PSQL="psql -v ON_ERROR_STOP=1 -q"

dropdb --if-exists "$BASE" >/dev/null 2>&1 || true
createdb "$BASE"
trap 'dropdb --if-exists "$BASE" >/dev/null 2>&1 || true' EXIT

Q="$PSQL -d $BASE"

fallos=0
comprobar() { # nombre, sql, esperado
  local got
  got=$($Q -At -c "$2" 2>&1 || true)
  if [ "$got" = "$3" ]; then printf '  ok    %s\n' "$1"
  else printf '  FALLO %s -> esperaba «%s», obtuvo «%s»\n' "$1" "$3" "$got"; fallos=$((fallos+1)); fi
}
debe_fallar() { # nombre, sql
  if $Q -c "$2" >/dev/null 2>&1; then
    printf '  FALLO %s -> la sentencia ha funcionado y NO debía\n' "$1"; fallos=$((fallos+1))
  else printf '  ok    %s (rechazado)\n' "$1"; fi
}

echo "── Preparando el esquema (auth simulada + fases reales) ─────────────"
$Q >/dev/null <<'SQL'
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
-- auth.uid() de Supabase, en versión de banco: lee el "usuario" de la sesión.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
SQL
for f in tyrecontrol_fase1 tyrecontrol_fase2 tyrecontrol_fase3; do
  $Q -f "$MIG/$f.sql" >/dev/null 2>&1
done
comprobar "tc_puede_ver_empresa existe (helper REAL, no un doble)" \
  "select count(*)::text from pg_proc where proname = 'tc_puede_ver_empresa'" "1"

echo
echo "── Dos empresas con un usuario cliente cada una ─────────────────────"
$Q >/dev/null <<'SQL'
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002')
on conflict do nothing;
insert into tc_empresas (id, nombre) values
  ('11111111-1111-4111-8111-111111111111', 'Empresa A'),
  ('22222222-2222-4222-8222-222222222222', 'Empresa B')
on conflict do nothing;
insert into tc_usuarios (id, empresa_id, nombre, email, rol) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Ana', 'a@a', 'cliente'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Bea', 'b@b', 'cliente')
on conflict do nothing;
insert into tc_vehiculos (id, empresa_id, matricula) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '1234 ABC'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', '5678 DEF')
on conflict do nothing;
SQL

echo
echo "── El caso hostil: alguien ya ha concedido permisos de más ──────────"
# Supabase trae `alter default privileges` que conceden de oficio a anon y
# authenticated sobre lo nuevo de public. Se simula a lo bestia ANTES de la
# migración para comprobar que sus revokes mandan.
$Q -c "alter default privileges in schema public grant all on tables to anon, authenticated" >/dev/null

echo
echo "── Aplicando la migración ───────────────────────────────────────────"
$Q -f "$MIG/ia_consumo_y_resumen_vehiculo.sql" >/dev/null
comprobar "las cuatro tablas existen" \
  "select count(*)::text from pg_tables where tablename in ('ia_uso','ia_limites','ia_resumen_vehiculo','ia_resumen_en_curso')" "4"
comprobar "las cuatro con RLS activa" \
  "select count(*)::text from pg_class where relname in ('ia_uso','ia_limites','ia_resumen_vehiculo','ia_resumen_en_curso') and relrowsecurity" "4"

echo
echo "── Segunda pasada: idempotencia ─────────────────────────────────────"
$Q -f "$MIG/ia_consumo_y_resumen_vehiculo.sql" >/dev/null
comprobar "sigue habiendo cuatro tablas y no se ha duplicado nada" \
  "select count(*)::text from pg_tables where tablename like 'ia\_%'" "4"
comprobar "las políticas no se han duplicado" \
  "select count(*)::text from pg_policies where tablename like 'ia\_%'" "3"

echo
echo "── Datos de las dos empresas ────────────────────────────────────────"
$Q >/dev/null <<'SQL'
insert into ia_limites (empresa_id, resumen_vehiculo_activo, max_peticiones_dia) values
  ('11111111-1111-4111-8111-111111111111', true, 50),
  ('22222222-2222-4222-8222-222222222222', false, 10);
insert into ia_uso (empresa_id, modulo, operacion, modelo_pedido, resultado) values
  ('11111111-1111-4111-8111-111111111111', 'resumen', 'resumen.vehiculo', 'm', 'ok'),
  ('22222222-2222-4222-8222-222222222222', 'resumen', 'resumen.vehiculo', 'm', 'ok');
insert into ia_resumen_vehiculo (empresa_id, vehiculo_id, huella, version, payload, caduca_at) values
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'h1', 'v1', '{}', now() + interval '1 day'),
  ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 'h2', 'v1', '{}', now() + interval '1 day');
insert into ia_resumen_en_curso (clave, empresa_id, vehiculo_id, instancia, caduca_at) values
  ('k1', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 'otra', now() + interval '1 minute');
SQL

COMO_ANA="set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';"
COMO_ANON="set role anon;"

echo
echo "── Aislamiento: Ana (empresa A) ─────────────────────────────────────"
comprobar "ve SU consumo y solo el suyo" \
  "$COMO_ANA select count(*)::text from ia_uso" "1"
comprobar "y es el de su empresa" \
  "$COMO_ANA select (empresa_id = '11111111-1111-4111-8111-111111111111')::text from ia_uso" "true"
comprobar "ve SUS límites y no los de la otra empresa" \
  "$COMO_ANA select count(*)::text from ia_limites" "1"
comprobar "ve SUS resúmenes y no los de la otra empresa" \
  "$COMO_ANA select count(*)::text from ia_resumen_vehiculo" "1"

echo
echo "── Escritura: nadie, por mucho grant que haya ───────────────────────"
debe_fallar "Ana no puede activarse el resumen a sí misma" \
  "$COMO_ANA update ia_limites set resumen_vehiculo_activo = true where empresa_id = '11111111-1111-4111-8111-111111111111'"
debe_fallar "Ana no puede subirse el tope" \
  "$COMO_ANA update ia_limites set max_peticiones_dia = 999999"
debe_fallar "Ana no puede crear límites de otra empresa" \
  "$COMO_ANA insert into ia_limites (empresa_id) values ('22222222-2222-4222-8222-222222222222')"
debe_fallar "Ana no puede borrar su consumo para esquivar la cuota" \
  "$COMO_ANA delete from ia_uso"
debe_fallar "Ana no puede inventarse consumo ajeno" \
  "$COMO_ANA insert into ia_uso (empresa_id, modulo, operacion, modelo_pedido, resultado) values ('22222222-2222-4222-8222-222222222222','x','x.y','m','ok')"
debe_fallar "Ana no puede escribir resúmenes a mano" \
  "$COMO_ANA insert into ia_resumen_vehiculo (empresa_id, vehiculo_id, huella, version, payload, caduca_at) values ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','x','v1','{}', now())"
debe_fallar "Ana no puede tocar la coordinación entre instancias" \
  "$COMO_ANA select count(*) from ia_resumen_en_curso"
debe_fallar "Ana no puede liberar el arrendamiento de otro" \
  "$COMO_ANA delete from ia_resumen_en_curso"

echo
echo "── Anónimo: no ve nada ──────────────────────────────────────────────"
# Ni siquiera llega a la RLS: al anónimo se le ha revocado el SELECT, así que
# la consulta se rechaza de plano. Mejor así que devolver cero filas.
debe_fallar "anon no puede ni leer el consumo" "$COMO_ANON select count(*) from ia_uso"
debe_fallar "anon no puede ni leer los límites" "$COMO_ANON select count(*) from ia_limites"
debe_fallar "anon no puede ni leer los resúmenes" "$COMO_ANON select count(*) from ia_resumen_vehiculo"
debe_fallar "anon no puede escribir límites" \
  "$COMO_ANON insert into ia_limites (empresa_id) values ('11111111-1111-4111-8111-111111111111')"

echo
echo "── Funciones SQL: no se añade superficie nueva ──────────────────────"
comprobar "la migración no crea ninguna función" \
  "select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ia\_%'" "0"

echo
echo "── Vuelta atrás y reaplicación ──────────────────────────────────────"
$Q -f "$MIG/ia_consumo_y_resumen_vehiculo_vuelta_atras.sql" >/dev/null
comprobar "no queda ninguna tabla de la migración" \
  "select count(*)::text from pg_tables where tablename like 'ia\_%'" "0"
comprobar "lo anterior sigue en pie" \
  "select count(*)::text from pg_tables where tablename = 'tc_vehiculos'" "1"
$Q -f "$MIG/ia_consumo_y_resumen_vehiculo.sql" >/dev/null
comprobar "se puede reaplicar después de volver atrás" \
  "select count(*)::text from pg_tables where tablename like 'ia\_%'" "4"

echo
if [ "$fallos" -eq 0 ]; then echo "TODO OK"; else echo "$fallos COMPROBACIONES FALLIDAS"; exit 1; fi
