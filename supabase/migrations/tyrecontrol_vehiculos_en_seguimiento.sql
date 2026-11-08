-- ════════════════════════════════════════════════════════════════════════════
-- SEA TyreControl — Vehículos activos que NO están en el mantenimiento integral
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hay matrículas que circulan y están en la telemática pero que no entran en
-- el contrato: nadie les revisa los neumáticos. Hoy cuentan como un vehículo
-- más, así que ensucian los recuentos de los informes y aparecen en las colas
-- de revisión como si alguien tuviera que ir a mirarlas.
--
-- En Plana son del orden de 108 de los 717 activos: sin un solo montaje y sin
-- una sola revisión, 82 de ellos sin tipo siquiera, y 79 creados desde la
-- conciliación telemática.
--
-- ── Esto NO es ninguno de los estados que ya había ─────────────────────────
--
-- Y la diferencia importa, porque el repositorio ya tropezó una vez con esto.
-- Dice `server/tyrecontrol/altaOperativa/estado.ts`: «Mezclarlas fue el error
-- que ya se cometió una vez: `pendiente_validar` marca lo segundo, y por eso
-- NO se usa aquí». Son cuatro cosas distintas:
--
--   · `activo`             — el vehículo existe y circula.
--   · `pendiente_validar`  — le faltan datos administrativos.
--   · alta operativa       — sin tipo, plano o inventario el técnico no puede
--                            trabajar. Se CALCULA, no se guarda.
--   · `en_seguimiento`     — esto. No está en el contrato.
--
-- Un vehículo puede estar activo, validado, perfectamente operativo y aun así
-- fuera del contrato. Y al revés.
--
-- ── Por qué una columna, si el alta operativa se calcula ───────────────────
--
-- Porque esto NO se puede calcular. Que una matrícula esté en el mantenimiento
-- integral es un hecho que vive en un contrato, no en la base: un vehículo sin
-- revisiones puede estar dentro y llevar dos meses sin pasar, y uno con
-- revisiones viejas puede haber salido el mes pasado. Dato que solo conoce una
-- persona, columna.
--
-- ── `default true`, que es lo que hace que esto no rompa nada ──────────────
--
-- Los 909 vehículos que hay hoy nacen en `true`. El día que se aplique esta
-- migración NO cambia ni un solo número de ningún informe. Lo que cambie,
-- cambiará cuando alguien pulse el botón de la ficha.

alter table tc_vehiculos
  add column if not exists en_seguimiento           boolean not null default true,
  add column if not exists seguimiento_motivo       text,
  add column if not exists seguimiento_cambiado_en  timestamptz,
  add column if not exists seguimiento_cambiado_por uuid references tc_usuarios(id);

comment on column tc_vehiculos.en_seguimiento is
  'Si el vehículo entra en el mantenimiento integral. En false NO cuenta para '
  'revisiones ni informes, pero sigue activo, sigue en la telemática y se le '
  'puede montar una goma si hace falta. No confundir con activo (dado de '
  'baja) ni con pendiente_validar (faltan datos administrativos).';
comment on column tc_vehiculos.seguimiento_motivo is
  'Por qué se dejó sin seguimiento. Obligatorio al quitarlo: un vehículo que '
  'deja de contar sin que nadie sepa por qué es justo lo que no queremos.';

-- Para la lista de «sin seguimiento», que es la consulta rara: el índice
-- parcial solo cubre las filas en false, que son las pocas.
create index if not exists idx_tc_vehiculos_sin_seguimiento
  on tc_vehiculos (empresa_id) where not en_seguimiento;

-- ── Quitar y poner el seguimiento ───────────────────────────────────────────
--
-- Por RPC y no escribiendo la columna desde el panel, por dos razones: el
-- motivo tiene que ser obligatorio de verdad —no «obligatorio en el
-- formulario»— y esto lo decide un administrador, igual que validar un
-- vehículo. Misma comprobación que `tc_validar_vehiculo`.
create or replace function public.tc_vehiculo_seguimiento(
  p_vehiculo       uuid,
  p_en_seguimiento boolean,
  p_motivo         text default null
)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v record;
begin
  select * into v from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and v.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sólo un administrador cambia el seguimiento de un vehículo';
  end if;

  -- Al QUITARLO hace falta motivo. Al devolverlo no: volver al redil es el
  -- estado normal y no necesita explicación.
  if not p_en_seguimiento and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Hace falta un motivo para dejar un vehículo sin seguimiento';
  end if;

  update tc_vehiculos
     set en_seguimiento           = p_en_seguimiento,
         -- El motivo se borra al devolver el seguimiento: si no, la ficha
         -- enseñaría la explicación de una situación que ya no se da.
         seguimiento_motivo       = case when p_en_seguimiento then null else btrim(p_motivo) end,
         seguimiento_cambiado_en  = now(),
         seguimiento_cambiado_por = auth.uid(),
         updated_at               = now()
   where id = p_vehiculo;
end $$;

grant execute on function public.tc_vehiculo_seguimiento(uuid, boolean, text) to authenticated;
