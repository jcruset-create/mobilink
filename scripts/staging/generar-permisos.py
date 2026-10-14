"""Genera scripts/staging/permisos-pruebas.sql y permisos-pruebas.json.

Se ejecuta a mano cuando cambia la superficie de la aplicación o alguna
migración añade un grant; 10-comprobar-permisos.sh avisa si el fichero se ha
quedado atrás. Necesita una base de PRUEBAS con el esquema completo aplicado,
para leer el catálogo (RLS, políticas, firmas de función).

    python3 scripts/staging/generar-permisos.py [base]           # local, puerto 5433
    DATABASE_URL=postgresql://… python3 scripts/staging/generar-permisos.py

Lee el catálogo; no escribe nada en la base.
"""
import json, os, re, collections, pathlib, subprocess, sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
URL  = os.environ.get("DATABASE_URL")
DB   = sys.argv[1] if len(sys.argv) > 1 else "esquema_completo_f3"
CONN = ([URL] if URL else
        ["-h", os.environ.get("PGHOST", "127.0.0.1"), "-p", os.environ.get("PGPORT", "5433"),
         "-U", os.environ.get("PGUSER", "mobilink"), "-d", DB])

def psql(q):
    return subprocess.run(["psql", *CONN, "-At", "-F", "|", "-c", q],
                          capture_output=True, text=True, check=True).stdout.strip().splitlines()

cat = {}
for l in psql("select c.relname, c.relkind, c.relrowsecurity, (select count(*) from pg_policy p where p.polrelid=c.oid) "
              "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
              "where n.nspname='public' and c.relkind in ('r','v','m','p')"):
    n,k,rls,pol = l.split('|'); cat[n]=(k, rls=='t', int(pol))
fn = collections.defaultdict(list)
for l in psql("select p.proname, pg_get_function_identity_arguments(p.oid) from pg_proc p "
              "join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"):
    n,a = l.split('|'); fn[n].append(a)

# ── superficie de la prueba ──────────────────────────────────────────────
RAICES = [("src/modules/tyrecontrol","auth"),("src/services","auth"),("src/lib","auth"),
          ("src/hooks","auth"),("src/components","auth"),
          ("server/tyrecontrol","srv"),("server/core","srv"),("server/index.ts","srv")]
pt = re.compile(r'\.from\(\s*["\']([A-Za-z0-9_]+)["\']\s*\)')
pr = re.compile(r'\.rpc\(\s*["\']([A-Za-z0-9_]+)["\']')
tablas = collections.defaultdict(set); rpcs = collections.defaultdict(set)
for base, rol in RAICES:
    p0 = RAIZ/base
    for p in ([p0] if p0.is_file() else [x for x in p0.rglob("*") if x.suffix in (".ts",".tsx",".mts")]):
        t = p.read_text(errors="ignore")
        for m in pt.finditer(t):
            cola = t[m.end():m.end()+160]; op = "select"
            for k in ("insert","upsert","update","delete"):
                if re.match(r'\s*\.'+k+r'\(', cola) or re.search(r'^\s*\.\w+\([^)]*\)\s*\.'+k+r'\(', cola):
                    op = "insert" if k=="upsert" else k; break
            tablas[m.group(1)].add(rol+":"+op)
        for m in pr.finditer(t): rpcs[m.group(1)].add(rol)

# ── lo que ya conceden las migraciones ───────────────────────────────────
mig_grants, mig_tablas = [], set()
for f in sorted((RAIZ/"supabase/migrations").glob("*.sql")):
    for linea in f.read_text(errors="ignore").splitlines():
        s = linea.strip().lower().rstrip()
        if re.match(r'^grant (execute on function|select|insert|update|delete|all) ', s):
            s = re.sub(r'\bpublic\.', '', s)
            if not s.endswith(';'): continue
            mig_grants.append(s)
            m = re.match(r'^grant select on ([a-z0-9_, ]+?) to ', s)
            if m: mig_tablas.update(x.strip() for x in m.group(1).split(','))
mig_grants = sorted(set(mig_grants))
mig_fn = {re.match(r'^grant execute on function ([a-z0-9_]+)\(', g).group(1)
          for g in mig_grants if g.startswith('grant execute')}

