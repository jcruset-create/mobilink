# PROMPT — Módulo de Cobros, Seguimiento de Pagos y Recobros (sección "Administración")

> Prompt listo para usar. Copiar y pegar tal cual en Claude Code, trabajando dentro del repo `sea-tarragona`.

---

## Contexto del proyecto (NO crear proyecto nuevo)

Trabajas en el repo existente `sea-tarragona`, una aplicación de planificación de taller ya en producción:

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS 4 + `react-router-dom` v7 + iconos `lucide-react`.
- **Backend/BD:** Supabase (`@supabase/supabase-js` v2). Las migraciones SQL viven en `supabase/migrations/` con nomenclatura por módulo y fase (ej. `tyrecontrol_fase1.sql`).
- **Servidor:** Express en `server/` (usado por otros módulos; solo tocar si es imprescindible).
- **Despliegue:** Render (ya existe `render.yaml`, `.env.example` y build de producción). No reinventar el despliegue: solo añadir las variables de entorno nuevas si las hubiera.
- **Módulos existentes:** la app se organiza por módulos en `src/modules/` (`tyrecontrol`, `almacen-neumaticos`, `cobros`, `safety`, `toolcontrol`, `sea-core`, `presencia`). Cada módulo tiene sus `pages/`, `components/`, `services/`, `types/` y se monta con rutas propias en `src/App.tsx`.

**IMPORTANTE — colisión de nombres:** ya existe `src/modules/cobros/` con una pantalla de enlaces de pago Stripe montada en la ruta `/cobros`. NO tocarla ni reutilizar su carpeta. El módulo nuevo se llama **`administracion`** y vive en `src/modules/administracion/` con rutas `/administracion/*`.

## Qué construir

Un módulo nuevo llamado **"Administración" (Cobros, Seguimiento de Pagos y Recobros)** integrado en la aplicación general, para un taller de neumáticos, camión, flotas, unidades móviles, tacógrafos y mecánica, con dos centros: **Tarragona** y **Reus**.

Controla tres cosas:
1. **Cobros normales del taller** (caja del día).
2. **Seguimiento de pagos** de clientes sin giro bancario domiciliado (control preventivo, NO es recobro).
3. **Recobros** de facturas vencidas o retrasadas.

## Estilo visual — OBLIGATORIO: idéntico a SEA TyreControl

El módulo debe verse exactamente como el programa de gestión de flotas (`src/modules/tyrecontrol/`). Antes de crear componentes, lee estos ficheros y replica su lenguaje visual:

- `src/modules/tyrecontrol/layouts/TyreLayout.tsx` — layout con topbar + sidebar.
- `src/modules/tyrecontrol/components/ui.tsx` — inputs, Field, Badge, Modal, TableWrap, `thCls`/`tdCls`.
- `src/modules/tyrecontrol/pages/Dashboard.tsx` — tarjetas resumen.
- `src/modules/tyrecontrol/config/navigation.ts` — patrón de navegación con visibilidad por rol.

Reglas concretas del estilo:

- **Tema oscuro:** fondo `bg-slate-900`, texto `text-slate-100`, paneles y tarjetas `bg-slate-800`, bordes `border-slate-700`.
- **Acento:** azul `sky` (`text-sky-400`, ítem activo del menú `bg-sky-600 text-white`, focus `focus:ring-sky-500`).
- **Topbar sticky:** icono + nombre del módulo ("SEA Administración", icono `Wallet` o `Euro` de lucide), usuario y rol a la derecha, botón "Salir".
- **Sidebar** de `w-52` con enlaces `rounded-xl px-3 py-2 text-[13px] font-medium`, colapsable en móvil con botón hamburguesa.
- **Tarjetas resumen:** `rounded-lg bg-slate-800 p-4`, título `text-[10px] font-bold uppercase tracking-wide text-slate-400`, valor `text-3xl font-black`.
- **Tablas compactas:** contenedor `overflow-x-auto rounded-lg border border-slate-700 bg-slate-800`, cabeceras `text-[11px] uppercase text-slate-400`, filas con hover.
- **Formularios:** reutilizar el patrón `inputCls` / `Field` / `Modal` de `ui.tsx` (crear copia local del módulo o extraer a compartido, sin romper tyrecontrol).
- **Badges de estado** tipo píldora `rounded-full px-2 py-0.5 text-xs font-bold` con colores semánticos: emerald = cobrado/confirmado, amber = pendiente/recordatorio, sky = en curso, rose = vencido/urgente, slate = cerrado/neutro.
- Botones grandes y claros para acciones rápidas; español en toda la interfaz.

