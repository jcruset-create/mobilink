-- ============================================================
-- SEA Administración — Fase 1
-- Módulo de Cobros, Seguimiento de Pagos y Recobros.
-- Prefijo adm_ para NO colisionar con tablas de otros módulos.
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── ENUM de roles del módulo ─────────────────────────────────
do $$ begin
  create type adm_rol as enum ('admin','administracion','recepcion','supervisor','tecnico');
exception when duplicate_object then null; end $$;

-- ── USUARIOS (perfil ligado a auth.users) ────────────────────
create table if not exists adm_usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  email       text not null,
  rol         adm_rol not null default 'recepcion',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── CLIENTES (ficha económica) ───────────────────────────────
create table if not exists adm_customers (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  tax_id                      text,
  phone                       text,
  email                       text,
  payment_method              text,
  has_direct_debit            boolean not null default false,
  requires_payment_tracking   boolean not null default true,
  expected_payment_days       integer not null default 30,
  admin_email                 text,
  admin_phone                 text,
  payment_contact_name        text,
  internal_credit_limit       numeric(12,2),
  economic_notes              text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists idx_adm_customers_name on adm_customers (name);

-- ── ÓRDENES DE TRABAJO ───────────────────────────────────────
create table if not exists adm_work_orders (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references adm_customers(id) on delete restrict,
  ot_number      text,
  vehicle_plate  text,
  status         text not null default 'abierta'
                 check (status in ('abierta','cerrada','anulada')),
  total_amount   numeric(12,2) not null default 0,
  center         text not null default 'tarragona'
                 check (center in ('tarragona','reus')),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index if not exists idx_adm_work_orders_customer on adm_work_orders (customer_id);
create index if not exists idx_adm_work_orders_status on adm_work_orders (status);

-- ── FACTURAS ─────────────────────────────────────────────────
create table if not exists adm_invoices (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references adm_customers(id) on delete restrict,
  work_order_id   uuid references adm_work_orders(id) on delete set null,
  invoice_number  text not null,
  invoice_date    date not null default current_date,
  due_date        date,
  total_amount    numeric(12,2) not null default 0,
  pending_amount  numeric(12,2) not null default 0,
  status          text not null default 'pendiente'
                  check (status in ('pendiente','parcial','pagada','anulada')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_adm_invoices_customer on adm_invoices (customer_id);
create index if not exists idx_adm_invoices_status on adm_invoices (status);

-- ── FORMAS DE PAGO (configurables) ───────────────────────────
create table if not exists adm_payment_methods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into adm_payment_methods (name, sort_order) values
  ('Efectivo', 1), ('Tarjeta', 2), ('Transferencia', 3), ('Bizum empresa', 4),
  ('Stripe', 5), ('Giro bancario', 6), ('Cuenta cliente', 7), ('Factura mensual', 8)
on conflict (name) do nothing;

-- ── COBROS ───────────────────────────────────────────────────
create table if not exists adm_payments (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid references adm_customers(id) on delete restrict,
  work_order_id        uuid references adm_work_orders(id) on delete set null,
  invoice_id           uuid references adm_invoices(id) on delete set null,
  payment_date         date not null default current_date,
  amount               numeric(12,2) not null,
  payment_method       text not null,
  reference            text,
  registered_by        uuid references adm_usuarios(id) on delete set null,
  center               text not null default 'tarragona'
                       check (center in ('tarragona','reus')),
  notes                text,
  is_cancelled         boolean not null default false,
  cancellation_reason  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_adm_payments_date on adm_payments (payment_date);
create index if not exists idx_adm_payments_customer on adm_payments (customer_id);
create index if not exists idx_adm_payments_invoice on adm_payments (invoice_id);
create index if not exists idx_adm_payments_work_order on adm_payments (work_order_id);

-- ── SEGUIMIENTO DE PAGOS (preventivo, clientes sin giro) ─────
create table if not exists adm_payment_tracking (
  id                       uuid primary key default gen_random_uuid(),
  customer_id              uuid not null references adm_customers(id) on delete restrict,
  work_order_id            uuid references adm_work_orders(id) on delete set null,
  invoice_id               uuid references adm_invoices(id) on delete set null,
  total_amount             numeric(12,2) not null default 0,
  pending_amount           numeric(12,2) not null default 0,
  expected_payment_date    date,
  expected_payment_method  text,
  status                   text not null default 'pendiente'
                           check (status in ('pendiente','recordatorio_enviado','esperando_transferencia',
                                             'pago_parcial','pago_confirmado','pasado_a_recobro','cerrado')),
  next_action_date         date,
  next_action_note         text,
  responsible_user         uuid references adm_usuarios(id) on delete set null,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  closed_at                timestamptz
);
create index if not exists idx_adm_tracking_customer on adm_payment_tracking (customer_id);
create index if not exists idx_adm_tracking_status on adm_payment_tracking (status);
create index if not exists idx_adm_tracking_next_action on adm_payment_tracking (next_action_date);

create table if not exists adm_payment_tracking_actions (
  id                    uuid primary key default gen_random_uuid(),
  payment_tracking_id   uuid not null references adm_payment_tracking(id) on delete cascade,
  action_type           text not null,
  action_date           timestamptz not null default now(),
  user_id               uuid references adm_usuarios(id) on delete set null,
  notes                 text,
  next_action_date      date,
  created_at            timestamptz not null default now()
);
create index if not exists idx_adm_tracking_actions_tracking on adm_payment_tracking_actions (payment_tracking_id);

-- ── RECOBROS (facturas vencidas) ─────────────────────────────
create table if not exists adm_recovery_cases (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references adm_customers(id) on delete restrict,
  invoice_id        uuid references adm_invoices(id) on delete set null,
  work_order_id     uuid references adm_work_orders(id) on delete set null,
  due_date          date,
  initial_amount    numeric(12,2) not null default 0,
  pending_amount    numeric(12,2) not null default 0,
  status            text not null default 'pendiente'
                    check (status in ('pendiente','primer_aviso','segundo_aviso','llamada_realizada',
                                      'compromiso_pago','pago_parcial','pago_recibido','cerrado')),
  priority          text not null default 'normal'
                    check (priority in ('normal','alta','urgente')),
  responsible_user  uuid references adm_usuarios(id) on delete set null,
  next_action_date  date,
  next_action_note  text,
  internal_notes    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index if not exists idx_adm_recovery_customer on adm_recovery_cases (customer_id);
create index if not exists idx_adm_recovery_status on adm_recovery_cases (status);
create index if not exists idx_adm_recovery_next_action on adm_recovery_cases (next_action_date);

create table if not exists adm_recovery_actions (
  id                 uuid primary key default gen_random_uuid(),
  recovery_case_id   uuid not null references adm_recovery_cases(id) on delete cascade,
  action_type        text not null,
  action_date        timestamptz not null default now(),
  user_id            uuid references adm_usuarios(id) on delete set null,
  notes              text,
  next_action_date   date,
  created_at         timestamptz not null default now()
);
create index if not exists idx_adm_recovery_actions_case on adm_recovery_actions (recovery_case_id);

-- ============================================================
-- TRIGGERS Y FUNCIONES
-- ============================================================

-- updated_at automático
create or replace function adm_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$ declare t text;
begin
  foreach t in array array['adm_customers','adm_invoices','adm_payments','adm_payment_tracking','adm_recovery_cases']
  loop
    execute format('drop trigger if exists trg_touch_%s on %s', t, t);
    execute format('create trigger trg_touch_%s before update on %s for each row execute function adm_touch_updated_at()', t, t);
  end loop;
end $$;

-- ── Crear seguimiento automático ─────────────────────────────
-- Condiciones: cliente sin giro bancario + requiere seguimiento.
-- Evita duplicados: no crea si ya hay un seguimiento abierto para la misma factura/OT.
create or replace function adm_crear_seguimiento(
  p_customer_id uuid, p_work_order_id uuid, p_invoice_id uuid,
  p_total numeric, p_base_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_customer adm_customers%rowtype;
  v_id uuid;
begin
  select * into v_customer from adm_customers where id = p_customer_id;
  if not found then return null; end if;
  if v_customer.has_direct_debit or not v_customer.requires_payment_tracking then
    return null;
  end if;

  -- ¿ya existe seguimiento abierto para esta factura u OT?
  select id into v_id from adm_payment_tracking
  where closed_at is null
    and ((p_invoice_id is not null and invoice_id = p_invoice_id)
      or (p_invoice_id is null and p_work_order_id is not null and work_order_id = p_work_order_id));
  if found then return v_id; end if;

  insert into adm_payment_tracking
    (customer_id, work_order_id, invoice_id, total_amount, pending_amount,
     expected_payment_date, expected_payment_method, status)
  values
    (p_customer_id, p_work_order_id, p_invoice_id, coalesce(p_total,0), coalesce(p_total,0),
     coalesce(p_base_date, current_date) + coalesce(v_customer.expected_payment_days, 30),
     v_customer.payment_method, 'pendiente')
  returning id into v_id;
  return v_id;
end $$;

-- Al emitir factura → seguimiento (y enlaza seguimiento de OT previo si existía)
create or replace function adm_trg_invoice_seguimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- si ya había seguimiento abierto por la OT (sin factura), lo enlaza a la factura
  if new.work_order_id is not null then
    update adm_payment_tracking
      set invoice_id = new.id,
          total_amount = new.total_amount,
          pending_amount = new.pending_amount,
          expected_payment_date = coalesce(due_date_fix.d, expected_payment_date)
    from (select coalesce(new.due_date, new.invoice_date) as d) due_date_fix
    where adm_payment_tracking.work_order_id = new.work_order_id
      and adm_payment_tracking.invoice_id is null
      and adm_payment_tracking.closed_at is null;
    if found then return new; end if;
  end if;

  perform adm_crear_seguimiento(new.customer_id, new.work_order_id, new.id,
                                new.total_amount, coalesce(new.due_date, new.invoice_date));
  return new;
end $$;

drop trigger if exists trg_adm_invoice_seguimiento on adm_invoices;
create trigger trg_adm_invoice_seguimiento
  after insert on adm_invoices
  for each row execute function adm_trg_invoice_seguimiento();

-- Al cerrar OT (status → 'cerrada') → seguimiento si no hay factura todavía
create or replace function adm_trg_ot_cerrada_seguimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cerrada' and old.status is distinct from 'cerrada' then
    if new.closed_at is null then new.closed_at = now(); end if;
    if not exists (select 1 from adm_invoices where work_order_id = new.id) then
      perform adm_crear_seguimiento(new.customer_id, new.id, null, new.total_amount, current_date);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_adm_ot_cerrada on adm_work_orders;
create trigger trg_adm_ot_cerrada
  before update on adm_work_orders
  for each row execute function adm_trg_ot_cerrada_seguimiento();

-- ── Recalcular pendientes al registrar/anular un pago ────────
create or replace function adm_recalcular_pendiente(p_invoice_id uuid, p_work_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_paid numeric := 0;
  v_total numeric := 0;
  v_pending numeric := 0;
begin
  -- 1) factura
  if p_invoice_id is not null then
    select coalesce(sum(amount),0) into v_paid
      from adm_payments where invoice_id = p_invoice_id and not is_cancelled;
    select total_amount into v_total from adm_invoices where id = p_invoice_id;
    v_pending := greatest(coalesce(v_total,0) - v_paid, 0);
    update adm_invoices set
      pending_amount = v_pending,
      status = case when v_pending <= 0 then 'pagada'
                    when v_paid > 0 then 'parcial'
                    else 'pendiente' end
    where id = p_invoice_id and status <> 'anulada';
  end if;

  -- 2) seguimientos abiertos vinculados
  update adm_payment_tracking t set
    pending_amount = sub.pending,
    status = case when sub.pending <= 0 then 'pago_confirmado'
                  when sub.paid > 0 and t.status not in ('pasado_a_recobro') then 'pago_parcial'
                  else t.status end,
    closed_at = case when sub.pending <= 0 then now() else t.closed_at end
  from (
    select t2.id,
           greatest(t2.total_amount - coalesce((
             select sum(p.amount) from adm_payments p
             where not p.is_cancelled
               and ((t2.invoice_id is not null and p.invoice_id = t2.invoice_id)
                 or (t2.invoice_id is null and t2.work_order_id is not null and p.work_order_id = t2.work_order_id))
           ),0), 0) as pending,
           coalesce((
             select sum(p.amount) from adm_payments p
             where not p.is_cancelled
               and ((t2.invoice_id is not null and p.invoice_id = t2.invoice_id)
                 or (t2.invoice_id is null and t2.work_order_id is not null and p.work_order_id = t2.work_order_id))
           ),0) as paid
    from adm_payment_tracking t2
    where t2.closed_at is null
      and ((p_invoice_id is not null and t2.invoice_id = p_invoice_id)
        or (p_work_order_id is not null and t2.work_order_id = p_work_order_id))
  ) sub
  where t.id = sub.id;

  -- 3) recobros abiertos vinculados
  update adm_recovery_cases r set
    pending_amount = sub.pending,
    status = case when sub.pending <= 0 then 'pago_recibido'
                  when sub.paid > 0 then 'pago_parcial'
                  else r.status end,
    closed_at = case when sub.pending <= 0 then now() else r.closed_at end
  from (
    select r2.id,
           greatest(r2.initial_amount - coalesce((
             select sum(p.amount) from adm_payments p
             where not p.is_cancelled
               and ((r2.invoice_id is not null and p.invoice_id = r2.invoice_id)
                 or (r2.invoice_id is null and r2.work_order_id is not null and p.work_order_id = r2.work_order_id))
           ),0), 0) as pending,
           coalesce((
             select sum(p.amount) from adm_payments p
             where not p.is_cancelled
               and ((r2.invoice_id is not null and p.invoice_id = r2.invoice_id)
                 or (r2.invoice_id is null and r2.work_order_id is not null and p.work_order_id = r2.work_order_id))
           ),0) as paid
    from adm_recovery_cases r2
    where r2.closed_at is null
      and ((p_invoice_id is not null and r2.invoice_id = p_invoice_id)
        or (p_work_order_id is not null and r2.work_order_id = p_work_order_id))
  ) sub
  where r.id = sub.id;
end $$;

create or replace function adm_trg_payment_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform adm_recalcular_pendiente(coalesce(new.invoice_id, old.invoice_id),
                                   coalesce(new.work_order_id, old.work_order_id));
  return new;
end $$;

drop trigger if exists trg_adm_payment_recalc on adm_payments;
create trigger trg_adm_payment_recalc
  after insert or update on adm_payments
  for each row execute function adm_trg_payment_recalc();

-- ── Pasar seguimiento a recobro ──────────────────────────────
create or replace function adm_pasar_a_recobro(p_tracking_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_t adm_payment_tracking%rowtype;
  v_id uuid;
begin
  if not (adm_rol_actual() in ('admin','administracion')) then
    raise exception 'Sin permiso para pasar a recobro';
  end if;

  select * into v_t from adm_payment_tracking where id = p_tracking_id for update;
  if not found then raise exception 'Seguimiento no encontrado'; end if;
  if v_t.status = 'pasado_a_recobro' then
    select id into v_id from adm_recovery_cases
      where (invoice_id = v_t.invoice_id or work_order_id = v_t.work_order_id) and closed_at is null
      limit 1;
    return v_id;
  end if;

  insert into adm_recovery_cases
    (customer_id, invoice_id, work_order_id, due_date, initial_amount, pending_amount,
     status, priority, responsible_user)
  values
    (v_t.customer_id, v_t.invoice_id, v_t.work_order_id,
     coalesce(v_t.expected_payment_date, current_date),
     v_t.pending_amount, v_t.pending_amount, 'pendiente', 'normal', v_t.responsible_user)
  returning id into v_id;

  update adm_payment_tracking
    set status = 'pasado_a_recobro', closed_at = now()
    where id = p_tracking_id;

  insert into adm_payment_tracking_actions (payment_tracking_id, action_type, user_id, notes)
  values (p_tracking_id, 'pasado_a_recobro', auth.uid(), 'Expediente de recobro creado');

  return v_id;
end $$;

-- ============================================================
-- RLS
-- ============================================================

create or replace function adm_rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select rol::text from adm_usuarios where id = auth.uid() and activo), '')
$$;

create or replace function adm_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select adm_rol_actual() = 'admin'
$$;

create or replace function adm_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select adm_rol_actual() in ('admin','administracion')
$$;

create or replace function adm_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select adm_rol_actual() in ('admin','administracion','recepcion','supervisor')
$$;

alter table adm_usuarios                  enable row level security;
alter table adm_customers                 enable row level security;
alter table adm_work_orders               enable row level security;
alter table adm_invoices                  enable row level security;
alter table adm_payment_methods           enable row level security;
alter table adm_payments                  enable row level security;
alter table adm_payment_tracking          enable row level security;
alter table adm_payment_tracking_actions  enable row level security;
alter table adm_recovery_cases            enable row level security;
alter table adm_recovery_actions          enable row level security;

-- USUARIOS: cada uno ve su perfil; admin gestiona todos
drop policy if exists adm_usuarios_self on adm_usuarios;
create policy adm_usuarios_self on adm_usuarios for select
  using ( id = auth.uid() or adm_is_admin() );
drop policy if exists adm_usuarios_admin on adm_usuarios;
create policy adm_usuarios_admin on adm_usuarios for all
  using ( adm_is_admin() ) with check ( adm_is_admin() );

-- CLIENTES: lectura para admin/administración/recepción/supervisor; escritura admin/administración
drop policy if exists adm_customers_select on adm_customers;
create policy adm_customers_select on adm_customers for select using ( adm_can_read() );
drop policy if exists adm_customers_write on adm_customers;
create policy adm_customers_write on adm_customers for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

-- OTs: lectura general (técnico solo vía vista sin importes); escritura admin/administración
drop policy if exists adm_work_orders_select on adm_work_orders;
create policy adm_work_orders_select on adm_work_orders for select using ( adm_can_read() );
drop policy if exists adm_work_orders_write on adm_work_orders;
create policy adm_work_orders_write on adm_work_orders for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

-- FACTURAS
drop policy if exists adm_invoices_select on adm_invoices;
create policy adm_invoices_select on adm_invoices for select using ( adm_can_read() );
drop policy if exists adm_invoices_write on adm_invoices;
create policy adm_invoices_write on adm_invoices for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

-- FORMAS DE PAGO: lectura todos los roles del módulo; escritura admin/administración
drop policy if exists adm_payment_methods_select on adm_payment_methods;
create policy adm_payment_methods_select on adm_payment_methods for select using ( adm_can_read() );
drop policy if exists adm_payment_methods_write on adm_payment_methods;
create policy adm_payment_methods_write on adm_payment_methods for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

-- COBROS: recepción puede ver y registrar; editar/anular solo admin/administración
drop policy if exists adm_payments_select on adm_payments;
create policy adm_payments_select on adm_payments for select using ( adm_can_read() );
drop policy if exists adm_payments_insert on adm_payments;
create policy adm_payments_insert on adm_payments for insert
  with check ( adm_can_manage() or adm_rol_actual() = 'recepcion' );
drop policy if exists adm_payments_update on adm_payments;
create policy adm_payments_update on adm_payments for update
  using ( adm_can_manage() ) with check ( adm_can_manage() );

-- SEGUIMIENTO: solo admin/administración (supervisor lee)
drop policy if exists adm_tracking_select on adm_payment_tracking;
create policy adm_tracking_select on adm_payment_tracking for select
  using ( adm_can_manage() or adm_rol_actual() = 'supervisor' );
drop policy if exists adm_tracking_write on adm_payment_tracking;
create policy adm_tracking_write on adm_payment_tracking for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

drop policy if exists adm_tracking_actions_select on adm_payment_tracking_actions;
create policy adm_tracking_actions_select on adm_payment_tracking_actions for select
  using ( adm_can_manage() or adm_rol_actual() = 'supervisor' );
drop policy if exists adm_tracking_actions_write on adm_payment_tracking_actions;
create policy adm_tracking_actions_write on adm_payment_tracking_actions for insert
  with check ( adm_can_manage() );

-- RECOBROS: solo admin/administración (supervisor lee)
drop policy if exists adm_recovery_select on adm_recovery_cases;
create policy adm_recovery_select on adm_recovery_cases for select
  using ( adm_can_manage() or adm_rol_actual() = 'supervisor' );
drop policy if exists adm_recovery_write on adm_recovery_cases;
create policy adm_recovery_write on adm_recovery_cases for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

drop policy if exists adm_recovery_actions_select on adm_recovery_actions;
create policy adm_recovery_actions_select on adm_recovery_actions for select
  using ( adm_can_manage() or adm_rol_actual() = 'supervisor' );
drop policy if exists adm_recovery_actions_write on adm_recovery_actions;
create policy adm_recovery_actions_write on adm_recovery_actions for insert
  with check ( adm_can_manage() );

-- ── Vista para técnicos: estado de OT sin importes ───────────
-- (las vistas se ejecutan con permisos del propietario → no exponen importes)
create or replace view adm_ot_estado as
  select wo.id, wo.ot_number, wo.vehicle_plate, wo.status, wo.center, wo.created_at,
         c.name as customer_name
  from adm_work_orders wo
  join adm_customers c on c.id = wo.customer_id;

grant select on adm_ot_estado to authenticated;

-- ============================================================
-- SEMILLA (ejecutar UNA vez, editando el email).
-- Requiere que tu cuenta exista ya en Authentication → Users.
-- ============================================================
-- insert into adm_usuarios (id, nombre, email, rol)
-- select u.id, 'Administrador SEA', u.email, 'admin'
-- from auth.users u where u.email = 'jcruset@gmail.com'
-- on conflict (id) do update set rol = 'admin', activo = true;