EXCEPCION = "productos_neumaticos"
AUD = "tc_reconstruccion_revisiones"
HIST = {"tc_operacion_auditoria","tc_operacion_estado_historial","tc_operacion_movimientos","tc_historial_montajes"}

T_LEE, T_ESCRIBE, T_SRV, FUERA = [], [], [], []
for n, usos in sorted(tablas.items()):
    if n not in cat or cat[n][0] in 'vm': continue
    if n in mig_tablas or n == AUD or n == EXCEPCION: continue
    k, rls, pol = cat[n]
    if not rls or pol == 0: FUERA.append(n); continue
    a = {u.split(':')[1] for u in usos if u.startswith('auth')}
    if not a: T_SRV.append(n)
    elif (a - {'select'}) and n not in HIST: T_ESCRIBE.append(n)
    else: T_LEE.append(n)

def firmas(ns):
    return [f"{n}({a})" for n in sorted(ns) for a in sorted(fn[n])]
rpc_auth = firmas([r for r,v in rpcs.items() if 'auth' in v and r in fn and r not in mig_fn])
rpc_srv  = firmas([r for r,v in rpcs.items() if 'auth' not in v and r in fn and r not in mig_fn])
POLIT = ["adm_can_manage","adm_can_read","adm_is_admin","adm_rol_actual","app_empresa_actual",
         "app_es_admin","self_storage_current_customer_id","tc_auth_empresa_id","tc_is_admin",
         "tc_is_cliente","tc_is_superadmin","tc_operador_ve_empresa","tc_puede_ver_empresa",
         "tc_generar_numero_operacion"]

def lista(ns, ancho=3, s='  '):
    f=[];ln=[]
    for n in ns:
        ln.append(n)
        if len(ln)==ancho: f.append(s+', '.join(ln)); ln=[]
    if ln: f.append(s+', '.join(ln))
    return ',\n'.join(f)

json.dump({"T_LEE":T_LEE,"T_ESCRIBE":T_ESCRIBE,"T_SRV":T_SRV,"FUERA":FUERA,
           "rpc_auth":rpc_auth,"rpc_srv":rpc_srv,"mig_grants":mig_grants,
           "n_rel":len(cat),"n_fn":sum(len(v) for v in fn.values())},
          open(RAIZ/"scripts/staging/permisos-pruebas.json","w"), indent=1, ensure_ascii=False)
print(f"relaciones {len(cat)} · funciones {sum(len(v) for v in fn.values())}")
print(f"T_LEE {len(T_LEE)} · T_ESCRIBE {len(T_ESCRIBE)} · T_SRV {len(T_SRV)} · fuera {FUERA}")
print(f"rpc_auth {len(rpc_auth)} · rpc_srv {len(rpc_srv)} · migraciones {len(mig_grants)}")

# ── emitir el SQL ────────────────────────────────────────────────────────
def gfun(firms, roles):
    return '\n'.join(f"grant execute on function {f} to {roles};" for f in firms) or "-- (ninguna)"

