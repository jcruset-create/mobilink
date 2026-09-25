# Gastos de trabajadores (tickets, dietas, peajes): análisis y prompt maestro

Documento de la **fase 1: solo análisis**, en su **segunda revisión**. No hay
código, ni migraciones, ni componentes detrás de esto. Consta de:

- **A.** Auditoría de lo que Mobilink Cash es hoy, con los ficheros reales.
- **A bis.** Restricciones comprobadas en la segunda revisión (las que han
  cambiado el diseño).
- **B.** Decisiones definitivas, modelo de datos, flujo, plan de PRs y riesgos.
- **C.** El prompt maestro para la fase 2, escrito contra el código real.

Todo nombre de fichero, tabla, función o endpoint que aparece aquí **existe en
el repositorio** salvo que vaya marcado como `(NUEVO)`.

Idea que no cambia: **la liquidación vive dentro del módulo Cash pero es una
entidad independiente del movimiento de caja. Solo al pagar una liquidación
aprobada se crea un `cash_operations.PAYMENT`.**

---

## A. Auditoría de Mobilink Cash

### A.1 Qué problema resuelve

Cash es la **caja física** de un taller: un cajón con billetes y monedas que se
abre por la mañana, cobra y paga durante el día, se arquea y se cierra. Su
invariante central, escrita en `server/cash/domain/operations.ts`:

> No existe movimiento de efectivo sin su detalle de piezas. Un `+187 €` suelto
> no se puede representar en este modelo.

Y la segunda regla, de la que depende todo lo demás: **el dinero es siempre un
importe positivo en céntimos enteros más una dirección** (`domain/money.ts`,
`validarOperacion` rechaza cualquier importe ≤ 0 con `IMPORTE_NO_VALIDO`).

Por tanto Cash NO es un módulo de contabilidad general ni de gastos: es un
libro mayor de piezas por jornada, con cobros y pagos encima. Todo lo que
entra o sale de dinero pasa por **una sola función**,
`registrarOperacion` (`server/cash/service.ts:555`), dentro de una
transacción que bloquea la jornada (`bloquearSesionOperable`).

### A.2 Estructura

**Backend** (`server/cash/`, ~40.000 líneas con pruebas):

| Fichero | Papel |
|---|---|
| `index.ts` | `initCash` (esquema), `mountCash` (router en `/api/cash`), workers |
| `schema.ts` | DDL con `CREATE TABLE IF NOT EXISTS` + `ALTER … ADD COLUMN IF NOT EXISTS`. **No hay ficheros de migración para `cash_*`**: el esquema se crea y evoluciona al arrancar |
| `router.ts` | Express; `exigirPermiso(...)` por ruta; `ruta()` traduce `ErrorCaja` → HTTP; `contexto(req)` construye `Contexto {empresaId, userId, ip, centroId}` |
| `service.ts` | `registrarOperacion`, `registrarCobro`, `abrirJornada`, `cerrarJornada`, `anularOperacion`, `resumenJornada`, `detalleJornada` |
| `repository.ts` | `enTransaccion`, `insertarOperacion`, `insertarFormasPago`, `siguienteNumero`/`siguienteNumeroDe`, `stockTeorico`, `bloquearSesionOperable`, `ErrorCaja` |
| `domain/` | Motor puro sin BD ni UI: `operations.ts` (tipos, `validarOperacion`), `money.ts`, `inventory.ts`, `change.ts`, `arqueo.ts`, `cotejo.ts`, `puertaDeCierre.ts`… |
| `config.ts` | Catálogos por empresa: cajas, formas de pago, secciones, **conceptos y destinos de gasto** (`listarConceptos`, `listarDestinos`, `crearConcepto`, `crearDestino`, `validarClasificacionGasto`), reglas de pago/sección, equivalencias ERP, `AJUSTES` (`cash_settings`) |
| `documents.ts` / `storage.ts` | Justificantes: `adjuntarDocumento`, `adjuntarDocumentoDeJornada`, `anularDocumento`, `duplicadosDe`, `verificarDocumento`; bucket privado de Supabase con `urlFirmada` (15 min), disco local con `CASH_STORAGE_LOCAL=1` |
| `treasury.ts` | Pedidos de cambio al banco y **entregas de dinero a personas** (`entregarDinero`, `liquidarEntrega`, tabla `cash_advances`) |
| `bankdeposits.ts`, `transfers.ts` | Ingresos bancarios, traspasos entre cajas |
| `invoice-scan/` | Lectura de facturas con IA: `service.ts` (`escanearFactura`, `propuestaDeEscaneo`, `anotarConfirmacion`), `extractor.ts` (`extractorIA`, OpenAI Responses), `schema.ts` (`ESQUEMA_FACTURA` estricto), `normalize.ts`, `classifier.ts` (forma de cobro por reglas), `seccion.ts` (sección por reglas), `validate.ts` (umbrales y avisos), `types.ts` |
| `autoscan/` | Bandeja de documentos que llegan solos desde un escáner (`inbox.ts`, `worker.ts` con `FOR UPDATE SKIP LOCKED`, `promote.ts`) |
| `duplicates.ts` | `cobroPrevioDeFactura(empresa, referencia, client, excluir, sentido)`; autorización de duplicado por **otra persona** con usuario+clave (`autorizarDuplicado`, `consumirAutorizacion`) |
| `permissions.ts` | `PERMISOS`, `POR_ROL`, `rolDeCaja` (lee `app_usuario_modulos` módulo `cash`), `exigirPermiso` |
| `sod.ts`, `reauth.ts` | Separación de funciones (`sodActivo`, `exigirOtraPersona`) y reautenticación (`exigirReautenticacion`), ambas apagadas por defecto vía `cash_settings` |
| `events/` | `emitirEvento` → `cash_event_outbox` (hacia MC Central), tipos `TipoEvento` |
| `expensestats.ts` | `informeDeGasto`: gasto por concepto/destino/periodo, solo lectura |
| `report.ts` | `informeCierre` (pdfkit portada + **pdf-lib** para incrustar justificantes: `montar`, `paginaDeAviso`), `informeIngreso` |
| `erp/` | Conector Business Central; outbox `cash_erp_outbox` |

**Frontend** (`src/modules/cash/`):

- `CashApp.tsx` — rutas bajo `/cash/*` (`jornada`, `cobros`, `pagos`,
  `movimientos`, `dar-cambio`, `stock`, `cambio`, `entregas`, `ingresos`,
  `arqueo`, `cotejo-erp`, `cierre`, `historico`, `informes`, `gasto`, `erp`,
  `configuracion`).
- `config/navigation.ts` — `NAV` con `permiso` por entrada; `navVisible`.
- `layouts/CashLayout.tsx` — topbar + sidebar; selector de caja; recarga la
  jornada en cada cambio de pantalla.
- `contexts/CashContext.tsx` — `useCash()`: `jornada`, `cajaId`, `permisos`,
  `puede(permiso)`, `formasParaPagos`, `formasParaCobros`, `secciones`,
  `denominaciones`, `disponible`, `refrescar`. Todo sale de `GET /bootstrap`.
- `services/api.ts` — un wrapper `pedir<T>()` por endpoint (`registrarPago`,
  `registrarCobro`, `registrarAbono`, `adjuntarDocumento`, `escanearFactura`,
  `anotarResultadoEscaneo`, `conceptosDeGasto`, `entregarDinero`,
  `liquidarEntrega`, `descargarPdf`…).
- `components/` — `DenominationGrid` (piezas), `PaymentMethodPicker`,
  `Justificantes` (adjuntar/anular sobre una operación existente),
  `JustificantePrevio` (fichero «en la mano» antes de confirmar),
  `EscanerFactura` (adjuntar + analizar → `PropuestaEscaneo`),
  `BandejaAutoScan`, `AutorizarDuplicado`, `ui.tsx` (reexporta `Card`,
  `Modal`, `TableWrap`, `inputCls`, `btnPrimary`… de
  `administracion/components/ui.tsx` y añade `BotonAccion`, `Cabecera`,
  `Aviso`, `BotonInforme`).
- `pages/Pagos.tsx` — la pantalla de referencia para esta funcionalidad:
  importe, formas de pago, piezas entregadas/recibidas, **concepto de gasto y
  destino** (dos desplegables dependientes), escáner, justificante previo.
- `types/index.ts` — espejo de los tipos del servidor.
- Sin pruebas de componentes React (`vitest.config.ts`): la lógica de pantalla
  que se quiera probar se extrae a `utils/*.ts` puros.

### A.3 Modelo de datos (lo relevante para gastos)

```
cash_registers ──< cash_sessions ──< cash_operations ──< cash_operation_payments
   (caja)          (jornada)          (cobro/pago/…)        (forma, importe, ref)
                                          │
                                          ├──< cash_denomination_movements (piezas)
                                          ├──< cash_operation_documents (justificantes)
                                          ├──> cash_expense_concepts (expense_concept_id)
                                          ├──> cash_expense_targets  (expense_target_id)
                                          └──> cash_sections         (section_id)
cash_advances (entrega a persona) ──> operation_entrega_id / operation_pago_id / operation_devolucion_id
cash_invoice_scans (rastro de cada lectura IA; session_id y operation_id NULLables)
cash_autoscan_inbox (documento sin dueño: ruta, sha256, estado, scan_id)
cash_event_outbox, cash_erp_outbox, app_auditoria
```

`cash_operations` (schema.ts): `tipo` ∈ `COLLECTION, REFUND, PAYMENT,
MANUAL_IN, MANUAL_OUT, CASH_DELIVERY, BANK_DEPOSIT, ADJUSTMENT, OPENING_FLOAT,
CLOSING_FLOAT, EXCHANGE`; `estado` ∈ `DRAFT, CONFIRMED, REVERSED, CANCELLED`;
`party_nombre`, `concepto` (texto libre), `referencia`, `importe_centimos`,
`efectivo_neto_centimos`, `created_by`, `numero` único (`P-26-003` para pagos
con prefijo de `PREFIJO_POR_TIPO` en `repository.ts`).

`cash_expense_concepts`: `codigo` inmutable derivado del nombre, `nombre`,
`tipo_destino` ∈ `NINGUNO | PERSONA | CENTRO_COSTE`. `cash_expense_targets`:
`tipo` ∈ `PERSONA | CENTRO_COSTE`, `codigo`, `nombre`. **Un destino PERSONA es
un nombre en un catálogo: no está vinculado a `app_usuarios` ni a
`sea_employees`.** Lo mismo pasa con `cash_advances.persona` (texto).

