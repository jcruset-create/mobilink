#!/usr/bin/env bash
#
# Comprueba los permisos de la base de PRUEBAS: que permisos-pruebas.sql no se
# ha quedado atrás respecto a la aplicación ni a las migraciones, y que lo que
# tiene que estar cerrado lo está.
#
#   DESTINO_URL='postgresql://…' bash scripts/staging/10-comprobar-permisos.sh
#
# Con el stack local levantado se añaden las comprobaciones por HTTP, que son
# las que de verdad reproducen lo que hace el panel:
#
#   DESTINO_URL=… REST_URL=http://127.0.0.1:3001 \
#   JWT_SECRET=<el mismo de PostgREST> bash scripts/staging/10-comprobar-permisos.sh
#
# No escribe nada: la única prueba que inserta (el aislamiento entre empresas)
# va dentro de una transacción con rollback.
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${DESTINO_URL:?Falta DESTINO_URL (cadena de conexión de la base de PRUEBAS)}"

FALLOS=0
ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; FALLOS=$((FALLOS+1)); }
q()   { psql "$DESTINO_URL" -At -c "$1" 2>&1; }

echo "1. El fichero de permisos sigue el ritmo de la aplicación"
CATALOGO=$(mktemp)
q "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p','v','m')" > "$CATALOGO"
python3 - "$RAIZ" "$CATALOGO" <<'PY'
import json, re, sys, pathlib, collections
RAIZ = pathlib.Path(sys.argv[1])
sql  = (RAIZ/"scripts/staging/permisos-pruebas.sql").read_text()
# Para buscar sentencias, el fichero SIN comentarios: la cabecera cita el
# grant global que se retiró y haría saltar las comprobaciones de la letra c.
sql_sin_comentarios = "\n".join(re.sub(r'--.*$', '', l) for l in sql.splitlines())
plan = json.loads((RAIZ/"scripts/staging/permisos-pruebas.json").read_text())
fallos = []

# a) lo que concede cada migración tiene que estar repetido en el fichero
mig = set()
for f in sorted((RAIZ/"supabase/migrations").glob("*.sql")):
    for linea in f.read_text(errors="ignore").splitlines():
        s = linea.strip().lower().rstrip()
        if re.match(r'^grant (execute on function|select|insert|update|delete|all) ', s) and s.endswith(';'):
            mig.add(re.sub(r'\bpublic\.', '', s))
faltan = sorted(g for g in mig if g not in sql)
if faltan:
    fallos.append("grants de las migraciones que NO repite permisos-pruebas.sql:\n    " + "\n    ".join(faltan))

# b) la superficie de la aplicación no ha crecido por debajo
RAICES = ["src/modules/tyrecontrol","src/services","src/lib","src/hooks","src/components",
          "server/tyrecontrol","server/core","server/index.ts"]
pt = re.compile(r'\.from\(\s*["\']([A-Za-z0-9_]+)["\']\s*\)')
pr = re.compile(r'\.rpc\(\s*["\']([A-Za-z0-9_]+)["\']')
tablas, llamadas = set(), set()
for base in RAICES:
    p0 = RAIZ/base
    for p in ([p0] if p0.is_file() else [x for x in p0.rglob("*") if x.suffix in (".ts",".tsx",".mts")]):
        t = p.read_text(errors="ignore")
        tablas.update(m.group(1) for m in pt.finditer(t))
        llamadas.update(m.group(1) for m in pr.finditer(t))
conocidas = set(plan["T_LEE"]) | set(plan["T_ESCRIBE"]) | set(plan["T_SRV"])
# Solo cuentan las que existen de verdad en la base: la aplicación nombra
# tablas de módulos que no están en supabase/migrations (Almacén, OCR) y que
# en este esquema no existen, así que no hay nada que conceder.
existen = set(pathlib.Path(sys.argv[2]).read_text().split())
nuevas = sorted(t for t in tablas & existen
                if t not in conocidas and not re.search(r'\b'+re.escape(t)+r'\b', sql))