## Estructura del menú (sidebar del módulo)

Sección **Administración** con estos apartados:

1. Cobros del día
2. Seguimiento de pagos
3. Recobros
4. Clientes con seguimiento
5. Configuración de formas de pago
6. Informes

## 1. Cobros del día (`/administracion/cobros-dia`)

Listado de todos los cobros registrados en el día. Columnas: fecha, cliente, matrícula, nº OT, nº factura (si existe), importe, forma de pago, usuario que registró, centro (Tarragona/Reus), observaciones.

Formas de pago iniciales (tabla configurable, no enum hardcodeado): Efectivo, Tarjeta, Transferencia, Bizum empresa, Stripe, Giro bancario, Cuenta cliente, Factura mensual.

Acciones: registrar nuevo cobro (modal), editar cobro, **anular cobro con motivo obligatorio** (no borrar: marcar `is_cancelled` + `cancellation_reason`), exportar listado (CSV/Excel con `xlsx`, ya instalada), filtros por fecha, cliente, centro y forma de pago.

Tarjetas superiores: Total cobrado hoy · Efectivo · Tarjeta · Transferencia · Stripe · Pendiente de revisar.

## 2. Seguimiento de pagos (`/administracion/seguimiento`)

Para clientes SIN giro bancario. Es control preventivo, no recobro.

**Automatización clave:** al cerrar una OT o emitir factura de un cliente con `has_direct_debit = false` y `requires_payment_tracking = true`, se crea automáticamente un registro de seguimiento.

Campos: cliente, CIF/NIF, persona de contacto, teléfono, email, nº OT, nº factura, fecha factura, fecha prevista de pago, importe total, importe pendiente, forma de pago prevista, estado, próxima acción (fecha + descripción), responsable interno, observaciones.

Estados: Pendiente de pago · Recordatorio enviado · Esperando transferencia · Pago parcial · Pago confirmado · Pasado a recobro · Cerrado.

**Dos vistas conmutables:** tablero **Kanban** (columnas: Pendiente de pago, Recordatorio enviado, Esperando transferencia, Pago parcial, Pago confirmado) con tarjetas arrastrables o con botones de cambio de estado, y vista **tabla**.

Acciones rápidas por registro: enviar recordatorio por email (mailto o plantilla), preparar mensaje de WhatsApp (`wa.me` con texto precargado), registrar llamada, añadir nota, registrar pago parcial, registrar pago total, pasar a recobro. Cada acción se guarda en `payment_tracking_actions` (historial).

Tarjetas superiores: Pendiente de pago · Recordatorios enviados · Esperando transferencia · Pagos parciales · Pagos previstos hoy.

## 3. Recobros (`/administracion/recobros`)

Facturas vencidas o retrasadas. Independiente del seguimiento, pero se puede pasar un seguimiento a recobro (crea el expediente y marca el seguimiento como "Pasado a recobro").

Campos: cliente, CIF/NIF, factura, OT relacionada, fecha factura, fecha vencimiento, **días vencidos (calculado)**, importe inicial, importe pendiente, contacto, teléfono, email, estado, prioridad, responsable interno, próxima acción, historial de gestiones, observaciones internas.

Estados: Pendiente · Primer aviso enviado · Segundo aviso enviado · Llamada realizada · Compromiso de pago · Pago parcial · Pago recibido · Cerrado.
Prioridades: Normal · Alta · Urgente.

