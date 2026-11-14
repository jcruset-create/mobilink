-- ============================================================
-- SEA TyreControl — Completar la ficha operativa desde la tablet.
--
-- `tc_alta_operativa_tipo` (que ya existe) pone el TIPO, que es lo que
-- desbloquea el plano y las posiciones. Lo que faltaba es el resto de lo que
-- el técnico tiene delante y oficina no siempre ha rellenado: la MEDIDA del
-- neumático y el TIPO DE LLANTA. Sin esos dos datos la ficha queda a medias y
-- el inventario inicial se hace a ciegas.
--
-- ── Por qué una función nueva y no un parámetro más ─────────────────────────
--
-- Añadirle parámetros con valor por defecto a `tc_alta_operativa_tipo` crearía
-- una SOBRECARGA: las llamadas de dos argumentos que ya hace la APK instalada
-- quedarían ambiguas entre la vieja y la nueva. Esa es exactamente la clase de
-- fallo que aparece en producción y no en el banco. Así que la de dos
-- argumentos se queda como está —sin tocar una línea— y esta la LLAMA.
--
-- Reusar en vez de copiar también mantiene una sola copia de la regla que
-- evita el destrozo: con neumáticos montados no se cambia el tipo, porque sus
-- montajes quedarían apuntando a posiciones de otro plano.
--
-- ── Lo que NO hace ──────────────────────────────────────────────────────────
--
-- No crea posiciones (son del tipo), no toca marca, modelo, bastidor ni
-- `pendiente_validar` —datos de oficina—, y no borra lo que no se le pregunta:
-- un parámetro en null deja el valor que hubiera. Para VACIAR una medida hay
-- que ir al panel; desde el patio solo se rellena.
--
-- La configuración de ejes no se elige aquí a propósito. Las posiciones
-- cuelgan del tipo y las comparten todos los vehículos iguales, así que
-- dejar cambiarla desde una tablet tocaría la flota entera. Se enseña lo que
-- trae el tipo y se confirma; si no cuadra, el tipo está mal elegido.
--
-- Reversible con `drop function`. No altera ninguna tabla.
-- ============================================================

create or replace function tc_alta_operativa_ficha(
  p_vehiculo uuid,
  p_tipo     uuid,
  p_medida   uuid default null,
  p_llanta   uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_res     jsonb;
  v_medida  uuid;
  v_llanta  uuid;
begin
  -- Permisos, plano, vehículo de baja, montajes y enlace de la configuración:
  -- todo eso ya lo decide la función del tipo. Si algo no cuadra, lanza ella y
  -- aquí no se escribe nada.
  v_res := tc_alta_operativa_tipo(p_vehiculo, p_tipo);

  if p_medida is not null then
    select id into v_medida from tc_cat_medidas_neumatico where id = p_medida and activo;
    if v_medida is null then
      raise exception 'Esa medida de neumático no está en el catálogo o está dada de baja';
    end if;
  end if;

  if p_llanta is not null then
    select id into v_llanta from tc_tipos_llanta where id = p_llanta and activo;
    if v_llanta is null then
      raise exception 'Ese tipo de llanta no está en el catálogo o está dado de baja';
    end if;
  end if;

  -- Solo se escribe si hay algo que escribir: así una reconfirmación no deja
  -- un `updated_at` nuevo haciendo creer que alguien tocó la ficha.
  if v_medida is not null or v_llanta is not null then
    update tc_vehiculos
       set medida_id      = coalesce(v_medida, medida_id),
           tipo_llanta_id = coalesce(v_llanta, tipo_llanta_id),
           updated_at     = now()
     where id = p_vehiculo
       and (v_medida is distinct from medida_id or v_llanta is distinct from tipo_llanta_id);
  end if;

  -- Se devuelve lo que ha quedado de verdad en la ficha, leído de la tabla:
  -- así la APK pinta lo guardado y no lo que creía haber mandado.
  return v_res || (
    select jsonb_build_object(
             'medida_id',      v.medida_id,
             'tipo_llanta_id', v.tipo_llanta_id,
             'medida',         m.valor,
             'llanta',         case when l.id is null then null
                                    else l.material || ' ' || l.medida end)
      from tc_vehiculos v
      left join tc_cat_medidas_neumatico m on m.id = v.medida_id
      left join tc_tipos_llanta          l on l.id = v.tipo_llanta_id
     where v.id = p_vehiculo);
end $$;

comment on function tc_alta_operativa_ficha(uuid, uuid, uuid, uuid) is
  'Completa la ficha operativa desde la APK: tipo (delegando en '
  'tc_alta_operativa_tipo, que trae los permisos y la regla de los montajes), '
  'medida de neumático y tipo de llanta. Un parámetro en null deja el valor '
  'que hubiera: desde el patio se rellena, no se vacía.';

grant execute on function tc_alta_operativa_ficha(uuid, uuid, uuid, uuid) to authenticated;
