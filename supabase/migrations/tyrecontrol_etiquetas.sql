-- ============================================================
-- SEA TyreControl — Etiquetado de neumáticos nuevos.
--
-- Un operario fotografía el flanco de cada goma nueva, la IA lee su número de
-- serie, una persona lo revisa y el panel imprime una etiqueta con ese número
-- y su QR. Eso es todo lo que hace este módulo.
--
-- ── ESTO NO CREA NEUMÁTICOS ─────────────────────────────────────────────────
--
-- Y no es un matiz: es la regla que define el módulo. Estas dos tablas NO
-- tocan, ni de lejos:
--
--   tc_neumaticos · tc_montajes_actuales · operaciones_neumaticos
--   tc_intervenciones · el almacén · el stock · los costes
--
-- No se genera ningún `numero_interno`, no se da nada de alta y no se mueve
-- una unidad de stock. Lo que se guarda aquí es la trazabilidad del PROCESO DE
-- ETIQUETADO: qué se fotografió, qué se leyó, qué confirmó una persona y qué
-- se imprimió. Un neumático etiquetado sigue sin existir en TyreControl hasta
-- que alguien lo monta por el camino de siempre.
--
-- El banco `supabase/pruebas/etiquetas.sql` lo comprueba con una tabla
-- testigo: etiquetar un lote entero la deja vacía.
--
-- ── Por qué no se reutiliza tc_lotes_revision ───────────────────────────────
--
-- Porque es otra cosa. Ese lote agrupa VEHÍCULOS para planificar revisiones,
-- con fecha prevista, técnico y tiempo estimado. Meter aquí fotografías de
-- gomas sueltas obligaría a dejar la mitad de sus columnas en null y a que
-- cada consulta de planificación aprendiera a ignorar un tipo de lote que no
-- es suyo. Sí se le copia la FORMA: empresa_id, estado con check, created_by.
--
-- Aditiva y reversible con `drop table`. Idempotente.
-- ============================================================

create table if not exists tc_etiquetas_lote (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references tc_empresas(id) on delete cascade,
  -- ETQ-20260917-001. Legible, ordenable y suficiente para decirlo en voz alta
  -- por teléfono, que es para lo que sirve un código de lote.
  codigo      text not null,
  estado      text not null default 'abierto' check (estado in ('abierto','cerrado')),
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  cerrado_at  timestamptz,
  unique (empresa_id, codigo)
);

create index if not exists idx_etq_lote_empresa on tc_etiquetas_lote (empresa_id, created_at desc);

comment on table tc_etiquetas_lote is
  'Un lote de etiquetado: las fotos que un operario hizo de una tanda de '
  'neumáticos nuevos. NO es inventario: no crea ni referencia neumáticos.';

create table if not exists tc_etiquetas_foto (
  id            uuid primary key default gen_random_uuid(),
  lote_id       uuid not null references tc_etiquetas_lote(id) on delete cascade,
  -- Repetida a propósito, aunque se pueda llegar por el lote: la RLS de esta
  -- tabla tiene que poder decidir sin hacer un join, y una foto que perdiera
  -- su lote no puede quedarse sin dueño.
  empresa_id    uuid not null references tc_empresas(id) on delete cascade,
  foto_url      text not null,

  -- Lo que leyó la máquina, tal cual. No se pisa nunca: si una persona
  -- corrige, su valor va a `serie_confirmada` y este se conserva, porque es
  -- la única forma de saber después si la IA acierta o no.
  serie_detectada text,
  confianza       numeric,
  dudoso          boolean not null default false,

  -- Lo que dijo una persona. Es lo que se imprime.
  serie_confirmada text,

  estado        text not null default 'pendiente'
                  check (estado in ('pendiente','detectada','revisar',
                                    'no_detectada','confirmada','impresa','descartada')),
  revisado_por  uuid,
  revisado_at   timestamptz,
  impreso_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_etq_foto_lote on tc_etiquetas_foto (lote_id);
create index if not exists idx_etq_foto_empresa_estado on tc_etiquetas_foto (empresa_id, estado);

comment on column tc_etiquetas_foto.serie_detectada is
  'Lo que leyó la IA, sin tocar. Se conserva aunque una persona corrija: es lo '
  'único que permite saber después si el lector acierta.';
comment on column tc_etiquetas_foto.confianza is
  'Confianza del lector, 0..1, cuando la da. Por debajo del umbral el estado '
  'es «revisar»: un número dudoso NUNCA se confirma solo.';
comment on column tc_etiquetas_foto.estado is
  'pendiente (subida, sin leer) · detectada · revisar (poca confianza) · '
  'no_detectada · confirmada (por una persona) · impresa · descartada.';

-- ── RLS: cada cliente ve lo suyo ────────────────────────────────────────────
--
-- El mismo criterio que el resto de TyreControl. Y se recuerda aquí porque es
-- fácil de olvidar: el servidor habla con service_role y NO pasa por estas
-- políticas, así que todo endpoint que reciba una empresa tiene que
-- comprobarla a mano con `puedeVerEmpresa()`.
alter table tc_etiquetas_lote enable row level security;
alter table tc_etiquetas_foto enable row level security;

drop policy if exists etq_lote_select on tc_etiquetas_lote;
create policy etq_lote_select on tc_etiquetas_lote for select
  using ( tc_puede_ver_empresa(empresa_id) );

drop policy if exists etq_lote_write on tc_etiquetas_lote;
create policy etq_lote_write on tc_etiquetas_lote for all
  using      ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );

drop policy if exists etq_foto_select on tc_etiquetas_foto;
create policy etq_foto_select on tc_etiquetas_foto for select
  using ( tc_puede_ver_empresa(empresa_id) );

drop policy if exists etq_foto_write on tc_etiquetas_foto;
create policy etq_foto_write on tc_etiquetas_foto for all
  using      ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );

-- ── Abrir un lote ───────────────────────────────────────────────────────────
--
-- El código se genera EN LA BASE y no en la tablet: dos operarios abriendo
-- lote a la vez desde dos tablets se pisarían el número. El unique
-- (empresa_id, codigo) es el que lo garantiza de verdad; esta función solo
-- busca el siguiente hueco.
create or replace function tc_etiquetas_abrir_lote(p_empresa uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dia    text := to_char(now(), 'YYYYMMDD');
  v_n      int;
  v_codigo text;
  v_id     uuid;
begin
  if not (tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  -- Reintento acotado: si otro proceso coge el número entre el count y el
  -- insert, el unique salta y se prueba el siguiente.
  for i in 1..20 loop
    select count(*) + i into v_n from tc_etiquetas_lote
     where empresa_id = p_empresa and codigo like 'ETQ-' || v_dia || '-%';
    v_codigo := 'ETQ-' || v_dia || '-' || lpad(v_n::text, 3, '0');
    begin
      insert into tc_etiquetas_lote (empresa_id, codigo)
      values (p_empresa, v_codigo) returning id into v_id;
      return jsonb_build_object('id', v_id, 'codigo', v_codigo);
    exception when unique_violation then
      -- lo cogió otro: siguiente vuelta
    end;
  end loop;
  raise exception 'No se ha podido abrir un lote nuevo: demasiados intentos';
end $$;

comment on function tc_etiquetas_abrir_lote(uuid) is
  'Abre un lote de etiquetado y devuelve su código ETQ-<fecha>-<nnn>. El '
  'número se genera en la base para que dos tablets a la vez no se pisen.';

grant execute on function tc_etiquetas_abrir_lote(uuid) to authenticated;