SQL = f"""-- Permisos de la base de PRUEBAS de TyreControl.
--
-- Sustituye al «grant all on all tables/sequences/functions in schema public
-- to anon, authenticated, service_role» que tenía construir-esquema.sh. Aquel
-- grant abría las {len(cat)} relaciones y las {sum(len(v) for v in fn.values())} funciones del esquema a los tres roles —
-- módulos que esta prueba ni toca incluidos— y encima dejaba puestos los
-- `alter default privileges`, así que todo lo que se creara después nacía
-- igual de abierto. La RLS no tapa eso: no se aplica a las funciones, no se
-- aplica a las tablas que no la tienen activada y no se aplica a las vistas
-- que no son `security_invoker`.
--
-- ESTO NO ES UNA COPIA DE LOS PERMISOS DE PRODUCCIÓN, y no debe presentarse
-- como tal. Es más estricto a propósito, en tres sitios: los permisos van por
-- nombre en vez de por default privileges, tres vistas pasan a
-- `security_invoker` (sección 5.b) y productos_neumaticos se queda en solo
-- lectura (sección 5). Lo que aquí sale CERRADO no demuestra que lo esté en
-- producción; lo que aquí FUNCIONA sí funcionará allí. El reparto exacto,
-- resultado por resultado, está en DIFERENCIAS_CON_PRODUCCION.md. Nada de
-- esto se lleva a producción con esta prueba: es una revisión aparte.
--
-- Aquí se concede, por nombre, solo lo que usa esta prueba:
--   · el panel de TyreControl           → rol `authenticated`
--   · los endpoints del servidor        → rol `service_role`
--   · lo que ya definen las migraciones → se repite tal cual (sección 7)
--   · los auxiliares de las políticas RLS y de los valores por defecto
-- Ningún `alter default privileges`. Ningún `grant ... on all ...`.
--
-- De dónde sale la lista: las llamadas `.from("…")` y `.rpc("…")` de
-- src/modules/tyrecontrol, src/services, src/lib, src/hooks y src/components
-- (panel) y de server/tyrecontrol, server/core y server/index.ts (servidor),
-- cruzadas con el catálogo de la base y con los `grant` de
-- supabase/migrations. La lista vive también en permisos-pruebas.json, y
-- 10-comprobar-permisos.sh vuelve a hacer el cruce y falla si este fichero se
-- ha quedado atrás.
--
--   psql "$DESTINO_URL" -v ON_ERROR_STOP=1 -f scripts/staging/permisos-pruebas.sql
--
-- Lo que NO se concede, a propósito:
--   · `anon` no recibe ninguna tabla ni vista, y solo las funciones que las
--     migraciones le conceden expresamente (el quiosco del operario y el
--     login por correo). El resto del panel entra con sesión.
--   · `clientes` no tiene RLS y no se concede a nadie. Las vistas
--     tc_clientes_almacen y tc_productos_almacen sí: no son
--     `security_invoker`, se ejecutan con permisos del dueño y llevan su
--     propia puerta `tc_is_admin()` dentro.
--   · Los módulos Seguridad, Presencia, Caja, Asistencia y Administración no
--     entran en esta prueba: el panel no recibe sus tablas y sus páginas
--     darán 403. Si alguna vez hiciera falta, se añade por nombre.
--   · Ninguna secuencia: todas las tablas de las secciones 2 a 4 tienen clave
--     primaria uuid. Si algún día una lleva un `serial`, hay que conceder su
--     secuencia por nombre y la comprobación 8.h lo avisará.

begin;

-- ── Guardián: esto solo se ejecuta en una base MARCADA como de pruebas ──
-- Es la segunda llave, no la única: el destino (DATABASE_URL y el proyecto
-- Supabase) lo comprueba scripts/staging/00-comprobar-destino.sh antes de
-- llegar aquí. La marca la pone 00-inicializar-destino.sh sobre una base
-- nueva y vacía, después de identificar el proyecto y comprobar que está
-- vacía; producción no la tiene y no se le pone.
do $guardian$
begin
  if coalesce(current_setting('mobilink.entorno', true), '') is distinct from 'pruebas' then
    raise exception 'Esta base no esta marcada como entorno de pruebas (mobilink.entorno = %). '
                    'Si es un proyecto nuevo, pasa primero por '
                    'scripts/staging/00-inicializar-destino.sh.',
                    coalesce(current_setting('mobilink.entorno', true), '(sin marca)');
  end if;
end
$guardian$;

-- ── 0. Punto de partida ───────────────────────────────────────────────
-- PostgreSQL concede EXECUTE a PUBLIC en cada función nueva: las {sum(len(v) for v in fn.values())} del
-- esquema son ejecutables por cualquiera que pueda conectarse, `anon`
-- incluido, aunque nadie las haya concedido. Un `grant ... to authenticated`
-- no lo quita; hace falta el revoke.
revoke execute on all functions in schema public from public;
revoke create on schema public from public;

-- Y se retira lo que haya puesto la plataforma (los default privileges de
-- Supabase) o una pasada anterior del banco. Después se vuelve a conceder lo
-- que de verdad hace falta, incluido lo que definen las migraciones.
alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
revoke all on all tables     in schema public from anon, authenticated, service_role;
revoke all on all sequences  in schema public from anon, authenticated, service_role;
revoke all on all functions  in schema public from anon, authenticated, service_role;

-- ── 1. Entrar al esquema ──────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

-- ── 2. Tablas que el panel solo LEE ({len(T_LEE)}) ───────────────────────────────
-- Catálogos, cargas de importación e históricos que escriben los disparadores
-- y los RPC `security definer`, nunca el panel por PostgREST.
grant select on
{lista(T_LEE)}
to authenticated, service_role;

-- ── 3. Tablas que el panel LEE Y ESCRIBE ({len(T_ESCRIBE)}) ─────────────────────
-- La RLS de cada una —activada y con política, se comprueba en 8.a— es la que
-- decide a qué filas llega cada empresa.
grant select, insert, update, delete on
{lista(T_ESCRIBE)}
to authenticated, service_role;

-- ── 4. Tablas que solo usa el SERVIDOR ({len(T_SRV)}) ───────────────────────
-- Las toca server/index.ts con la service key. El panel no las pide, así que
-- `authenticated` no las recibe.
grant select, insert, update, delete on
{lista(T_SRV)}
to service_role;

-- ── 5. Excepción declarada: una tabla sin RLS ─────────────────────────
-- productos_neumaticos es el catálogo de neumáticos del módulo Almacén. No
-- está en supabase/migrations (se creó fuera), no tiene RLS, y el panel de
-- TyreControl la necesita para dos cosas: el embed
-- `producto_almacen:productos_neumaticos(...)` de la ficha del vehículo y
-- profundidadDibujoPorProducto(), que lee el catálogo entero sin filtrar por
-- empresa. Sin este grant, la ficha del vehículo revienta con «permission
-- denied for table productos_neumaticos» y no se puede probar nada.
--
-- Qué queda expuesto: marca, modelo, medida, dot y activo de todos los
-- productos, de todas las empresas de almacén. Qué NO se concede: insert,
-- update ni delete, a ningún rol.
--
-- Es una excepción, no la norma. La comprobación 8.a sigue parando la
-- transacción ante cualquier OTRA tabla sin RLS con permisos, y 8.b exige que
-- esta se quede en solo lectura. En el proyecto Supabase de pruebas, si la
-- tabla llega del volcado sin RLS, el aviso será el mismo y la decisión
-- —ponerle RLS en el módulo Almacén, o volver a declarar la excepción por
-- escrito— es de quien autorice el staging, no de este fichero.
grant select on {EXCEPCION} to authenticated, service_role;

-- ── 5.b Vistas que se saltaban la RLS ─────────────────────────────────
-- Una vista se ejecuta con los permisos de su DUEÑO salvo que sea
-- `security_invoker`: se salta la RLS de las tablas que lee. En el esquema
-- hay tres vistas concedidas a `authenticated` por las migraciones que no la
-- tienen y que tampoco filtran por empresa dentro:
--   · tc_marcas_contadores cuenta neumáticos y vehículos sobre tc_neumaticos
--     sin filtrar: con permisos del dueño, un usuario de una empresa ve el
--     recuento de las demás.
--   · tc_tipos_plano_descuadrado es un diagnóstico sobre tc_tipos_vehiculo.
--   · adm_ot_estado cruza órdenes de trabajo y clientes del módulo de
--     Administración.
-- En la base de pruebas se pasan a `security_invoker` para que cuenten y
-- enseñen lo que la RLS de cada quien permita. Las dos primeras siguen
-- funcionando (sus tablas sí se conceden). adm_ot_estado dejará de responder,
-- porque las tablas de Administración no entran en esta prueba: eso es lo
-- correcto aquí, y si alguna vez hiciera falta se conceden por nombre.
--
-- Esto NO cambia las migraciones ni el proyecto de producción: es un ajuste
-- del entorno de pruebas, y queda anotado como hallazgo en
-- scripts/staging/README.md.
alter view tc_marcas_contadores       set (security_invoker = true);
alter view tc_tipos_plano_descuadrado set (security_invoker = true);
alter view adm_ot_estado              set (security_invoker = true);

-- ── 6. RPC ────────────────────────────────────────────────────────────
-- Las que llama el panel ({len(rpc_auth)}) y que no conceden ya las migraciones.
{gfun(rpc_auth, 'authenticated')}

-- Las que solo llama el servidor con la service key ({len(rpc_srv)}).
{gfun(rpc_srv, 'service_role')}

-- ── 7. Lo que definen las migraciones ({len(mig_grants)}) ──────────────────────────
-- El revoke de la sección 0 se lleva por delante los grants que ponen las
-- propias migraciones, así que se repiten aquí tal cual están escritos en
-- supabase/migrations/*.sql. Esta es la parte que hay que respetar sin
-- interpretarla: si una migración concede una función a `anon` (el quiosco
-- del operario, el login por correo), se concede.
--
-- 10-comprobar-permisos.sh vuelve a extraerlos de las migraciones y falla si
-- esta lista no coincide.
{chr(10).join(mig_grants)}

-- ── 8. Auxiliares de las políticas RLS y de los valores por defecto ───
-- Las políticas RLS se evalúan con los permisos de quien hace la consulta: si
-- `authenticated` no puede ejecutar tc_puede_ver_empresa(), toda consulta a
-- una tabla con esa política falla con «permission denied for function». Y un
-- valor por defecto que llama a una función se ejecuta al insertar, también
-- con los permisos de quien inserta.
--
-- Va en bucle y no en grants sueltos porque hay módulos cuyas migraciones
-- viven en subcarpetas de supabase/migrations y no están en el banco local
-- (self_storage, por ejemplo): si su función no está, tampoco están sus
-- políticas, y saltarla es correcto. Lo que no se salta es la comprobación:
-- 8.g recalcula las funciones que usan las políticas de las tablas
-- concedidas y falla si falta alguna.
do $$
declare
  v_firma text;
  v_falta text[] := '{{}}';
begin
  foreach v_firma in array array[
{lista([repr(p+'()' if not fn.get(p) or fn[p]==[''] else p+'('+fn[p][0]+')') .replace(chr(39), chr(39)) for p in POLIT if p in fn], 2, '    ')}
  ]
  loop
    begin
      execute format('grant execute on function public.%s to authenticated, service_role', v_firma);
    exception when undefined_function then
      v_falta := v_falta || v_firma;
    end;
  end loop;
  if cardinality(v_falta) > 0 then
    raise notice 'No estan en esta base (su modulo no se ha migrado aqui): %',
                 array_to_string(v_falta, ', ');
  end if;
end $$;

-- gen_random_uuid y uuid_generate_v4: en Supabase viven en el esquema
-- `extensions` y los valores por defecto resuelven a pg_catalog, pero en el
-- banco local pgcrypto y uuid-ossp se instalan en `public` y los tapan. Si
-- están ahí, hay que concederlas o cualquier INSERT falla.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'gen_random_uuid') then
    execute 'grant execute on function public.gen_random_uuid() to authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'uuid_generate_v4') then
    execute 'grant execute on function public.uuid_generate_v4() to authenticated, service_role';
  end if;
end $$;

-- ── 9. La auditoría de revisiones: lectura y nada más ─────────────────
-- tc_reconstruccion_revisiones es el registro de quién aceptó o rechazó un
-- kilometraje o una continuidad, y por qué. El panel la consulta; escribirla
-- solo puede hacerlo tc_imp_revisar_intervalo, que es `security definer`.
-- El `grant select` está en la sección 7 (lo pone la migración); el revoke se
-- repite aquí para que no lo deshaga nada de lo anterior.
revoke insert, update, delete, truncate on tc_reconstruccion_revisiones
  from anon, authenticated, service_role;

-- ── 10. Comprobaciones que paran la transacción ───────────────────────
do $$
declare
  v_malas text;
  v_vistas text;
  v_anon  text;
begin
  -- a) Ninguna tabla concedida a `authenticated` sin RLS activada y con al
  --    menos una política, salvo la excepción declarada de la sección 5.
  select string_agg(format('%s (rls=%s, politicas=%s)', c.relname, c.relrowsecurity,
                           (select count(*) from pg_policy p where p.polrelid = c.oid)), ', ')
    into v_malas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
    and has_table_privilege('authenticated', c.oid, 'select')
    and c.relname <> all (array['{EXCEPCION}'])
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if v_malas is not null then
    raise exception 'Tablas concedidas a authenticated sin RLS util: %', v_malas;
  end if;

  -- b) Y la excepción declarada se queda en solo lectura.
  if has_table_privilege('authenticated', '{EXCEPCION}', 'insert')
     or has_table_privilege('authenticated', '{EXCEPCION}', 'update')
     or has_table_privilege('authenticated', '{EXCEPCION}', 'delete')
     or has_table_privilege('service_role',  '{EXCEPCION}', 'insert') then
    raise exception 'La excepcion {EXCEPCION} no tiene RLS: solo puede tener select';
  end if;

  -- c) Ninguna vista concedida a `authenticated` que se salte la RLS, salvo
  --    las dos del almacén, que filtran por tc_is_admin() dentro.
  select string_agg(c.relname, ', ') into v_vistas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and has_table_privilege('authenticated', c.oid, 'select')
    and c.relname not in ('tc_clientes_almacen','tc_productos_almacen')
    and coalesce((select true from unnest(c.reloptions) o
                  where o = 'security_invoker=true'), false) is not true;
  if v_vistas is not null then
    raise exception 'Vistas concedidas a authenticated sin security_invoker: %', v_vistas;
  end if;

  -- d) `anon` no tiene ni una tabla ni una vista.
  select string_agg(c.relname, ', ') into v_anon
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
    and has_table_privilege('anon', c.oid, 'select');
  if v_anon is not null then
    raise exception 'anon tiene permiso de lectura sobre: %', v_anon;
  end if;

  -- e) La auditoría no admite escritura directa desde ningún rol de la
  --    aplicación.
  if has_table_privilege('authenticated', 'tc_reconstruccion_revisiones', 'insert')
     or has_table_privilege('service_role', 'tc_reconstruccion_revisiones', 'update')
     or has_table_privilege('anon', 'tc_reconstruccion_revisiones', 'insert') then
    raise exception 'La auditoria tc_reconstruccion_revisiones admite escritura directa';
  end if;

  -- f) Ninguna función del esquema queda ejecutable por PUBLIC.
  select string_agg(p.proname, ', ') into v_malas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_malas is not null then
    raise exception 'Funciones ejecutables por PUBLIC: %', v_malas;
  end if;

  -- g) Toda función que use la política RLS de una tabla concedida a
  --    `authenticated` tiene que ser ejecutable por `authenticated`. Esto es
  --    lo que garantiza que no falte ningún auxiliar de la sección 8.
  select string_agg(distinct f.proname || '()', ', ') into v_malas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy pol on pol.polrelid = c.oid
  join pg_proc f on f.pronamespace = n.oid
  where n.nspname = 'public' and c.relkind in ('r','p')
    and has_table_privilege('authenticated', c.oid, 'select')
    and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
        ~ ('\\m' || f.proname || '\\s*\\(')
    and not has_function_privilege('authenticated', f.oid, 'execute');
  if v_malas is not null then
    raise exception 'Las politicas RLS usan funciones que authenticated no puede ejecutar: %', v_malas;
  end if;

  -- h) Ninguna secuencia concedida: si aparece una, es que una tabla nueva
  --    lleva `serial` y hay que decidirlo a mano.
  select string_agg(c.relname, ', ') into v_malas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
    and (has_sequence_privilege('authenticated', c.oid, 'usage')
         or has_sequence_privilege('anon', c.oid, 'usage'));
  if v_malas is not null then
    raise exception 'Secuencias concedidas sin decidirlo: %', v_malas;
  end if;

  -- i) No quedan default privileges globales en el esquema. Son los que hacían
  --    que cada objeto nuevo naciera abierto, y el arranque de Express crea
  --    tablas (prepararEsquema).
  select string_agg(format('%s (dueno %s)', d.defaclobjtype, pg_get_userbyid(d.defaclrole)), ', ')
    into v_malas
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and exists (select 1 from aclexplode(d.defaclacl) a
                where pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role'));
  if v_malas is not null then
    raise exception 'Quedan default privileges en public para anon/authenticated/service_role: %. '
                    'Hay que retirarlos CONECTADO COMO EL ROL QUE LOS PUSO (el del parentesis): '
                    'alter default privileges in schema public revoke all on tables from '
                    'anon, authenticated, service_role; e igual para sequences y functions.',
                    v_malas;
  end if;

  raise notice 'Permisos de pruebas aplicados y comprobados.';
end $$;

commit;
"""
(RAIZ/"scripts/staging/permisos-pruebas.sql").write_text(SQL)
print("escrito scripts/staging/permisos-pruebas.sql:", len(SQL.splitlines()), "lineas")