`cash_operation_documents`: `operation_id`, `session_id`, `deposit_id`,
`ruta`, `mime`, `sha256`, `version`, `reemplaza_a`, `sustituido`, `anulado`
(+motivo). Restricción `cash_opdoc_un_ancla`: un documento cuelga de una
jornada (con o sin operación) **o** de un ingreso bancario. Nunca se borra; se
anula (`cash.document.void`).

### A.4 Cómo se crea, edita y elimina una operación

- **Crear**: `POST /collections`, `/refunds`, `/payments`, `/movements`,
  `/exchange`… → `registrarOperacion`. Dentro de la transacción: bloquea la
  jornada, relee el stock, valida el catálogo de formas de pago (`enPagos`,
  `pideReferencia`), la sección, el concepto/destino
  (`validarClasificacionGasto`), las piezas (`validarOperacion`), numera,
  inserta operación + formas + movimientos, comprueba duplicado por referencia
  (`cobroPrevioDeFactura`), emite `OPERATION_REGISTERED`, encola ERP si
  procede y **escribe la auditoría dentro de la transacción**
  (`registrarAuditoriaEnTransaccion`).
- **Editar**: no existe. Una operación es inmutable. Lo único que cambia
  después es la sección (`PATCH /operations/:id/section`, permiso
  `cash.configure`).
- **Eliminar**: no existe. Se **anula** con `POST /operations/:id/reverse`
  (`anularOperacion`, permiso `cash.operation.reverse`), que crea la operación
  inversa y deja `estado = REVERSED`. Con SoD activa, quien anula no puede ser
  quien registró (`exigirOtraPersona`).
- **Justificantes**: siempre **después** de que la operación exista, en otra
  petición (`POST /operations/:id/documents`, `cash.document.attach`). La
  decisión está documentada en `documents.ts` y en `JustificantePrevio.tsx`:
  si el almacenamiento falla, el dinero ya está contado.

### A.5 Ingresos, gastos y pagos: cómo se representan

- **Ingreso de dinero** = `COLLECTION` (cliente) o `MANUAL_IN`.
- **Salida de dinero** = `PAYMENT` (proveedor), `REFUND` (abono a cliente),
  `MANUAL_OUT`, `CASH_DELIVERY` (entrega a una persona que volverá).
- **Gasto** no es un tipo: es un `PAYMENT` o `MANUAL_OUT` **clasificado** con
  `expense_concept_id` (+ `expense_target_id` si el concepto pide persona o
  centro de coste). Clasificar es opcional; lo sin clasificar se enseña aparte
  en `expensestats.ts`. La estadística corta por **fecha de jornada**, no por
  reloj.
- **Formas de pago** (`cash_payment_methods`): en pagos, por defecto solo
  `CASH` (`enPagos = true`); transferencia, TPV, Bizum vienen con
  `enPagos = false` y se activan desde Configuración. Un pago sin parte en
  efectivo no mueve piezas (`validarOperacion`, «si no hay parte en efectivo
  no puede haber piezas»).

### A.6 Estados existentes

| Entidad | Estados |
|---|---|
| `cash_sessions` | `DRAFT, OPEN, PENDING_CLOSE, CLOSED, REOPENED, CANCELLED` |
| `cash_operations` | `DRAFT, CONFIRMED, REVERSED, CANCELLED` |
| `cash_advances` | `ABIERTA, LIQUIDADA, DEVUELTA, CANCELADA` |
| `cash_autoscan_inbox` | `PENDIENTE, ANALIZANDO, LISTO, USADO, FALLIDO, DESCARTADO` |
| `cash_external_documents` | `OPEN, PARTIALLY_PAID, PAID, CANCELLED` |
| outbox ERP / eventos | `PENDING, SENDING, SENT, ERROR, RETRY_PENDING, CANCELLED` |

**No hay en Cash —ni en el resto del repositorio— un flujo de
solicitud → aprobación → pago.** `sod.ts` lo dice expresamente: «no hay un
flujo de solicitud y aprobación con su bandeja. Se valoró y se descartó para
esta fase […] El flujo con bandeja tiene sentido el día que haya acciones que
puedan esperar de verdad». Una liquidación de gastos es exactamente esa
acción. Los módulos `excepciones` y `therefore` tienen bandejas y
validaciones, pero de asistencias/albaranes: no hay nada reutilizable como
motor de aprobación.

### A.7 Permisos y roles

`server/cash/permissions.ts`: el rol viene de `app_usuario_modulos` (módulo
`cash`, columna `rol`, opcionalmente `centro_id` como ámbito). Roles:
`consulta`, `cajero`, `responsable`, `admin`; superadmin = admin. Los permisos
se **derivan** del rol (no hay tabla de permisos). Dos detalles que importan
aquí:

- `cajero` tiene `cash.payment.create` (pagos de factura ERP) pero **no**
  `cash.payment.create_manual`: hoy un cajero no puede registrar un pago
  tecleado a mano ni escanear un ticket de proveedor. Lo puede el
  `responsable`.
- La lista de roles que ofrece Administración al asignar el módulo está en
  `src/modules/administracion/config/modulosApp.ts` (clave `cash`).
- El permiso de `GET /bootstrap` es `cash.view`, y sin bootstrap `CashContext`
  no arranca: **cualquier rol nuevo que deba entrar en `/cash` necesita pasar
  por ahí.**

### A.8 Ficheros y justificantes

Bucket privado `cash-documents` (Supabase Storage) o
`server/uploads/cash` en local; `guardarDocumento`, `leerDocumento`,
`urlFirmada`, `rutaDocumento(empresa, session, operation|null, ext, ahora)`.
Límite 15 MB; MIME real por firma de bytes (`tipoReal` en
`invoice-scan/service.ts`); `sha256` guardado y usado para detectar el mismo
papel dos veces (`duplicadosDe`) y para verificar integridad
(`verificarDocumento`). Subida múltiple ya existe en la pantalla
(`Informes.tsx`: bucle de uno en uno «si el tercero falla, los dos primeros ya
están subidos»). El patrón «documento sin dueño que luego se engancha a una
operación» existe en AutoScan: `cash_autoscan_inbox` guarda ruta y hash; al
usarlo, `promote.ts` crea la fila en `cash_operation_documents` **apuntando al
mismo blob, sin copiar**.

### A.9 Auditoría e histórico

- `app_auditoria` (`server/core/auditoria.ts`): `accion` (`cash.operation.payment`,
  `cash.advance.settle`, `cash.document.attach`…), `entidad`, `entidad_id`,
  `detalle` JSONB, `ip`, `huella`. Dentro de transacción cuando el hecho es de
  dinero.
- `cash_event_outbox`: eventos de dominio hacia MC Central
  (`OPERATION_REGISTERED`, `TRANSIT_OPENED/SETTLED`, `SESSION_CLOSED`…), con
  versión por agregado.
- `cash_invoice_scans`: cada lectura IA con extracción cruda y normalizada,
  propuesta, `campos_corregidos` y `forma_pago_final` (para medir aciertos).
- Histórico de pantalla: `Historico.tsx` (jornadas y operaciones con
  `Justificantes` compacto), `Informes.tsx` (PDF de cierre, taco de escaneos).

### A.10 Relación con trabajadores, proyectos, obras y otros módulos

- **Trabajadores**: en el SaaS la persona es `sea_employees` (Supabase,
  `001_sea_core.sql`; `nombre`, `apellidos`, `dni_nie`, `codigo_operario`,
  `pin_hash`) y el usuario es `app_usuarios` (`employee_id` → `sea_employees`).
  El taller antiguo usa `techs` (por nombre, con `employee_id` opcional,
  `core/vinculoTecnicos.ts`). Recepciones tiene su propio `rcp_operarios`.
  **Cash no usa ninguna de ellas**: sus personas son `cash_expense_targets`
  (tipo PERSONA) y el texto `cash_advances.persona`.
- **Proyectos / obras**: no existe el concepto en el repositorio (los `jobs`,
  `otf_trabajos`, `orm_or` son órdenes de taller). Lo más parecido a imputar
  un gasto a algo es el destino `CENTRO_COSTE`. No hay nada que integrar aquí.
- **Proveedores**: no hay maestro. `party_nombre` es texto; el escáner devuelve
  `emisor.nombre` y `emisor.nif`.
- **Centros**: `app_centros` (jerarquía `hierarchy.ts`), `cash_registers.centro_id`,
  ámbito `cashCentroId` en cada petición; `exigirJornadaPropia` impide operar
  en una caja de otro taller.
- **Otros módulos de Cash que ya viven fuera de una jornada** (precedente para
  una liquidación que se prepara antes de pagarse): `cash_advances`,
  `cash_transfers`, `cash_bank_deposits`, `cash_autoscan_inbox`.

---


## A bis. Restricciones comprobadas en la segunda revisión

Cada una se ha buscado en el repositorio antes de decidir; las que
contradicen una petición de la revisión se dicen aquí y se resuelven en B.

