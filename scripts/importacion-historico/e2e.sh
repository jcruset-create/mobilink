#!/usr/bin/env bash
# Prueba pequeña de extremo a extremo: importar los lotes del JSON en una base de
# pruebas, comprobar, recargar, cambiar, deshacer. Compara la fotografía de lo que
# NO debe cambiar antes y después.
#   bash scripts/importacion-historico/e2e.sh <lotes.json> [base]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
# En el esquema completo el usuario sale del JWT, como en producción: se inyecta el claim `sub` del admin de pruebas.
case "${2:-${1:-banco_imp}}" in esquema_completo*) export PGOPTIONS='-c request.jwt.claims={"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';; esac
LOTES="${1:?ruta al JSON de lotes (de conciliar-excel.mts)}"; BASE="${2:-banco_e2e}"; comprobar_base "$BASE"
cd "$RAIZ"
if [ "$BASE" = "banco_e2e" ]; then
  recrear_base "$BASE"
  PSQL -d "$BASE" -q -f supabase/pruebas/importacion_historico.sql > /dev/null 2>&1 || true
  PSQL -d "$BASE" -q <<'SQL'
delete from tc_importacion_lineas; delete from tc_importacion_intervenciones; delete from tc_operacion_adjuntos; delete from operaciones_neumaticos; delete from tc_intervencion_servicios; delete from tc_intervenciones; delete from tc_importacion_lotes; delete from tc_importacion_cargas; delete from tc_vehiculos; delete from tc_montajes_actuales;
update auth_ctx set rol='admin', empresa='00000000-0000-0000-0000-0000000000e1';
insert into tc_cat_servicios (codigo, nombre) values ('pinchazo','Pinchazo'),('rayados','Rayados'),('alineacion_standard','Alineación'),('salida_servicio_movil','Salida'),('horas_oficial_1a','Horas'),('km_recorridos','Km'),('alargaderas','Alargaderas') on conflict do nothing;
SQL
fi
# Vehículos de la prueba (tipo autocar 2x4 del banco) y un montaje/revisión reales en 7724KBM para la fotografía.
for m in $(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).matriculas.join(' '))" "$LOTES"); do
  PSQL -d "$BASE" -qc "insert into tc_vehiculos (empresa_id, tipo_vehiculo_id, matricula, km_actual) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','$m', 999999) on conflict do nothing"
done
# Un neumático, un montaje actual y una revisión REALES en 7724KBM (con las columnas
# obligatorias del esquema completo): la importación no debe tocarlos.
PSQL -d "$BASE" -q <<'SQL'
insert into tc_neumaticos (id, empresa_id, numero_interno, medida) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e1','NT-PRUEBA-000001','315/80R22.5') on conflict do nothing;
insert into tc_montajes_actuales (empresa_id, vehiculo_id, posicion_id, neumatico_id) select v.empresa_id, v.id, p.id, '00000000-0000-0000-0000-000000000002' from tc_vehiculos v join tc_posiciones_vehiculo p on p.tipo_vehiculo_id=v.tipo_vehiculo_id and p.codigo_posicion='E1_IZQ' where v.matricula='7724KBM' and not exists (select 1 from tc_montajes_actuales m where m.vehiculo_id=v.id);
insert into revisiones_vehiculo (empresa_id, vehiculo_id, fecha_revision) select empresa_id, id, '2026-10-01' from tc_vehiculos where matricula='7724KBM';
drop table if exists _foto; create table _foto as select foto() as antes;
SQL
PSQL -d "$BASE" -v lotes_json="$(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).lotes))" "$LOTES")" -f "$RAIZ/scripts/importacion-historico/e2e.sql"
