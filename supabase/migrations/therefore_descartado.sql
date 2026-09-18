-- Therefore · descartar un expediente
--
-- «Esto no era una tarea»: un correo que no iba a ninguna parte, una prueba,
-- un expediente abierto por error. Sale de la bandeja y se queda en la base,
-- porque el correo que lo abrió y su histórico siguen siendo la respuesta a
-- «¿y esto qué fue?» meses después.
--
-- Espejo de lo que hace `initTherefore()` al arrancar el servidor. Ejecutarlo
-- a mano no hace falta si el servidor ha arrancado; está para poder mirar en
-- SQL qué cambió y cuándo.

alter table thf_expedientes drop constraint if exists thf_expedientes_estado_check;
alter table thf_expedientes add constraint thf_expedientes_estado_check
  check (estado in ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO','RESUELTO','CERRADO','DESCARTADO'));

do $$
begin
  raise notice 'OK: Therefore · estado DESCARTADO';
end $$;
