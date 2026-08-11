-- ============================================================
-- Mobilink TyreControl — Vehículos con el tipo equivocado
--
-- Al importar el informe del CheckPoint salieron 44 avisos de "su tipo no
-- tiene la posición E2_IZQ" (o E2_IZQ_EXT). No era un fallo del importador:
-- son vehículos cuyo TIPO en TyreControl no cuadra con las ruedas que el arco
-- les midió, en los dos sentidos.
--
--   · Tipados como autobús de 6 ruedas y el arco solo les ve 4 (turismos).
--   · Tipados con 4 y el arco les ve 6, con el eje trasero gemelo.
--
-- Mientras el tipo esté mal, sus mediciones no se pueden cargar: el
-- importador no sabe dónde poner una rueda que su tipo no tiene, y hace bien
-- en no inventárselo.
--
-- LA REFERENCIA ES EL ARCO. Aquí abajo van los 445 vehículos con las ruedas
-- que les midió de verdad, eje por eje. Solo se han incluido los que midió
-- completos: si una pasada se quedó a medias (le faltan ejes o empieza por el
-- 2), no dice nada de cómo es el vehículo y se queda fuera.
--
-- QUÉ HACE con cada uno que no cuadre: lo mueve al tipo que sí case con esas
-- ruedas y se lleva su historial —montajes, mediciones, incidencias,
-- reservas, operaciones y movimientos— a la posición equivalente.
--
-- La equivalencia va por ORDEN de posición: la 3ª del tipo viejo a la 3ª del
-- nuevo. Es lo que corresponde a cómo se cargó ese historial, porque el Excel
-- de revisiones traía las ruedas numeradas y el importador las colocaba por
-- ese orden. Para un turismo tipado como autobús, su "posición 3" quería
-- decir la trasera izquierda y acabó en el eje 2 exterior izquierdo: al
-- moverlo, vuelve a su sitio.
--
-- QUÉ **NO** HACE: si un vehículo tiene datos en una posición que en el tipo
-- nuevo no existe (la 5ª y la 6ª de un turismo de 4 ruedas), NO se mueve. Eso
-- significaría tirar mediciones, y contradice la propia configuración que
-- dice el arco. Se listan al final para mirarlos a mano.
--
-- Idempotente: al segundo pase ya cuadran y no hace nada.
-- ============================================================

