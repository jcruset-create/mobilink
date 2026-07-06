# SEA Administración — Cobros, Seguimiento de Pagos y Recobros

Módulo integrado en la aplicación general (`src/modules/administracion/`), accesible en **`/administracion`**.
Estilo visual idéntico a SEA TyreControl (tema oscuro slate + acento sky).

## Puesta en marcha

### 1. Aplicar la migración en Supabase

1. Abre el proyecto en [supabase.com](https://supabase.com) → **SQL Editor**.
2. Pega el contenido completo de [`supabase/migrations/administracion_fase1.sql`](../supabase/migrations/administracion_fase1.sql) y ejecútalo. Es idempotente: se puede ejecutar varias veces sin romper nada.
3. Da de alta tu usuario admin (al final del fichero hay una semilla comentada). Con tu cuenta ya creada en **Authentication → Users**, ejecuta:

```sql
insert into adm_usuarios (id, nombre, email, rol)
select u.id, 'Administrador SEA', u.email, 'admin'
from auth.users u where u.email = 'jcruset@gmail.com'
on conflict (id) do update set rol = 'admin', activo = true;
```

4. Para dar acceso a más usuarios, repite el insert cambiando email, nombre y rol: `admin`, `administracion`, `recepcion`, `supervisor` o `tecnico`.

### 2. Probar en local

```bash
npm run dev
```

Abre `http://localhost:5173/administracion` (o el puerto que indique Vite). El login es por enlace de email (igual que TyreControl). No hacen falta variables de entorno nuevas: usa las mismas `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` que ya están en `.env`.

### 3. Desplegar en Render

Nada nuevo que configurar: el módulo forma parte del build existente (`npm run build`) y del `render.yaml` actual. Al hacer push, Render publica la app con la ruta `/administracion` incluida.

## Pantallas

| Ruta | Pantalla | Roles |
|---|---|---|
| `/administracion/dashboard` | Resumen y avisos | todos |
| `/administracion/cobros-dia` | Cobros del día | admin, administración, recepción, supervisor |
| `/administracion/seguimiento` | Seguimiento de pagos (Kanban + tabla) | admin, administración, supervisor (lectura) |
| `/administracion/recobros` | Recobros | admin, administración, supervisor (lectura) |
| `/administracion/clientes` | Clientes con seguimiento + ficha económica | admin, administración, supervisor (lectura) |
| `/administracion/formas-pago` | Configuración de formas de pago | admin, administración |
| `/administracion/informes` | Informes y exportación Excel | admin, administración, supervisor |
| `/administracion/estado-ots` | Estado de OTs sin importes | técnico, supervisor |

## Flujo de trabajo

1. **Alta de cliente** en "Clientes con seguimiento", indicando si tiene giro bancario, si requiere seguimiento y sus días previstos de pago.
2. **OTs y facturas**: desde la ficha del cliente se crean OTs; desde "Seguimiento de pagos" se crean facturas con el botón *Nueva factura*.
3. **Seguimiento automático**: al emitir una factura (o cerrar una OT sin factura) de un cliente **sin giro bancario** que **requiere seguimiento**, la base de datos crea automáticamente un registro en Seguimiento de pagos con la fecha prevista = fecha base + días previstos del cliente.
4. **Cobros**: al registrar un pago (desde Cobros del día, seguimiento o recobro), los triggers recalculan el pendiente de la factura, del seguimiento y del recobro. Si el pendiente llega a 0, el seguimiento/recobro se cierra automáticamente.
5. **Recobro**: desde el detalle de un seguimiento se puede *Pasar a recobro* (función `adm_pasar_a_recobro`), que crea el expediente y cierra el seguimiento.
6. **Anulación de cobros**: siempre con motivo obligatorio; el cobro no se borra, se marca como anulado y los pendientes se recalculan.

## Permisos (RLS en Supabase)

- **Admin**: acceso total.
- **Administración**: crear/editar todo, registrar pagos, cerrar seguimientos y recobros.
- **Recepción**: ver y registrar cobros del día (no puede editar ni anular; no ve seguimiento/recobros).
- **Supervisor**: lectura de todo, sin edición.
- **Técnico**: solo la vista `adm_ot_estado` (estado de OT sin importes).

Las políticas se aplican en la base de datos (RLS), no solo en la interfaz.

## Clientes unificados (fase 3)

Desde la fase 3, la tabla maestra de clientes de toda la aplicación es **`clientes`** (la misma que usa el almacén). `adm_customers` es su ficha económica 1:1 (mismo id):

- Los clientes creados o editados en el **almacén** aparecen automáticamente en Administración (trigger `adm_sync_cliente`), con seguimiento activado y 30 días de pago por defecto.
- Crear o editar un cliente desde **Administración** escribe en la maestra vía la función `adm_guardar_cliente` (nombre, nº cliente, NIF, teléfono, email) y guarda aparte las condiciones económicas.
- Las migraciones se aplican en orden: `administracion_fase1.sql` → `administracion_fase3_unificar_clientes.sql` (la fase 3 ya incluye la fase 2).

## Envíos automáticos (fase 8)

El servidor procesa cada mañana (a partir de `RECOBROS_NOTIFY_HOUR`, por defecto 08:00) los envíos de recobros:

- **Programados**: desde el expediente → "Programar envío automático" (WhatsApp y/o email al cliente en la fecha elegida). Se pueden cancelar mientras estén pendientes.
- **Automáticos**: recordatorio por WhatsApp al cliente cuyo **compromiso de pago vence hoy**, y **resumen interno** por WhatsApp a los teléfonos configurados en Configuración → "Avisos WhatsApp internos".
- Todo queda en el historial del expediente y en la tabla `adm_notificaciones`.

Configuración necesaria (variables en Render):

| Variable | Qué es |
|---|---|
| `TWILIO_RECOBROS_CONTENT_SID` | Plantilla aprobada de recordatorio al deudor (4 variables: nombre, factura, importe, vencimiento) |
| `TWILIO_RECOBROS_RESUMEN_SID` | Plantilla aprobada del resumen interno (2 variables: fecha, resumen) |
| `RECOBROS_NOTIFY_HOUR` | Hora de envío diario, formato HH:MM (por defecto 08:00) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Cuenta Gmail de empresa para los emails (smtp.gmail.com:587 + contraseña de aplicación) |

Textos sugeridos para las plantillas de Twilio (Content Template Builder → tipo *Text*):

- **Recordatorio deudor**: `Hola {{1}}, le recordamos que la factura {{2}} tiene un importe pendiente de {{3}} con vencimiento {{4}}. Si ya ha realizado el pago, ignore este mensaje. Gracias. — Administración SEA`
- **Resumen interno**: `Resumen de recobros {{1}}: {{2}}`

## Tablas (prefijo `adm_`)

`adm_usuarios`, `adm_customers`, `adm_work_orders`, `adm_invoices`, `adm_payment_methods`, `adm_payments`, `adm_payment_tracking`, `adm_payment_tracking_actions`, `adm_recovery_cases`, `adm_recovery_actions` + vista `adm_ot_estado`.
