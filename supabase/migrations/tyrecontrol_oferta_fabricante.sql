-- La oferta del fabricante: en qué medidas, con qué índice de carga y con qué
-- código de velocidad fabrica cada modelo.
--
-- El catálogo tiene las listas sueltas (medidas, índices, velocidades,
-- modelos) y las combinaciones nacen una a una al dar de alta un neumático.
-- Al crear una referencia, el formulario no sabía qué medidas lleva el RA18 ni
-- qué índices van con cada medida, y enseñaba todas.
--
-- Esta tabla guarda las filas de los Excel de los fabricantes tal cual vienen:
-- modelo × medida × IC × CV. NO son referencias del catálogo ni combinaciones
-- (tyre_sizes): solo sirven para filtrar el formulario. La rellena el
-- importador de Configuración · medidas, índices, velocidades y modelos.
--
-- Solo crea esta tabla: no toca neumáticos, montajes, vehículos, ejes ni el
-- catálogo existente.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
-- Repetida, no hace nada. Si algo no cuadra, se deshace entera.

do $migracion$
begin
  if to_regclass('public.tc_cat_modelos_neumatico') is null
     or to_regclass('public.tc_cat_medidas_neumatico') is null
     or to_regprocedure('public.tc_is_superadmin()') is null then
    raise exception 'No se toca nada: faltan las tablas del catálogo o tc_is_superadmin().';
  end if;

  create table if not exists tc_cat_oferta_fabricante (
    id uuid primary key default gen_random_uuid(),
    modelo_id uuid not null references tc_cat_modelos_neumatico(id) on delete cascade,
    medida_id uuid not null references tc_cat_medidas_neumatico(id) on delete cascade,
    -- Texto vacío y no null: así la fila entera es única sin trucos y el
    -- importador puede repetirse sin duplicar.
    indice_carga_simple text not null default '',
    indice_carga_doble text not null default '',
    codigo_velocidad text not null default '',
    created_at timestamptz not null default now(),
    constraint tc_cat_oferta_fabricante_unica
      unique (modelo_id, medida_id, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  );
  create index if not exists tc_cat_oferta_fabricante_medida on tc_cat_oferta_fabricante (medida_id);

  comment on table tc_cat_oferta_fabricante is
    'Lo que fabrica cada modelo según el Excel del fabricante (medida, IC, CV). '
    'Solo filtra el formulario de nueva referencia; no son referencias del catálogo.';

  alter table tc_cat_oferta_fabricante enable row level security;
  drop policy if exists tc_cat_oferta_select on tc_cat_oferta_fabricante;
  create policy tc_cat_oferta_select on tc_cat_oferta_fabricante
    for select using (auth.uid() is not null);
  drop policy if exists tc_cat_oferta_write on tc_cat_oferta_fabricante;
  create policy tc_cat_oferta_write on tc_cat_oferta_fabricante
    for all using (tc_is_superadmin()) with check (tc_is_superadmin());

  grant select, insert, update, delete on tc_cat_oferta_fabricante to authenticated;

  -- Comprobación: la clave única existe y la RLS está puesta.
  if not exists (select 1 from pg_constraint where conname = 'tc_cat_oferta_fabricante_unica') then
    raise exception 'No se ha creado la clave única de la oferta.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.tc_cat_oferta_fabricante'::regclass) then
    raise exception 'La oferta del fabricante ha quedado sin RLS.';
  end if;

  perform set_config('mobilink.resultado', format(
    'OK: tabla de la oferta del fabricante lista (%s filas). Ahora vuelve a pasar los Excel por el importador.',
    (select count(*) from tc_cat_oferta_fabricante)), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