-- Sin "on commit drop": el editor de Supabase y psql no ejecutan todo en la
-- misma transacción, y la tabla se evaporaría antes de usarla. Se limpia al
-- cerrar la sesión, que es lo que hace una tabla temporal.
drop table if exists tmp_cfg_arco;
create temporary table tmp_cfg_arco (matricula text primary key, config text);
insert into tmp_cfg_arco (matricula, config) values
('0008JDJ','2x4'),
('0024GVF','2x4'),
('0033HCS','2x4'),
('0039LXV','2x4x2'),
('0057GLZ','2x4'),
('0061HCS','2x4'),
('0101GLT','2x4'),
('0157LXF','2x4x2'),
('0164HGG','2x4'),
('0179JDJ','2x4'),
('0257HCS','2x4'),
('0293HCS','2x4'),
('0299GDK','2x4'),
('0322JDJ','2x4'),
('0373HCS','2x4'),
('0468KSC','2x4x2'),
('0548JDT','2x4'),
('0570FSW','2x4'),
('0580HBK','2x4'),
('0581JVL','2x4x2'),
('0591JGV','2x4'),
('0659GWZ','2x4'),
('0690GDK','2x4'),
('0727GCZ','2x4'),
('0760HVG','2x2'),
('0765LCN','2x4'),
('0767GWZ','2x4'),
('0781GXK','2x4'),
('0829GDK','2x4'),
('0830LWM','2x4x2'),
('0838GWZ','2x4'),
('0868MNM','2x4'),
('0919GBY','2x4'),
('0923HZG','2x4'),
('0934GWZ','2x4'),
('0942GWZ','2x4'),
('0950GXK','2x4'),
('0982GCM','2x4'),
('0995HBR','2x4'),
('1002HBR','2x4'),
('1016HBR','2x4'),
('1022GWW','2x4'),
('1045JMK','2x4x2'),
('1062HWZ','2x4'),
('1080HMN','2x4'),
('1083JJH','2x4'),
('1091JJH','2x4'),
('1098JJH','2x4'),
('1105JJH','2x4'),
('1115MNL','2x4'),
('1123MGT','2x4x2'),
('1127HMN','2x4'),
('1133HSV','2x2'),
('1170HBS','2x4'),
('1178JYJ','2x2'),
('1188HNM','2x4'),
('1189GBJ','2x4'),
('1224GCM','2x4'),
('1252MGT','2x4x2'),
('1289HWZ','2x4'),
('1312JJC','2x4'),
('1313HCJ','2x4'),
('1314JDJ','2x4'),
('1350GPW','2x4'),
('1362JFG','2x2'),
('1424JDD','2x4'),
('1445GPS','2x4x2'),
('1445HWZ','2x4'),
('1467HJS','2x4'),
('1476GPS','2x4x2'),
('1478HJS','2x4'),
('1481JJC','2x4'),
('1492HPW','2x4'),
('1494HJS','2x4'),
('1508HJS','2x4'),
('1511JRM','2x4'),
('1517HJS','2x4'),
('1524LXV','2x4x2'),
('1571HPW','2x4'),
('1586GPS','2x4x2'),
('1606GPS','2x4x2'),
('1614GPS','2x4x2'),
('1620HBM','2x4'),
('1623HPW','2x4'),
('1653GPS','2x4x2'),
('1663JRM','2x4'),
('1678GCM','2x4'),
('1772MNN','2x4'),
('1774JRM','2x4'),
('1878HZN','2x4'),
('1880HZN','2x4'),
('2021KJC','2x4'),
('2055JFC','2x4'),
('2129JRM','2x4'),
('2151MDM','2x4'),
('2153HNJ','2x4'),
('2206JDD','2x4'),
('2286JDD','2x4'),
('2289HZN','2x4'),
('2302HVH','2x4'),
('2313JYP','2x4'),
('2339JPW','2x4'),
('2343JDD','2x4'),
('2351HBB','2x4'),
('2424HVB','2x4'),
('2438KKG','2x4'),
('2466KKG','2x4'),
('2470JBR','2x4x2'),
('2565JRM','2x4'),
('2579HCZ','2x4'),
('2588HCZ','2x4'),
('2594JYG','2x4x2'),
('2596HCZ','2x4'),
('2599HCZ','2x4'),
('2601HCZ','2x4'),
('2651JRM','2x4'),
('2667JBR','2x4x2'),
('2795JYP','2x4'),
('2804JDJ','2x4'),
('2818HGJ','2x4'),
('2836GPT','2x4'),
('2855HMF','2x4x2'),
('2857HYF','2x4'),
('2868JHV','2x4'),
('2886JYP','2x4'),
('2919JRM','2x4'),
('2980GJX','2x4'),
('3040KKK','2x4'),
('3099JRM','2x4'),
('3147JRM','2x4'),
('3170HDZ','2x4'),
('3184JRW','2x4x2'),
('3198JRM','2x4'),
('3215KWV','2x2'),
('3221KVL','2x4x2'),
('3224GZK','2x4'),
('3224HDZ','2x4'),
('3294KKK','2x4'),
('3308GLJ','2x4'),
('3335GLJ','2x4'),
('3358GLJ','2x4'),
('3406LXW','2x2'),
('3417MSK','2x4'),
('3439LYM','2x4x2'),
('3452GYH','2x2'),
('3487JMT','2x4x2'),
('3499JDJ','2x4'),
('3515JDJ','2x4'),
('3517GDJ','2x4'),
('3522JRM','2x4'),
('3526GDJ','2x4'),
('3533GDJ','2x4'),
('3540GDJ','2x4'),
('3548GDJ','2x4'),
('3555GDJ','2x4'),
('3577JRM','2x4'),
('3606GJN','2x4'),
('3610JRM','2x4'),
('3639GWM','2x4'),
('3643HCV','2x4'),
('3689JLJ','2x4'),
('3690KPM','2x4x2'),
('3705FXS','2x4'),
('3713GZB','2x4'),
('3747HPG','2x4x2'),
('3747JYF','2x4'),
('3775JNX','2x4'),
('3776HTJ','2x4'),
('3818JNX','2x4'),
('3834HTJ','2x4'),
('3876GTM','2x4'),
('3896JNX','2x4'),
('3908HWM','2x4'),
('3912GNZ','2x4x2'),
('3983HTJ','2x4'),
('3984GWV','2x4'),
('3990HBP','2x4'),
('3991HBP','2x4'),
('4008GWS','2x4'),
('4024MHV','2x4'),
('4032JMT','2x4x2'),
('4260HBX','2x4'),
('4286HGJ','2x4'),
('4287GZD','2x4'),
('4292GZD','2x4'),
('4300GZD','2x4'),
('4304GZD','2x4'),
('4310JYJ','2x4'),
('4316JYJ','2x4'),
('4318JYJ','2x4'),
('4321JYJ','2x4'),
('4325JYJ','2x4'),
('4327JYJ','2x4'),
('4327MNV','2x4'),
('4328GJK','2x4'),
('4328JYJ','2x4'),
('4329JYJ','2x4'),
('4331GJK','2x4'),
('4346JYJ','2x4'),
('4347JYJ','2x4'),
('4447KKS','2x4x2'),
('4452MSG','2x4'),
('4468GJK','2x4'),
('4471KKS','2x4x2'),
('4477MGP','2x4'),
('4481HBH','2x4'),
('4485HBH','2x4'),
('4496GLD','2x4'),
('4500GLD','2x4'),
('4504GLD','2x4'),
('4507HDK','2x4'),
('4507KKS','2x4x2'),
('4509GLD','2x4'),
('4512JJM','2x4'),
('4525HDK','2x4'),
('4537HDK','2x4'),
('4550HDK','2x4'),
('4568JXB','2x2'),
('4583HDK','2x4'),
('4587HCW','2x4'),
('4600HDK','2x4'),
('4637HCW','2x4'),
('4640HDK','2x4'),
('4685MGP','2x4'),
('4730HCW','2x4'),
('4791HRC','2x4'),
('4794HRC','2x4'),
('4818HRC','2x4'),
('4917LJR','2x4'),
('4923JXX','2x4x2'),
('5015HKC','2x4'),
('5031HKC','2x4'),
('5038JXX','2x4'),
('5053HKC','2x4'),
('5065JXX','2x4'),
('5066HKC','2x4'),
('5099JXX','2x4x2'),
('5101JXX','2x4'),
('5177GHJ','2x4'),
('5192GTN','2x4x2'),
('5200LTC','2x2'),
('5206KKB','2x4'),
('5213KKB','2x4'),
('5222MHB','2x4'),
('5239KVW','2x4'),
('5262HRC','2x4'),
('5266JRT','2x4'),
('5270HRC','2x4'),
('5276KKB','2x4'),
('5307HRC','2x4'),
('5311HRC','2x4'),
('5348HRC','2x4'),
('5358LRF','2x4'),
('5378HRC','2x4'),
('5396GWF','2x4'),
('5399GWF','2x4'),
('5430GVY','2x4'),
('5471LRF','2x4'),
('5475GVY','2x4'),
('5486HFG','2x4'),
('5518HFG','2x4'),
('5546LMK','2x4'),
('5569GVY','2x4'),
('5621LRF','2x4'),
('5634HFG','2x4'),
('5659HTY','2x2'),
('5668HHC','2x4'),
('5718MNL','2x4'),
('5722LRF','2x4'),
('5733GXJ','2x4'),
('5739HHC','2x4'),
('5741HLN','2x4'),
('5747JXX','2x4'),
('5765JXX','2x4'),
('5819GXJ','2x4'),
('5838HDP','2x4'),
('5853LRF','2x4'),
('5855LVD','2x2'),
('5924KWR','2x4x2'),
('5942HDD','2x4'),
('5965HDD','2x4'),
('5969HDD','2x4'),
('6015HDP','2x4'),
('6016HPS','2x4'),
('6048MGP','2x4'),
('6078HDP','2x4'),
('6079JCK','2x4x2'),
('6087KYT','2x2'),
('6092HKW','2x4x2'),
('6096GZR','2x4'),
('6152HKW','2x4x2'),
('6205HKW','2x4x2'),
('6261LFN','2x4x2'),
('6302LRF','2x4'),
('6303LFN','2x4x2'),
('6325KVJ','2x2'),
('6439LJS','2x4'),
('6452LJS','2x4'),
('6473JXX','2x4'),
('6478GSJ','2x4'),
('6495HTN','2x4'),
('6501GSJ','2x4'),
('6517GSJ','2x4'),
('6517MGP','2x4'),
('6530GHN','2x4'),
('6532FRM','2x4'),
('6549HNY','2x4'),
('6549JYV','2x4'),
('6566GXF','2x4'),
('6673HPZ','2x4'),
('6693KFD','2x2'),
('6735KVK','2x4'),
('6745JYD','2x4x2'),
('6818MGP','2x4'),
('6891KVK','2x4'),
('6915JYD','2x4'),
('6975GVM','2x4'),
('7009LZB','2x4x2'),
('7015KVK','2x4'),
('7036GZJ','2x4'),
('7044LZB','2x4x2'),
('7051GZJ','2x4'),
('7081KVK','2x4'),
('7102GBL','2x4'),
('7107JLG','2x4'),
('7112KHV','2x4x2'),
('7229LTB','2x2'),
('7356HDL','2x4'),
('7399GPJ','2x4'),
('7408GPJ','2x4'),
('7436KVK','2x4x2'),
('7518MGP','2x4'),
('7525HJT','2x4'),
('7535JSJ','2x4'),
('7555JNT','2x4'),
('7640JNT','2x4'),
('7644JXK','2x2'),
('7676JNT','2x4'),
('7694HCH','2x4'),
('7709JNT','2x4'),
('7719HCH','2x4'),
('7724KBM','2x4x2'),
('7742HCH','2x4'),
('7754MGP','2x4'),
('7757HCH','2x4'),
('7774HCH','2x4'),
('7779HCH','2x4'),
('7794HCH','2x4'),
('7818HCH','2x4'),
('7836MGP','2x4'),
('7851JNT','2x4'),
('7871FYD','2x4'),
('7880JDF','2x4'),
('7880LDY','2x4'),
('7915JNT','2x4'),
('7934JDF','2x4'),
('7934JNT','2x4'),
('7954GXZ','2x4'),
('7955JFB','2x4'),
('7969HCH','2x4'),
('7990KBM','2x4x2'),
('8000JNT','2x4'),
('8089GZJ','2x4'),
('8201GXR','2x4'),
('8235JDF','2x4'),
('8264JZT','2x2'),
('8310HJF','2x4'),
('8317JVM','2x4'),
('8318JVM','2x4'),
('8356KBD','2x4x2'),
('8367HHL','2x4'),
('8389HMG','2x4x2'),
('8397HMG','2x4x2'),
('8401GZF','2x4'),
('8409GZF','2x4'),
('8419GZF','2x4'),
('8463HMK','2x4'),
('8509KJB','2x4'),
('8516GWN','2x4'),
('8526HHL','2x4'),
('8575KWW','2x4'),
('8612HHL','2x4'),
('8619GBJ','2x4'),
('8652GXR','2x4'),
('8654KBD','2x4x2'),
('8662GXR','2x4'),
('8679JHT','2x4'),
('8684KWW','2x4'),
('8690GHK','2x4'),
('8693HDC','2x4'),
('8718GHK','2x4'),
('8767LSY','2x4x2'),
('8828LVM','2x2'),
('8838HHL','2x4'),
('8842GBJ','2x4'),
('8843KWW','2x4'),
('8867HVW','2x4'),
('8886HHL','2x4'),
('8907KBD','2x4x2'),
('8908GBJ','2x4'),
('8927GKJ','2x4'),
('8928KWW','2x4'),
('8931JPV','2x4x2'),
('8975KCY','2x4'),
('8976LWV','2x4x2'),
('8985JPV','2x4x2'),
('8987HRW','2x4x2'),
('8996HHL','2x4'),
('9018KWW','2x4'),
('9035LWV','2x4x2'),
('9075KCY','2x4'),
('9079JCB','2x4'),
('9083LXH','2x4x2'),
('9103KWW','2x4'),
('9177KWW','2x4'),
('9186HHL','2x4'),
('9203FLX','2x4'),
('9204HMM','2x4'),
('9219GSS','2x4'),
('9232HMK','2x4'),
('9281GNW','2x4'),
('9306HKG','2x4'),
('9359HKG','2x4'),
('9405GMH','2x4x4'),
('9446JMH','2x4'),
('9520FVR','2x4'),
('9582HBH','2x4'),
('9586HBH','2x4'),
('9641GGV','2x4'),
('9645GGV','2x4'),
('9645LJR','2x4'),
('9682GGV','2x4'),
('9689GGV','2x4'),
('9745FLX','2x4'),
('9762GWK','2x4x2'),
('9786HHR','2x4'),
('9832LXT','2x4x2'),
('9848HWY','2x4'),
('9853JDH','2x4'),
('9877LXT','2x4x2'),
('9878GLS','2x4'),
('9909GLS','2x4'),
('9911JDH','2x4'),
('9934LXT','2x4x2'),
('9967GCL','2x4');

