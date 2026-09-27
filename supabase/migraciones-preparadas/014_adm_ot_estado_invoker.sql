/*
 * `adm_ot_estado` · reactivar `security_invoker` — PREPARADA, **SIN APLICAR**
 *
 * Una sola sentencia. Es la prueba decisiva de si la regresión del 2026-09-27
 * fue de sesión o de autorización.
 *
 * ── POR QUÉ AHORA SÍ Y ANTES NO ───────────────────────────────────────────
 *
 * El 27-09 se activó `security_invoker` dentro de `005` y la pantalla se quedó
 * vacía. Se revirtió con una restauración mínima. Dos hipótesis mías sobre el
 * porqué resultaron falsas (faltar el rol `tecnico`; superadmin sin ficha).
 *
 * La reproducción en PostgreSQL 17.6 de los cinco modos de fallo posibles dejó
 * uno solo capaz de producir «vacío en silencio»: que `auth.uid()` no resuelva
 * a un usuario autorizado. Los otros cuatro dan error visible, y ninguno de
 * esos errores se vio.
 *
 * Y la comprobación del 27-09, ya con sesión renovada, lo confirma:
 * `/administracion/clientes` lee `adm_customers` DIRECTAMENTE, sujeta a la
 * misma política `adm_can_read()`, **y carga con clientes**. Luego
 * `adm_can_read()` es cierto para esa sesión, y con `security_invoker` la
 * vista tiene que devolver filas.
 *
 * Si las devuelve, la regresión era de sesión y este cambio se queda.
 * Si vuelve a quedar vacía CON SESIÓN VÁLIDA, la hipótesis cae y hay que
 * seguir investigando: entonces se revierte con la línea del rollback y no se
 * toca nada más.
 *
 * ── LO QUE CIERRA ─────────────────────────────────────────────────────────
 *
 * El bypass de SEC-068 que hoy sigue vivo para `authenticated`: cualquier
 * usuario autenticado del proyecto —de cualquiera de las ocho apps— lee hoy
 * todas las órdenes de trabajo y los nombres de cliente sin pasar por
 * `adm_can_read()`. Con `security_invoker`, deja de poder.
 *
 * `anon` ya está fuera desde 005 y esto no lo cambia.
 *
 * ── UNA DEPENDENCIA NUEVA, QUE CONVIENE ANOTAR ────────────────────────────
 *
 * Con `security_invoker`, la vista deja de resolverse con los privilegios de
 * su dueño, así que **el llamante necesita `SELECT` sobre `adm_work_orders` y
 * `adm_customers`**, además de pasar la RLS. Hoy lo tiene, por el grant por
 * defecto de Supabase.
 *
 * Eso significa que, a partir de ahora, una migración futura que retire ese
 * `select` a `authenticated` rompería esta pantalla. Comprobado: ninguna de
 * las 88 tablas de la Fase D es `adm_work_orders` ni `adm_customers`, así que
 * la Fase D no la toca. Pero queda dicho.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * No crea funciones, no toca policies, no toca grants. `011` queda en
 * suspenso: si esto funciona, deja de ser necesario, porque el predicado que
 * proponía lo resuelve ya la RLS de las tablas base.
 */

alter view public.adm_ot_estado set (security_invoker = true);
