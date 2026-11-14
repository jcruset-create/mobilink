#!/usr/bin/env bash
# Pruebas de concurrencia con DOS sesiones psql reales contra una base de pruebas.
# Uso: bash scripts/importacion-historico/concurrencia.sh [base]  (la base debe venir del banco: tiene alb_n/lote/auth_ctx)
set -u
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
# En el esquema completo el usuario sale del JWT, como en producción: se inyecta el claim `sub` del admin de pruebas.
case "${2:-${1:-banco_imp}}" in esquema_completo*) export PGOPTIONS='-c request.jwt.claims={"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';; esac
DB="${1:-banco_imp}"; comprobar_base "$DB"
P="psql -h $PGHOST -p $PGPORT -U $PGUSER -d $DB -v ON_ERROR_STOP=0 -qAt"
E='00000000-0000-0000-0000-0000000000e1'
# Un albarán fresco para estas pruebas.
LOTE="lote('2026-03', alb_n('B2_26/CC01','7724KBM',2,1), alb_n('B2_26/CC02','7724KBM',4,1))"
$P -c "delete from tc_reconstruccion_montajes; delete from tc_importacion_eventos; delete from tc_importacion_lineas; delete from tc_importacion_intervenciones; delete from tc_operacion_adjuntos; delete from operaciones_neumaticos where importacion_lote_id is not null; delete from tc_intervencion_servicios where importacion_lote_id is not null; delete from tc_intervenciones where importacion_lote_id is not null; delete from tc_neumaticos where importacion_lote_id is not null; delete from tc_importacion_lotes; delete from tc_importacion_cargas;" >/dev/null
$P -c "update auth_ctx set rol='admin', empresa='$E'" >/dev/null 2>&1 || true

echo "== 1. Dos importaciones del MISMO documento a la vez"
# Sesión A: dentro de una transacción, importa y se queda 3 s antes de commit. Sesión B: importa en paralelo.
( $P <<SQL
begin; select 'A:'||(tc_importar_historico('$E','genes',$LOTE,false)->>'creadas'); select pg_sleep(3); commit;
SQL
) & sleep 0.5
( $P -c "select 'B:'||(r->>'creadas')||'/'||(r->>'ya_presentes') from (select tc_importar_historico('$E','genes',$LOTE,false) r) x" ) &
wait
echo "  esperado: A crea 2, B (espera al bloqueo) 0 creadas / 2 ya presentes; sin duplicados"
$P -c "select '  intervenciones con esa identidad: '||count(*) from tc_intervenciones where origen_doc in ('B2_26/CC01|7724KBM','B2_26/CC02|7724KBM')"
LOTE_ID=$($P -c "select importacion_lote_id from tc_intervenciones where origen_doc='B2_26/CC01|7724KBM'")

echo "== 2. Importar (otro albarán) frente a deshacer, misma empresa y origen"
( $P <<SQL
begin; select 'deshacer:'||(tc_deshacer_importacion('$LOTE_ID','{}',false)->>'borradas'); select pg_sleep(3); commit;
SQL
) & sleep 0.5
( $P -c "select 'importar:'||(r->>'creadas') from (select tc_importar_historico('$E','genes',lote('2026-03', alb_n('B2_26/CC03','7724KBM',2,1)),false) r) x" ) &
wait
echo "  esperado: deshacer borra 2; importar espera y luego crea 1; nada huérfano"
$P -c "select '  quedan: interv='||(select count(*) from tc_intervenciones where importacion_lote_id is not null)||' ops huérfanas='||(select count(*) from operaciones_neumaticos where intervencion_id is null)"
LOTE3=$($P -c "select importacion_lote_id from tc_intervenciones where origen_doc='B2_26/CC03|7724KBM'")
OP3=$($P -c "select o.id from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/CC03|7724KBM' limit 1")

