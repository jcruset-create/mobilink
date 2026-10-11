#!/usr/bin/env bash
# Caso de validación con OR (partes de trabajo) parciales.
#
# El vehículo 4452MSG tiene cinco OR aportadas por el cliente. Las OR traen la
# POSICIÓN de cada operación; el Excel no. Este guion:
#   1. crea el vehículo con el plano que enseñan las OR (2 + 4 gemelas + 2),
#   2. importa sus albaranes del Excel conciliado,
#   3. enseña qué dedujo la importación sola,
#   4. aplica la evidencia de las OR como posición INDICADA,
#   5. enseña qué cambia.
#
# Las OR no se leen automáticamente: esto es un caso de validación y la
# evidencia se aplica a mano, igual que haría una persona en la bandeja.
#   bash scripts/importacion-historico/caso-4452msg.sh <lotes.json> [base]
set -u
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
LOTES="${1:?ruta al JSON de lotes (de conciliar-excel.mts)}"; DB="${2:-esquema_completo}"; comprobar_base "$DB"
case "$DB" in esquema_completo*) export PGOPTIONS='-c request.jwt.claims={"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';; esac
cd "$RAIZ"
E=00000000-0000-0000-0000-0000000000e1
TIPO=00000000-0000-0000-0000-0000000000f1
VEH=00000000-0000-0000-0000-0000000000f2

# 1. El plano que enseñan las OR: eje 1 con 2, eje 2 con 4 gemelas, eje 3 con 2.
#    Los números de la OR (1,2 / 3,4,5,6 / 7,10) se mapean a los códigos.
PSQL -d "$DB" -q <<SQL
insert into tc_tipos_vehiculo (id, nombre, numero_ejes, numero_ruedas, configuracion_ejes)
  values ('$TIPO','camion_3ejes_or_pruebas', 3, 8, '2x4x2') on conflict (id) do nothing;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual) values
  ('$TIPO','E1_IZQ',1,'izq',null,1), ('$TIPO','E1_DER',1,'der',null,2),
  ('$TIPO','E2_IZQ_EXT',2,'izq','ext',3), ('$TIPO','E2_IZQ_INT',2,'izq','int',4),
  ('$TIPO','E2_DER_INT',2,'der','int',5), ('$TIPO','E2_DER_EXT',2,'der','ext',6),
  ('$TIPO','E3_IZQ',3,'izq',null,7), ('$TIPO','E3_DER',3,'der',null,8)
  on conflict do nothing;
insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
  values ('$VEH','$E','$TIPO','4452MSG', 999999)
  on conflict (empresa_id, matricula) do update set tipo_vehiculo_id = excluded.tipo_vehiculo_id;
SQL
# Si el vehículo ya existía, conserva su id: se resuelve por matrícula.
VEH=$(PSQL -d "$DB" -qAt -c "select id from tc_vehiculos where empresa_id='$E' and matricula='4452MSG'")
echo "vehículo 4452MSG: $VEH (plano de 3 ejes según las OR)"

# 2. Importar SOLO los albaranes de este vehículo, por meses, en orden.
LOTES_VEH=$(node -e '
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const out=[];for(const l of d.lotes){const a=l.albaranes.filter(x=>x.matricula==="4452MSG");if(a.length)out.push({...l,albaranes:a});}
out.sort((x,y)=>x.periodo<y.periodo?-1:1);console.log(JSON.stringify(out));' "$LOTES")
echo "$LOTES_VEH" | node -e '
let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{for(const l of JSON.parse(s))console.log(l.periodo, l.albaranes.map(a=>a.documento+" "+a.fecha+" km"+a.km).join(" | "));});'
TMP=$(mktemp -d); CARGA=""
N=$(echo "$LOTES_VEH" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).length));')
for i in $(seq 0 $((N-1))); do
  echo "$LOTES_VEH" | node -e 'let s="";const i=+process.argv[1];process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(s)[i])));' "$i" > "$TMP/l.json"
  if [ -z "$CARGA" ]; then EXTRA=""; else EXTRA=", 'carga_id', '$CARGA'"; fi
  printf "\\set l \`cat %s\`\nselect (r->>'carga_id')||'|'||(r->>'creadas') from (select tc_importar_historico('%s','genes', (:'l'::jsonb) || jsonb_build_object('fichero','plana.xlsx'%s), false) r) x;\n" "$TMP/l.json" "$E" "$EXTRA" > "$TMP/i.sql"
  OUT=$(PSQL -d "$DB" -qAt -f "$TMP/i.sql" | tail -1)
  CARGA=$(echo "$OUT" | cut -d'|' -f1)
  echo "   importadas: $(echo "$OUT" | cut -d'|' -f2)"
