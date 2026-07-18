-- ============================================================
-- SEA TyreControl — Catálogo configurable de tipos de incidencia
--
-- Hasta ahora los "tipos de problema" de una incidencia
-- (profundidad_baja, pinchazo, dano_flanco…) estaban fijos en tres
-- sitios que debían coincidir: la web (PROBLEMA_LABELS), la APK
-- (kProblemasTipos) y el CHECK de tc_incidencia_problemas.tipo.
--
-- Esta migración los convierte en un catálogo editable desde el panel
-- de administración. La web y la APK leen los tipos desde esta tabla.
-- ============================================================

-- ── tc_cat_tipos_incidencia ──────────────────────────────────
create table if not exists tc_cat_tipos_incidencia (
  id                 uuid primary key default gen_random_uuid(),
  clave              text not null unique,          -- slug estable (no cambia); lo que se guarda en tc_incidencia_problemas.tipo
  etiqueta           text not null,                 -- texto visible
  icono              text,                           -- nombre de icono (mapeado en web y APK; fallback si desconocido)
  gravedad_sugerida  text not null default 'leve'
    check (gravedad_sugerida = any (array['leve','importante','critica'])),
  operacion_sugerida text,                           -- key de operación propuesta al resolver (opcional)
  orden              integer not null default 0,
  activo             boolean not null default true,
  es_sistema         boolean not null default false, -- de fábrica: no se puede borrar (sí desactivar/editar etiqueta)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_tc_cat_tipos_incidencia_activo on tc_cat_tipos_incidencia (activo, orden);

-- ── updated_at automático ────────────────────────────────────
create or replace function tc_cat_tipos_incidencia_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_tc_cat_tipos_incidencia_touch on tc_cat_tipos_incidencia;
create trigger trg_tc_cat_tipos_incidencia_touch before update on tc_cat_tipos_incidencia
  for each row execute function tc_cat_tipos_incidencia_touch();

-- ── Semilla: los 21 tipos que ya existían en el código ───────
insert into tc_cat_tipos_incidencia (clave, etiqueta, icono, gravedad_sugerida, operacion_sugerida, orden, es_sistema) values
  ('profundidad_baja',   'Profundidad baja',           'straighten',              'importante', 'sustituir_neumatico',  10, true),
  ('presion_baja',       'Presión baja',               'south',                   'leve',       'corregir_presion',     20, true),
  ('presion_alta',       'Presión alta',               'north',                   'leve',       'corregir_presion',     30, true),
  ('pinchazo',           'Pinchazo / pérdida de aire',  'tire_repair',             'importante', 'reparar_pinchazo',     40, true),
  ('objeto_clavado',     'Objeto clavado',             'push_pin',                'importante', 'reparar_pinchazo',     50, true),
  ('desgaste_irregular', 'Desgaste irregular',         'blur_linear',             'importante', 'solicitar_alineacion', 60, true),
  ('desgaste_interior',  'Desgaste interior',          'align_horizontal_left',   'leve',       'solicitar_alineacion', 70, true),
  ('desgaste_exterior',  'Desgaste exterior',          'align_horizontal_right',  'leve',       'solicitar_alineacion', 80, true),
  ('diferencia_gemelos', 'Diferencia entre gemelos',   'compare_arrows',          'leve',       'equilibrar',           90, true),
  ('corte_grieta',       'Corte o grieta',             'content_cut',             'importante', 'reparar_pinchazo',    100, true),
  ('dano_flanco',        'Daño en flanco',             'report_gmailerrorred',    'critica',    'sustituir_neumatico', 110, true),
  ('deformacion',        'Deformación',                'change_history',          'critica',    'sustituir_neumatico', 120, true),
  ('valvula_danada',     'Válvula dañada',             'air',                     'importante', 'cambiar_valvula',     130, true),
  ('no_coincide_ficha',  'No coincide con la ficha',   'rule',                    'critica',    'actualizar_neumatico',140, true),
  ('cambiado_posicion',  'Cambiado de posición',       'swap_horiz',              'leve',       'actualizar_neumatico',150, true),
  ('no_identificado',    'No identificado',            'help_outline',            'leve',       'actualizar_neumatico',160, true),
  ('necesita_sustitucion','Necesita sustitución',      'autorenew',               'critica',    'sustituir_neumatico', 170, true),
  ('necesita_reparacion','Necesita reparación',        'build',                   'importante', 'reparar_pinchazo',    180, true),
  ('necesita_equilibrado','Necesita equilibrado',      'balance',                 'importante', 'equilibrar',          190, true),
  ('necesita_alineacion','Necesita alineación',        'linear_scale',            'importante', 'solicitar_alineacion',200, true),
  ('otra',               'Otra incidencia',            'more_horiz',              'leve',       'otra',                210, true)
on conflict (clave) do nothing;

-- ── Liberar el CHECK fijo de tc_incidencia_problemas.tipo ────
-- Ahora los tipos válidos los define el catálogo, no un enum en la BD.
-- (No añadimos FK para no romper filas históricas con claves ya no listadas.)
alter table tc_incidencia_problemas drop constraint if exists tc_incidencia_problemas_tipo_check;

-- ── RLS: lectura para autenticados, escritura admin/super-admin ─
alter table tc_cat_tipos_incidencia enable row level security;

drop policy if exists tc_cat_tipos_incidencia_select on tc_cat_tipos_incidencia;
create policy tc_cat_tipos_incidencia_select on tc_cat_tipos_incidencia for select
  using ( auth.uid() is not null );

drop policy if exists tc_cat_tipos_incidencia_write on tc_cat_tipos_incidencia;
create policy tc_cat_tipos_incidencia_write on tc_cat_tipos_incidencia for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );
