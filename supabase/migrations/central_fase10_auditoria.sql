-- MC Central · Fase 10 — auditoria inmutable
--
-- Tres cosas que no estaban, y las tres salieron de mirar en vez de suponer:
--
-- 1. La tabla podia NO EXISTIR. La crea la migracion de la fundacion SaaS, que
--    se aplica a mano; en una base sin ella las 35 llamadas del modulo de caja
--    fallaban en silencio, porque registrarAuditoria traga sus errores.
--
-- 2. Se podia modificar y borrar. Las politicas RLS solo permitian leer e
--    insertar, pero el servidor se conecta con pg y no pasa por RLS: un UPDATE
--    sobre una linea de auditoria era perfectamente posible.
--
-- 3. No se podia demostrar que una linea no habia cambiado.
--
-- Equivalente en código: server/core/auditoriaSchema.ts.

-- ── 1) Fuera la clave ajena ─────────────────────────────────────────────────
-- La auditoria pasa a escribirse DENTRO de la transaccion que mueve el dinero,
-- y eso cambia las reglas: cualquier cosa que pueda hacer fallar este INSERT
-- deshace un cobro que ya ocurrio fisicamente. Una clave ajena es exactamente
-- eso. Ademas, una auditoria que rechaza una linea porque su empresa ya no esta
-- es una auditoria que se pierde justo cuando mas falta hace: el registro
-- sobrevive a su sujeto, para eso esta.
alter table app_auditoria drop constraint if exists app_auditoria_empresa_id_fkey;
alter table app_auditoria drop constraint if exists app_auditoria_user_id_fkey;

-- ── 2) Huella por fila ──────────────────────────────────────────────────────
-- Es una huella POR FILA, no una cadena que encadene cada linea con la
-- anterior. Una cadena detectaria tambien un borrado, pero obligaria a
-- serializar TODAS las escrituras de auditoria de la instalacion -cada una
-- tendria que leer la huella de la anterior con la fila bloqueada- y la
-- auditoria se escribe en cada operacion de cada modulo. El borrado ya lo
-- impide el disparador de abajo; la huella cubre lo otro: que alguien cambie
-- el contenido por fuera.
alter table app_auditoria add column if not exists huella text;

create or replace function app_auditoria_huella() returns trigger as $$
begin
  new.huella := encode(sha256(convert_to(
    coalesce(new.empresa_id::text,'') || '|' ||
    coalesce(new.user_id::text,'')    || '|' ||
    new.accion                        || '|' ||
    coalesce(new.entidad,'')          || '|' ||
    coalesce(new.entidad_id,'')       || '|' ||
    coalesce(new.detalle::text,'')    || '|' ||
    coalesce(new.ip::text,'')         || '|' ||
    new.created_at::text,
    'UTF8')), 'hex');
  return new;
end $$ language plpgsql;

drop trigger if exists app_auditoria_huella_trg on app_auditoria;
create trigger app_auditoria_huella_trg
  before insert on app_auditoria
  for each row execute function app_auditoria_huella();

-- ── 3) El candado ───────────────────────────────────────────────────────────
-- El mensaje explica QUE hacer, no solo se niega: quien se topa con esto casi
-- siempre queria corregir algo, y lo que corrige una linea de auditoria
-- equivocada es otra linea, nunca un UPDATE.
create or replace function app_auditoria_solo_insertar() returns trigger as $$
begin
  raise exception
    'app_auditoria es inmutable: no se puede % una linea de auditoria. Una correccion se registra como una linea nueva.',
    TG_OP;
end $$ language plpgsql;

drop trigger if exists app_auditoria_inmutable_trg on app_auditoria;
create trigger app_auditoria_inmutable_trg
  before update or delete on app_auditoria
  for each row execute function app_auditoria_solo_insertar();

-- ── 4) Marca de reautenticacion reciente ────────────────────────────────────
-- En la base y no en memoria: en Render hay varias instancias y la siguiente
-- peticion puede caer en otra. Con un mapa en memoria, reautenticarse valdria o
-- no segun a quien le tocara responder -intermitente y sin explicacion, que es
-- la peor clase de fallo-.
--
-- Una fila por usuario, que se pisa: el historico de cuando se ha identificado
-- cada uno ya esta en la auditoria.
create table if not exists cash_reauth (
  user_id  uuid primary key,
  hasta_ms bigint not null
);