done
rm -rf "$TMP"

echo
echo "── 3. Lo que dedujo la importación sola (sin OR) ──────────────────────"
PSQL -d "$DB" -qA -F' | ' <<SQL
select i.origen_doc, i.fecha, o.tipo_operacion, coalesce(o.condicion,'—') cond,
       coalesce(p.codigo_posicion,'—') pos, o.posicion_fuente
  from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
  left join tc_posiciones_vehiculo p on p.id=coalesce(o.posicion_destino_id,o.posicion_origen_id)
 where o.vehiculo_id='$VEH' and o.importacion_lote_id is not null
 order by i.fecha, o.tipo_operacion desc, o.origen_linea;
select estado, count(*) from tc_reconstruccion_montajes where vehiculo_id='$VEH' group by 1 order by 1;
SQL

echo
echo "── 4. Se aplica la evidencia de las OR ────────────────────────────────"
# OR B2_26/1736 (25/04) y B2_26/3121 (27/07): las USADAS van a 7 y 10.
# OR B2_26/4167 (01/10): la USADA va a 7.
PSQL -d "$DB" -q <<SQL
with usadas as (
  select o.id, i.origen_doc,
         row_number() over (partition by o.intervencion_id order by o.origen_linea) n
    from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
   where o.vehiculo_id='$VEH' and o.importacion_lote_id is not null
     and o.tipo_operacion='montaje' and o.condicion='usada'
),
destino as (
  select u.id, (select pv.id from tc_posiciones_vehiculo pv
                 where pv.tipo_vehiculo_id='$TIPO'
                   and pv.codigo_posicion = case when u.n = 1 then 'E3_IZQ' else 'E3_DER' end) pos
    from usadas u
)
update operaciones_neumaticos o set posicion_destino_id = d.pos, posicion_fuente = 'indicada', updated_at = now()
  from destino d where o.id = d.id;
-- La salida hereda la posición de su entrada.
update operaciones_neumaticos s set posicion_origen_id = e.posicion_destino_id, posicion_fuente = 'indicada', updated_at = now()
  from operaciones_neumaticos e
 where s.grupo_sustitucion = e.grupo_sustitucion and s.tipo_operacion='desmontaje' and e.tipo_operacion='montaje'
   and e.vehiculo_id='$VEH' and e.posicion_fuente='indicada';
select tc_imp_reconstruir_vehiculo('$VEH');
SQL
PSQL -d "$DB" -qA -F' | ' <<SQL
select coalesce(p.codigo_posicion,'—') pos, r.fecha_montaje, r.km_montaje, r.estado,
       coalesce(r.fecha_desmontaje::text,'—') salida, coalesce(r.km_desmontaje::text,'—') km_salida,
       r.posicion_fuente, coalesce(r.continuidad_desde::text,'—') continuidad_desde
  from tc_reconstruccion_montajes r left join tc_posiciones_vehiculo p on p.id=r.posicion_id
 where r.vehiculo_id='$VEH' order by r.fecha_montaje, p.orden_visual;
select estado, count(*) from tc_reconstruccion_montajes where vehiculo_id='$VEH' group by 1 order by 1;
SQL
