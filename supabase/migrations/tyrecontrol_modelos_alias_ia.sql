-- Alias de modelos del catálogo y «Es el mismo modelo» en Completar fichas con IA.
--
-- La IA descartaba fichas buenas porque el fabricante llama al modelo de otra
-- forma: el catálogo dice «BT200» y Barum «BT 200 R»; el catálogo «RA30» y
-- Hankook «Vantra ST AS2 RA30». Cuando una persona confirma que es el mismo
-- modelo, ese nombre se guarda como alias y la próxima vez coincide solo.
--
--  1. tc_cat_modelos_alias (nueva): alias de cada modelo.
--  2. tc_catalogo_propuestas_ia: + `causa` (por qué se descartó: modelo,
--     indice, medida, marca, fuente, valor), + `modelo_leido` (cómo llama la
--     ficha al modelo) y + `ficha_leida` (marca, modelo, medida e índice que
--     leyó, para volver a comprobarlo todo al confirmar). Solo se AÑADEN columnas.
--
-- No toca tc_neumaticos, tc_montajes_actuales, tc_vehiculo_ejes,
-- config_ejes_id ni tc_vehiculos.km_actual. Idempotente.

create table if not exists tc_cat_modelos_alias (
  id         uuid primary key default gen_random_uuid(),
  modelo_id  uuid not null references tc_cat_modelos_neumatico(id) on delete cascade,
  alias      text not null check (length(btrim(alias)) between 1 and 80),
  creado_por uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_tc_cat_modelos_alias on tc_cat_modelos_alias (modelo_id, upper(btrim(alias)));
alter table tc_cat_modelos_alias enable row level security;
drop policy if exists tc_cat_modelos_alias_select on tc_cat_modelos_alias;
create policy tc_cat_modelos_alias_select on tc_cat_modelos_alias for select to authenticated using (true);

alter table tc_catalogo_propuestas_ia add column if not exists causa text;
alter table tc_catalogo_propuestas_ia add column if not exists modelo_leido text;
alter table tc_catalogo_propuestas_ia add column if not exists ficha_leida jsonb;

do $migracion$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'tc_catalogo_propuestas_ia' and column_name = 'modelo_leido') then
    raise exception 'Falta la columna modelo_leido';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'tc_cat_modelos_alias') then
    raise exception 'Falta la tabla tc_cat_modelos_alias';
  end if;
  perform set_config('mobilink.resultado', 'OK: alias de modelos y causa de descarte listos', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