| # | Lo pedido | Lo que hay en el repositorio | Consecuencia |
|---|---|---|---|
| R1 | Identificar al trabajador por `sea_employees.id` | `sea_employees` la crea `supabase/migrations/001_sea_core.sql`, **no** `initDb`/`initCash`: en la base de la CI no existe. Es exactamente el caso de `techs.employee_id` (`supabase/migrations/010_techs_employee_id.sql`: «la clave foránea no puede ir en initDb porque en una base recién creada todavía no existe»). El servidor sí la lee en producción por `pool` (`server/index.ts:2562`) | `employee_id` **sin clave foránea**, con la misma justificación escrita; las pruebas de integración crean un `sea_employees` mínimo como hacen las de Therefore con `app_usuario_modulos` |
| R2 | Ídem | `sea_employees` **no tiene `empresa_id`**: solo `company_id → sea_companies` (tabla anterior al SaaS) y `work_center_id → sea_work_centers`. Ninguna migración posterior la ata a `app_empresas`. La única unión empleado↔empresa que existe es `app_usuarios.employee_id` + `app_usuarios.empresa_id` | El servicio solo puede comprobar `activo`; **el aislamiento por empresa lo da `cash_expense_targets`** (que sí lleva `empresa_id`). Riesgo abierto B.6 |
| R3 | Numeración `LG-26-001` | `siguienteNumeroDe(client, codigo, prefijo, anio)` (`repository.ts:513`) produce SIEMPRE `${codigo}-${prefijo}-${aa}-${seq}`; lo usan `EN`, `CB`, `IB`, `TR`, todos con el código de una caja. `app_centros` **no tiene `codigo`** | Función nueva sobre la misma tabla `cash_document_counters`, clave por empresa; numeración por empresa (por centro no hay código con el que numerar) |
| R4 | Categoría sin exigir `PERSONA` | `validarClasificacionGasto(empresaId, conceptoId, destinoId)` (`config.ts:2148`): con `NINGUNO` el destino debe ser nulo; con `PERSONA`/`CENTRO_COSTE` el destino es **opcional** y, si va, debe ser de ese tipo | Se llama **por línea** con el destino derivado (B.2). No hay que tocarla |
| R5 | Estadística | `expensestats.ts` construye tres consultas sobre `DESDE`/`FILTRO` con `o.expense_concept_id` y `o.expense_target_id` de la operación | Se amplía con una vista/subconsulta de «líneas de gasto» (B.2, PR2). No cambia la semántica de lo existente |
| R6 | Idempotencia del pago | Precedentes: `x-idempotency-key` + `taller_idempotencia` (`server/index.ts:3218`), `idempotency_key` UNIQUE en `cash_autoscan_inbox` y en la cola ERP; el router de Cash ya lee `req.headers["idempotency-key"]` (`router.ts:3007`) | Misma cabecera; la clave se guarda **en la propia liquidación** (B.2) |
| R7 | PDF antes del pago | `informeCierre` y `montar` (`report.ts`) solo dependen de rutas y MIME; nada exige operación | `montar`/`paginaDeAviso` se exportan con el tipo generalizado |
| R8 | Autoservicio futuro sin migración grande | `app_usuarios.employee_id` **ya existe** (`administracion_fase11_usuarios_unificados.sql`) | La propiedad «esta liquidación es mía» será `app_usuarios.employee_id = claim.employee_id`. **No hace falta `cash_expense_targets.user_id`**: se retira del diseño |
| R9 | Varios ficheros en una petición | `subidaDocumento` es `multer.memoryStorage()` con `.single(...)`; `subida()` solo traduce `LIMIT_FILE_SIZE` | `.array("documentos", 20)` con el mismo envoltorio; `LIMIT_UNEXPECTED_FILE` se traduce también |

## B. Decisiones definitivas

### B.1 Decisiones modificadas respecto a la primera versión

| Punto | Antes | Ahora | Por qué |
|---|---|---|---|
| 1. Identidad del trabajador | Destino PERSONA + `cash_expense_targets.user_id` | **`employee_id` (sea_employees) en la liquidación**, sin FK; el destino PERSONA es la *proyección* del empleado dentro de Cash, enlazada por `cash_expense_targets.employee_id` `(NUEVO)`, **una por empleado** (índice único parcial). Nada de `user_id` | Usuario ≠ trabajador; el vínculo usuario→empleado ya existe en `app_usuarios.employee_id`. R1, R2, R8 |
| 2. Numeración | `siguienteNumeroDe` con código de caja (`LG-LG-26-001`) | `siguienteNumeroDeEmpresa` `(NUEVO)` → **`LG-26-001`** por empresa, sobre `cash_document_counters` | R3 |
| 3. Estado de línea | Un solo `estado` mezclando OCR y función | **Dos campos**: `analisis` (PENDIENTE·ANALIZANDO·LISTO·FALLIDO·OMITIDO) y `situacion` (INCLUIDA·EXCLUIDA), más `revisada` | Una línea excluida puede seguir analizándose; una fallida puede incluirse a mano |
| 4. IA obligatoria | Implícito: `LINEA_SIN_ANALIZAR` bloqueaba presentar | **La IA nunca bloquea**: presentar exige datos obligatorios, no análisis. Sin `OPENAI_API_KEY` (`hayIA()` en `core/openaiService.ts`) las líneas nacen `OMITIDO` | Punto 4 |
| 5. Duplicados | `duplicado_de TEXT` | **Tabla de evidencias** `cash_expense_claim_duplicates` `(NUEVO)`: una fila por coincidencia, con tipo, referencia, resolución y quién | Una línea puede coincidir con varias cosas; la resolución es un hecho auditado |
| 6. Categoría vs persona | Solo conceptos `tipo_destino = PERSONA` | **Cualquier concepto activo**. La persona reembolsada es de la cabecera; el destino de cada línea se **deriva**: `PERSONA` → el destino del empleado, `CENTRO_COSTE` → opcional en la línea, `NINGUNO` → nulo | R4: `validarClasificacionGasto` ya lo permite tal cual |
| 7. Idempotencia del pago | Solo `FOR UPDATE` | `FOR UPDATE` **+ `Idempotency-Key`** guardada en `pago_idempotency_key`; misma clave → misma respuesta; otra clave sobre PAGADA → 409 | R6 |
| 8. PDF | Solo tras pagar | **En cualquier estado**: portada con el estado y, cuando existe, el pago y su jornada | R7 |
| 9. Autoservicio | Bloque opcional con rol nuevo y `user_id` | Fuera del alcance; el modelo ya lo soporta con `solicitante_user_id` + `app_usuarios.employee_id`. Sin columnas nuevas | R8 |
| 10. Entrega | Un PR | **Cinco PRs desplegables** (B.4) | Punto 10 |
| Ámbito de centro | `centro_id` en la liquidación al crear | Se mantiene, **nullable**, tomado de `ctx.centroId` al crear y del `register_id` al pagar (`centro_id_pago`) | Coherente con `cashCentroId` y `exigirJornadaPropia` |

Lo que **no** cambia: un solo `PAYMENT` por el total (B.5 de la primera
versión); tickets promovidos al pago sin copiar el fichero (`promote.ts`);
pagar es de `responsable` como cualquier pago manual; el pago exige jornada
abierta; sin conceptos sembrados.

### B.2 Modelo de datos definitivo

Todo en `server/cash/schema.ts` (`initCash`), después de
`cash_expense_concepts`, `cash_expense_targets`, `cash_operations` y
`cash_invoice_scans`. Sin ficheros de migración de Supabase: ninguna tabla
nueva referencia nada que no cree `initDb`/`initCash`.

```sql
-- El empleado dentro de Cash: el destino PERSONA que lo representa.
-- Sin clave foránea a sea_employees (R1). Único por empresa y empleado:
-- una persona, una proyección. Los destinos antiguos siguen con NULL.
ALTER TABLE cash_expense_targets ADD COLUMN IF NOT EXISTS employee_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS cash_expense_targets_employee_idx
  ON cash_expense_targets(empresa_id, employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_expense_claims (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  centro_id UUID,                              -- ámbito al crear; NULL = sin limitar
  numero TEXT NOT NULL,                        -- LG-26-001 (por empresa)
  estado TEXT NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR','PRESENTADA','APROBADA','RECHAZADA','PAGADA','ANULADA')),
  -- Quién cobra. employee_id es la identidad (sea_employees.id, sin FK);
  -- expense_target_id es su proyección en Cash (tenant, estadísticas);
  -- empleado_nombre es la foto para el histórico, como party_nombre.
  employee_id UUID,
  expense_target_id INTEGER NOT NULL REFERENCES cash_expense_targets(id) ON DELETE RESTRICT,
  empleado_nombre TEXT NOT NULL,
  solicitante_user_id UUID,                    -- quien la creó; base del autoservicio futuro
  periodo_desde DATE, periodo_hasta DATE,      -- de las líneas incluidas, al presentar
  total_centimos BIGINT NOT NULL DEFAULT 0,    -- suma de INCLUIDAS; siempre recalculado en servidor
  notas TEXT,
  presentada_por UUID, presentada_at_ms BIGINT,
  aprobada_por UUID,   aprobada_at_ms BIGINT,
  rechazo_motivo TEXT, rechazada_por UUID, rechazada_at_ms BIGINT,
  -- El pago: la única unión con el movimiento de caja.
  operation_pago_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
  session_id_pago INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  centro_id_pago UUID,
  pago_idempotency_key TEXT,                   -- ver B.3 (7)
  pagada_por UUID,     pagada_at_ms BIGINT,
  anulada_por UUID,    anulada_at_ms BIGINT, anulada_motivo TEXT,
  version BIGINT NOT NULL DEFAULT 0,           -- como cash_sessions.version: cada transición la sube
  creado_por UUID, created_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL,
  UNIQUE (empresa_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_expense_claims_pago_idx
  ON cash_expense_claims(operation_pago_id) WHERE operation_pago_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cash_expense_claims_estado_idx
  ON cash_expense_claims(empresa_id, estado, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS cash_expense_claim_lines (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  claim_id INTEGER NOT NULL REFERENCES cash_expense_claims(id) ON DELETE RESTRICT,
  orden INTEGER NOT NULL DEFAULT 0,
  -- El justificante, como en cash_autoscan_inbox: vive aquí hasta que el pago existe.
  nombre TEXT NOT NULL, mime TEXT NOT NULL, tamano_bytes INTEGER NOT NULL,
  ruta TEXT NOT NULL, sha256 TEXT NOT NULL,
  -- (3) Dos estados independientes.
  analisis TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (analisis IN ('PENDIENTE','ANALIZANDO','LISTO','FALLIDO','OMITIDO')),
  situacion TEXT NOT NULL DEFAULT 'INCLUIDA'
    CHECK (situacion IN ('INCLUIDA','EXCLUIDA')),
  excluida_motivo TEXT, excluida_por UUID, excluida_at_ms BIGINT,
  -- Una persona ha confirmado los datos obligatorios (a mano o dando por buena la lectura).
  revisada BOOLEAN NOT NULL DEFAULT false, revisada_por UUID, revisada_at_ms BIGINT,
  scan_id INTEGER REFERENCES cash_invoice_scans(id) ON DELETE SET NULL,
  analisis_error TEXT, analisis_intentos INTEGER NOT NULL DEFAULT 0,
  -- Lo LEÍDO no se toca después; lo REVISADO es lo que vale.
  leido JSONB,
  fecha DATE,
  emisor_nombre TEXT NOT NULL DEFAULT '', emisor_nif TEXT,
  numero_documento TEXT,
  concepto TEXT NOT NULL DEFAULT '',
  base_centimos BIGINT, iva_centimos BIGINT,
  importe_centimos BIGINT NOT NULL DEFAULT 0 CHECK (importe_centimos >= 0),
  moneda TEXT NOT NULL DEFAULT 'EUR',
  -- (6) Categoría del gasto; cualquier concepto activo. El destino solo se
  -- guarda cuando el concepto pide CENTRO_COSTE; el de PERSONA se deriva de la cabecera.
  expense_concept_id INTEGER REFERENCES cash_expense_concepts(id) ON DELETE SET NULL,
  expense_target_id  INTEGER REFERENCES cash_expense_targets(id)  ON DELETE SET NULL,
  concepto_propuesto_id INTEGER, concepto_confianza NUMERIC(3,2), concepto_regla_id INTEGER,
  campos_corregidos JSONB,
  subido_por UUID, subido_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_expense_claim_lines_claim_idx ON cash_expense_claim_lines(claim_id, orden);
CREATE INDEX IF NOT EXISTS cash_expense_claim_lines_sha_idx   ON cash_expense_claim_lines(empresa_id, sha256);
CREATE INDEX IF NOT EXISTS cash_expense_claim_lines_clave_idx
  ON cash_expense_claim_lines(empresa_id, emisor_nif, fecha, importe_centimos);

-- (5) Cada coincidencia es una fila, con su resolución. Nada se borra.
CREATE TABLE IF NOT EXISTS cash_expense_claim_duplicates (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  line_id INTEGER NOT NULL REFERENCES cash_expense_claim_lines(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN ('MISMO_FICHERO','MISMA_CLAVE','MISMO_NUMERO')),
  -- Con qué coincide: otra línea, un justificante ya colgado de un pago, o una operación.
  referencia_tipo TEXT NOT NULL CHECK (referencia_tipo IN ('LINEA','DOCUMENTO','OPERACION')),
  referencia_id INTEGER NOT NULL,
  referencia_numero TEXT,                      -- LG-26-003 / P-26-041, para enseñarlo sin JOIN
  detectado_en TEXT NOT NULL CHECK (detectado_en IN ('SUBIDA','ANALISIS','PRESENTAR','PAGAR')),
  detectado_at_ms BIGINT NOT NULL,
  resolucion TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (resolucion IN ('PENDIENTE','ACEPTADA','EXCLUIDA','DESCARTADA')),
  -- ACEPTADA: no es duplicado, se mantiene (motivo obligatorio).
  -- EXCLUIDA: se excluyó la línea por esto. DESCARTADA: la referencia dejó de existir (p. ej. pago anulado).
  resuelto_por UUID, resuelto_at_ms BIGINT, motivo TEXT,
  UNIQUE (line_id, tipo, referencia_tipo, referencia_id)
);

-- Reglas de concepto: mismo molde que cash_section_rules.
CREATE TABLE IF NOT EXISTS cash_expense_rules (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  campo TEXT NOT NULL CHECK (campo IN ('TIPO_ESTABLECIMIENTO','NOMBRE_EMISOR','NIF_EMISOR','CONCEPTO')),
  patron TEXT NOT NULL,
  expense_concept_id INTEGER NOT NULL,         -- sin FK, como cash_section_rules → cash_sections
  confianza NUMERIC(3,2) NOT NULL DEFAULT 0.9,
  auto_seleccionar BOOLEAN NOT NULL DEFAULT true,
  prioridad INTEGER NOT NULL DEFAULT 100,
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_por UUID, created_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL,
  UNIQUE (empresa_id, campo, patron)
);
```

