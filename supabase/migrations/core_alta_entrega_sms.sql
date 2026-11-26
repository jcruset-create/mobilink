-- =============================================================================
-- Core · ¿Llegó el SMS del enlace?
-- =============================================================================
--
-- QUÉ HACE
--   Añade a sea_employee_invites cuatro columnas para apuntar lo que Twilio
--   dice de la ENTREGA del SMS del enlace:
--     · entrega          'en_camino' | 'entregado' | 'no_entregado'
--     · entrega_codigo   el código de error de Twilio, si lo hay (30003, 30007…)
--     · entrega_detalle  el texto de error de Twilio, si lo hay
--     · entrega_at       la última vez que se le preguntó a Twilio
--
--   Hasta ahora solo se sabía que Twilio había ACEPTADO el mensaje
--   (mensaje_sid). Que lo acepte no quiere decir que llegue al móvil.
--
-- QUÉ NO HACE
--   · No cambia ningún dato existente: las columnas nacen vacías y el servidor
--     las va rellenando al abrir la lista de empleados.
--   · No toca estado, estado_alta ni ninguna otra tabla. Que un SMS no llegue
--     no anula el enlace ni mueve la ficha: solo se enseña.
--   · Sin triggers. Sin DROP.
--
-- ORDEN
--   1. core_alta_operario.sql (ya ejecutada: es la que crea la tabla).
--   2. ESTE FICHERO.
--   3. A partir de ahí, Core → Empleados enseña bajo «Enlace enviado» /
--      «Actualización pedida» si el SMS está entregado, en camino o no
--      entregado (y por qué). Antes de ejecutarlo, simplemente no aparece.
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta.
-- =============================================================================

alter table sea_employee_invites
  add column if not exists entrega         text,
  add column if not exists entrega_codigo  integer,
  add column if not exists entrega_detalle text,
  add column if not exists entrega_at      timestamptz;

comment on column sea_employee_invites.entrega is
  'Entrega del SMS según Twilio: en_camino, entregado o no_entregado. Vacío = aún no se ha preguntado.';
