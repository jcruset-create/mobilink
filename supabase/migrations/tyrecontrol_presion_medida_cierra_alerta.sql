-- Un aviso de presión se cierra solo cuando esa rueda vuelve a medir bien.
--
-- ── El caso que lo pide ─────────────────────────────────────────────────────
--
-- El 7436KVK (unidad 1129) tenía abierto un aviso de Goodyear del 11/11 a las
-- 11:08: «E3_DER · 4,6 bar de 8 recomendados (−42,27 %)». El 12/11 a las 21:05
-- pasó por el arco y esa misma rueda dio 9,3 bar. El aviso seguía en rojo en
-- la ficha, en la tablet y en la campana.
--
-- Estaba escrito desde el principio que debía pasar —«lo cerrará una revisión
-- posterior que mida bien esa rueda», dice el comentario de
-- `AvisosPresionVehiculo.tsx`— y nunca se implementó. Esto lo implementa.
--
-- ── Por qué un disparador sobre la MEDICIÓN y no en `tc_completar_revision` ─
--
-- Porque las revisiones del arco NO pasan por ahí. `checkpointImport.ts`
-- inserta las filas con `estado_revision: 'completada'` directamente, así que
-- enganchar en `tc_completar_revision` habría cubierto la tablet y el panel y
-- habría dejado fuera justo el caso que se pide: «ha vuelto a pasar por el
-- arco».
--
-- `revisiones_neumaticos_detalle` es el único sitio por el que pasan TODOS los
-- caminos: el arco, la tablet, el panel, el parte guiado y el importador.
--
-- ── Cuándo se considera que la rueda está bien ─────────────────────────────
--
-- Cuando la medición llega al 90 % de la presión recomendada que trae el
-- propio aviso. El umbral NO sale de una intuición: se midió contra las cinco
-- alertas abiertas que ya tenían una medición posterior.
--
--   4568JXB TRAS_IZQ   1,7 → 2,4 de 2,5    −4,0 %   se cierra
--   4568JXB TRAS_DER   1,9 → 2,5 de 2,5     0,0 %   se cierra
--   5924KWR E1_IZQ     4,4 → 9,4 de 8,0   +17,5 %   se cierra
--   7436KVK E3_DER     4,6 → 9,3 de 8,0   +16,3 %   se cierra
--   9359HKG E2_IZQ_INT 6,0 → 6,5 de 8,0   −18,8 %   SIGUE ABIERTA
--
-- La última es la que justifica el corte: 6,5 de 8 sigue siendo poca presión.
-- Y para contrastar, el aviso de Goodyear menos grave de la muestra saltó a
-- −18,76 %, así que −10 % queda cómodamente dentro de lo que su propio sensor
-- considera correcto.
--
-- Se compara contra `presion_recomendada_bar` DEL AVISO y no contra los
-- umbrales de `tc_umbrales_revision`, que son 7–9,5 bar para toda la empresa.
-- Con esos, el 4568JXB —una furgoneta de 2,5 bar recomendados— no se cerraría
-- JAMÁS: 2,5 nunca llega a 7. El dato bueno es el que manda el propio sensor
-- para esa rueda.
--
-- Si el aviso no trae recomendada, no se cierra solo. Sin referencia no hay
-- nada con qué comparar, y dar por buena una rueda a ojo es justo lo que no
-- debe hacer esto.
--
-- ── Y tiene que ser POSTERIOR ───────────────────────────────────────────────
--
-- Solo cierra una medición tomada DESPUÉS del último aviso. Una revisión de
-- por la mañana no dice nada de un aviso de por la tarde, y sin esta condición
-- un aviso nuevo sobre una rueda medida esta semana nacería ya cerrado.

