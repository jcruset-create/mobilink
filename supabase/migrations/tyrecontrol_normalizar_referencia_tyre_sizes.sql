-- ============================================================
-- Mobilink TyreControl — Medidas de neumático: una forma de escribir cada una
--
-- EL PROBLEMA (pantalla Medidas de neumáticos, 14-08-2026)
--
-- En la lista conviven la misma medida escrita de dos maneras:
--
--     385/55 R22.5 160K        ← con espacio antes de la R
--     385/55R22.5 160K         ← sin espacio
--
-- Son el mismo neumático: misma medida, misma carga, mismo código de
-- velocidad. Pero como `referencia_completa` es el unique de la tabla, las dos
-- caben y las dos aparecen, y el técnico tiene que elegir entre dos cosas
-- idénticas.
--
-- `medida` YA está normalizada (tyrecontrol_normalizar_medidas.sql lo hizo y
-- dejó un disparador para que no vuelva a torcerse). Lo que nunca se
-- reconstruyó es `referencia_completa`, que se escribió a mano o se importó y
-- arrastra el formato de origen.
--
-- LA FORMA CANÓNICA es la que ya construye el panel al crear una medida
-- (construirReferenciaTs en data.ts:2627):
--
--     medida + ' ' + carga_simple[/carga_doble] + codigo_velocidad
--     315/70R22.5 154/150L
--
-- QUÉ HACE
--
--   1. Limpia carga y velocidad (espacios, minúsculas).
--   2. Agrupa por lo que define de verdad una medida —medida, carga simple,
--      carga doble y velocidad— y deja UNA fila viva por grupo.
--   3. Repunta a la superviviente las referencias del catálogo que apuntaban a
--      una duplicada, ANTES de retirarla (el FK es on delete restrict).
--   4. Reescribe la `referencia_completa` de las supervivientes a la forma
--      canónica.
--
-- QUIÉN SOBREVIVE: si alguna del grupo YA está escrita en forma canónica, esa.
-- Si no, la más antigua. No es un capricho: eligiendo primero a la que ya tiene
-- el nombre bueno, el unique nunca choca al renombrar — el nombre que quiero
-- poner no lo está ocupando otra fila del grupo.
--
-- Las duplicadas se DESACTIVAN, no se borran, y conservan su texto antiguo:
-- la pantalla filtra activo=true, así que desaparecen de la lista, pero nada
-- se pierde y recuperarlas es un update.
--
-- LO QUE NO HACE: fusionar las filas SIN código de velocidad con las que sí lo
-- tienen. `315/70R22.5 154/150` a secas podría ser la L o la M, y decidirlo
-- sería inventarse el dato. Se cuentan y se avisa para mirarlas a mano.
--
-- Idempotente: al segundo pase ya está todo en forma canónica.
-- ============================================================

-- Un solo bloque: la tabla de trabajo es temporal y el editor de Supabase no
-- garantiza que dos sentencias vayan por la misma conexión.
do $$
declare
  v_dup int; v_repuntadas int; v_renombradas int; v_sin_vel int; v_grupos_dobles int;
