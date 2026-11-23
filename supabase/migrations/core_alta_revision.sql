-- ============================================================
-- Mobilink Core — revisar el alta, y pedir actualizaciones
--
-- Segunda parte del alta por enlace. Tres cosas:
--
--   1. `motivo` en la invitacion: un alta nueva no es lo mismo que
--      pedirle a alguien que ya trabaja aqui que repase su ficha.
--   2. `verificacion`: lo que la IA dice al comparar lo que el
--      trabajador tecleo con la foto de su DNI.
--   3. Un estado mas, `actualizando`, para el empleado que ya estaba
--      completo y al que se le ha pedido que revise sus datos.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1 · Para qué se mandó el enlace
-- ------------------------------------------------------------
alter table sea_employee_invites
  add column if not exists motivo text not null default 'alta';

do $$
begin
  alter table sea_employee_invites
    add constraint sea_employee_invites_motivo_check
    check (motivo in ('alta', 'actualizacion'));
exception
  when duplicate_object then null;
end $$;

comment on column sea_employee_invites.motivo is
  'alta = ficha nueva; actualizacion = se le pide repasar la que ya tiene';

-- ------------------------------------------------------------
-- 2 · Lo que la IA ve al comparar lo tecleado con la foto
--
-- Se guarda el veredicto entero, campo por campo, y no un simple
-- «cuadra / no cuadra»: quien revisa tiene que poder ver QUE leyo el
-- modelo y decidir por su cuenta. Un booleano obligaria a fiarse.
--
-- Vive en la invitacion porque es de ESE envio: si mañana se le pide
-- que actualice, se comprueba otra vez y queda el veredicto de las dos
-- veces, cada uno con su fecha.
-- ------------------------------------------------------------
alter table sea_employee_invites
  add column if not exists verificacion   jsonb,
  add column if not exists verificado_at  timestamptz;

-- ------------------------------------------------------------
-- 3 · El empleado completo al que se le pide que repase su ficha
--
-- Estado propio y no reutilizar 'enviado': en la lista, un operario de
-- hace diez años con la etiqueta «Enlace enviado» parece un alta a
-- medias. Lo que esta a medias es la actualizacion, no el alta.
-- ------------------------------------------------------------
alter table sea_employees
  drop constraint if exists sea_employees_estado_alta_check;

alter table sea_employees
  add constraint sea_employees_estado_alta_check
  check (estado_alta in ('pendiente', 'enviado', 'abierto', 'recibida', 'completa', 'actualizando'));
