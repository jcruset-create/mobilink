-- ============================================================
-- SEA TyreControl — Quién hizo la última revisión.
--
-- `tc_revision_estado()` ya decía CUÁNDO fue la última revisión de cada
-- vehículo y en qué situación está (al día, próxima, vencida, sin revisión).
-- No decía QUIÉN la hizo, y eso es lo que separa «revisada el 14/04» de
-- «revisada el 14/04 por David» o «por el arco del CheckPoint»: una la hizo
-- una persona mirando la rueda y la otra la midió una máquina al pasar.
--
-- ── De dónde sale el «quién», sin columna nueva ─────────────────────────────
--
-- De lo que ya se guarda al crear la revisión:
--
--   · `tecnico_id` lo pone la APK (el usuario de la sesión) y el panel. Si hay
--     técnico, el «quién» es su nombre y no hay nada que interpretar.
--   · Sin técnico y con `medido_at`, la revisión la creó una importación
--     automática. Para esta flota eso es el arco del CheckPoint, que es el
--     único que las crea así (`checkpointImport.ts`).
--   · Sin lo uno ni lo otro, no se sabe, y se devuelve NULL en vez de
--     inventar un nombre.
--
-- AVISO honesto sobre el segundo caso: el importador de revisiones por Excel
-- (`importRevisiones.ts`) también rellena `medido_at`, y deja `tecnico_id` a
-- NULL cuando el nombre del técnico de la hoja no casa con ningún usuario.
-- Una revisión así se etiquetaría aquí como «checkpoint» sin serlo. Si eso
-- llega a pasar en la práctica, la solución no es afinar la adivinanza: es
-- guardar el origen en su propia columna al crear la revisión.
--
-- Se cambia el tipo de retorno, así que hay que borrar la función antes: en
-- PostgreSQL `create or replace` no puede añadir columnas al resultado.
-- Quien ya la llamaba (Disponibles para revisar, Planificación) recibe los
-- mismos campos de siempre y dos más, que puede ignorar.
-- ============================================================

drop function if exists tc_revision_estado();

create or replace function tc_revision_estado()
returns table (
  vehiculo_id             uuid,
  ultima_revision         date,
  intervalo_dias          int,
  proxima_revision        date,
  dias_vencido            int,
  estado                  text,
  -- Nombre del técnico, o NULL si no lo hizo una persona identificada.
  ultima_revision_por     text,
  -- 'tecnico' | 'checkpoint' | NULL. Quien lo lea decide cómo escribirlo.
  ultima_revision_origen  text
)
language sql security invoker stable
set search_path = public as $$
  with ult as (
    -- La última completada de cada vehículo, con la fila entera y no solo la
    -- fecha: hace falta saber quién la firmó. A igualdad de fecha manda la
    -- más reciente de crear, que es la que se vería en el histórico.
    select distinct on (r.vehiculo_id)
           r.vehiculo_id,
           r.fecha_revision::date as ultima,
           r.tecnico_id,
           r.medido_at
      from revisiones_vehiculo r
     where r.estado_revision = 'completada'
     order by r.vehiculo_id, r.fecha_revision desc, r.created_at desc
  ),
  base as (
    select v.id as vehiculo_id,
           u.ultima,
           u.tecnico_id,
           u.medido_at,
           coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo
    from tc_vehiculos v
    left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
    left join ult u on u.vehiculo_id = v.id
    where v.activo
  )
  select
    b.vehiculo_id,
    b.ultima,
    b.intervalo,
    case when b.ultima is not null and b.intervalo is not null then b.ultima + b.intervalo end as proxima_revision,
    case when b.ultima is not null and b.intervalo is not null then current_date - (b.ultima + b.intervalo) end as dias_vencido,
    case
      when b.ultima is null then 'sin_revision'
      when b.intervalo is null then 'al_dia'
      when current_date > b.ultima + b.intervalo then 'vencida'
      when (b.ultima + b.intervalo) - current_date <= 15 then 'proxima'
      else 'al_dia'
    end as estado,
    -- El nombre del técnico. Si RLS no deja ver ese usuario, sale NULL y la
    -- pantalla enseña una raya: mejor eso que un id que no dice nada.
    us.nombre as ultima_revision_por,
    case
      when b.tecnico_id is not null then 'tecnico'
      when b.medido_at is not null then 'checkpoint'
    end as ultima_revision_origen
  from base b
  left join tc_usuarios us on us.id = b.tecnico_id;
$$;

comment on function tc_revision_estado() is
  'Situación de revisión de cada vehículo activo: última fecha, intervalo, próxima, días vencidos, estado, y quién hizo la última (nombre del técnico u origen automático).';