-- ── La configuración que tiene hoy cada tipo, según sus posiciones ──────────
drop view if exists tmp_cfg_tipo;
create temporary view tmp_cfg_tipo as
select t.id, coalesce(t.descripcion, t.nombre) as nombre,
       (select string_agg(n::text, 'x' order by eje)
          from (select p.eje, count(*) as n
                  from tc_posiciones_vehiculo p
                 where p.tipo_vehiculo_id = t.id and p.activo
                 group by p.eje) e) as config,
       (select count(*) from tc_posiciones_vehiculo p
         where p.tipo_vehiculo_id = t.id and p.activo) as n_posiciones
  from tc_tipos_vehiculo t;

-- ── Mover los que no cuadran ────────────────────────────────────────────────
do $$
declare
  v record; m record;
  v_destino uuid; v_max_nuevo int; v_max_usado int;
  n_mov int := 0; n_saltados int := 0; pendientes text := '';
begin
  for v in
    select ve.id, ve.matricula, ve.tipo_vehiculo_id,
           c.config as debe_ser, tc.config as tiene, tc.nombre as tipo_actual
      from tc_vehiculos ve
      join tmp_cfg_arco c on upper(btrim(ve.matricula)) = c.matricula
      left join tmp_cfg_tipo tc on tc.id = ve.tipo_vehiculo_id
     where ve.activo
       and c.config is distinct from tc.config
     order by ve.matricula
  loop
    -- El tipo que case con esas ruedas. Si hay varios (autobús y camión 2
    -- ejes son los dos 2x4), gana el que ya use más gente: cambiar de tipo no
    -- debe cambiar de familia sin necesidad.
    select t.id into v_destino
      from tmp_cfg_tipo t
     where t.config = v.debe_ser
     order by (select count(*) from tc_vehiculos x where x.tipo_vehiculo_id = t.id) desc, t.nombre
     limit 1;

    if v_destino is null then
      n_saltados := n_saltados + 1;
      pendientes := pendientes || v.matricula || ' (necesita ' || v.debe_ser || ', no hay tipo)  ';
      continue;
    end if;

    select count(*) into v_max_nuevo from tc_posiciones_vehiculo
     where tipo_vehiculo_id = v_destino and activo;

    -- ¿Tiene datos en una posición que en el tipo nuevo no existe? Entonces
    -- moverlo tiraría mediciones: no se toca.
    select coalesce(max(orden), 0) into v_max_usado
      from (
        select row_number() over (order by p.orden_visual, p.codigo_posicion) as orden, p.id
          from tc_posiciones_vehiculo p
         where p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo
      ) o
     where exists (select 1 from revisiones_neumaticos_detalle d where d.posicion_id = o.id and d.vehiculo_id = v.id)
        or exists (select 1 from tc_montajes_actuales x where x.posicion_id = o.id and x.vehiculo_id = v.id);

    if v_max_usado > v_max_nuevo then
      n_saltados := n_saltados + 1;
      pendientes := pendientes || v.matricula || ' (' || coalesce(v.tiene,'sin tipo') || ' → ' || v.debe_ser
                 || ', tiene datos en la posición ' || v_max_usado || ')  ';
      continue;
    end if;

    -- Reapuntar el historial, la N del tipo viejo a la N del nuevo.
    for m in
      select vieja.id as de, nueva.id as a
        from (select p.id, row_number() over (order by p.orden_visual, p.codigo_posicion) as n
                from tc_posiciones_vehiculo p
               where p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo) vieja
        join (select p.id, row_number() over (order by p.orden_visual, p.codigo_posicion) as n
                from tc_posiciones_vehiculo p
               where p.tipo_vehiculo_id = v_destino and p.activo) nueva on nueva.n = vieja.n
    loop
      update tc_montajes_actuales          set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update tc_historial_montajes         set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update revisiones_neumaticos_detalle set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update tc_incidencias                set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update tc_reservas_neumatico         set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update operaciones_neumaticos        set posicion_origen_id  = m.a where vehiculo_id = v.id and posicion_origen_id  = m.de;
      update operaciones_neumaticos        set posicion_destino_id = m.a where vehiculo_id = v.id and posicion_destino_id = m.de;
      update tc_neumaticos n set posicion_id = m.a
       where n.posicion_id = m.de
         and exists (select 1 from tc_montajes_actuales x where x.neumatico_id = n.id and x.vehiculo_id = v.id);
      update tc_operacion_movimientos mv set origen_posicion_id = m.a
       where mv.origen_posicion_id = m.de
         and exists (select 1 from operaciones_neumaticos o where o.id = mv.operacion_id and o.vehiculo_id = v.id);
      update tc_operacion_movimientos mv set destino_posicion_id = m.a
       where mv.destino_posicion_id = m.de
         and exists (select 1 from operaciones_neumaticos o where o.id = mv.operacion_id and o.vehiculo_id = v.id);
    end loop;

    update tc_vehiculos set tipo_vehiculo_id = v_destino where id = v.id;
    n_mov := n_mov + 1;
    raise notice '% : % → % (%)', v.matricula, coalesce(v.tiene, 'sin tipo'), v.debe_ser,
      (select nombre from tmp_cfg_tipo where id = v_destino);
  end loop;

  raise notice 'Vehículos con el tipo corregido: %', n_mov;
  if n_saltados > 0 then
    raise warning '% vehículos NO se han movido, hay que mirarlos a mano: %', n_saltados, pendientes;
  end if;
end $$;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare n_mal int; sueltas int;
begin
  -- Lo que sigue sin cuadrar solo puede ser lo que se avisó arriba.
  select count(*) into n_mal
    from tc_vehiculos ve
    join tmp_cfg_arco c on upper(btrim(ve.matricula)) = c.matricula
    left join tmp_cfg_tipo tc on tc.id = ve.tipo_vehiculo_id
   where ve.activo and c.config is distinct from tc.config;

  -- Nada puede haberse quedado colgando de una posición de otro tipo.
  select count(*) into sueltas
    from revisiones_neumaticos_detalle d
    join tc_vehiculos ve on ve.id = d.vehiculo_id
    join tc_posiciones_vehiculo p on p.id = d.posicion_id
   where p.tipo_vehiculo_id is distinct from ve.tipo_vehiculo_id;
  if sueltas > 0 then
    raise exception '% mediciones apuntan a la posición de un tipo que no es el suyo', sueltas;
  end if;

  raise notice 'OK: tipos cuadrados con lo que mide el arco (quedan % por revisar a mano)', n_mal;
end $$;
