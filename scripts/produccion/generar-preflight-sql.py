#!/usr/bin/env python3
"""
Genera el preflight en SQL puro, para pegarlo en el editor de Supabase.

Por qué existe además del script de bash: `preflight-produccion.sh` necesita
`psql` con la cadena de conexión de producción, y quien tiene el acceso
trabaja desde el panel de Supabase. Un preflight que no se puede ejecutar no
comprueba nada.

Lo que genera es **solo lectura**: puros `select`. No hay `do`, ni funciones
temporales, ni escrituras. La lista de objetos sale de las propias
migraciones (`objetos-de-las-migraciones.py`), así que no se queda atrás
cuando una migración cambia.

  python3 scripts/produccion/generar-preflight-sql.py > scripts/produccion/preflight-produccion.sql
"""
import json
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent

def objetos() -> dict:
    salida = subprocess.run(
        [sys.executable, str(AQUI / "objetos-de-las-migraciones.py")],
        capture_output=True, text=True, check=True)
    return json.loads(salida.stdout)

def lista_sql(valores) -> str:
    """Una lista de literales para un `values`, con las comillas escapadas."""
    return ", ".join("(" + ", ".join("'" + str(v).replace("'", "''") + "'" for v in fila) + ")"
                     for fila in valores)

def main() -> None:
    o = objetos()
    tablas = o["requiere_tablas"]
    columnas = [c.split(".", 1) for c in o["requiere_columnas"]]
    funciones = o["requiere_funciones"]
    firmas = [(f["nombre"], f["firma"]) for f in o["redefine_funciones"]]
    crea_tablas = o["crea"]["tablas"]
    crea_vistas = o["crea"]["vistas"]

    print(f"""-- ─────────────────────────────────────────────────────────────────────────
-- PREFLIGHT DE PRODUCCIÓN · importación del histórico de Plana (PR #492)
--
-- GENERADO. No se edita a mano: sale de las tres migraciones con
--   python3 scripts/produccion/generar-preflight-sql.py
--
-- SOLO LECTURA: son `select` y nada más. No crea, no borra y no modifica.
-- Se pega entero en el editor SQL de Supabase (proyecto de PRODUCCIÓN) y se
-- devuelve la tabla que sale.
--
-- Cómo se lee la columna `estado`:
--   PARA  → no se sigue adelante hasta entenderlo.
--   MIRA  → hay que mirarlo, puede estar bien.
--   OK    → comprobado.
--   DATO  → no es una comprobación, es información que hace falta.
--
-- Comprueba {len(tablas)} tablas, {len(columnas)} columnas y {len(funciones)} funciones que las migraciones dan
-- por supuestas, las {len(firmas)} firmas que redefinen y los {len(crea_tablas) + len(crea_vistas)} objetos que crean.
-- ─────────────────────────────────────────────────────────────────────────

with
-- Lo que las migraciones dan por supuesto que ya existe.
req_tabla(t) as (values {lista_sql([[t] for t in tablas])}),
req_col(t, c) as (values {lista_sql(columnas)}),
req_fn(f) as (values {lista_sql([[f] for f in funciones])}),
-- Las funciones que el PR REDEFINE: la firma tiene que coincidir EXACTA, o
-- `create or replace` crearía una segunda y PostgREST devolvería PGRST203.
redef(nombre, firma) as (values {lista_sql(firmas)}),
-- Lo que el PR CREA: si ya está, alguien lo aplicó antes o hay choque de nombres.
crea_tabla(t) as (values {lista_sql([[t] for t in crea_tablas])}),
crea_vista(v) as (values {lista_sql([[v] for v in crea_vistas])}),

-- ── 1. A qué base se está mirando ────────────────────────────────────────
r1 as (
  select 1 ord, '1. Base' seccion, 'DATO' estado,
         'base=' || current_database() ||
         ' · tablas en public=' || (select count(*) from pg_tables where schemaname = 'public') ||
         ' · ' || substring(version() from 'PostgreSQL [0-9.]+') detalle
  union all
  select 1, '1. Base',
         case when coalesce(current_setting('mobilink.entorno', true), '') = 'pruebas'
              then 'PARA' else 'OK' end,
         case when coalesce(current_setting('mobilink.entorno', true), '') = 'pruebas'
              then 'esta base lleva la marca «pruebas»: NO es producción'
              else 'sin marca de entorno de pruebas (producción no la lleva)' end
),

-- ── 2. Las empresas, con su UUID ─────────────────────────────────────────
-- Plana se confirma por UUID, nunca por el nombre: hay nombres parecidos.
--
-- Va por `query_to_xml` y no como consulta normal a propósito: una tabla que
-- no existiera haría fallar el ENTERO al analizarlo, y entonces este
-- preflight no comprobaría nada en vez de comprobar lo que sí puede. El
-- `case` garantiza que la consulta de dentro solo se ejecuta si está la tabla.
emp(x) as (
  select case when to_regclass('public.tc_empresas') is null then null else query_to_xml(
      'select e.id::text || ''  '' || rpad(e.nombre, 28)'
      || case when to_regclass('public.tc_vehiculos') is not null
              then ' || ''  vehiculos='' || (select count(*) from tc_vehiculos v where v.empresa_id = e.id)'
              else '' end
      || case when to_regclass('public.tc_neumaticos') is not null
              then ' || ''  neumaticos='' || (select count(*) from tc_neumaticos n where n.empresa_id = e.id)'
              else '' end
      -- tableforest=false: un solo <table> raíz. Con `true` salen <row>
      -- sueltos, que no son un documento XML y xpath no los traga.
      || ' as d from tc_empresas e order by e.nombre', false, false, '') end
),
r2 as (
  -- Sin filas, `query_to_xml` devuelve un documento vacío y `xpath` se queja:
  -- se sustituye por una tabla vacía de verdad.
  select 2, '2. Empresas', 'DATO',
         unnest(xpath('/table/row/d/text()', coalesce(nullif(x::text, ''), '<table/>')::xml))::text
    from emp where x is not null
  union all
  select 2, '2. Empresas', 'PARA', 'no existe tc_empresas: ¿es esta la base de TyreControl?'
   where to_regclass('public.tc_empresas') is null
),

-- ── 3. Lo que tiene que existir y no existe ──────────────────────────────
r3 as (
  select 3, '3. Falta', 'PARA', 'falta la tabla ' || t
    from req_tabla where to_regclass('public.' || t) is null
  union all
  select 3, '3. Falta', 'PARA', 'falta la columna ' || t || '.' || c
    from req_col
   where to_regclass('public.' || t) is not null
     and not exists (select 1 from information_schema.columns i
                      where i.table_schema = 'public' and i.table_name = t and i.column_name = c)
  union all
  select 3, '3. Falta', 'PARA', 'falta la función ' || f
    from req_fn
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = f)
  union all
  select 3, '3. Falta', 'OK', 'están las {len(tablas)} tablas, las {len(columnas)} columnas y las {len(funciones)} funciones que las migraciones dan por supuestas'
   where not exists (select 1 from req_tabla where to_regclass('public.' || t) is null)
     and not exists (select 1 from req_col
                      where to_regclass('public.' || t) is not null
                        and not exists (select 1 from information_schema.columns i
                                         where i.table_schema='public' and i.table_name=t and i.column_name=c))
     and not exists (select 1 from req_fn
                      where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                         where n.nspname='public' and p.proname=f))
),

-- ── 4. Firmas: ¿la que hay es la que se va a redefinir? ──────────────────
sobre as (
  select r.nombre, r.firma,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = r.nombre) sobrecargas,
         to_regprocedure(r.firma) is not null exacta
    from redef r
),
r4 as (
  select 4, '4. Firmas', 'PARA',
         nombre || ': existe con OTRA firma (' || sobrecargas || ' sobrecarga(s)); la esperada es ' ||
         firma || '. Redefinir crearía una segunda y PostgREST daría PGRST203'
    from sobre where sobrecargas > 0 and not exacta
  union all
  select 4, '4. Firmas', 'MIRA',
         nombre || ': ya tiene ' || sobrecargas || ' sobrecargas en la base'
    from sobre where sobrecargas > 1 and exacta
  union all
  select 4, '4. Firmas', 'OK',
         (select count(*) from sobre where exacta)::text || ' de {len(firmas)} firmas coinciden exactas; ' ||
         (select count(*) from sobre where sobrecargas = 0)::text || ' no existen todavía (las crea el PR)'
),

-- ── 5. Lo que el PR crea y YA está ───────────────────────────────────────
r5 as (
  select 5, '5. Ya existe', 'MIRA', 'la tabla ' || t || ' ya existe: ¿se importó antes?'
    from crea_tabla where to_regclass('public.' || t) is not null
  union all
  select 5, '5. Ya existe', 'MIRA', 'la vista ' || v || ' ya existe'
    from crea_vista where to_regclass('public.' || v) is not null
  union all
  select 5, '5. Ya existe', 'OK', 'ninguno de los {len(crea_tablas) + len(crea_vistas)} objetos que crea el PR existe todavía'
   where not exists (select 1 from crea_tabla where to_regclass('public.' || t) is not null)
     and not exists (select 1 from crea_vista where to_regclass('public.' || v) is not null)
),

-- ── 6. ¿Hay ya datos de una importación anterior? ────────────────────────
r6 as (
  select 6, '6. Importado', 'MIRA',
         'tc_importacion_lotes existe con ' ||
         (select count(*) from information_schema.tables
           where table_schema='public' and table_name='tc_importacion_lotes')::text ||
         ' definición: revisa los lotes antes de nada'
   where to_regclass('public.tc_importacion_lotes') is not null
  union all
  select 6, '6. Importado', 'OK', 'no hay tablas de importación: la base está virgen para esto'
   where to_regclass('public.tc_importacion_lotes') is null
),

-- ── 7. Disparadores de las tablas que la importación escribe ─────────────
-- Un trigger que nadie esperaba puede mover stock o tocar el montaje actual
-- cuando se inserte una operación histórica.
r7 as (
  select 7, '7. Triggers', 'DATO',
         c.relname || ' · ' || t.tgname || ' · ' || p.proname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and n.nspname = 'public'
     and c.relname in ('operaciones_neumaticos', 'tc_intervenciones',
                       'tc_intervencion_servicios', 'tc_neumaticos')
),

-- ── 8. Lo que este preflight NO comprueba ────────────────────────────────
r8 as (
  select 8, '8. Sin comprobar', 'MIRA', m
    from (values
      ('el backup: hay que hacerlo y verificarlo aparte'),
      ('que PostgREST aguante el lote grande en una sola llamada'),
      ('los planos reales de cada vehículo, que usa la deducción de posiciones'),
      ('el contenido del Excel: eso lo concilia el panel al subirlo')
    ) x(m)
)
select seccion, estado, detalle
  from (select * from r1 union all select * from r2 union all select * from r3
        union all select * from r4 union all select * from r5 union all select * from r6
        union all select * from r7 union all select * from r8) todo
 order by ord,
          case estado when 'PARA' then 0 when 'MIRA' then 1 when 'OK' then 2 else 3 end,
          detalle;""")

