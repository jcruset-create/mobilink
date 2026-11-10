-- Pasada inicial: poner en la ficha lo que digan los albaranes importados.
--
-- Necesita la migración `tyrecontrol_albaran_manda_en_montajes.sql` aplicada
-- ANTES: es la que crea `tc_aplicar_albaranes_a_montajes`.
--
-- Solo Empresa Plana tiene albaranes importados: 5.214 operaciones sobre 463
-- vehículos. Las demás empresas no tienen ninguno, así que esto no las toca.
--
-- ── Qué va a cambiar, dicho de antemano ─────────────────────────────────────
--
-- De 325 vehículos con albaranes que nombran posición:
--
--    77 posiciones donde el albarán es POSTERIOR al montaje de la ficha.
--       Ahí la ficha estaba caducada sin discusión.
--   329 posiciones donde el albarán es ANTERIOR. En 328 de ellas lo que hay
--       hoy lo puso el inventario inicial, o sea una persona mirando la rueda,
--       y 175 llevan más de tres meses de diferencia. Esas pasan a decir lo
--       que decía un papel viejo. Es la regla que se ha pedido y se aplica
--       entera, pero conviene saber que ese es el precio.
--    45 posiciones que el albarán nombra y que hoy no tienen nada montado.
--
-- ── Se hace en dos pasos, a propósito ───────────────────────────────────────
--
-- El PASO 1 no toca nada: dice cuántas cambiarían. Mirar ese número antes de
-- lanzar el 2 es la última oportunidad de parar.

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 1 — SIMULACIÓN. No escribe nada. Lánzalo solo.
-- ════════════════════════════════════════════════════════════════════════════

select tc_aplicar_albaranes_a_montajes(
         'a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid,  -- Empresa Plana S.L.
         null,                                           -- toda la flota
         true                                            -- simular
       ) as simulacion;

-- Lo que TIENE que salir, calculado sobre los datos de hoy:
--
--   {"simulado": true, "cambiadas": 1109, "creadas": 45, "ya_estaban": 0}
--
-- Si no sale eso, para y avisa: los datos han cambiado desde que se midió.
--
-- Ojo a `ya_estaban: 0`: no significa que las 1.109 cambien de modelo. El
-- albarán crea su propia ficha de goma aunque el modelo coincida, así que la
-- comparación es por IDENTIDAD, no por marca y modelo. El reparto real:
--
--   406  cambia el modelo que enseña la ficha   (124 vehículos)
--   703  mismo modelo, cambia la identidad      (217 vehículos)
--    45  posición vacía, se crea el montaje     (11 vehículos)


-- ════════════════════════════════════════════════════════════════════════════
-- PASO 2 — DE VERDAD. Solo después de mirar el paso 1.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Va en una transacción con su foto de antes y de después: si el recuento
-- final no cuadra, se hace ROLLBACK en vez de COMMIT y no ha pasado nada.

begin;

create temporary table _antes on commit drop as
select count(*) filas, count(distinct vehiculo_id) vehiculos
  from tc_montajes_actuales
 where empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb';

select tc_aplicar_albaranes_a_montajes(
         'a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid, null, false) as aplicado;

-- Antes y después, en la misma pantalla. El número de filas puede subir (las
-- 45 posiciones que estaban vacías) pero NO debería bajar: si baja, se ha
-- perdido un montaje por el camino.
select a.filas    as filas_antes,
       n.filas    as filas_despues,
       n.filas - a.filas as diferencia,
       a.vehiculos as vehiculos_antes,
       n.vehiculos as vehiculos_despues
  from _antes a,
       (select count(*) filas, count(distinct vehiculo_id) vehiculos
          from tc_montajes_actuales
         where empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb') n;

-- Si `diferencia` es negativa, ROLLBACK. Si no, COMMIT.
commit;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — el vehículo del que salió todo esto
-- ════════════════════════════════════════════════════════════════════════════
--
-- 8378NBC. Las seis posiciones tienen que decir Hankook AH51 después de esto:
-- las dos del eje 1 por el albarán del 24-09 y las cuatro del eje 2 por el del
-- 30-04.

select p.codigo_posicion            as posicion,
       n.codigo_interno,
       coalesce(n.marca, '-')       as marca,
       coalesce(n.modelo, '-')      as modelo,
       m.fecha_montaje,
       m.km_montaje,
       m.observaciones
  from tc_montajes_actuales m
  join tc_posiciones_vehiculo p on p.id = m.posicion_id
  join tc_neumaticos n          on n.id = m.neumatico_id
 where m.vehiculo_id = 'd0c1b81d-86ae-4a4f-987f-b629367b0d8a'
 order by p.orden_visual;