if nuevas:
    fallos.append("tablas/vistas que usa la aplicación y no aparecen en el fichero: " + ", ".join(nuevas))
nuevos_rpc = sorted(r for r in llamadas if not re.search(r'\b'+re.escape(r)+r'\s*\(', sql))
if nuevos_rpc:
    fallos.append("RPC que llama la aplicación y no aparecen en el fichero: " + ", ".join(nuevos_rpc))

# c) nada de permisos globales ni default privileges de vuelta
for patron, texto in [(r'grant\s+\w+\s+on\s+all\s+\w+\s+in\s+schema', "hay un «grant ... on all ... in schema»"),
                      (r'alter\s+default\s+privileges[^;]*\bgrant\b', "hay un «alter default privileges ... grant»")]:
    if re.search(patron, sql_sin_comentarios, re.I|re.S):
        fallos.append(texto)

if fallos:
    for f in fallos: print("  FALLA " + f)
    sys.exit(1)
print("  OK    permisos-pruebas.sql cubre las %d tablas y los %d RPC que usa la aplicación"
      % (len(tablas), len(llamadas)))
print("  OK    repite los %d grant de las migraciones" % len(mig))
print("  OK    las %d tablas que nombra la aplicación y no existen en el esquema no necesitan permiso"
      % len(tablas - existen))
print("  OK    sin «on all ... in schema» ni default privileges")
PY
[[ $? -ne 0 ]] && FALLOS=$((FALLOS+1))
rm -f "$CATALOGO"

echo
echo "2. RPC de escritura: solo los roles autorizados"
for f in tc_imp_bloquear tc_imp_exigir_admin tc_imp_medianoche; do
  r=$(q "select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$f' limit 1")
  [[ "$r" == "f" ]] && ok "authenticated no puede ejecutar $f" || mal "authenticated PUEDE ejecutar $f ($r)"
done
for f in tc_importar_historico tc_deshacer_importacion tc_imp_revisar_intervalo tc_imp_fijar_limite_km_dia; do
  r=$(q "select has_function_privilege('anon', p.oid, 'execute') from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$f' limit 1")
  [[ "$r" == "f" ]] && ok "anon no puede ejecutar $f" || mal "anon PUEDE ejecutar $f ($r)"
done
r=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.prosecdef
         and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not like 'tc\_op\_%' and p.proname <> 'tc_operator_login'
         and p.proname <> 'app_login_email'")
[[ "$r" == "0" ]] && ok "ninguna función security definer suelta para anon" \
                  || mal "$r función(es) security definer ejecutables por anon fuera del quiosco del operario"

echo
echo "3. Funciones auxiliares sin ejecución pública"
r=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')")
[[ "$r" == "0" ]] && ok "ninguna de las funciones del esquema la ejecuta PUBLIC" \
                  || mal "$r función(es) siguen siendo ejecutables por PUBLIC"
r=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname like 'tc\_imp\_intervalo\_%'
         and has_function_privilege('anon', p.oid, 'execute')")
[[ "$r" == "0" ]] && ok "los auxiliares de intervalos de la fase 3 no los ejecuta anon" \
                  || mal "anon ejecuta $r auxiliar(es) tc_imp_intervalo_*"

echo
echo "4. Auditoría: sin inserción, actualización ni borrado desde la aplicación"
for rol in anon authenticated service_role; do
  r=$(q "select has_table_privilege('$rol','tc_reconstruccion_revisiones','insert')
             or has_table_privilege('$rol','tc_reconstruccion_revisiones','update')
             or has_table_privilege('$rol','tc_reconstruccion_revisiones','delete')")
  [[ "$r" == "f" ]] && ok "$rol no puede escribir en tc_reconstruccion_revisiones" \
                    || mal "$rol PUEDE escribir en tc_reconstruccion_revisiones"
done
r=$(q "select has_table_privilege('authenticated','tc_reconstruccion_revisiones','select')")
[[ "$r" == "t" ]] && ok "authenticated sí puede leerla (el panel la enseña)" \
                  || mal "authenticated no puede ni leer la auditoría"

echo
echo "5. Tablas sin RLS que no deben quedar expuestas"
EXPUESTAS=$(q "select coalesce(string_agg(c.relname, ', '), '') from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and (has_table_privilege('authenticated', c.oid, 'select')
         or has_table_privilege('anon', c.oid, 'select'))
    and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid=c.oid))")