FOTOGRAFIA = """-- ─────────────────────────────────────────────────────────────────────────
-- FOTOGRAFÍA PREVIA · importación del histórico de Plana (PR #492)
--
-- GENERADO por scripts/produccion/generar-preflight-sql.py. SOLO LECTURA.
--
-- Se ejecuta DOS veces: antes de importar y después. Las tablas que la
-- importación NO debe tocar tienen que dar el mismo número las dos veces; en
-- las cuatro que sí escribe, la diferencia tiene que estar entera en la
-- columna `con_lote`, que son las filas de la importación.
--
-- Son recuentos, no huellas por fila: la versión con md5 de cada fila está en
-- `preflight-produccion.sh`, que necesita psql. Un recuento no detecta dos
-- cambios que se compensen, y por eso no sustituye al backup: lo que de
-- verdad permite volver atrás es el backup, no esto.
--
-- Si alguna tabla tarda demasiado en el editor, se ejecuta su línea aparte.
-- ─────────────────────────────────────────────────────────────────────────

with protegidas(t) as (values
  ('tc_vehiculos'), ('tc_neumaticos'), ('tc_montajes_actuales'),
  ('operaciones_neumaticos'), ('tc_intervenciones'), ('tc_intervencion_servicios'),
  ('tc_historial_montajes'), ('revisiones_vehiculo'), ('revisiones_neumaticos_detalle'),
  ('movimientos_stock'), ('tc_contadores_numero_interno'), ('tc_contadores_numero_operacion')
),
medidas as (
  select p.t,
         to_regclass('public.' || p.t) is not null existe,
         exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p.t
                    and c.column_name = 'importacion_lote_id') tiene_lote
    from protegidas p
),
conteos as (
  select m.t, m.existe, m.tiene_lote,
         case when not m.existe then null else
           (xpath('/table/row/n/text()',
                  query_to_xml('select count(*) n from public.' || quote_ident(m.t),
                               false, false, '')))[1]::text::bigint end filas,
         case when not m.existe or not m.tiene_lote then null else
           (xpath('/table/row/n/text()',
                  query_to_xml('select count(*) n from public.' || quote_ident(m.t)
                               || ' where importacion_lote_id is not null', false, false, '')))[1]::text::bigint end con_lote
    from medidas m
)
select t tabla,
       case when existe then filas::text else '(no existe)' end filas,
       case when not existe then '' when tiene_lote then coalesce(con_lote::text, '?')
            else '(sin columna de lote)' end con_lote,
       now()::timestamptz(0)::text momento
  from conteos
 order by t;
"""


def fotografia() -> None:
    destino = AQUI / "fotografia-produccion.sql"
    destino.write_text(FOTOGRAFIA, encoding="utf-8")


if __name__ == "__main__":
    if "--fotografia" in sys.argv:
        fotografia()
    else:
        main()