Acciones rápidas: enviar primer aviso, enviar segundo aviso, preparar WhatsApp, registrar llamada, añadir nota, registrar compromiso de pago (con fecha), registrar pago parcial, registrar pago total, cerrar expediente. Historial en `recovery_actions`.

Tarjetas superiores: Total pendiente · Casos abiertos · Compromisos de pago · Prioridad alta · Acciones vencidas.

**PROHIBIDO usar la palabra "moroso"** en interfaz, código visible al usuario, textos de email o WhatsApp. Usar "recobro", "pago pendiente", "factura vencida".

## 4. Clientes con seguimiento (`/administracion/clientes`)

Listado de clientes + ficha económica por cliente con: forma de pago habitual, tiene giro bancario (Sí/No), requiere seguimiento de pago (Sí/No), días previstos de pago, email de administración, teléfono de administración, persona responsable de pagos, límite interno de crédito (opcional), observaciones económicas. Además, en la ficha: resumen de seguimientos y recobros abiertos del cliente.

Reglas de negocio:
- Cliente con giro bancario → NO entra en seguimiento automático.
- Cliente sin giro + requiere seguimiento → entra automáticamente al emitir factura o cerrar OT.
- Si el pago supera los días previstos sin confirmación → sugerir pasar a recobro (aviso visual, no automático).
- Pago total registrado → el seguimiento se cierra automáticamente.

## 5. Configuración de formas de pago (`/administracion/formas-pago`)

CRUD simple de formas de pago (nombre, activa/inactiva, orden). Solo Admin/Administración.

## 6. Informes (`/administracion/informes`)

Informes básicos con filtros por rango de fechas y centro: cobros por forma de pago y por día, importe pendiente en seguimiento, importe pendiente en recobro, ranking de clientes con más retraso. Exportables a Excel. No es contabilidad completa: solo control operativo.

## Base de datos Supabase

Crear una migración `supabase/migrations/administracion_fase1.sql` (seguir la convención de nombres del repo). Prefijar las tablas con `adm_` para no colisionar con tablas existentes de otros módulos (**antes de escribir el SQL, comprobar qué tablas existen ya** — puede haber `customers`, `work_orders` o `invoices` de otros módulos; si existen y encajan, reutilizarlas en lugar de duplicar).

Tablas mínimas (columnas según la spec):

- `adm_customers` — id, name, tax_id, phone, email, payment_method, has_direct_debit, requires_payment_tracking, expected_payment_days, admin_email, admin_phone, payment_contact_name, internal_credit_limit, economic_notes, created_at, updated_at.
- `adm_work_orders` — id, customer_id, vehicle_plate, status, total_amount, center, created_at, closed_at.
- `adm_invoices` — id, customer_id, work_order_id, invoice_number, invoice_date, due_date, total_amount, pending_amount, status, created_at, updated_at.
- `adm_payment_methods` — id, name, active, sort_order.
- `adm_payments` — id, customer_id, work_order_id, invoice_id, payment_date, amount, payment_method, reference, registered_by, center, notes, is_cancelled, cancellation_reason, created_at, updated_at.
- `adm_payment_tracking` — id, customer_id, work_order_id, invoice_id, total_amount, pending_amount, expected_payment_date, expected_payment_method, status, next_action_date, next_action_note, responsible_user, notes, created_at, updated_at, closed_at.
- `adm_payment_tracking_actions` — id, payment_tracking_id, action_type, action_date, user_id, notes, next_action_date, created_at.
- `adm_recovery_cases` — id, customer_id, invoice_id, work_order_id, due_date, initial_amount, pending_amount, status, priority, responsible_user, next_action_date, internal_notes, created_at, updated_at, closed_at. (`days_overdue` calculado en cliente o vista SQL, no columna almacenada.)
- `adm_recovery_actions` — id, recovery_case_id, action_type, action_date, user_id, notes, next_action_date, created_at.

