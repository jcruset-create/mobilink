-- ════════════════════════════════════════════════════════════════════════════
-- Sacar del mantenimiento integral las matrículas que diga oficina
-- ════════════════════════════════════════════════════════════════════════════
--
-- Fase 3. Las tres anteriores dejaron la columna, el botón de la ficha y los
-- informes filtrando; aquí se marcan los vehículos de verdad.
--
-- ── Esto NO lo puede decidir una consulta ──────────────────────────────────
--
-- Estar o no en el mantenimiento integral es un hecho que vive en un contrato.
-- Un vehículo sin revisiones puede estar dentro y llevar dos meses sin pasar,
-- y uno con revisiones viejas puede haber salido el mes pasado. Lo más que se
-- puede hacer desde aquí es sacar la lista de CANDIDATOS y que alguien diga
-- cuáles. La primera consulta es eso.
--
-- ── Por qué escribe las columnas y no llama a la RPC ───────────────────────
--
-- `tc_vehiculo_seguimiento` comprueba que quien llama es administrador con
-- `auth.uid()`, y en el editor de SQL no hay sesión: la llamada se rechazaría.
-- Para una carga de una vez se escriben las columnas, que es lo que hace
-- cualquier script de producción. Desde el panel, y para cambiar uno suelto,
-- SIEMPRE la RPC: ahí el motivo es obligatorio de verdad.
--
-- Es idempotente: volver a pasarlo no cambia nada.

-- ── 1 · Los candidatos, para que oficina diga cuáles ────────────────────────
--
-- Activos, con seguimiento, y sin un solo montaje ni una sola revisión. No son
-- necesariamente todos los que hay que marcar —puede haber uno con gomas que
-- tampoco esté en el contrato— ni hay que marcarlos todos.
select v.matricula, v.numero_unidad, coalesce(t.nombre, '(sin tipo)') as tipo,
       v.marca, v.modelo, v.creado_desde, v.origen_km,
       to_char(v.created_at, 'YYYY-MM-DD') as dado_de_alta
  from tc_vehiculos v
  left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
 where v.empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
   and v.activo
   and v.en_seguimiento
   and not exists (select 1 from tc_montajes_actuales m where m.vehiculo_id = v.id)
   and not exists (select 1 from revisiones_vehiculo r where r.vehiculo_id = v.id)
 order by t.nombre nulls first, v.matricula;

-- ── 2 · Marcarlas ───────────────────────────────────────────────────────────
--
-- Se pone la lista de matrículas que haya dicho oficina y el motivo. El motivo
-- va aquí y no se deja en blanco por lo mismo que lo exige la RPC: un vehículo
-- que deja de contar sin que nadie sepa por qué es justo lo que no queremos.
--
-- ⚠️ SUSTITUIR la lista y el motivo antes de ejecutar.
with lista(matricula) as (
  values ('0000XXX'), ('0000YYY')          -- ← las matrículas de verdad
),
motivo as (select 'Fuera del contrato de mantenimiento integral'::text as texto)
update tc_vehiculos v
   set en_seguimiento          = false,
       seguimiento_motivo      = (select texto from motivo),
       seguimiento_cambiado_en = now(),
       updated_at              = now()
  from lista l
 where v.empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
   and upper(replace(v.matricula, ' ', '')) = upper(replace(l.matricula, ' ', ''))
   and v.en_seguimiento;   -- idempotente: lo ya marcado no se vuelve a tocar

-- ── 3 · Comprobar ───────────────────────────────────────────────────────────
select count(*) filter (where v.en_seguimiento)       as con_seguimiento,
       count(*) filter (where not v.en_seguimiento)   as sin_seguimiento,
       count(*) filter (where not v.en_seguimiento
                          and coalesce(btrim(v.seguimiento_motivo), '') = '') as sin_motivo  -- 0
  from tc_vehiculos v
 where v.empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb' and v.activo;

-- Y las que se pidieron y NO se han marcado: una matrícula mal escrita no
-- puede pasar desapercibida.
-- (Repetir aquí la misma lista del paso 2.)
with lista(matricula) as (
  values ('0000XXX'), ('0000YYY')
)
select l.matricula as no_encontrada
  from lista l
 where not exists (
   select 1 from tc_vehiculos v
    where v.empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
      and upper(replace(v.matricula, ' ', '')) = upper(replace(l.matricula, ' ', ''))
 );
