-- ============================================================
-- SEA TyreControl — Fix: la app móvil guarda metodo = 'sonda'
-- (medida tomada con la sonda TLGX) pero el CHECK de
-- revisiones_neumaticos_detalle solo admitía
-- ('manual','bluetooth','importacion_excel').
--
-- Consecuencia: cada rueda medida con sonda violaba el CHECK, el
-- guardado del detalle fallaba (23514), se encolaba en la app y la
-- revisión se quedaba "pendiente" sin llegar nunca al panel/escritorio.
--
-- Al añadir 'sonda' a los valores permitidos, los detalles ya
-- encolados en las tablets se suben en la siguiente sincronización
-- (recuperación automática) y las nuevas revisiones funcionan.
-- ============================================================

alter table revisiones_neumaticos_detalle
  drop constraint if exists revisiones_neumaticos_detalle_metodo_profundidad_check,
  drop constraint if exists revisiones_neumaticos_detalle_metodo_presion_check;

alter table revisiones_neumaticos_detalle
  add constraint revisiones_neumaticos_detalle_metodo_profundidad_check
    check (metodo_profundidad is null or metodo_profundidad in ('manual','bluetooth','sonda','importacion_excel')),
  add constraint revisiones_neumaticos_detalle_metodo_presion_check
    check (metodo_presion is null or metodo_presion in ('manual','bluetooth','sonda','importacion_excel'));