Detalles: usar `uuid` con `gen_random_uuid()`, `numeric(12,2)` para importes, `timestamptz`, CHECK constraints para estados/prioridades/centros, índices en FKs y en `status`/fechas de próxima acción, trigger `updated_at` automático.

**Automatizaciones en SQL (triggers/funciones):**
1. Trigger al cerrar OT o insertar factura → crear `adm_payment_tracking` si el cliente cumple las condiciones (sin duplicar si ya existe uno abierto para esa factura/OT).
2. Trigger al insertar/anular un pago → recalcular `pending_amount` de factura, seguimiento y recobro asociados.
3. Si `pending_amount` llega a 0 → estado "Pago confirmado"/"Pago recibido" y cierre automático (`closed_at`).
4. Función RPC `pasar_a_recobro(tracking_id)` que crea el `adm_recovery_case` y actualiza el seguimiento.

**RLS:** activar RLS en todas las tablas. Políticas basadas en una tabla de perfiles con rol (mirar cómo lo resuelven `tyrecontrol` o `almacen-neumaticos` y seguir el mismo patrón de autenticación/perfiles del repo — no inventar otro sistema de auth):
- **Admin:** acceso total.
- **Administración:** crear, editar, registrar pagos, cerrar seguimientos y recobros.
- **Recepción:** ver cobros y registrar cobros del día (sin acceso a recobros).
- **Supervisor:** solo lectura del estado económico de OTs; no edita importes.
- **Técnico:** solo puede ver si una OT está autorizada o pendiente; nada de importes ni datos sensibles.

## Avisos (dashboard del módulo)

Al entrar en el módulo, mostrar avisos de: pagos previstos para hoy, seguimientos sin próxima acción definida, facturas que superan la fecha prevista de pago (con botón "Pasar a recobro").

## Estructura de carpetas del módulo

```
src/modules/administracion/
  AdministracionApp.tsx        // rutas internas + guard de rol
  config/navigation.ts
  layouts/AdminLayout.tsx      // topbar + sidebar, clon del patrón TyreLayout
  components/ui.tsx            // Field, Modal, Badge, TableWrap, tarjetas resumen
  components/KanbanBoard.tsx
  pages/CobrosDia.tsx
  pages/Seguimiento.tsx
  pages/Recobros.tsx
  pages/Clientes.tsx
  pages/ClienteFicha.tsx
  pages/FormasPago.tsx
  pages/Informes.tsx
  services/supabase.ts         // reutilizar cliente Supabase existente si lo hay
  services/data.ts             // consultas y mutaciones tipadas
  types/index.ts               // tipos + constantes de estados con labels y colores
```

Montaje en `src/App.tsx`: `<Route path="/administracion/*" element={<AdministracionApp />} />`.

## Entregables

1. Migración SQL completa (`supabase/migrations/administracion_fase1.sql`) con tablas, triggers, funciones y políticas RLS.
2. Módulo React completo según la estructura anterior, con las 6 pantallas funcionando contra Supabase.
3. Lógica de registrar pagos, seguimiento automático y paso a recobro.
4. Actualizar `.env.example` solo si hacen falta variables nuevas.
5. Instrucciones breves en `docs/administracion.md`: cómo aplicar la migración en Supabase, cómo probar en local (`npm run dev`) y confirmación de que el build de Render existente ya lo cubre.

## Restricciones

- NO es un sistema contable completo. NO hay gestión agresiva de morosidad. NO usar la palabra "moroso".
- NO crear app separada, ni proyecto nuevo, ni otro sistema de login: integrar con lo que ya hay.
- NO tocar los módulos existentes (`cobros` Stripe, `tyrecontrol`, `almacen-neumaticos`, etc.) salvo el montaje de rutas en `App.tsx`.
- Rápido de usar para administración: mínimo de clics, filtros rápidos, todo en español.
- Trabajar por fases y compilar (`npm run build`) antes de dar por terminada cada fase.