Relación con lo existente, sin duplicar identidad:

```
sea_employees.id ──(sin FK)──> cash_expense_claims.employee_id
       │                              │
       └──(sin FK)──> cash_expense_targets.employee_id  <── cash_expense_claims.expense_target_id
app_usuarios.employee_id  (ya existe)  → propiedad «mía» del autoservicio futuro
cash_expense_claims.operation_pago_id  → cash_operations (PAYMENT)  → cash_operation_documents (promovidos)
```

### B.3 Flujo definitivo

```
crear(empleado) ─► BORRADOR ─ subir tickets ─► líneas (analisis: PENDIENTE→…; situacion: INCLUIDA)
                       │                              │ worker: LISTO | FALLIDO   (o OMITIDO sin IA)
                       │                              │ persona: corrige, marca revisada, incluye/excluye
                       │◄─── REABRIR ──── RECHAZADA   │ duplicados: evidencias → ACEPTADA | EXCLUIDA
                       ▼                              │
                  PRESENTAR (recalcula total y periodo; congela líneas)
                       ▼
                  PRESENTADA ─ APROBAR (permiso; SoD; reauth si activa) ─► APROBADA
                       │                                                       │
                       └─ RECHAZAR (motivo) ─► RECHAZADA                       ▼
                                                        PAGAR (jornada abierta; Idempotency-Key)
                                                          = 1 PAYMENT por el total + promoción de tickets
                                                                               ▼
                                                                            PAGADA
                                                        anularOperacion(pago) ─► APROBADA (gancho, misma transacción)
  ANULAR (motivo) desde BORRADOR | PRESENTADA | APROBADA | RECHAZADA ─► ANULADA   (nunca desde PAGADA)
```

Reglas del flujo, una por punto de la revisión:

1. **Identidad.** `crearLiquidacion(ctx, { employeeId | expenseTargetId, notas })`:
   si llega `employeeId`, comprueba en `sea_employees` que existe y está
   activo (solo eso: R2), busca el destino PERSONA con ese `employee_id` y,
   si no existe, lo **crea** (nombre `apellidos, nombre`, código derivado con
   `codigoDesde` de `config.ts`) o lo **propone** si hay uno sin vincular con
   nombre igual (`normalizarNombre` de `core/vinculoTecnicos.ts`; se pide
   confirmación, nunca se enlaza solo). Si llega `expenseTargetId` (destino
   PERSONA sin empleado vinculado, caso de transición), se admite y se marca
   «sin empleado vinculado» en la lista. `empleado_nombre` se fotografía al
   crear.
2. **Numeración.** `siguienteNumeroDeEmpresa(client, empresaId, "LG", anio)`
   `(NUEVO)` en `repository.ts`: clave `${empresaId}:LG:${anio}` en
   `cash_document_counters`, formato `LG-${aa}-${seq3}`. Año = el de creación.
3. **Estados de línea.** `analisis` lo mueve solo el worker (y `reintentar`);
   `situacion` y `revisada` los mueve solo una persona. Excluir no cancela un
   análisis en curso; un `FALLIDO` incluido es válido si está `revisada`.
4. **La IA no es requisito.** `puedePresentar` exige, por línea INCLUIDA:
   `fecha`, `importe_centimos > 0`, `expense_concept_id`, `moneda = 'EUR'`,
   `revisada = true`, y ninguna evidencia de duplicado `PENDIENTE`. No mira
   `analisis`. Con `hayIA() === false` las líneas nacen `OMITIDO` y la
   pantalla pide los datos a mano desde el principio.
5. **Duplicados.** Tres detecciones, cada una escribe evidencias:
   `MISMO_FICHERO` (sha256, en SUBIDA: contra líneas de la empresa no
   excluidas de liquidaciones no anuladas, y contra `cash_operation_documents`
   no anulados vía `duplicadosDe`), `MISMA_CLAVE` (emisor_nif|nombre
   normalizado + fecha + importe, en ANALISIS y al editar), `MISMO_NUMERO`
   (`cobroPrevioDeFactura(..., "PAGO")`, en ANALISIS, al editar y **otra vez
   en PRESENTAR y PAGAR**, porque el mundo cambia: es lo que hace
   `propuestaDeEscaneo`). Resolver: `ACEPTADA` con motivo (auditado) o
   `EXCLUIDA` (excluye la línea). Si al anular un pago desaparece la
   referencia, la evidencia pasa a `DESCARTADA`.
6. **Categoría y persona.** Al pagar, por cada línea INCLUIDA se llama
   `validarClasificacionGasto(empresaId, conceptId, destinoDerivado)` con
   `destinoDerivado` = `claim.expense_target_id` si el concepto es `PERSONA`,
   `line.expense_target_id` si es `CENTRO_COSTE`, `null` si es `NINGUNO`. Un
   concepto desactivado entre la aprobación y el pago falla con
   `CONCEPTO_INACTIVO` dentro de la transacción. `expensestats.ts` suma esas
   líneas con ese destino derivado (C.8).
7. **Idempotencia del pago.** `POST /expense-claims/:id/pay` exige
   `Idempotency-Key` (cabecera, o `idempotencyKey` en el cuerpo, como
   `router.ts:3007`). Dentro de la transacción y con la fila bloqueada:
   `APROBADA` → paga y guarda la clave; `PAGADA` con la **misma** clave →
   200 con el mismo resultado (número de pago, operación), sin tocar nada;
   `PAGADA` con **otra** clave → 409 `LIQUIDACION_YA_PAGADA`. El navegador
   genera la clave con `crypto.randomUUID()` al abrir el modal y la reutiliza
   en el reintento. Sin clave → 400.
8. **PDF.** `informeLiquidacion` en cualquier estado: portada con el estado
   grande; pie con presentada/aprobada/pagada rellenos o «pendiente»; cuando
   está pagada, número del pago, jornada y formas; anexos = líneas INCLUIDAS.
   En BORRADOR lleva la marca «Borrador».
9. **Autoservicio.** Fuera del alcance. Lo que ya queda preparado:
   `solicitante_user_id`, `employee_id`, y la comprobación futura
   `app_usuarios.employee_id = claim.employee_id`. Sin columnas nuevas.
10. **Entrega por fases.** B.4.

### B.4 Plan de PRs (cada uno desplegable y con CI verde)

| PR | Contenido | Sirve ya para | Toca código existente |
|---|---|---|---|
| **PR1 · Liquidación manual** | Esquema completo (B.2), `siguienteNumeroDeEmpresa`, `expenseclaims/domain.ts` + `service.ts` + `lines.ts` (subida multi-fichero con `MISMO_FICHERO`, edición manual, incluir/excluir, revisada), presentar/aprobar/rechazar/reabrir/anular con SoD y reauth, permisos, endpoints, pantalla básica, PDF (`informeLiquidacion`). Líneas nacen `OMITIDO` (sin worker) | Preparar, revisar y aprobar liquidaciones con datos tecleados; PDF para firmar | `schema.ts`, `repository.ts`, `permissions.ts`, `router.ts`, `report.ts` (exportar `montar`/`paginaDeAviso`), `navigation.ts`, `CashApp.tsx`, `api.ts`, `types/index.ts` |
| **PR2 · Pago** | `pagar` con `registrarOperacion`, promoción de tickets, idempotencia, gancho en `anularOperacion`, `expensestats.ts` con líneas, modal de pago, enlace desde `Historico.tsx` | Cerrar el ciclo: el dinero sale del cajón y los tickets van al informe de cierre | `service.ts` (`anularOperacion`), `expensestats.ts`, `Historico.tsx` |
| **PR3 · Lectura automática** | `tipo_establecimiento` en el esquema/normalización del escáner, worker de análisis, `leido`, propuesta por línea, `cash_expense_rules` + `clasificarConcepto` + bloque en `Configuracion.tsx`, `campos_corregidos` | Que el 80 % de las líneas lleguen rellenas | `invoice-scan/schema.ts`, `types.ts`, `normalize.ts`, `config.ts`, `index.ts` (worker) |
| **PR4 · Duplicados completos** | `MISMA_CLAVE` y `MISMO_NUMERO`, re-detección en presentar/pagar, `DESCARTADA` al anular pago, panel de evidencias con resolución | Que no se pague dos veces el mismo ticket | `anularOperacion` (segunda vez, pequeña) |
| **PR5 · Empleados** | `cash_expense_targets.employee_id` en Configuración (selector de `sea_employees` activos, propuesta por nombre con `normalizarNombre`, confirmación manual), creación de liquidación **por empleado**, filtro por empleado | Identidad limpia y lista para el autoservicio | `Configuracion.tsx`, `config.ts` |