create or replace function tc_presion_medida_cierra_alerta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_medida_en timestamptz;
begin
  if new.presion_bar is null then
    return new;
  end if;

  /*
   * Salida rápida. El arco mete miles de mediciones por pasada y casi ninguna
   * tiene un aviso esperando: hoy hay nueve abiertos en toda la instalación.
   * Esta comprobación usa el índice parcial de `tc_alertas_presion`, así que
   * el 99,9 % de las filas sale por aquí sin tocar nada más.
   */
  if not exists (
    select 1 from tc_alertas_presion a
     where a.vehiculo_id = new.vehiculo_id
       and a.posicion_id = new.posicion_id
       and a.estado = 'abierta'
  ) then
    return new;
  end if;

  -- Cuándo se midió de verdad. `medido_at` es el instante del arco; en una
  -- revisión de técnico puede no estar y entonces vale la creación.
  select coalesce(rv.medido_at, rv.created_at) into v_medida_en
    from revisiones_vehiculo rv
   where rv.id = new.revision_id
     and rv.estado_revision <> 'anulada';
  if v_medida_en is null then
    return new;
  end if;

  update tc_alertas_presion a
     set estado         = 'resuelta',
         resuelta_at    = now(),
         actualizado_at = now(),
         nota = 'Resuelta sola: ' || new.presion_bar || ' bar medidos el '
                || to_char(v_medida_en, 'DD/MM/YYYY HH24:MI')
                || ', sobre ' || a.presion_recomendada_bar || ' recomendados'
   where a.vehiculo_id = new.vehiculo_id
     and a.posicion_id = new.posicion_id
     and a.estado = 'abierta'
     -- Sin referencia no se cierra sola: ver la cabecera.
     and a.presion_recomendada_bar is not null
     -- La medición tiene que ser posterior al aviso.
     and v_medida_en > a.ultimo_aviso_at
     -- Y llegar al 90 % de lo recomendado.
     and new.presion_bar >= a.presion_recomendada_bar * 0.90;

  return new;
end
$function$;

comment on function tc_presion_medida_cierra_alerta() is
  'Cierra el aviso de presión de una rueda cuando una medición POSTERIOR de esa misma rueda llega al 90% de la presión recomendada del aviso. Cubre el arco, la tablet y el panel, porque todos escriben en revisiones_neumaticos_detalle.';

drop trigger if exists trg_presion_medida_cierra_alerta on revisiones_neumaticos_detalle;

-- `of presion_bar` en el UPDATE: una corrección de la profundidad o de las
-- observaciones no tiene por qué volver a mirar los avisos.
create trigger trg_presion_medida_cierra_alerta
after insert or update of presion_bar on revisiones_neumaticos_detalle
for each row execute function tc_presion_medida_cierra_alerta();

-- ── Las que ya se podían cerrar antes de existir esto ───────────────────────
--
-- El disparador solo mira lo que se mida de ahora en adelante. Las cuatro de
-- la tabla de arriba ya tienen su medición buena guardada, así que se cierran
-- aquí con el mismo criterio, exactamente igual que lo haría el disparador.
--
-- Va en el mismo fichero a propósito: es el mismo criterio y separarlo en un
-- script aparte es como acaban dos reglas distintas para la misma pregunta.

with medicion as (
  select distinct on (a.id)
         a.id as alerta_id,
         d.presion_bar,
         coalesce(rv.medido_at, rv.created_at) as medida_en,
         a.presion_recomendada_bar
    from tc_alertas_presion a
    join revisiones_neumaticos_detalle d
      on d.vehiculo_id = a.vehiculo_id
     and d.posicion_id = a.posicion_id
     and d.presion_bar is not null
    join revisiones_vehiculo rv
      on rv.id = d.revision_id
     and rv.estado_revision <> 'anulada'
     and coalesce(rv.medido_at, rv.created_at) > a.ultimo_aviso_at
   where a.estado = 'abierta'
     and a.presion_recomendada_bar is not null
   order by a.id, coalesce(rv.medido_at, rv.created_at) desc
)
update tc_alertas_presion a
   set estado         = 'resuelta',
       resuelta_at    = now(),
       actualizado_at = now(),
       nota = 'Resuelta sola: ' || m.presion_bar || ' bar medidos el '
              || to_char(m.medida_en, 'DD/MM/YYYY HH24:MI')
              || ', sobre ' || m.presion_recomendada_bar || ' recomendados'
  from medicion m
 where a.id = m.alerta_id
   and m.presion_bar >= m.presion_recomendada_bar * 0.90;

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- `cerradas_solas` tiene que traer las cuatro, con su nota.
-- Y `siguen_abiertas_con_medicion_baja` tiene que traer el 9359HKG, que midió
-- 6,5 de 8 y NO se cierra: eso es que el umbral hace su trabajo.

select v.matricula, p.codigo_posicion, a.estado, a.nota
  from tc_alertas_presion a
  join tc_vehiculos v on v.id = a.vehiculo_id
  left join tc_posiciones_vehiculo p on p.id = a.posicion_id
 where a.nota like 'Resuelta sola:%'
 order by v.matricula;

select v.matricula, p.codigo_posicion, a.presion_bar as la_del_aviso,
       a.presion_recomendada_bar as recomendada
  from tc_alertas_presion a
  join tc_vehiculos v on v.id = a.vehiculo_id
  left join tc_posiciones_vehiculo p on p.id = a.posicion_id
 where a.estado = 'abierta'
 order by v.matricula;
