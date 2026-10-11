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
$P -c "delete from tc_importacion_lineas; delete from tc_importacion_intervenciones; delete from tc_operacion_adjuntos; delete from operaciones_neumaticos where importacion_lote_id is not null; delete from tc_intervencion_servicios where importacion_lote_id is not null; delete from tc_intervenciones where importacion_lote_id is not null; delete from tc_importacion_lotes; delete from tc_importacion_cargas;" >/dev/null
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