echo "== 3. Deshacer frente a ANULAR una operación (update concurrente)"
( $P <<SQL
begin; select 'deshacer-sim:'||(tc_deshacer_importacion('$LOTE3','{}',true)->>'borradas'); select pg_sleep(3); select 'deshacer-real:'||(tc_deshacer_importacion('$LOTE3','{}',false)->>'borradas'); commit;
SQL
) & sleep 0.5
( $P -c "select tc_anular_operacion('$OP3','prueba concurrente'); select 'anular: hecho'" 2>&1 | sed 's/^/  anular → /' | head -2 ) &
wait
echo "  esperado: la RPC espera (FOR UPDATE) al commit de deshacer y entonces falla con 'La operación ya no existe; no se ha realizado la anulación'; nunca 'anular: hecho'"
$P -c "select '  interv CC03 existe: '||(select count(*) from tc_intervenciones where origen_doc='B2_26/CC03|7724KBM')||' · ops: '||(select count(*) from operaciones_neumaticos where id='$OP3')||' · auditoría de anular sobre ella: '||(select count(*) from tc_operacion_auditoria where accion='anular' and operacion_id='$OP3')"

echo "== 4. Deshacer frente a modificar un SERVICIO"
$P -c "select tc_importar_historico('$E','genes',lote('2026-03', alb_n('B2_26/CC04','7724KBM',2,1) || jsonb_build_object('servicios', jsonb_build_array(jsonb_build_object('servicio','equilibrado','cantidad',2)))),false)->>'creadas'" >/dev/null
LOTE4=$($P -c "select importacion_lote_id from tc_intervenciones where origen_doc='B2_26/CC04|7724KBM'")
SRV4=$($P -c "select s.id from tc_intervencion_servicios s join tc_intervenciones i on i.id=s.intervencion_id where i.origen_doc='B2_26/CC04|7724KBM'")
( $P -c "begin; update tc_intervencion_servicios set cantidad=9 where id='$SRV4'; select pg_sleep(3); commit; select 'servicio modificado'" ) & sleep 0.5
( $P -c "select 'deshacer:'||(r->>'borradas')||'/'||(r->>'conservadas')||' '||coalesce((r->'detalle'->0->'motivos')::text,'') from (select tc_deshacer_importacion('$LOTE4','{}',false) r) x" ) &
wait
echo "  esperado: deshacer espera al commit del update y entonces CONSERVA (huella distinta); 0 borradas"

echo "== 5. Deshacer frente a añadir un ADJUNTO (insert con FK)"
$P -c "select tc_importar_historico('$E','genes',lote('2026-03', alb_n('B2_26/CC05','7724KBM',2,1)),false)->>'creadas'" >/dev/null
LOTE5=$($P -c "select importacion_lote_id from tc_intervenciones where origen_doc='B2_26/CC05|7724KBM'")
OP5=$($P -c "select o.id from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/CC05|7724KBM' limit 1")
( $P <<SQL
begin; select 'deshacer-sim:'||(tc_deshacer_importacion('$LOTE5','{}',true)->>'borradas'); select pg_sleep(3); select 'deshacer-real:'||(tc_deshacer_importacion('$LOTE5','{}',false)->>'borradas'); commit;
SQL
) & sleep 0.5
( $P -c "insert into tc_operacion_adjuntos (operacion_id, file_url) values ('$OP5','foto.jpg'); select 'adjunto: '||coalesce((select count(*)::text from tc_operacion_adjuntos where operacion_id='$OP5'),'0')" 2>&1 | head -2 ) &
wait
echo "  esperado: el insert espera (FOR KEY SHARE vs FOR UPDATE); al liberarse, la operación ya no existe → viola la FK (error) y no queda adjunto huérfano"
$P -c "select '  adjuntos huérfanos: '||count(*) from tc_operacion_adjuntos a left join operaciones_neumaticos o on o.id=a.operacion_id where o.id is null"
echo "== bloqueos que no se resuelven:"; $P -c "select count(*) from pg_locks where not granted"

