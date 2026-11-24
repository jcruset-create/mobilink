# Mobilink Core — Unificación de operarios · Número de trabajador por empresa

> Sustituye al «Paso 1: el DNI como identificador único». La clave para enlazar
> módulos pasa a ser un **número interno de trabajador por empresa** que se rellena
> a mano. El DNI sigue siendo un dato de la ficha (se valida), pero ya no es la
> clave de enlace.

## Contexto (léelo antes de tocar nada)

- Sigue `CLAUDE.md` al pie de la letra: pull e integración de `main` al empezar,
  `bash scripts/check-versions.sh` antes de cada commit, PR + merge con la CI verde.
- Lee `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md` (inventario y plan) y `ARCHITECTURE.md`.
  No hay Firebase: Supabase/PostgreSQL + servidor Express (`server/`).
- Core = `sea_employees` (persona) + `app_usuarios` / `app_usuario_modulos` (acceso).
  **No se crea ninguna tabla de operarios nueva.**
- Migraciones de Supabase: se ejecutan a mano en el SQL Editor, idempotentes, con
  comentario arriba de qué hacen, qué NO hacen y en qué orden van.
- **Prohibido** añadir triggers que copien datos entre tablas
  (`PROMPT_UNIFICACION_DATOS_MOBILINK.md` §0). Un dato, un sitio; lo demás son FK.

## Decisiones ya tomadas (no las cuestiones)

| Decisión | Valor |
|---|---|
| Clave humana del trabajador entre módulos | `sea_employees.numero_trabajador`, único **por empresa** (`company_id`) |
| Cómo se rellena | A mano, por el administrador, en Core |
| Qué se guarda en cada módulo | `employee_id → sea_employees(id)`. El número sirve para **encontrar** al trabajador; el enlace que se guarda es el id. El número **no** se copia a las tablas de los módulos |
| Después de enlazar | La identidad (nombre, apellidos, teléfono, DNI, activo) se lee **solo de Core**; el módulo guarda únicamente lo operativo suyo |
| Operarios sin usuario de app | Existen → `user_id` sigue opcional |
| Empresas por operario | Una (`sea_employees.company_id`) |
| Quién da de alta y edita | Solo el administrador |

## Hechos comprobados en el código (no los reverifiques a ciegas, pero sí antes de cambiarlos)

- `sea_employees.codigo_operario` ya existe, es `UNIQUE` **global** y es el usuario de
  login de ToolControl (`tc_operator_login`). **No se reutiliza** como número de
  trabajador: cambiarlo rompería logins. `numero_trabajador` es una columna nueva.
- `sea_employees.company_id` admite NULL. Sin empresa no se puede asignar número.
- «Empresa» = `sea_companies` (`company_id`). No confundir con `authCtx.empresaId`
  (cliente de la plataforma): hoy no hay relación entre los dos. No la inventes.
- Ya hay enlaces por `employee_id` a medio usar: `techs.employee_id`
  (`010_techs_employee_id.sql`, emparejado en `GET/PUT /api/techs/vinculo-core`),
  `app_usuarios.employee_id`, y Cash (`server/cash/expenseclaims/empleados.ts`).
  Se reutilizan; no se duplican.
- La web escribe en `sea_employees` directamente desde el navegador
  (`Empleados.tsx`) con RLS `USING (true)`. Lo nuevo de este paso (número) se escribe
  **por el servidor** con `requireAdmin`.

## Fase A — El número en Core (un PR)

1. **Informe previo** `supabase/migrations/core_numero_trabajador_informe.sql`
   (solo lectura): empleados activos sin `company_id`; recuento por empresa; y, por
   cada módulo de la tabla de abajo, cuántos registros tienen ya `employee_id` y cuántos no.
