-- ============================================================
-- SEA TyreControl — Qué vehículos no se pueden trabajar todavía.
--
-- Devuelve, por vehículo activo de una empresa, los cuatro RECUENTOS con los
-- que se decide si su alta operativa está terminada:
--
--   posiciones del tipo · posiciones con neumático · posiciones con
--   profundidad medida · (y el tipo, para saber si lo tiene)
--
-- La DECISIÓN no se toma aquí: la toma `estadoDeAlta()` en
-- server/tyrecontrol/altaOperativa/estado.ts, que es código puro y con
-- pruebas. Esta función solo cuenta. Repartir la regla entre SQL y TypeScript
-- es como se acaba con dos criterios que discrepan y nadie sabe cuál manda.
--
-- ── Por qué en la base y no en el servidor ──────────────────────────────────
--
-- Por volumen. Contar «¿esta posición tiene alguna profundidad medida?» desde
-- el servidor obliga a traerse `revisiones_neumaticos_detalle` entero: en una
-- flota de 751 vehículos con años de revisiones son cientos de miles de filas
-- para contestar una pantalla de lista. Aquí se agrega donde están los datos y
-- viajan 751 filas de números.
--
-- ── Lo que NO mira ──────────────────────────────────────────────────────────
--
-- Marca, modelo, año, bastidor, delegación y `pendiente_validar`. Son datos de
-- oficina: su ausencia no impide medir una goma y no puede devolver un
-- vehículo a la cola del técnico. Que no aparezcan en esta consulta es
-- deliberado.
--
-- Solo lectura: no escribe nada. Reversible con `drop function`.
-- ============================================================

create or replace function tc_alta_operativa_recuentos(p_empresa uuid)
returns table (
  vehiculo_id               uuid,
  matricula                 text,
  numero_unidad             text,
  tipo_id                   uuid,
  tipo_nombre               text,
  posiciones_del_tipo       int,
  posiciones_con_neumatico  int,
  posiciones_con_profundidad int
)
language sql security definer stable set search_path = public as $$
  select
    v.id,
    v.matricula,
    v.numero_unidad,
    v.tipo_vehiculo_id,
    coalesce(t.descripcion, t.nombre),
    -- Las posiciones son del TIPO y las comparten todos sus vehículos: esa es
    -- la arquitectura de TyreControl y aquí se respeta, no se replica.
    (select count(*)::int from tc_posiciones_vehiculo p
      where p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo),
    -- Montajes VIGENTES. `tc_montajes_actuales` ya tiene un unique por
    -- (vehiculo, posicion) activo, así que contar filas es contar posiciones.
    (select count(*)::int from tc_montajes_actuales m
      where m.vehiculo_id = v.id),
    -- Posiciones DISTINTAS con al menos una profundidad medida alguna vez. No
    -- se cuenta la última revisión: lo que se pregunta es si esa rueda llegó a
    -- medirse, no cuándo.
    (select count(distinct d.posicion_id)::int
       from revisiones_neumaticos_detalle d
       join revisiones_vehiculo r on r.id = d.revision_id
      where d.vehiculo_id = v.id
        and d.profundidad_mm is not null
        and r.estado_revision <> 'anulada')
  from tc_vehiculos v
  left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
  where v.empresa_id = p_empresa
    and v.activo
    -- El permiso se comprueba aquí ADEMÁS de en el servidor. El servidor habla
    -- con service_role y no pasa por RLS; si algún día se llamara desde el
    -- cliente, esto sigue en pie.
    and tc_puede_ver_empresa(p_empresa);
$$;

comment on function tc_alta_operativa_recuentos(uuid) is
  'Recuentos por vehículo para saber si su alta operativa está terminada: '
  'posiciones del tipo, posiciones con neumático montado y posiciones con '
  'profundidad medida. Solo cuenta; la decisión la toma estadoDeAlta() en el '
  'servidor. No mira marca, modelo ni pendiente_validar: son datos de oficina '
  'y no bloquean al técnico.';

grant execute on function tc_alta_operativa_recuentos(uuid) to authenticated;
