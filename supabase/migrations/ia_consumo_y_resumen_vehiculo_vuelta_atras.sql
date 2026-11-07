-- ─────────────────────────────────────────────────────────────────────────
-- Vuelta atrás de ia_consumo_y_resumen_vehiculo.sql
--
-- Qué deshace: las cuatro tablas que añadió la migración, con sus índices y
-- sus políticas (que caen con la tabla).
--
-- Qué NO toca: nada anterior. La migración no modificó ni una tabla previa,
-- así que volver atrás no puede llevarse por delante trabajo ajeno.
--
-- ⚠️ ESTO BORRA DATOS: `ia_uso` es el histórico de consumo y `ia_limites`
-- guarda qué empresas tienen la IA y el resumen activados. Si se vuelve atrás
-- para corregir algo y luego se reaplica, ambas cosas hay que volver a
-- configurarlas. Si solo se quiere apagar la funcionalidad, NO hace falta
-- esto: basta con poner `resumen_vehiculo_activo = false` (o `ia_activa =
-- false`) en `ia_limites`, que es reversible y no pierde el histórico.
--
-- Sin `cascade` a propósito: si algún día cuelga algo de estas tablas,
-- preferimos que el DROP falle y se mire, a que se lleve por delante lo que
-- hubiera colgando sin decir nada.
-- ─────────────────────────────────────────────────────────────────────────

drop table if exists ia_resumen_en_curso;
drop table if exists ia_resumen_vehiculo;
drop table if exists ia_limites;
drop table if exists ia_uso;
