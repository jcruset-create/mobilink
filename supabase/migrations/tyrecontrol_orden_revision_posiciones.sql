-- ============================================================
-- SEA TyreControl — Orden de revisión configurable por posición.
--
-- Permite fijar en qué orden el técnico revisa las ruedas en la
-- tablet (1, 2, 3, …) por tipo de vehículo. Si una posición no lo
-- tiene informado, la app usa el recorrido en círculo por defecto
-- (lado derecho de delante hacia atrás, lado izquierdo de atrás
-- hacia delante).
-- ============================================================

alter table tc_posiciones_vehiculo add column if not exists orden_revision int;

comment on column tc_posiciones_vehiculo.orden_revision is
  'Orden de revisión en la tablet (1,2,3,…). NULL = recorrido en círculo por defecto.';
