-- ============================================================
-- Superadmin de plataforma — activar el flag maestro
-- Ejecutar en Supabase > SQL Editor
-- ============================================================
--
-- CONTEXTO
-- El hub y los guardias de cada modulo leen `app_usuarios.es_superadmin`.
-- Habia un segundo flag, `tc_usuarios.es_superadmin`, que solo miraba
-- TyreControl (y el hub unicamente si el usuario no tenia ningun modulo
-- asignado). Resultado: alguien marcado como superadmin solo en TyreControl
-- no lo era para el resto de la plataforma.
--
-- El codigo ya acepta las dos fuentes, pero la buena es la de app_usuarios.
-- ============================================================

-- ── 1. Ver como esta cada usuario antes de tocar nada ───────────────────────
select a.username,
       a.activo,
       a.es_superadmin  as superadmin_maestro,
       t.es_superadmin  as superadmin_tyrecontrol,
       (select count(*) from app_usuario_modulos m where m.user_id = a.id) as modulos
from app_usuarios a
left join tc_usuarios t on t.id = a.id
order by a.username;

-- ── 2. Activar el superadmin maestro ────────────────────────────────────────
-- Cambia el username si hace falta. Afecta a TODA la plataforma: quien lo
-- tenga entra en todos los modulos y sin restriccion de pantallas.
update app_usuarios
set es_superadmin = true,
    updated_at    = now()
where lower(username) = 'jordi';

-- ── 3. Arrastrar los que solo estaban marcados en TyreControl ───────────────
-- Opcional. Descomentar si quieres que quien fuese superadmin de TyreControl
-- lo sea tambien de la plataforma. REVISA la lista del paso 1 antes.
--
-- update app_usuarios a
-- set es_superadmin = true, updated_at = now()
-- from tc_usuarios t
-- where t.id = a.id and t.es_superadmin and not a.es_superadmin;

-- ── 4. Comprobar el resultado ───────────────────────────────────────────────
select username, activo, es_superadmin
from app_usuarios
where es_superadmin
order by username;