2. **Migración** `supabase/migrations/core_numero_trabajador.sql`:
   - `ALTER TABLE sea_employees ADD COLUMN IF NOT EXISTS numero_trabajador TEXT`.
   - Índice único parcial `(company_id, numero_trabajador) WHERE numero_trabajador IS NOT NULL`.
   - Nada de `NOT NULL` ni `CHECK` obligatorios: se rellena poco a poco.
   - Nada de DROP. Nada sobre otras tablas.
3. **Servidor**: ruta con `requireAdmin` para poner/cambiar el número (normalizado:
   sin espacios, mayúsculas). Número repetido en la misma empresa → 409 diciendo con
   qué empleado choca (solo de esa empresa). Sin empresa → 400 explicándolo.
4. **Web**: columna y filtro «Nº trabajador» en `Empleados.tsx`, campo editable en
   `EmpleadoDetalle.tsx` (solo admin), y una vista «Sin número» para ir rellenándolos.
5. **Tests**: repetido en la misma empresa → 409; mismo número en otra empresa →
   permitido; sin empresa → 400; no-admin → 403; ninguna respuesta revela otra empresa.

## Fase B — Pantalla de enlace por módulo (un PR por módulo)

Una sola pantalla en Core, **Core → Enlazar trabajadores**, con una pestaña por
módulo. Cada fila es un usuario/operario del módulo que aún no tiene `employee_id`;
el admin escribe el número de trabajador (y elige empresa si hace falta), se muestra a
quién corresponde y se confirma. Al confirmar se guarda `employee_id` en la tabla del
módulo. Propuesta automática por nombre solo como pista («por nombre — revisar»);
la confirmación es siempre manual.

Donde la tabla del módulo no tenga `employee_id`, se añade (columna nullable, FK
`ON DELETE SET NULL`, sin trigger). Orden propuesto, de menos a más riesgo:

1. Almacén (`perfiles_usuario`)
2. Recepciones (`rcp_operarios`)
3. Taller (`techs` — ya tiene `employee_id`; se cambia el emparejado por nombre por
   el de número)
4. Cash (destinos persona — ya tiene enlace; mismo cambio)
5. TyreControl, solo operarios internos (`tc_usuarios`)
6. Administración (`app_usuarios.employee_id` — ya existe; `adm_usuarios` es espejo)

## Fase C — Leer de Core y quitar la identidad del módulo (un PR por módulo)

Solo cuando el informe de la Fase A diga que el módulo tiene **todos** sus registros
activos enlazados:

1. El módulo lee nombre/teléfono/activo de `sea_employees` por `employee_id`, con
   vuelta atrás a su propio campo mientras quede alguno sin enlazar.
2. Su pantalla de alta de operarios deja de crear personas: crea solo la parte
   operativa sobre un empleado de Core que ya existe.
3. Los campos de identidad del módulo **no se borran** en esta fase: se dejan de
   escribir. El DROP es un paso posterior, aparte y con su propio informe.

## Fuera de alcance (no lo toques)

- Histórico por nombre (`techName` y similares en partes, pausas, cobros, asistencias):
  sigue apuntando por nombre.
- Logins de las APK y sus PIN (`roadsideOperatorCode`, `codigo_operario` de almacén,
  PIN de TyreControl): siguen igual.
- `app_users` (Panel de taller: contraseña = token de sesión; bloqueante propio).
- Connect Pro / Lite (`connect_users`, `connect_lite_users`) y `assist_panel_users`:
  son usuarios de terceros/talleres cliente, no plantilla.
- Clientes de TyreControl (`tc_usuarios` que no son operarios internos).
- Nombres hardcodeados en código y reglas «Ramón».

## Entregable de cada fase

1. PR con código, tests y migraciones (informe + cambio).
2. Nota fechada al principio de `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md`: qué se ha
   hecho, orden de ejecución manual en Supabase, decisiones pendientes.
3. En la terminal, 5–10 líneas: orden exacto en Supabase y lo pendiente de decidir.

Si algo no se puede determinar desde el código, dilo; no lo inventes.