PR1 ya lleva la columna `employee_id` y admite `employeeId` en la creación
(para no migrar después); lo que PR5 añade es la pantalla para vincular.
Orden alternativo si se quiere valor antes: PR1 → PR2 → PR5 → PR3 → PR4.

### B.5 Riesgos que siguen abiertos

1. **`sea_employees` no está atada a la empresa (R2).** Con varias empresas
   en la misma instalación, el selector de empleados enseñaría a todos. Hoy
   hay un tenant (`DEFAULT_EMPRESA_ID`). La atadura real es
   `cash_expense_targets.empresa_id`; si algún día hace falta, se filtra por
   `app_usuarios.empresa_id` de los empleados con usuario, o se añade
   `empresa_id` a `sea_employees` por migración de Supabase.
2. **Pruebas de integración con `sea_employees`.** No existe en la CI: la
   suite crea un stub mínimo (`id, nombre, apellidos, activo`) como hacen las
   de Therefore con `app_usuario_modulos`. Cualquier columna más que se use en
   producción hay que añadirla al stub a mano.
3. **Un blob, varias filas.** Al promover, el objeto del bucket queda
   referenciado por la línea y por `cash_operation_documents`. Ya pasa con
   AutoScan; una política de retención tendrá que mirar ambas.
4. **Coste y tiempo de la IA.** Cinco tickets = cinco llamadas. El worker
   acota (lote 3 / 15 s) pero no hay presupuesto por empresa.
5. **Fiscalidad.** Una factura simplificada sin NIF del receptor no es
   deducible. Se guarda lo leído y se avisa; no se decide nada.
6. **Sin ticket no hay línea.** Un gasto sin justificante (peaje sin recibo)
   no cabe en este modelo. Si hace falta, sería una línea sin fichero con
   permiso de responsable y motivo; queda fuera hasta que alguien lo pida.
7. **Gancho en `anularOperacion`.** Es la única modificación de una función
   central del módulo; se protege con prueba de integración y mutación.
8. **Catálogo de conceptos vacío.** Sin «Dietas» no hay a qué clasificar. La
   pantalla lo dice; no se siembra.
9. **El pago exige jornada abierta.** Una liquidación aprobada un domingo se
   paga el lunes. Es el mismo precio que ya pagan las entregas de dinero.

---

## C. PROMPT MAESTRO (fase 2: implementación, versión corregida)

> Copiar desde aquí hasta el final en una conversación nueva. Indica en el
> primer mensaje **qué PR del plan (C.2) se implementa**; cada PR se entrega,
> se mergea y se despliega por separado.

### C.0 Contexto y reglas de la casa

Vas a implementar **liquidaciones de gastos de trabajadores** en Mobilink
Cash (repositorio `jcruset-create/mobilink`). Antes de tocar nada lee
`CLAUDE.md`, `docs/mobilink-cash.md` (§7 ter, §7 quater, §7 novies,
§7 undecies) y `docs/PROMPT_gastos_trabajadores.md` entero: la parte A es la
auditoría, A bis las restricciones comprobadas y B las decisiones **ya
tomadas**; no las reabras. Trabaja en la rama que se te indique; `git fetch
origin main` y `git merge origin/main` antes de empezar; `bash
scripts/check-versions.sh` antes de cada commit; sube la versión de
`package.json`; al acabar, PR y merge cuando la CI esté verde, comprobando que
el diff contra `main` solo trae tus ficheros.

Principio que gobierna todo: **la liquidación vive dentro de Cash pero es una
entidad independiente del movimiento de caja; solo al pagar una liquidación
aprobada se crea un `cash_operations.PAYMENT`, a través de
`registrarOperacion` y de nadie más.**

Convenciones sin excepción:

- Dinero en **céntimos enteros y positivos** (`Centimos`, `domain/money.ts`).
- Comentarios y nombres en castellano, con el porqué de cada decisión, como
  el resto de `server/cash/`.
- Nada se borra: se anula o se excluye con motivo y auditoría.
- Todo hecho de dinero se escribe **dentro de la transacción** con
  `registrarAuditoriaEnTransaccion`; lo demás con `registrarAuditoria`.
- Las comprobaciones de negocio van en el servicio, dentro de la transacción,
  no en el router ni en el navegador.
- Sin pruebas de componentes React: la lógica de pantalla que merezca prueba
  va en `src/modules/cash/utils/*.ts`.
- `tsconfig.server.json` tiene `strict: false`: no cuentes con narrowing de
  uniones por booleanos; usa discriminantes de texto.
- Servidor en `server/cash/expenseclaims/` `(NUEVO)`: `domain.ts` (puro),
  `service.ts` (ciclo de vida), `lines.ts` (líneas y ficheros),
  `duplicates.ts` (evidencias), `conceptos.ts` (clasificador), `report.ts`
  (PDF), `worker.ts` (análisis). Pantalla en `src/modules/cash/pages/`,
  tipos en `src/modules/cash/types/index.ts`, API en
  `src/modules/cash/services/api.ts`.

### C.1 Alcance

Flujo: **el mostrador crea la liquidación a nombre de un empleado → sube
varios PDF/imágenes → lectura automática si hay IA (nunca obligatoria) →
revisión y corrección → total por concepto → presentar → aprobar → pagar (del
cajón o por transferencia) → los tickets quedan como justificantes del pago →
PDF con resumen y anexos en cualquier estado.**

Ejemplo de referencia (pruebas y pantalla renderizada):

```
Dietas: 66,40 €
Peajes: 15,88 €
TOTAL: 82,28 €
```

Fuera del alcance: autoservicio del trabajador (el modelo ya lo soporta:
`solicitante_user_id` + `app_usuarios.employee_id`); líneas sin
justificante; envío del pago al ERP.

### C.2 Plan de PRs

Implementa **solo el PR que se te pida**, en este orden salvo indicación:

1. **PR1 · Liquidación manual** — C.3, C.4 (sin `pagar`), C.5 (solo
   `MISMO_FICHERO`), C.7, C.9, C.10 (sin modal de pago), C.11, C.13, C.14.
   Las líneas nacen con `analisis = 'OMITIDO'`.
2. **PR2 · Pago** — `pagar` (C.4), promoción de tickets (C.3), gancho en
   `anularOperacion`, idempotencia, `expensestats.ts` (C.8), modal de pago,
   enlace desde `Historico.tsx`.
3. **PR3 · Lectura automática** — C.6 entero, worker, `leido`, reglas de
   concepto y su bloque en `Configuracion.tsx`.
4. **PR4 · Duplicados completos** — `MISMA_CLAVE`, `MISMO_NUMERO`,
   re-detección en presentar/pagar, `DESCARTADA` al anular pago, panel de
   evidencias.
5. **PR5 · Empleados** — vínculo `cash_expense_targets.employee_id` en
   Configuración, propuesta por nombre, creación por empleado en la pantalla.

Cada PR: tests nuevos en verde, mutaciones en rojo, tres typechecks, `npm run
build`, render de lo visible, sección de `docs/mobilink-cash.md` actualizada.

### C.3 Esquema y almacenamiento

- Añade a `initCash` (`server/cash/schema.ts`) **exactamente** el DDL de
  B.2, después de `cash_expense_concepts`, `cash_expense_targets`,
  `cash_operations` y `cash_invoice_scans`, con un comentario de bloque por
  tabla en el estilo del fichero. Sin FK a `sea_employees` (A bis R1) y
  dilo en el comentario citando `010_techs_employee_id.sql`.
- Prueba el arranque contra PostgreSQL real dos veces seguidas (idempotencia
  del DDL).
- `server/cash/storage.ts`: `rutaDeTicket(empresaId, claimId, ext, ahora)`
  `(NUEVO)` → `${empresaId}/gastos/${claimId}/${ahora}${ext}`, junto a
  `rutaDocumento`. Mismo bucket, mismos `guardarDocumento`, `leerDocumento`,
  `urlFirmada`.
- Validación del fichero con `exigirDocumentoValido` (`invoice-scan/service.ts`).
- **Promoción al pagar** (PR2): por cada línea INCLUIDA, una fila en
  `cash_operation_documents` (`operation_id` = el pago, `session_id` = su
  jornada, `ruta`/`sha256`/`mime`/`nombre` copiados), **sin copiar el
  fichero**, como `autoscan/promote.ts`, y con su mismo comentario sobre
  retención.

### C.4 Servicio (`server/cash/expenseclaims/`)

**`domain.ts`** (puro, con pruebas unitarias):

```ts
export type EstadoLiquidacion = "BORRADOR"|"PRESENTADA"|"APROBADA"|"RECHAZADA"|"PAGADA"|"ANULADA";
export type Accion = "PRESENTAR"|"APROBAR"|"RECHAZAR"|"REABRIR"|"PAGAR"|"ANULAR"|"DESHACER_PAGO";
export function transicion(desde: EstadoLiquidacion, accion: Accion): EstadoLiquidacion | null;
export function totalesPorConcepto(lineas): { porConcepto: {conceptoId: number|null; nombre: string; importeCentimos: number}[]; totalCentimos: number; lineas: number };
export function periodoDe(lineas): { desde: string|null; hasta: string|null };
export function claveDeDuplicado(l: {emisorNif: string|null; emisorNombre: string; fecha: string|null; importeCentimos: number}): string | null;
export function puedePresentar(lineas, evidenciasPendientes): { ok: true } | { ok: false; codigo: CodigoBloqueo; lineaId?: number };
export function destinoDerivado(concepto: {tipoDestino}, claimTargetId: number, lineTargetId: number|null): number | null;
```