begin
  -- ── 1. Limpiar los componentes ────────────────────────────────────────────
  update tyre_sizes
     set indice_carga_simple = upper(trim(indice_carga_simple)),
         indice_carga_doble  = nullif(upper(trim(coalesce(indice_carga_doble, ''))), ''),
         codigo_velocidad    = upper(trim(codigo_velocidad))
   where indice_carga_simple is distinct from upper(trim(indice_carga_simple))
      or coalesce(indice_carga_doble, '') is distinct from coalesce(nullif(upper(trim(coalesce(indice_carga_doble, ''))), ''), '')
      or codigo_velocidad is distinct from upper(trim(codigo_velocidad));

  -- ── 2. Grupos: qué define de verdad una medida ────────────────────────────
  create temp table _tc_ts_dedupe on commit drop as
  with canon as (
    select id, activo, referencia_completa, created_at,
           medida || ' ' || indice_carga_simple
             || coalesce('/' || indice_carga_doble, '')
             || coalesce(codigo_velocidad, '')                as ref_canonica,
           medida, indice_carga_simple,
           coalesce(indice_carga_doble, '')                   as carga_doble,
           coalesce(codigo_velocidad, '')                     as vel
      from tyre_sizes
     where activo
  ),
  ordenados as (
    select id, ref_canonica, referencia_completa,
           first_value(id) over w  as superviviente,
           count(*) over (partition by medida, indice_carga_simple, carga_doble, vel) as n
      from canon
    window w as (
      partition by medida, indice_carga_simple, carga_doble, vel
      -- La que ya se llama como debe primero: así renombrar no choca nunca.
      order by (referencia_completa = ref_canonica) desc, created_at asc
      rows between unbounded preceding and unbounded following
    )
  )
  select id, ref_canonica, superviviente, (id = superviviente) as es_superviviente, n
    from ordenados;

  select count(*) into v_dup from _tc_ts_dedupe where not es_superviviente;

  -- ── 3. Repuntar el catálogo antes de retirar nada ─────────────────────────
  update tc_referencias_neumatico r
     set tyre_size_id = d.superviviente, updated_at = now()
    from _tc_ts_dedupe d
   where r.tyre_size_id = d.id and not d.es_superviviente;
  get diagnostics v_repuntadas = row_count;

  -- Retirar las duplicadas conservando su texto: la pantalla filtra activo.
  update tyre_sizes t
     set activo = false, updated_at = now()
    from _tc_ts_dedupe d
   where t.id = d.id and not d.es_superviviente;

  -- ── 4. Las supervivientes, a la forma canónica ────────────────────────────
  update tyre_sizes t
     set referencia_completa = d.ref_canonica, updated_at = now()
    from _tc_ts_dedupe d
   where t.id = d.id and d.es_superviviente
     and t.referencia_completa is distinct from d.ref_canonica;
  get diagnostics v_renombradas = row_count;

  -- ── Comprobación ──────────────────────────────────────────────────────────

  -- DURO: ninguna referencia del catálogo puede apuntar a una medida retirada.
  if exists (select 1 from tc_referencias_neumatico r
               join tyre_sizes t on t.id = r.tyre_size_id
              where not t.activo) then
    raise exception 'Quedan referencias del catálogo apuntando a medidas retiradas';
  end if;

  -- DURO: no puede quedar ningún grupo con dos activas.
  select count(*) into v_grupos_dobles from (
    select 1 from tyre_sizes
     where activo
     group by medida, indice_carga_simple, coalesce(indice_carga_doble, ''), coalesce(codigo_velocidad, '')
    having count(*) > 1
  ) g;
  if v_grupos_dobles > 0 then
    raise exception 'Quedan % grupos de medida con más de una fila activa', v_grupos_dobles;
  end if;

  -- DURO: y todas las activas tienen que estar ya en forma canónica.
  if exists (
    select 1 from tyre_sizes
     where activo
       and referencia_completa is distinct from
           medida || ' ' || indice_carga_simple
             || coalesce('/' || indice_carga_doble, '')
             || coalesce(codigo_velocidad, '')
  ) then
    raise exception 'Han quedado medidas activas sin la forma canónica';
  end if;

  -- AVISO: las que no tienen código de velocidad. No se tocan porque decidir
  -- si son la L o la M sería inventarse el dato.
  select count(*) into v_sin_vel from tyre_sizes
   where activo and coalesce(codigo_velocidad, '') = '';
  if v_sin_vel > 0 then
    raise warning 'Hay % medida(s) activas SIN código de velocidad. No se fusionan con las que sí lo tienen porque no se puede saber cuál son. Verlas: select referencia_completa from tyre_sizes where activo and coalesce(codigo_velocidad,'''') = '''' order by 1;', v_sin_vel;
  end if;

  raise notice 'OK: % medidas duplicadas retiradas, % referencias del catálogo repuntadas, % nombres reescritos a la forma canónica',
    v_dup, v_repuntadas, v_renombradas;
end $$;

-- ── Que no vuelva a torcerse ────────────────────────────────────────────────
--
-- Limpiar una vez no sirve si mañana alguien crea "385/55 R22.5 160K" a mano.
-- El panel ya construye bien el nombre, pero el disparador es el único sitio
-- por el que pasan todos los caminos: panel, importaciones e inserts sueltos.
create or replace function tc_tyre_size_referencia_trg() returns trigger
language plpgsql as $$
begin
  new.indice_carga_simple := upper(trim(new.indice_carga_simple));
  new.indice_carga_doble  := nullif(upper(trim(coalesce(new.indice_carga_doble, ''))), '');
  new.codigo_velocidad    := upper(trim(coalesce(new.codigo_velocidad, '')));
  new.referencia_completa := new.medida || ' ' || new.indice_carga_simple
                             || coalesce('/' || new.indice_carga_doble, '')
                             || coalesce(new.codigo_velocidad, '');
  return new;
end $$;

drop trigger if exists trg_tyre_size_referencia on tyre_sizes;
create trigger trg_tyre_size_referencia
  before insert or update of medida, indice_carga_simple, indice_carga_doble, codigo_velocidad
  on tyre_sizes for each row execute function tc_tyre_size_referencia_trg();

comment on function tc_tyre_size_referencia_trg() is
  'referencia_completa se calcula, no se escribe: medida + carga + velocidad. '
  'Evita que vuelvan a convivir "385/55 R22.5 160K" y "385/55R22.5 160K".';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_tyre_size_referencia') then
    raise exception 'No se ha creado el disparador: el formato volvería a torcerse';
  end if;
  raise notice 'OK: disparador instalado, la referencia se calcula sola';
end $$;