if [[ "$EXPUESTAS" == "productos_neumaticos" ]]; then
  ok "la única tabla sin RLS con permisos es la excepción declarada (productos_neumaticos)"
elif [[ -z "$EXPUESTAS" ]]; then
  ok "ninguna tabla sin RLS tiene permisos"
else
  mal "tablas sin RLS con permisos: $EXPUESTAS"
fi
r=$(q "select has_table_privilege('authenticated','productos_neumaticos','insert')
           or has_table_privilege('authenticated','productos_neumaticos','update')
           or has_table_privilege('authenticated','productos_neumaticos','delete')")
[[ "$r" == "f" ]] && ok "y la excepción se queda en solo lectura" || mal "la excepción admite escritura"
r=$(q "select coalesce(string_agg(c.relname, ', '), '') from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v'
    and has_table_privilege('authenticated', c.oid, 'select')
    and c.relname not in ('tc_clientes_almacen','tc_productos_almacen')
    and coalesce((select true from unnest(c.reloptions) o where o='security_invoker=true'), false) is not true")
[[ -z "$r" ]] && ok "ninguna vista concedida se salta la RLS" || mal "vistas que se saltan la RLS: $r"
r=$(q "select coalesce(string_agg(c.relname, ', '), '') from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m')
    and has_table_privilege('anon', c.oid, 'select')")
[[ -z "$r" ]] && ok "anon no lee ninguna tabla ni vista" || mal "anon lee: $r"

echo
echo "6. Aislamiento entre empresas (transacción con rollback)"
AISLA=$(psql "$DESTINO_URL" -At <<'SQL' 2>&1
begin;
do $$
declare
  v_a uuid; v_b uuid; v_user uuid := gen_random_uuid();
  v_total int; v_vistos int; v_intervalos int;
begin
  -- La empresa de referencia es la que tiene vehículos; la otra, cualquiera.
  select e.id into v_a from tc_empresas e
    order by (select count(*) from tc_vehiculos v where v.empresa_id = e.id) desc, e.nombre limit 1;
  select id into v_b from tc_empresas where id <> v_a order by nombre limit 1;
  if v_b is null then raise notice 'SALTADA: hace falta mas de una empresa en la base'; return; end if;

  insert into auth.users (id, email) values (v_user, 'aislamiento@pruebas.local')
    on conflict (id) do nothing;
  insert into tc_usuarios (id, email, nombre, rol, empresa_id, activo)
    values (v_user, 'aislamiento@pruebas.local', 'Aislamiento', 'operador', v_b, true);

  select count(*) into v_total from tc_vehiculos where empresa_id = v_a;

  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  select count(*) into v_vistos     from tc_vehiculos where empresa_id = v_a;
  select count(*) into v_intervalos from tc_reconstruccion_intervalos where empresa_id = v_a;
  reset role;

  if v_total = 0 then
    raise notice 'SALTADA: la empresa de referencia no tiene vehiculos';
  elsif v_vistos = 0 and v_intervalos = 0 then
    raise notice 'AISLADO: %/% vehiculos y 0 intervalos de la otra empresa', v_vistos, v_total;
  else
    raise notice 'FUGA: ve % de % vehiculos y % intervalos de la otra empresa',
                 v_vistos, v_total, v_intervalos;
  end if;
end $$;
rollback;
SQL
)
echo "$AISLA" | grep -q "AISLADO" && ok "un usuario de otra empresa no ve vehículos ni intervalos ajenos" \
  || { echo "$AISLA" | grep -q "SALTADA" \
       && printf '  AVISO %s\n' "$(echo "$AISLA" | grep SALTADA | head -1)" \
       || mal "$(echo "$AISLA" | grep -E 'FUGA|ERROR' | head -1)"; }

if [[ -n "${REST_URL:-}" && -n "${JWT_SECRET:-}" ]]; then
  echo
  echo "7. Por HTTP, que es como entra el panel"
  TOK=$(node -e '
    const crypto=require("crypto"), S=process.env.JWT_SECRET;
    const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
    const jwt=c=>{const h=b64({alg:"HS256",typ:"JWT"}),p=b64({...c,exp:Math.floor(Date.now()/1e3)+600});
      return h+"."+p+"."+crypto.createHmac("sha256",S).update(h+"."+p).digest("base64url");};
    console.log(JSON.stringify({
      anon: jwt({role:"anon"}),
      auth: jwt({role:"authenticated", aud:"authenticated", sub:process.env.USUARIO||"00000000-0000-0000-0000-0000000000aa"}),
    }));')
  A=$(node -pe 'JSON.parse(process.argv[1]).anon' "$TOK")
  U=$(node -pe 'JSON.parse(process.argv[1]).auth' "$TOK")
  http() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
  esperar() { # etiqueta códigos_validos...
    local etq="$1" got="$2"; shift 2
    for c in "$@"; do [[ "$got" == "$c" ]] && { ok "$etq ($got)"; return; }; done
    mal "$etq: ha devuelto $got, se esperaba ${*}"
  }
  esperar "anon no lee tc_vehiculos" \
    "$(http -H "Authorization: Bearer $A" "$REST_URL/tc_vehiculos?limit=1")" 401 403
  esperar "anon no lee la reconstrucción" \
    "$(http -H "Authorization: Bearer $A" "$REST_URL/tc_reconstruccion_intervalos?limit=1")" 401 403
  esperar "anon no ejecuta tc_imp_revisar_intervalo" \
    "$(http -X POST -H "Authorization: Bearer $A" -H 'Content-Type: application/json' \
       -d '{"p_intervalo":"00000000-0000-0000-0000-000000000000","p_ambito":"kilometros","p_decision":"aceptada","p_motivo":"x"}' \
       "$REST_URL/rpc/tc_imp_revisar_intervalo")" 401 403
  esperar "authenticated no lee clientes (sin RLS, no concedida)" \
    "$(http -H "Authorization: Bearer $U" "$REST_URL/clientes?limit=1")" 403
  esperar "authenticated no ejecuta tc_imp_bloquear" \
    "$(http -X POST -H "Authorization: Bearer $U" -H 'Content-Type: application/json' \
       -d '{"p_empresa":"00000000-0000-0000-0000-000000000000","p_origen":"x"}' \
       "$REST_URL/rpc/tc_imp_bloquear")" 403
  for m in POST PATCH DELETE; do
    esperar "authenticated no hace $m en la auditoría" \
      "$(http -X $m -H "Authorization: Bearer $U" -H 'Content-Type: application/json' \
         -d '{"ambito":"kilometros","decision":"aceptada","motivo":"colado a mano"}' \
         "$REST_URL/tc_reconstruccion_revisiones?id=neq.00000000-0000-0000-0000-000000000000")" 403
  done
  esperar "authenticated sí lee la reconstrucción" \
    "$(http -H "Authorization: Bearer $U" "$REST_URL/tc_reconstruccion_intervalos?limit=1")" 200
  esperar "authenticated sí lee sus vehículos" \
    "$(http -H "Authorization: Bearer $U" "$REST_URL/tc_vehiculos?limit=1")" 200
else
  echo
  echo "7. Por HTTP: SALTADA (define REST_URL y JWT_SECRET para incluirla)"
fi

echo
if [[ "$FALLOS" -gt 0 ]]; then
  echo "$FALLOS comprobación(es) sin pasar. Revisa scripts/staging/permisos-pruebas.sql." >&2
  exit 1
fi
echo "Permisos comprobados."
