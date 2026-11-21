-- Propuestas de la IA para completar fichas del catálogo de neumáticos.
--
-- «✨ Completar fichas con IA» busca los campos VACÍOS de una referencia y deja
-- aquí lo que encuentra, con su URL y su tipo de fuente. NO toca la referencia:
-- solo cuando una persona acepta una propuesta, el servidor la copia al campo
-- (y solo si sigue vacío, salvo que pida corregir).
--
-- Tabla nueva. No toca tc_neumaticos, tc_montajes_actuales, tc_vehiculo_ejes,
-- config_ejes_id ni tc_vehiculos.km_actual. Idempotente.

create table if not exists tc_catalogo_propuestas_ia (
  id            uuid primary key default gen_random_uuid(),
  referencia_id uuid not null references tc_referencias_neumatico(id) on delete cascade,
  campo         text not null,
  valor         text,
  valor_actual  text,
  url           text,
  tipo_fuente   text check (tipo_fuente in ('oficial', 'eprel', 'distribuidor')),
  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'aceptada', 'descartada', 'invalida')),
  motivo        text,
  creado_por    uuid,
  created_at    timestamptz not null default now(),
  resuelta_at   timestamptz
);

create index if not exists idx_tc_propuestas_ia_ref on tc_catalogo_propuestas_ia (referencia_id, estado);

alter table tc_catalogo_propuestas_ia enable row level security;
drop policy if exists tc_catalogo_propuestas_ia_select on tc_catalogo_propuestas_ia;
-- Solo el superadmin las ve; se escriben desde el servidor.
create policy tc_catalogo_propuestas_ia_select on tc_catalogo_propuestas_ia
  for select to authenticated using ((select tc_is_superadmin()));

do $migracion$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'tc_catalogo_propuestas_ia') then
    raise exception 'No se ha creado tc_catalogo_propuestas_ia';
  end if;
  perform set_config('mobilink.resultado', 'OK: tabla de propuestas de IA lista', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
