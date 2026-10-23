#!/usr/bin/env bash
#
# PREFLIGHT DE PRODUCCIÓN — paso 1 de la puesta en producción del PR #492.
#
# SOLO LECTURA. Abre la sesión con `default_transaction_read_only = on`, así
# que si algo intentara escribir, PostgreSQL lo rechazaría. Lo único que
# escribe son ficheros en el directorio de salida.
#
#   DATABASE_URL='postgresql://…' bash scripts/produccion/preflight-produccion.sh
#
# Modos:
#   (sin argumentos)            comprobación completa + fotografía previa
#   --fotografia DIR [COMO]     solo la fotografía. Con COMO (otro directorio
#                               de fotografía) usa SUS MISMAS columnas, que es
#                               lo que permite comparar a través de una
#                               migración que añade columnas.
#   --comparar ANTES DESPUES    compara dos fotografías y dice qué ha cambiado
#
# Ninguna consulta que falle se da por buena: cualquier error de SQL cuenta
# como comprobación no realizada y bloquea.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$AQUI/../.." && pwd)}"

# ── Las tablas cuyos datos hay que conservar intactos ─────────────────────
TABLAS_FOTO=(tc_vehiculos tc_neumaticos tc_montajes_actuales operaciones_neumaticos
             tc_intervenciones tc_intervencion_servicios tc_historial_montajes
             revisiones_vehiculo revisiones_neumaticos_detalle movimientos_stock
             tc_contadores_numero_interno tc_contadores_numero_operacion)
# Las que la importación escribe: en ellas, un cambio CON lote es lo esperado.
CON_LOTE=(tc_neumaticos operaciones_neumaticos tc_intervenciones tc_intervencion_servicios)

FALLOS=0; AVISOS=0; SQL_ERRORES=0
INF=""
eco() { if [[ -n "$INF" ]]; then printf '%s\n' "$1" | tee -a "$INF"; else printf '%s\n' "$1"; fi; }
ok()  { eco "  OK     $1"; }
mal() { eco "  PARA   $1"; FALLOS=$((FALLOS+1)); }
avi() { eco "  MIRA   $1"; AVISOS=$((AVISOS+1)); }
tit() { eco ""; eco "$1"; }