echo "== 6. FASE 2: dos lotes del MISMO vehículo y posición a la vez (cadena)"
# A importa enero y B importa abril para el mismo eje: la cadena la rehace
# quien llegue segundo, y no puede quedar medio hecha.
LA="lote('2026-01', jsonb_build_object('origen_doc','B2_26/X1|7724KBM','documento','B2_26/X1','matricula','7724KBM','fecha','2026-01-10','km',100000,'huella_origen','hx1','operaciones',jsonb_build_array(jsonb_build_object('origen_linea','X1|u1','condicion','nueva','marca','Hankook','modelo','AH51','medida','295/80R22.5'),jsonb_build_object('origen_linea','X1|u2','condicion','nueva','marca','Hankook','modelo','AH51','medida','295/80R22.5')),'servicios','[]'::jsonb,'lineas','[]'::jsonb))"
LB="lote('2026-04', jsonb_build_object('origen_doc','B2_26/X2|7724KBM','documento','B2_26/X2','matricula','7724KBM','fecha','2026-04-10','km',150000,'huella_origen','hx2','operaciones',jsonb_build_array(jsonb_build_object('origen_linea','X2|u1','condicion','nueva','marca','Hankook','modelo','AH51','medida','295/80R22.5'),jsonb_build_object('origen_linea','X2|u2','condicion','nueva','marca','Hankook','modelo','AH51','medida','295/80R22.5')),'servicios','[]'::jsonb,'lineas','[]'::jsonb))"
( $P -c "select 'A:'||(tc_importar_historico('$E','genes',$LA,false)->>'creadas')" ) & sleep 0.3
( $P -c "select 'B:'||(tc_importar_historico('$E','genes',$LB,false)->>'creadas')" ) &
wait
echo "  esperado: las dos crean 1; la cadena queda coherente (2 cerrados o 2 abiertos, nunca a medias)"
$P -c "select '  intervalos: '||coalesce(string_agg(estado||'='||n, ' '),'ninguno') from (select estado, count(*) n from tc_reconstruccion_montajes group by 1) x"
$P -c "select '  fichas: '||count(*)||' · salidas: '||(select count(*) from operaciones_neumaticos where tipo_operacion='desmontaje' and importacion_lote_id is not null) from tc_neumaticos where importacion_lote_id is not null"
$P -c "select '  ninguna ficha duplicada por origen_linea: '||(count(*) = count(distinct origen_linea)) from tc_neumaticos where origen_linea is not null"