Transiciones: `BORRADOR→PRESENTADA`, `PRESENTADA→APROBADA|RECHAZADA`,
`RECHAZADA→BORRADOR` (REABRIR), `APROBADA→PAGADA`, `PAGADA→APROBADA`
(DESHACER_PAGO, solo desde el gancho de `anularOperacion`),
`{BORRADOR,PRESENTADA,APROBADA,RECHAZADA}→ANULADA`. Lo demás `null` →
`ErrorCaja("TRANSICION_NO_VALIDA", …, 409)`.

`puedePresentar` mira **solo** líneas `INCLUIDA`: `fecha`, `importe > 0`,
`expense_concept_id`, `moneda === "EUR"`, `revisada`, y ninguna evidencia
`PENDIENTE`. **No mira `analisis`.** Códigos: `SIN_LINEAS`,
`LINEA_SIN_FECHA`, `LINEA_SIN_IMPORTE`, `LINEA_SIN_CONCEPTO`,
`LINEA_EN_OTRA_MONEDA`, `LINEA_SIN_REVISAR`, `DUPLICADO_SIN_RESOLVER`.

**`service.ts`**:

- `crearLiquidacion(ctx, { employeeId?, expenseTargetId?, notas? })` — uno de
  los dos. Con `employeeId`: `SELECT id, nombre, apellidos, activo FROM
  sea_employees WHERE id = $1` (solo existencia y `activo`: A bis R2); busca
  el destino PERSONA de la empresa con ese `employee_id`; si no hay, lo crea
  con `crearDestino` de `config.ts` (nombre «Apellidos, Nombre») y
  `employee_id`; si hay uno **sin vincular** con el mismo nombre normalizado
  (`normalizarNombre` de `core/vinculoTecnicos.ts`), devuelve
  `ErrorCaja("DESTINO_SIN_VINCULAR", …, 409)` con el candidato para que la
  pantalla ofrezca vincularlo (PR5) —nunca se enlaza solo—. Con
  `expenseTargetId`: destino PERSONA activo de la empresa. `centro_id =
  ctx.centroId`, `empleado_nombre` fotografiado, `numero` con
  `siguienteNumeroDeEmpresa(client, ctx.empresaId, "LG", añoActual)`
  `(NUEVO en repository.ts)`: clave `${empresaId}:LG:${anio}` en
  `cash_document_counters`, formato `LG-${aa}-${seq.padStart(3,"0")}`.
  Audita `cash.expense_claim.create`.
- `listar(ctx, { estado?, expenseTargetId?, employeeId?, desde?, hasta? })` —
  por `empresa_id`; si `ctx.centroId` no es null, `centro_id = ctx.centroId
  OR centro_id IS NULL` (documenta el OR: una liquidación creada sin ámbito
  la ve todo el mundo, como las cajas sin `centro_id`).
- `detalle(ctx, id)` — cabecera, líneas con `url` firmada, evidencias por
  línea, `totalesPorConcepto`, `puedePresentar` ya evaluado (para que la
  pantalla enseñe qué falta sin duplicar la regla).
- `presentar(ctx, id)` — `FOR UPDATE`; `puedePresentar`; re-detecta
  `MISMO_NUMERO` (PR4); recalcula `total_centimos`, `periodo_*`; congela.
- `aprobar(ctx, id)` — permiso `cash.expense_claim.approve`; con
  `sodActivo(empresaId)`, `presentada_por !== ctx.userId` (mismo código y
  mensaje que `exigirOtraPersona` de `sod.ts`); con `reauthActivo`,
  `exigirReautenticacion(ctx.userId)`.
- `rechazar(ctx, id, motivo)`, `reabrir(ctx, id)`, `anular(ctx, id, motivo)`.
- `pagar(ctx, id, { sessionId, formasPago, efectivoEntregado?, efectivoRecibido?, idempotencyKey })`
  (PR2) — permiso `cash.expense_claim.pay`. **Una transacción**:
  1. `SELECT … FOR UPDATE` de la liquidación.
  2. Si `estado = 'PAGADA'`: misma `pago_idempotency_key` → devuelve el
     resultado guardado (número, `operation_pago_id`) sin escribir nada;
     distinta → `ErrorCaja("LIQUIDACION_YA_PAGADA", …, 409)`.
  3. `transicion(estado, "PAGAR")`; `bloquearSesionOperable` +
     `exigirJornadaPropia` (lo hace `registrarOperacion`).
  4. Por cada línea INCLUIDA: `validarClasificacionGasto(empresaId,
     conceptId, destinoDerivado(...))` — un concepto desactivado entre
     medias falla aquí con `CONCEPTO_INACTIVO`.
  5. Re-detección `MISMO_NUMERO` (PR4); si hay evidencia nueva sin resolver,
     `DUPLICADO_SIN_RESOLVER`.
  6. `registrarOperacion(ctx, { sessionId, tipo: "PAYMENT", importeCentimos:
     total, formasPago, efectivoEntregado, efectivoRecibido, partyNombre:
     empleado_nombre, concepto: "Liquidación LG-26-001 (Dietas 66,40 · Peajes
     15,88)", referencia: numero, expenseConceptId: null, expenseTargetId:
     null }, client)`. Si `formasPago` no lleva efectivo, no se mandan piezas.
  7. Promoción de tickets (C.3).
  8. `UPDATE` a `PAGADA` con `operation_pago_id`, `session_id_pago`,
     `centro_id_pago`, `pago_idempotency_key`, `pagada_*`, `version + 1`.
  9. `registrarAuditoriaEnTransaccion` `cash.expense_claim.pay` con el número
     del pago, el total y el desglose por concepto.
- **Gancho en `anularOperacion`** (`server/cash/service.ts`, PR2): si la
  operación tiene una liquidación con `operation_pago_id = id`, en la misma
  transacción: `DESHACER_PAGO` (→ `APROBADA`, limpia `operation_pago_id`,
  `session_id_pago`, `pago_idempotency_key`, `pagada_*`), anula (no borra)
  las filas promovidas de `cash_operation_documents` con motivo «pago
  anulado», marca `DESCARTADA` las evidencias que apuntaban a ese pago (PR4),
  audita `cash.expense_claim.payment_reversed`. Con prueba de integración y
  mutación (quitar el gancho debe poner en rojo).

**`lines.ts`**:

- `subirTickets(ctx, claimId, ficheros[])` — solo `BORRADOR`; de uno en uno;
  por fichero: `exigirDocumentoValido`, `sha256`, evidencia `MISMO_FICHERO`
  contra líneas de la empresa (`situacion = 'INCLUIDA'`, liquidación no
  `ANULADA`) y contra `cash_operation_documents` (`duplicadosDe`,
  `anulado = false`); guarda con `rutaDeTicket`; inserta con `analisis =
  hayIA() ? 'PENDIENTE' : 'OMITIDO'` (PR1: siempre `OMITIDO`), `situacion =
  'INCLUIDA'`, `revisada = false`. Devuelve las líneas creadas, con sus
  evidencias.
- `editarLinea(ctx, lineId, cambios)` — solo `BORRADOR`; campos: `fecha`,
  `emisorNombre`, `emisorNif`, `numeroDocumento`, `concepto`,
  `baseCentimos`, `ivaCentimos`, `importeCentimos` (≥ 0), `moneda`,
  `expenseConceptId` (activo, cualquier `tipo_destino`),
  `expenseTargetId` (solo si el concepto es `CENTRO_COSTE`; si no, 400),
  `revisada`. Anota en `campos_corregidos` los que difieren de `leido`
  (PR3). Re-detecta `MISMA_CLAVE` y `MISMO_NUMERO` (PR4).
- `excluirLinea(ctx, lineId, motivo)` / `incluirLinea(ctx, lineId)` — mueven
  `situacion`; no tocan `analisis`; al excluir, sus evidencias `PENDIENTE`
  pasan a `EXCLUIDA`.
- `reintentarAnalisis(ctx, lineId)` — `FALLIDO|OMITIDO → PENDIENTE` (PR3).
- `marcarRevisada(ctx, lineId, valor)`.

**`worker.ts`** (PR3): copia la forma de `autoscan/worker.ts` (`cogerUno`
con `FOR UPDATE SKIP LOCKED`, lote 3, cada 15 s;
`arrancarWorkerGastos`/`pararWorkerGastos` exportados desde
`server/cash/index.ts` y arrancados en `mountCash`). `analizarLinea`:
`leerDocumento`, `escanearFactura({ empresaId, userId: null, sessionId:
null, fichero, sentido: "PAGO" })`, guarda `scan_id`, `leido` y los campos
revisables **solo si están vacíos** (si una persona ya escribió, no se pisa),
aplica `clasificarConcepto`, evidencias `MISMA_CLAVE`/`MISMO_NUMERO`
(PR4). `LISTO`, o `FALLIDO` con `analisis_error` recortado a 300 caracteres.
**El fichero se queda aunque falle** y la línea sigue siendo editable.

### C.5 Duplicados (`expenseclaims/duplicates.ts`)

- `detectar(client, linea, momento)` escribe evidencias en
  `cash_expense_claim_duplicates` con `ON CONFLICT (line_id, tipo,
  referencia_tipo, referencia_id) DO NOTHING`; nunca borra. PR1 solo
  `MISMO_FICHERO`; PR4 añade `MISMA_CLAVE` (índice `…_clave_idx`, nombre
  normalizado con `normalizarReferencia`-like sin tildes cuando no hay NIF) y
  `MISMO_NUMERO` (`cobroPrevioDeFactura(empresaId, numero, client, null,
  "PAGO")` → `referencia_tipo = 'OPERACION'`).
- `resolver(ctx, evidenciaId, { resolucion: "ACEPTADA"|"EXCLUIDA", motivo })`
  — `ACEPTADA` exige motivo y audita `cash.expense_claim.duplicate_accepted`
  con la referencia; `EXCLUIDA` llama a `excluirLinea`.
- `descartarPorPagoAnulado(client, operationId)` — desde el gancho.

### C.6 Extracción y categoría (PR3)

1. `invoice-scan/schema.ts`: campo opcional `tipo_establecimiento`
   (`["string","null"]`) en `ESQUEMA_FACTURA`: «Qué clase de negocio emite
   el ticket, con una de estas palabras exactas: RESTAURANTE, PEAJE,
   GASOLINERA, PARKING, HOTEL, TRANSPORTE, TAXI, SUPERMERCADO, OTRO. Es lo que
   el propio papel dice ser; null si no se distingue.» Una línea en
   `INSTRUCCIONES`, sin backticks (usa «»). Aquí no vive ninguna regla
   financiera: el modelo lee, la empresa decide.