# Una consulta. Devuelve el valor por stdout. Si psql falla, lo dice y
# devuelve 1: el que llama NO puede dar por buena la comprobación.
c() {
  local salida rc
  salida=$(psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?
  if [[ $rc -ne 0 ]]; then
    eco "  ERROR  una consulta ha fallado; esta comprobación no vale:"
    eco "$(sed 's/^/           /' <<<"$salida")"
    eco "         SQL: $(head -c 200 <<<"$1")"
    SQL_ERRORES=$((SQL_ERRORES+1)); return 1
  fi
  printf '%s' "$salida"
}
# Igual, pero volcando a un fichero.
ca() {
  local destino="$1" sql="$2" rc tmperr
  tmperr=$(mktemp)
  # El orden importa: «> fichero 2>&1» mandaría también los errores AL
  # FICHERO, que es justo lo que no se quiere: acabarían dentro del SQL.
  psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$sql" 2>"$tmperr" >"$destino"; rc=$?
  if [[ $rc -ne 0 ]]; then
    eco "  ERROR  no se ha podido escribir $(basename "$destino"):"
    eco "$(sed 's/^/           /' "$tmperr")"
    SQL_ERRORES=$((SQL_ERRORES+1)); rm -f "$destino" "$tmperr"; return 1
  fi
  rm -f "$tmperr"
}

conectar() {
  : "${DATABASE_URL:?Falta DATABASE_URL (la base de PRODUCCIÓN, en modo lectura)}"
  export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on"
  local salida
  if ! salida=$(psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 -c "select 1" 2>&1); then
    echo "No se puede conectar con DATABASE_URL. Nada comprobado, nada escrito." >&2
    sed 's/^/  /' <<<"$salida" >&2
    exit 1
  fi
}

# ── Fotografía ────────────────────────────────────────────────────────────
#
# Recuentos NO: huellas por fila. La suma de kilómetros puede quedarse igual
# con dos vehículos cambiados, y el máximo de un contador no dice nada de los
# demás. Aquí, de cada tabla protegida, sale una línea por fila con su clave
# primaria y el md5 de la fila entera; así un diff señala la fila exacta.
#
# Las columnas usadas se guardan aparte: la fotografía de DESPUÉS tiene que
# usar las MISMAS, o las columnas que añaden las migraciones cambiarían todas
# las huellas sin que nadie haya tocado un dato.
fotografia() {
  local dir="$1" como="${2:-}"
  mkdir -p "$dir/filas" "$dir/columnas" "$dir/lotes"
  local t cols clave n
  for t in "${TABLAS_FOTO[@]}"; do
    local existe; existe=$(c "select to_regclass('public.$t') is not null") || return 1
    if [[ "$existe" != "t" ]]; then echo "(no existe)" > "$dir/columnas/$t.txt"; continue; fi

    if [[ -n "$como" && -s "$como/columnas/$t.txt" && "$(cat "$como/columnas/$t.txt")" != "(no existe)" ]]; then
      cols=$(cat "$como/columnas/$t.txt")
      # Si alguna de aquellas columnas ya no está, la comparación no vale.
      local faltan
      faltan=$(c "select coalesce(string_agg(x, ', '), '') from unnest(string_to_array(\$\$$cols\$\$, ',')) x
                   where trim(both '\"' from trim(x)) not in (
                     select column_name from information_schema.columns
                      where table_schema='public' and table_name='$t')") || return 1
      [[ -n "$faltan" ]] && { mal "a $t le faltan columnas que sí tenía la fotografía previa: $faltan"; continue; }
    else
      cols=$(c "select string_agg(quote_ident(column_name), ',' order by ordinal_position)
                  from information_schema.columns where table_schema='public' and table_name='$t'") || return 1
    fi
    printf '%s' "$cols" > "$dir/columnas/$t.txt"

    clave=$(c "select coalesce(string_agg(quote_ident(a.attname), ',' order by k.ord), '')
                 from pg_index i
                 join lateral unnest(i.indkey) with ordinality k(attnum, ord) on true
                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                where i.indrelid = 'public.$t'::regclass and i.indisprimary") || return 1
    local keyexpr="md5(row($cols)::text)"
    [[ -n "$clave" ]] && keyexpr="concat_ws('~', $(sed 's/,/::text, /g; s/$/::text/' <<<"$clave"))"
    ca "$dir/filas/$t.txt" \
       "select $keyexpr || '|' || md5(row($cols)::text) from public.$t order by 1" || return 1
    n=$(wc -l < "$dir/filas/$t.txt")
    printf '%-32s %8s filas\n' "$t" "$n" | tee -a "${INF:-/dev/null}" >/dev/null
    echo "$t $n" >> "$dir/recuentos.txt"

    # Las claves que la importación ha tocado, para poder separar después lo
    # que ha hecho la carga de lo que ha hecho el taller en paralelo.
    local tiene_lote
    tiene_lote=$(c "select count(*) from information_schema.columns
                     where table_schema='public' and table_name='$t' and column_name='importacion_lote_id'") || return 1
    if [[ "$tiene_lote" == "1" ]]; then
      ca "$dir/lotes/$t.txt" \
         "select $keyexpr from public.$t where importacion_lote_id is not null order by 1" || return 1
    else
      : > "$dir/lotes/$t.txt"
    fi
  done

  # Dos cosas que conviene poder leer a ojo, además de la huella.
  ca "$dir/km-por-vehiculo.txt" \
     "select v.id || '|' || coalesce(v.matricula,'') || '|' || coalesce(v.km_actual::text,'') || '|' ||
             coalesce(v.origen_km::text,'') from tc_vehiculos v order by 1" || return 1
  ca "$dir/contadores.txt" \
     "select 'numero_interno|' || t::text from tc_contadores_numero_interno t order by 1" || return 1
  if [[ "$(c "select to_regclass('public.tc_contadores_numero_operacion') is not null")" == "t" ]]; then
    psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 \
      -c "select 'numero_operacion|' || t::text from tc_contadores_numero_operacion t order by 1" \
      >> "$dir/contadores.txt" 2>/dev/null || true
  fi
  date -Is > "$dir/tomada-el.txt"
  c "select current_database()" > "$dir/base.txt" || return 1
  return 0
}

comparar() {
  local antes="$1" despues="$2"
  [[ -d "$antes/filas" && -d "$despues/filas" ]] || { echo "Faltan los directorios de fotografía." >&2; exit 1; }
  echo "Fotografía previa:  $(cat "$antes/tomada-el.txt" 2>/dev/null)"
  echo "Fotografía después: $(cat "$despues/tomada-el.txt" 2>/dev/null)"
  echo
  local t ruta_a ruta_d
  for t in "${TABLAS_FOTO[@]}"; do
    ruta_a="$antes/filas/$t.txt"; ruta_d="$despues/filas/$t.txt"
    [[ -f "$ruta_a" && -f "$ruta_d" ]] || { printf '%-30s  (sin fotografía en una de las dos)\n' "$t"; continue; }
    python3 - "$t" "$ruta_a" "$ruta_d" "$despues/lotes/$t.txt" <<'PY'
import sys, pathlib
tabla, fa, fd, flote = sys.argv[1:5]
def leer(p):
    d = {}
    for l in pathlib.Path(p).read_text().splitlines():
        if "|" in l:
            k, h = l.rsplit("|", 1); d[k] = h
    return d
a, b = leer(fa), leer(fd)
lotes = set(pathlib.Path(flote).read_text().split()) if pathlib.Path(flote).exists() else set()
nuevas   = [k for k in b if k not in a]
perdidas = [k for k in a if k not in b]
cambiadas = [k for k in a if k in b and a[k] != b[k]]
def parte(claves):
    con = [k for k in claves if k in lotes]
    return len(con), [k for k in claves if k not in lotes]
n_con, n_sin = parte(nuevas)
c_con, c_sin = parte(cambiadas)
print(f"{tabla:<30}  antes={len(a)}  después={len(b)}")
if not (nuevas or perdidas or cambiadas):
    print("    sin cambios")
else:
    if nuevas:
        print(f"    filas nuevas: {len(nuevas)}  ·  con lote de importación: {n_con}  ·  SIN lote: {len(n_sin)}")
        for k in n_sin[:10]: print(f"        nueva sin lote: {k}")
    if cambiadas:
        print(f"    filas cambiadas: {len(cambiadas)}  ·  con lote: {c_con}  ·  SIN lote: {len(c_sin)}")
        for k in c_sin[:10]: print(f"        cambiada sin lote: {k}")
    if perdidas:
        print(f"    filas DESAPARECIDAS: {len(perdidas)}")
        for k in perdidas[:10]: print(f"        desaparecida: {k}")
PY
  done
  echo
  echo "Cómo se lee esto, que no lo decide el script:"
  echo "  · «con lote» son filas que ha escrito la importación: es lo esperado."
  echo "  · «SIN lote» puede ser el taller trabajando en paralelo (un montaje,"
  echo "    una revisión, un kilometraje) o puede ser daño. Hay que mirarlas una"
  echo "    a una contra el parte de trabajo de esas horas; ni se dan por buenas"
  echo "    ni se dan por malas automáticamente."
  echo "  · «DESAPARECIDAS» no tiene lectura benigna en esta carga: la"
  echo "    importación no borra nada."
  echo
  echo "Kilómetros y contadores, para leer a ojo:"
  for f in km-por-vehiculo.txt contadores.txt; do
    if [[ -f "$antes/$f" && -f "$despues/$f" ]]; then
      local d; d=$(diff "$antes/$f" "$despues/$f" | grep -c '^[<>]' || true)
      printf '  %-24s %s línea(s) distintas\n' "$f" "$d"
      diff "$antes/$f" "$despues/$f" | head -20 | sed 's/^/      /'
    fi
  done
}

# ── Modos ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  --comparar) comparar "${2:?Falta el directorio ANTES}" "${3:?Falta el directorio DESPUES}"; exit 0 ;;
  --fotografia)
    conectar
    DIR="${2:?Falta el directorio de salida}"; mkdir -p "$DIR"; INF="$DIR/informe.txt"; : > "$INF"
    fotografia "$DIR" "${3:-}" || { echo "La fotografía no se ha podido completar." >&2; exit 1; }
    [[ "$SQL_ERRORES" -gt 0 || "$FALLOS" -gt 0 ]] && { echo "Fotografía incompleta." >&2; exit 1; }
    echo "Fotografía en $DIR"; exit 0 ;;
esac

conectar
SALIDA="${SALIDA:-./preflight-$(date +%Y%m%d-%H%M)}"
mkdir -p "$SALIDA"; INF="$SALIDA/informe.txt"; : > "$INF"

OBJETOS="$SALIDA/objetos.json"
python3 "$AQUI/objetos-de-las-migraciones.py" > "$OBJETOS" || {
  echo "No he podido leer los objetos de las migraciones." >&2; exit 1; }
lee() { python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
v=d
for k in sys.argv[2].split('.'): v=v[k]
print('\n'.join(v) if isinstance(v,list) else v)" "$OBJETOS" "$1"; }

tit "1. A qué base se está mirando"
python3 - "$DATABASE_URL" <<'PY' | tee -a "$INF" > "$SALIDA/00-identificacion.txt"
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
print(f"host={u.hostname} puerto={u.port or 5432} base={(u.path or '/').lstrip('/')}")
PY
BASE=$(c "select current_database()")   || mal "no se ha podido leer current_database()"
VER=$(c "select version()")             || true
NTAB=$(c "select count(*) from pg_tables where schemaname='public'") || true
MARCA=$(c "select coalesce(current_setting('mobilink.entorno', true), '')") || MARCA="?"
{ echo; echo "current_database: ${BASE:-?}"; echo "versión:          ${VER:-?}"
  echo "tablas en public: ${NTAB:-?}"; echo "marca de entorno: ${MARCA:-(ninguna)}"; } >> "$SALIDA/00-identificacion.txt"
if [[ "$MARCA" == "pruebas" ]]; then
  mal "esta base lleva la marca 'pruebas': NO es producción, o alguien se la ha puesto"
else
  ok "sin marca de entorno de pruebas (producción no la lleva)"
fi

# La columna importacion_lote_id la añade la migración 1: antes de aplicarla
# NO existe, y preguntarla sin más hace fallar la consulta entera.
HAY_LOTE=$(c "select count(*) from information_schema.columns
               where table_schema='public' and table_name='tc_neumaticos' and column_name='importacion_lote_id'")
if [[ -z "${HAY_LOTE:-}" ]]; then
  mal "no se ha podido saber si tc_neumaticos tiene importacion_lote_id"
elif [[ "$HAY_LOTE" == "1" ]]; then
  HIST=$(c "select count(*) from tc_neumaticos where importacion_lote_id is not null") || HIST="?"
  [[ "$HIST" == "0" ]] && ok "la columna importacion_lote_id ya existe y no hay ninguna ficha histórica" \
                       || avi "ya hay $HIST fichas históricas: alguien importó antes. Mira los lotes"
  EMPRESAS_SQL="select e.id||'  '||rpad(e.nombre,32)||'  vehiculos='||(select count(*) from tc_vehiculos v where v.empresa_id=e.id)||'  neumaticos='||(select count(*) from tc_neumaticos n where n.empresa_id=e.id)||'  historicas='||(select count(*) from tc_neumaticos n where n.empresa_id=e.id and n.importacion_lote_id is not null) from tc_empresas e order by e.nombre"
else
  ok "la columna importacion_lote_id no existe todavía: lo normal antes de la migración 1"
  EMPRESAS_SQL="select e.id||'  '||rpad(e.nombre,32)||'  vehiculos='||(select count(*) from tc_vehiculos v where v.empresa_id=e.id)||'  neumaticos='||(select count(*) from tc_neumaticos n where n.empresa_id=e.id) from tc_empresas e order by e.nombre"
fi
{ echo; echo "EMPRESAS (confirma Plana por su UUID, no por el nombre):"; } >> "$SALIDA/00-identificacion.txt"
if ca "$SALIDA/.empresas" "$EMPRESAS_SQL"; then
  cat "$SALIDA/.empresas" >> "$SALIDA/00-identificacion.txt"; rm -f "$SALIDA/.empresas"
  ok "$(c "select count(*) from tc_empresas") empresa(s); la lista con sus UUID está en 00-identificacion.txt"
else
  mal "no se ha podido listar las empresas"
fi

tit "2. ¿Existe lo que las tres migraciones dan por supuesto?"
: > "$SALIDA/01-esquema.txt"
FALTAN=0
echo "TABLAS REQUERIDAS" >> "$SALIDA/01-esquema.txt"
while read -r t; do
  [[ -z "$t" ]] && continue
  r=$(c "select to_regclass('public.$t') is not null") || { FALTAN=$((FALTAN+1)); continue; }
  echo "$t: $r" >> "$SALIDA/01-esquema.txt"
  [[ "$r" == "t" ]] || { mal "falta la tabla $t, que las migraciones dan por supuesta"; FALTAN=$((FALTAN+1)); }
done < <(lee requiere_tablas)
echo >> "$SALIDA/01-esquema.txt"; echo "COLUMNAS REQUERIDAS" >> "$SALIDA/01-esquema.txt"
while read -r tc; do
  [[ -z "$tc" ]] && continue
  t="${tc%%.*}"; col="${tc#*.}"
  r=$(c "select count(*) from information_schema.columns
          where table_schema='public' and table_name='$t' and column_name='$col'") || { FALTAN=$((FALTAN+1)); continue; }
  echo "$tc: $r" >> "$SALIDA/01-esquema.txt"
  [[ "$r" == "1" ]] || { mal "falta la columna $tc, que las migraciones usan"; FALTAN=$((FALTAN+1)); }
done < <(lee requiere_columnas)
echo >> "$SALIDA/01-esquema.txt"; echo "FUNCIONES REQUERIDAS" >> "$SALIDA/01-esquema.txt"
while read -r f; do
  [[ -z "$f" ]] && continue
  r=$(c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='$f'") || { FALTAN=$((FALTAN+1)); continue; }
  echo "$f: $r" >> "$SALIDA/01-esquema.txt"
  [[ "${r:-0}" != "0" ]] || { mal "falta la función $f, que las migraciones llaman"; FALTAN=$((FALTAN+1)); }
done < <(lee requiere_funciones)
[[ "$FALTAN" -eq 0 ]] && ok "están las $(lee requiere_tablas | grep -c .) tablas, las $(lee requiere_columnas | grep -c .) columnas y las $(lee requiere_funciones | grep -c .) funciones que las migraciones dan por supuestas"

tit "3. Firmas: ¿la que hay es la que la migración va a redefinir?"
# Contar sobrecargas no basta: una sola función con OTRA firma también haría
# que el «create or replace» creara una segunda y PostgREST respondiera
# PGRST203. Aquí se compara la firma EXACTA que declara la migración contra
# la base, con to_regprocedure, que resuelve los tipos como PostgreSQL.
echo >> "$SALIDA/01-esquema.txt"; echo "FIRMAS QUE REDEFINE EL PR" >> "$SALIDA/01-esquema.txt"
REDEF_FN=(); NUEVAS=0; PREEXISTEN=0
while IFS='|' read -r nombre firma; do
  [[ -z "$nombre" ]] && continue
  n=$(c "select count(*) from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace
          where nn.nspname='public' and p.proname='$nombre'") || continue
  exacta=$(c "select to_regprocedure('$(sed "s/'/''/g" <<<"$firma")') is not null") || continue
  echo "$firma  ->  sobrecargas=$n  firma_exacta=$exacta" >> "$SALIDA/01-esquema.txt"
  if [[ "$n" == "0" ]]; then
    NUEVAS=$((NUEVAS+1))                       # objeto nuevo del PR: normal
  elif [[ "$exacta" == "t" ]]; then
    PREEXISTEN=$((PREEXISTEN+1)); REDEF_FN+=("$nombre")
  else
    mal "$nombre ya existe en producción con OTRA firma: el «create or replace» de la migración crearía una SEGUNDA función y PostgREST respondería PGRST203. Mira 01-esquema.txt"
  fi
done < <(python3 -c "
import json,sys
for f in json.load(open(sys.argv[1]))['redefine_funciones']:
    print(f\"{f['nombre']}|{f['firma']}\")" "$OBJETOS")
ok "$NUEVAS función(es) nuevas del PR (su ausencia es normal) y $PREEXISTEN que ya existen con la firma exacta"
REDEF_VI=()
while read -r v; do
  [[ -z "$v" ]] && continue
  r=$(c "select to_regclass('public.$v') is not null") || continue
  [[ "$r" == "t" ]] && REDEF_VI+=("$v")
done < <(lee redefine_vistas)
ok "vistas que el PR redefine y YA existen: ${#REDEF_VI[@]} (${REDEF_VI[*]:-ninguna})"

tit "4. Disparadores de las tablas que la importación escribe, con su cuerpo"
# pg_get_triggerdef dice CÓMO se llaman; no dice QUÉ escriben. Por eso va
# también el cuerpo de cada función de disparador.
ca "$SALIDA/02-triggers.txt" "
with t as (
  select c.relname as tabla, tg.tgname, pg_get_triggerdef(tg.oid) as def, p.oid as fn
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
   where n.nspname='public' and not tg.tgisinternal
     and c.relname in ('operaciones_neumaticos','tc_intervenciones','tc_intervencion_servicios',
                       'tc_neumaticos','tc_montajes_actuales','tc_vehiculos','tc_historial_montajes',
                       'movimientos_stock')
)
select string_agg('-- ' || tabla || ' · ' || tgname || E'\n' || def || ';' || E'\n\n' ||
                  pg_get_functiondef(fn) || E'\n', E'\n' order by tabla, tgname) from t" \
  && { NT=$(grep -c "^-- " "$SALIDA/02-triggers.txt" || true)
       [[ "${NT:-0}" -eq 0 ]] && ok "ninguna de esas tablas tiene disparadores propios" \
                              || avi "$NT disparador(es), con el cuerpo de su función, en 02-triggers.txt. Hay que leer QUÉ escriben"; } \
  || mal "no se han podido leer los disparadores"

tit "5. Permisos actuales de lo que se redefine, y qué depende de ello"
LISTA_FN=$(IFS=,; echo "${REDEF_FN[*]:-}")
LISTA_VI=$(IFS=,; echo "${REDEF_VI[*]:-}")
ca "$SALIDA/03-permisos.txt" "
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')  dueño=' ||
       pg_get_userbyid(p.proowner) || '  acl=' || coalesce(p.proacl::text, '(por defecto)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname = any(string_to_array('$LISTA_FN', ','))
union all
select c.relname || '  dueño=' || pg_get_userbyid(c.relowner) || '  acl=' ||
       coalesce(c.relacl::text, '(por defecto)') || '  opciones=' ||
       coalesce(array_to_string(c.reloptions, ','), '(ninguna)')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relname = any(string_to_array('$LISTA_VI', ','))
 order by 1" && ok "permisos, dueños y opciones guardados en 03-permisos.txt" \
             || mal "no se han podido leer los permisos"
ca "$SALIDA/04-dependencias.txt" "
select distinct d.relname || ' depende de ' || o.relname
  from pg_depend dep
  join pg_rewrite r on r.oid = dep.objid
  join pg_class d on d.oid = r.ev_class
  join pg_class o on o.oid = dep.refobjid
  join pg_namespace n on n.oid = o.relnamespace
 where n.nspname='public' and o.relname = any(string_to_array('$LISTA_VI', ','))
   and d.relname <> o.relname" && {
  ND=$(wc -l < "$SALIDA/04-dependencias.txt")
  [[ "$ND" -eq 0 ]] && ok "nada depende de las vistas que se redefinen" \
                    || avi "$ND dependencia(s) sobre esas vistas — en 04-dependencias.txt"; } \
  || mal "no se han podido leer las dependencias"

tit "6. Vuelta atrás de TODO lo que el PR redefine y ya existe"
if [[ -z "$LISTA_FN" && -z "$LISTA_VI" ]]; then
  ok "no hay nada que guardar: el PR no redefine ningún objeto que ya exista"
else
  rm -f "$SALIDA/05-vuelta-atras.sql"
  if FUNCIONES="$LISTA_FN" VISTAS="$LISTA_VI" ORIGEN_URL="$DATABASE_URL" \
     bash "$REPO/scripts/staging/07-guardar-vuelta-atras.sh" "$SALIDA/05-vuelta-atras.sql" >> "$INF" 2>&1; then
    if grep -qnE '^(psql:|ERROR:|FATAL:|HINT:|DETAIL:)' "$SALIDA/05-vuelta-atras.sql"; then
      mal "se han colado mensajes de error dentro de 05-vuelta-atras.sql"
    else
      ok "$(grep -ci '^create or replace' "$SALIDA/05-vuelta-atras.sql") definición(es) con su dueño y sus permisos exactos en 05-vuelta-atras.sql"
      avi "pruébalo antes de fiarte, en una base desechable con el mismo esquema"
      eco "         (con las MISMAS listas, o la huella solo cubriría una parte):"
      eco "           FUNCIONES='$LISTA_FN' \\"
      eco "           VISTAS='$LISTA_VI' \\"
      eco "           bash scripts/staging/07-guardar-vuelta-atras.sh --probar \\"
      eco "             $SALIDA/05-vuelta-atras.sql <base_desechable>"
    fi
  else
    mal "el generador de la vuelta atrás ha fallado; mira el informe"
  fi
fi

tit "7. Fotografía previa"
if fotografia "$SALIDA/fotografia-antes"; then
  ok "fotografía en $SALIDA/fotografia-antes: una huella por fila de $(ls "$SALIDA/fotografia-antes/filas" | wc -l) tabla(s)"
  eco "         Después de migrar y de importar, repítela con las MISMAS columnas y compara:"
  eco "           bash scripts/produccion/preflight-produccion.sh --fotografia DESPUES $SALIDA/fotografia-antes"
  eco "           bash scripts/produccion/preflight-produccion.sh --comparar $SALIDA/fotografia-antes DESPUES"
else
  mal "la fotografía previa no se ha podido completar: sin ella no hay con qué comparar"
fi

tit "8. Lo que este script NO puede comprobar"
avi "el BACKUP recuperable. Supabase → Database → Backups: anota fecha, hora y"
eco "         cómo se restaura, y pruébalo restaurando en un proyecto aparte ANTES"
eco "         de migrar. Un volcado sin restaurar no es un respaldo."

tit "RESULTADO"
if [[ "$SQL_ERRORES" -gt 0 ]]; then
  eco "$SQL_ERRORES consulta(s) han fallado: hay comprobaciones SIN HACER. No apliques nada."
fi
if [[ "$FALLOS" -gt 0 || "$SQL_ERRORES" -gt 0 ]]; then
  eco "$FALLOS comprobación(es) en PARA. No apliques ninguna migración."
  eco "Salida en: $SALIDA"
  exit 1
fi
eco "Sin bloqueos. $AVISOS punto(s) marcados MIRA, que hay que leer antes de seguir."
eco "Salida en: $SALIDA"