echo "== 7. FASE 2: identificar una unidad mientras se deshace su lote"
LOTE7=$($P -c "select importacion_lote_id from tc_intervenciones where origen_doc='B2_26/X2|7724KBM'")
OP7=$($P -c "select o.id from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/X2|7724KBM' and o.tipo_operacion='montaje' limit 1")
( $P <<SQL
begin; select 'deshacer:'||(tc_deshacer_importacion('$LOTE7','{}',false)->>'borradas'); select pg_sleep(3); commit;
SQL
) & sleep 0.5
( $P -c "select tc_imp_identificar_unidad('$OP7', null, true, 'prueba concurrente')" 2>&1 | sed 's/^/  identificar → /' | head -2 ) &
wait
echo "  esperado: identificar espera al deshacer y falla porque la operación ya no existe; nada a medias"
$P -c "select '  operación X2 existe: '||(select count(*) from operaciones_neumaticos where id='$OP7')||' · fichas huérfanas: '||(select count(*) from tc_neumaticos n where n.importacion_lote_id='$LOTE7')"
echo "== 8. FASE 3: revisar un intervalo mientras se rehace la cadena del vehículo"
# Una cadena limpia y cerrada para poder revisarla.
$P -c "select tc_importar_historico('$E','genes',lote('2026-02', alb_n('B2_26/Y1','9005KMR',2,1)),false)" >/dev/null
$P -c "update tc_intervenciones set fecha='2026-02-10', mecanico_km=100000 where origen_doc='B2_26/Y1|9005KMR'" >/dev/null
$P -c "update operaciones_neumaticos o set fecha_operacion='2026-02-10', km_vehiculo=100000 from tc_intervenciones i where i.id=o.intervencion_id and i.origen_doc='B2_26/Y1|9005KMR'" >/dev/null
$P -c "select tc_importar_historico('$E','genes',lote('2026-06', alb_n('B2_26/Y2','9005KMR',2,1)),false)" >/dev/null
$P -c "update tc_intervenciones set fecha='2026-06-10', mecanico_km=130000 where origen_doc='B2_26/Y2|9005KMR'" >/dev/null
$P -c "update operaciones_neumaticos o set fecha_operacion='2026-06-10', km_vehiculo=130000 from tc_intervenciones i where i.id=o.intervencion_id and i.origen_doc='B2_26/Y2|9005KMR'" >/dev/null
VEH8=$($P -c "select id from tc_vehiculos where matricula='9005KMR'")
$P -c "select tc_imp_reconstruir_vehiculo('$VEH8')" >/dev/null
IV8=$($P -c "select id from tc_reconstruccion_montajes where vehiculo_id='$VEH8' and estado='cerrado' limit 1")
if [ -n "$IV8" ]; then
  # Sesión A rehace la cadena entera y se queda dentro de la transacción;
  # sesión B intenta revisar ese mismo intervalo.
  ( $P <<SQL
begin; select 'reconstruir:'||tc_imp_reconstruir_vehiculo('$VEH8'); select pg_sleep(3); commit;
SQL
  ) & sleep 0.5
  ( $P -c "select 'revisar:'||(tc_imp_revisar_intervalo('$IV8','kilometros','aceptado','prueba concurrente')->>'uso_estadistico')" 2>&1 | sed 's/^/  /' | head -2 ) &
  wait
  echo "  esperado: revisar espera a la reconstrucción; o la decisión queda guardada o falla porque ese intervalo ya no existe, nunca a medias"
  $P -c "select '  decisiones vivas: '||(select count(*) from tc_reconstruccion_revisiones where invalidada_at is null and decision in ('aceptado','rechazado'))||' · intervalos con uso <> pendiente: '||(select count(*) from tc_reconstruccion_montajes where uso_estadistico <> 'pendiente')"
  $P -c "select '  ninguna decisión viva sin su intervalo con la misma huella: '||(select coalesce(bool_and(rm.revision_huella = rv.huella_evidencia), true) from tc_reconstruccion_revisiones rv join tc_reconstruccion_montajes rm on rm.operacion_entrada_id = rv.operacion_entrada_id where rv.invalidada_at is null and rv.decision in ('aceptado','rechazado'))"
else
  echo "  (sin intervalo cerrado que revisar en esta base)"
fi

echo "== 9. FASE 3: dos reconstrucciones del MISMO vehículo a la vez"
# Rehacer la cadena es borrar los intervalos del vehículo y volver a crearlos.
# Sin candado por vehículo, dos sesiones a la vez los duplican: el DELETE de la
# segunda no ve lo que acaba de insertar la primera.
if [ -n "${VEH8:-}" ]; then
  ANTES=$($P -c "select count(*) from tc_reconstruccion_montajes where vehiculo_id='$VEH8'")
  ( $P -c "select 'A:'||tc_imp_reconstruir_vehiculo('$VEH8')" ) & sleep 0.1
  ( $P -c "select 'B:'||tc_imp_reconstruir_vehiculo('$VEH8')" ) &
  wait
  DESPUES=$($P -c "select count(*) from tc_reconstruccion_montajes where vehiculo_id='$VEH8'")
  echo "  esperado: los mismos intervalos que antes, ni uno duplicado"
  echo "  intervalos antes=$ANTES después=$DESPUES"
  $P -c "select '  sin intervalos duplicados por operación de entrada: '||(count(*) = count(distinct operacion_entrada_id)) from tc_reconstruccion_montajes where vehiculo_id='$VEH8'"
else
  echo "  (sin vehículo de la prueba 8)"
fi

echo "== bloqueos que no se resuelven (fase 3):"; $P -c "select count(*) from pg_locks where not granted"