2. `invoice-scan/types.ts`: `tipo_establecimiento?: string | null` en
   `ExtraccionCruda`; `tipoEstablecimiento: TipoEstablecimiento` en la
   normalizada. `normalize.ts`: `tipoDeEstablecimiento()` con `DESCONOCIDO`
   por defecto y `evidenciaDeConcepto(normalizada)`.
3. `expenseclaims/conceptos.ts`: `clasificarConcepto(evidencia, reglas,
   conceptosActivos)` con la misma forma que `clasificarSeccion`
   (`seccion.ts`): prioridad, primera regla que casa, `confianza`,
   `autoSeleccionar`; propone solo conceptos activos, de cualquier
   `tipo_destino`. Reglas en `config.ts`: `listarReglasGasto`,
   `guardarReglaGasto` (upsert por `(campo, patron)`, valida que el concepto
   exista), `borrarReglaGasto`; endpoints `GET/PUT/DELETE /expense-rules`
   (`cash.configure`); bloque en `Configuracion.tsx` calcado de
   `ReglasSeccion`.
4. **No siembres conceptos.** Sin «Dietas», la pantalla lo dice.
5. `validar` de `invoice-scan/validate.ts` no se toca.

### C.7 Router y permisos

`server/cash/router.ts`, con `exigirPermiso` y `ruta(...)`, junto al bloque
de `/expense-concepts`:

```
GET    /expense-claims                                cash.expense_claim.view
POST   /expense-claims                                cash.expense_claim.create
GET    /expense-claims/:id                            cash.expense_claim.view
GET    /expense-claims/:id/report.pdf                 cash.expense_claim.view   (cualquier estado)
POST   /expense-claims/:id/lines                      cash.expense_claim.create (subida(subidaDocumento.array("documentos", 20), 15))
PATCH  /expense-claims/:id/lines/:lineId              cash.expense_claim.create
POST   /expense-claims/:id/lines/:lineId/exclude|include|review|retry
GET    /expense-claims/:id/lines/:lineId/file         cash.expense_claim.view   (302 a urlFirmada)
POST   /expense-claims/:id/duplicates/:dupId/resolve  cash.expense_claim.create (ACEPTADA exige approve)
POST   /expense-claims/:id/present                    cash.expense_claim.create
POST   /expense-claims/:id/approve | reject           cash.expense_claim.approve
POST   /expense-claims/:id/reopen                     cash.expense_claim.create
POST   /expense-claims/:id/pay                        cash.expense_claim.pay    (Idempotency-Key obligatoria)
POST   /expense-claims/:id/void                       cash.expense_claim.approve
GET/PUT/DELETE /expense-rules                         cash.configure
```

`subida()` debe traducir también `LIMIT_UNEXPECTED_FILE` y
`LIMIT_FILE_COUNT` (A bis R9). Cuerpos con `enteroPositivo`, `formasPago`,
`lineas`.

`server/cash/permissions.ts`: `cash.expense_claim.view`, `.create`,
`.approve`, `.pay`, cada uno con su comentario. `POR_ROL`: `consulta` →
`view`; `cajero` → `view`, `create`; `responsable` → los cuatro; `admin` →
todos. **Pagar es de responsable a propósito**: hoy el cajero tampoco tiene
`cash.payment.create_manual`. `modulosApp.ts` no cambia.
`navigation.ts`: `{ key: "gastosTrabajadores", path: "gastos-trabajadores",
label: "Gastos de trabajadores", icon: ReceiptText, permiso:
"cash.expense_claim.view" }` debajo de `entregas`.

### C.8 Estadística (`server/cash/expensestats.ts`, PR2)

Define una subconsulta `LINEAS_DE_GASTO` que produce, para el periodo y el
centro, filas `(importe_centimos, expense_concept_id, expense_target_id,
fecha_jornada, centro_id)` como **UNION ALL** de:

1. operaciones de `FILTRO` **sin** liquidación (`NOT EXISTS (SELECT 1 FROM
   cash_expense_claims cl WHERE cl.operation_pago_id = o.id)`), con sus
   columnas de siempre;
2. líneas `INCLUIDA` de liquidaciones `PAGADA` cuyo pago cumple `FILTRO`,
   con `expense_target_id` **derivado** (`CASE c.tipo_destino WHEN 'PERSONA'
   THEN cl.expense_target_id WHEN 'CENTRO_COSTE' THEN l.expense_target_id
   ELSE NULL END`).

Las tres consultas de `informeDeGasto` y `totalDe` leen de ahí. El pago de
una liquidación **no** aparece como «Sin clasificar» y el total del periodo
no cambia. Prueba de integración con el ejemplo (dos conceptos, 82,28).

### C.9 PDF (`expenseclaims/report.ts`)

- Exporta de `server/cash/report.ts` `montar(portada, documentos)` con el
  segundo parámetro tipado como `{ ruta; mime; nombre; operacionNumero }[]`,
  y `paginaDeAviso`. Sin cambiar comportamiento.
- `informeLiquidacion(empresaId, claimId)`: portada pdfkit (misma cabecera y
  constantes `M`, `GRIS`, `TINTA` que `construirPortada`): número, estado
  **en grande**, empleado, periodo, tabla de líneas incluidas (fecha,
  establecimiento, concepto, base, IVA, importe), **totales por concepto y
  TOTAL**, excluidas contadas con motivo, pie con presentada/aprobada/pagada
  (usuario por `app_usuarios.nombre` si existe, si no el id; «pendiente» si
  no) y, si está pagada, número del pago, jornada y formas. En `BORRADOR`,
  marca «Borrador». Anexos: líneas INCLUIDAS con `montar`.
- Endpoint `GET /expense-claims/:id/report.pdf`; `BotonInforme` en la pantalla.

### C.10 Frontend

- `src/modules/cash/pages/GastosTrabajadores.tsx` `(NUEVO)`: lista con
  filtros (estado, empleado, fechas; `TableWrap`, `Pill` por estado) y detalle
  en la misma pantalla, como `Entregas.tsx`. Detalle: selector de empleado
  (PR1: destinos PERSONA de `api.conceptosDeGasto()`; PR5: empleados de
  `sea_employees` con vínculo), subida múltiple (bucle de uno en uno como
  `Informes.tsx`, con `MAXIMO_JUSTIFICANTE`), líneas con los **dos** estados
  visibles (chip de análisis y toggle incluir/excluir), edición en línea de
  los campos obligatorios, casilla «Revisada», concepto (PR3: propuesto con
  `CampoPropuesto`), evidencias de duplicado con «No es duplicado» (motivo)
  y «Excluir»; **totales por concepto y TOTAL** siempre visibles; lista de
  lo que impide presentar (viene de `detalle`); acciones por estado y
  `puede(...)`.
- Modal de pago (PR2): `PaymentMethodPicker` + `DenominationGrid` de
  `Pagos.tsx`, `formasParaPagos`, `disponible`; genera `idempotencyKey =
  crypto.randomUUID()` al abrir y lo reutiliza si se reintenta; sin jornada
  abierta, `Aviso` y botón deshabilitado.
- `services/api.ts`: `liquidaciones`, `crearLiquidacion`, `liquidacion`,
  `subirTickets`, `editarLinea`, `excluirLinea`, `incluirLinea`,
  `marcarLineaRevisada`, `reintentarLinea`, `resolverDuplicado`,
  `presentarLiquidacion`, `aprobarLiquidacion`, `rechazarLiquidacion`,
  `reabrirLiquidacion`, `pagarLiquidacion(id, datos, idempotencyKey)` (manda
  la cabecera `Idempotency-Key`), `anularLiquidacion`, `reglasGasto`…
- `types/index.ts`: `Liquidacion`, `LineaLiquidacion`
  (`analisis`, `situacion`, `revisada`), `EvidenciaDuplicado`,
  `EstadoLiquidacion`, `ETIQUETA_ESTADO_LIQUIDACION`, `ReglaGastoConfig`.
- `utils/liquidacion.ts` `(NUEVO)` con prueba: `totalesPorConcepto` (espejo)
  y `accionesDisponibles(estado, permisos)`.
- `CashApp.tsx`: ruta `gastos-trabajadores`. `Historico.tsx` (PR2): en un
  pago cuya `referencia` empieza por `LG-`, enlace al detalle.

### C.11 Auditoría, eventos, errores

- Acciones: `cash.expense_claim.create | line.upload | line.edit |
  line.exclude | line.include | line.review | duplicate_accepted | present |
  approve | reject | reopen | pay | void | payment_reversed`.
- Eventos: ninguno nuevo; `OPERATION_REGISTERED` ya sale del pago.
- `ErrorCaja` nuevos: `LIQUIDACION_NO_ENCONTRADA` (404),
  `TRANSICION_NO_VALIDA` (409), `LIQUIDACION_YA_PAGADA` (409),
  `IDEMPOTENCY_KEY_REQUERIDA` (400), `DESTINO_NO_ES_PERSONA` (400),
  `DESTINO_SIN_VINCULAR` (409), `EMPLEADO_NO_ENCONTRADO` (404),
  `EMPLEADO_INACTIVO` (409), `LINEA_NO_EDITABLE` (409), los de
  `puedePresentar` (400), `LIQUIDACION_DE_OTRO_CENTRO` (403). Reutiliza
  `FORMATO_NO_ADMITIDO`, `DOCUMENTO_DEMASIADO_GRANDE`,
  `JORNADA_NO_OPERABLE`, `FORMA_PAGO_NO_EN_PAGOS`, `CONCEPTO_INACTIVO`,
  `DESTINO_NO_VALIDO`, `PERMISO_DENEGADO`.

### C.12 Autoservicio (fuera del alcance; no lo construyas)

Queda documentado para no romperlo: la propiedad será
`app_usuarios.employee_id = cash_expense_claims.employee_id`; el permiso
`cash.expense_claim.own` y un rol `empleado` con solo ese permiso; `GET
/bootstrap` tendría que aceptar ese permiso y devolver un payload reducido.
Ninguna decisión de PR1–PR5 debe impedirlo (no metas `cash.view` como
requisito en el servicio de liquidaciones: el permiso se comprueba en el
router).

### C.13 Casos límite (y prueba para cada uno)

- Mismo fichero en la misma liquidación, en otra, o ya colgado de un pago
  (p. ej. liquidado antes por `Entregas`).
- Mismo ticket con dos escaneos distintos (`MISMA_CLAVE`).
- Número de factura ya pagado (`MISMO_NUMERO`); aparece **después** de
  aprobar y antes de pagar → el pago lo detecta.
- Una línea con dos evidencias: una aceptada y otra pendiente → no se presenta.
- Lectura fallida u omitida: se rellena a mano, `revisada`, se presenta.
- Línea excluida con análisis en curso: el análisis termina y no cambia
  `situacion`.
- Reintento de análisis no pisa lo que una persona ya escribió.
- PDF con varios tickets (`facturasDetectadas > 1`), moneda ≠ EUR, total
  negativo/ABONO: avisos; no se puede incluir hasta corregir.
- Concepto `CENTRO_COSTE` con destino de tipo PERSONA en la línea →
  `DESTINO_NO_VALIDO`; concepto `NINGUNO` con destino → 400.
- Concepto desactivado entre aprobación y pago → `CONCEPTO_INACTIVO`.
- Presentar con 0 líneas incluidas o total 0.
- Aprobar quien presentó con SoD activa → 403.
- Pagar: sin jornada abierta; en caja de otro centro; sin `Idempotency-Key`;
  dos veces con la misma clave (misma respuesta, un solo `PAYMENT`); dos
  veces con claves distintas (409); por transferencia (sin piezas); mixto.
- Anular el pago desde Histórico: vuelve a `APROBADA`, documentos promovidos
  anulados, evidencias `DESCARTADA`, estadística sin la liquidación.
- Anular una liquidación `PAGADA` → 409 hasta anular el pago.
- Empleado inactivo o inexistente al crear; destino PERSONA sin vínculo con
  nombre igual → `DESTINO_SIN_VINCULAR`.
- Ámbito de centro: ver/pagar una de otro centro → 403; una sin `centro_id`
  la ve todo el mundo.
- Numeración: dos creaciones simultáneas no repiten `LG-26-001`.

### C.14 Pruebas

- **Unitarias**: `expenseclaims/domain.test.ts` (tabla completa
  estado×acción, `puedePresentar` caso a caso, totales del ejemplo, periodo,
  `claveDeDuplicado` con NIF con/sin puntuación y nombre con tildes,
  `destinoDerivado` para los tres `tipo_destino`), `conceptos.test.ts` (PR3),
  `src/modules/cash/utils/liquidacion.test.ts`.
- **Integración** (`server/cash/expenseclaims.integration.test.ts`;
  `RUN_DB_TESTS=1`, `CASH_STORAGE_LOCAL=1`; `sufijo` idempotente; extractor
  falso inyectado como en `scan.integration.test.ts`; **crea un stub de
  `sea_employees` (`id UUID PK, nombre, apellidos, activo`) en `beforeAll` si
  no existe**, como hacen las de Therefore con `app_usuario_modulos`): el
  flujo entero del ejemplo; cada caso de C.13; `informeDeGasto`; PDF de
  liquidación en PRESENTADA y en PAGADA; informe de cierre con los tickets;
  `anularOperacion` con el gancho.
- **Mutaciones** (obligatorias, todas en rojo): sumar excluidas; permitir
  `APROBADA→BORRADOR`; no bloquear al pagar; pagar dos veces con la misma
  clave creando dos operaciones; contar el pago como «sin clasificar»;
  derivar siempre el destino de la cabecera aunque el concepto sea
  `CENTRO_COSTE`; saltarse SoD; promover excluidas; presentar sin `revisada`;
  presentar con evidencia pendiente; quitar el gancho de `anularOperacion`.
  Una mutación que «no aplica» da un verde sin valor.
- Tres typechecks (`npx tsc -p tsconfig.server.json --noEmit`, `npx tsc -b`,
  `npx tsc -p autoscan_agent/tsconfig.json --noEmit`), `npm run build`,
  render de la pantalla con el CSS del bundle.

### C.15 Documentación y entrega

- `docs/mobilink-cash.md`: «7 quaterdecies. Liquidaciones de gastos de
  trabajadores» con las decisiones de B (identidad sin FK y por qué; un pago
  por el total; dos estados por línea; IA no obligatoria; evidencias de
  duplicado; idempotencia; PDF en cualquier estado; autoservicio pendiente).
  Actualiza §7 (permisos) y §9.
- `docs/PROMPT_gastos_trabajadores.md`: al cerrar cada PR, apartado «Lo que
  entró en PRn» con desvíos respecto a este prompt.
- Versión, PR, CI verde sobre el commit de código, diff contra `main` solo
  con tus ficheros, merge, y aviso con la versión desplegada.

---

## Lo que entró en PR1

Liquidación manual: esquema completo de B.2, crear (por destino PERSONA o por
empleado), subir tickets, corregir, incluir/excluir, revisar, duplicados por
mismo fichero con resolución, presentar, aprobar (SoD y reautenticación),
rechazar, reabrir, anular, PDF en cualquier estado, permisos, pantalla
«Gastos de trabajadores». Sin pago ni lectura automática.

Desvíos respecto al prompt, todos pequeños:

- `puedePresentar` es `bloqueosParaPresentar` y devuelve **todos** los
  bloqueos, no el primero: la pantalla los enseña de una vez. El servicio lanza
  el primero con la lista entera en `detalle`. Se añade `TOTAL_CERO`.
- `analisis` tiene `OMITIDO` como valor por defecto en la base (el prompt decía
  PENDIENTE). El servicio lo fija explícitamente, así que da igual; OMITIDO es
  el valor honrado mientras no exista la lectura.
- `rutaDeTicket` lleva un índice: varios tickets subidos en el mismo
  milisegundo no se pisan.
- No hay endpoint `…/lines/:lineId/file`: el detalle ya trae el enlace firmado
  de cada ticket, como `documentosDeOperacion`.
- `exigirOtraPersona` (`sod.ts`) admite un tercer caso, «aprobar esta
  liquidación», con su propio texto.
- `codigoDesde` (`config.ts`) y `montar`, `paginaDeAviso`, `logoMobilink`, `M`,
  `GRIS`, `TINTA`, `M_LOGO` (`report.ts`) pasan a exportarse. Sin cambio de
  comportamiento.
- `LineaTicket` y `Totales` se exportan de la página para poder renderizarlas
  con el CSS real (no hay pruebas de componentes).
- La numeración de hojas del PDF cuenta solo la portada, igual que el informe
  de cierre: los tickets anexados no llevan cabecera.
- Una liquidación creada sin ámbito de taller la ve todo el mundo, igual que
  una caja sin taller; una con ámbito, solo su taller.

Pruebas: 22 unitarias del dominio, 24 de integración contra PostgreSQL
(idempotentes: corridas dos veces sobre la misma base), 3 de permisos, 5 de la
pantalla. 21 mutaciones, todas en rojo. Una sobrevivió la primera pasada —el
PDF con los excluidos detrás— porque la prueba solo comparaba páginas entre
estados; ahora comprueba que incluir un ticket añade exactamente su página.

## Lo que entró en PR2

El pago: `pagarLiquidacion` (`server/cash/expenseclaims/pago.ts`), endpoint
`POST /expense-claims/:id/pay`, gancho en `anularOperacion`, estadística por
tickets y la ventana de pago en la pantalla, con enlace desde el Histórico.

Desvíos respecto al prompt:

- **La clave de idempotencia viaja en el cuerpo** desde la pantalla. El
  servidor la acepta también en la cabecera `Idempotency-Key`, pero `pedir()`
  de `services/api.ts` sustituye las cabeceras por las de sesión, y tocarlo
  para esto afectaba a todas las llamadas del módulo.
- **El pago comprueba además el importe**: la pantalla manda el que enseña y
  tiene que coincidir con el aprobado y con la suma de las líneas.
- **La re-detección de duplicados al pagar sigue en PR4**, como decía el plan;
  aquí solo se revalidan los conceptos.
- **Lo que no estaba en el plan: un fallo anterior de la estadística.** Un
  pago anulado seguía sumando como gasto «sin clasificar», porque la operación
  inversa es del mismo tipo, confirmada y en positivo. Salió al probar que
  anular el pago de una liquidación la quita de la estadística; se comprobó
  sobre `main` sin estos cambios (20 € pagados y anulados = 20 € de gasto) y se
  arregla excluyendo las inversas, con su prueba en `gastos.integration.test.ts`.
- El enlace del Histórico abre la liquidación por número
  (`/cash/gastos-trabajadores?numero=LG-26-001`).

Pruebas: 9 de integración nuevas del pago (una más en gastos). 17 mutaciones,
todas en rojo; dos sobrevivieron la primera pasada —promover los excluidos y
contarlos en la estadística— porque ninguna liquidación pagada tenía un ticket
excluido. Ahora hay una.

## Lo que entró en PR3

La lectura automática: `tipo_establecimiento` en el esquema y la
normalización del escáner, `expenseclaims/conceptos.ts` (clasificador por
reglas), `expenseclaims/analisis.ts` (lectura de una línea, worker, rescate de
colgadas, reintentar), reglas de concepto en `config.ts` con sus endpoints y su
bloque en Configuración, y en la pantalla el estado de lectura con refresco
automático, los avisos de la lectura, la propuesta de concepto con «Usar» y
«Volver a leer».

Desvíos respecto al prompt:

- **`TALLER` entra en la lista de tipos de establecimiento.** Un trabajador
  que paga una reparación en ruta trae el ticket de un taller, y sin ese valor
  saldría como OTRO.
- **Una línea ya REVISADA no se rellena nunca**, aunque tenga huecos. El
  prompt decía «solo si están vacíos»; revisada quiere decir que una persona ya
  la dio por buena tal cual.
- **La moneda solo se cambia si el papel dice otra que no sea euros**: el caro
  es pagar libras como si fueran euros; uno en euros ya lo está.
- **Un abono no rellena el importe** (la lectura lo marca y se ve el aviso).
- **Lecturas colgadas**: si el proceso muere a mitad, la línea vuelve a la cola
  a los 10 minutos y tras 3 intentos queda FALLIDA. No estaba en el prompt; sin
  ello quedaría «leyendo…» para siempre.
- `GET /expense-rules` devuelve también `lecturaDisponible`, para que la
  pantalla ofrezca o no «Volver a leer».

Pruebas: 14 unitarias del clasificador y la lectura del tipo, 10 de
integración con un extractor falso, corridas dos veces sobre la misma base. 22
mutaciones, todas en rojo; una sobrevivió la primera pasada —rellenar el
concepto aunque la regla solo sugiriera— porque ninguna prueba leía un emisor
con poca seguridad. Ahora hay una.
