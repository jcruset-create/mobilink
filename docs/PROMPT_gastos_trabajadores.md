# Gastos de trabajadores (tickets, dietas, peajes): análisis y prompt maestro

Documento de la **fase 1: solo análisis**. No hay código, ni migraciones, ni
componentes detrás de esto. Consta de tres partes:

- **A.** Auditoría de lo que Mobilink Cash es hoy, con los ficheros reales.
- **B.** Propuesta de integración: qué se reutiliza, qué falta, qué decisiones
  hay que tomar antes de programar.
- **C.** El prompt maestro para la fase 2, escrito contra el código real.

Todo nombre de fichero, tabla, función o endpoint que aparece aquí **existe en
el repositorio** salvo que vaya marcado como `(NUEVO)`.

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

## B. Propuesta de integración

### B.1 La decisión: dentro de Cash, como un documento más

Se integra **dentro de Cash**, con router, servicio y pantalla propios en el
mismo módulo, por tres razones que salen del código y no del nombre:

1. **El pago al trabajador tiene que salir del cajón con sus piezas.** Solo
   `registrarOperacion` sabe hacerlo, y hacerlo desde fuera obligaría a
   duplicar el motor o a llamarlo de espaldas al resto del módulo.
2. **Lo que la funcionalidad necesita ya es de Cash**: conceptos y destinos de
   gasto (`Dietas` → persona), justificantes con bucket privado y hash,
   lectura IA de tickets con sentido `PAGO`, informe PDF con incrustación,
   auditoría, permisos por rol y ámbito de centro, SoD y reautenticación.
3. **El único hueco es el ciclo de vida previo al pago**, y ese hueco tiene
   precedente dentro de Cash: `cash_advances` es un documento que se abre un
   día, se liquida otro y acaba en operaciones. La liquidación de gastos es su
   simétrico: **la entrega de dinero es «te doy dinero y me traes tickets»; la
   liquidación es «me traes tickets y te doy dinero»**.

Lo que **no** se hace: ni un segundo sistema de pagos, ni de estados de
operación, ni de documentos. El pago es un `PAYMENT` normal; los tickets acaban
siendo `cash_operation_documents` de ese pago y salen en el informe de cierre
como cualquier otro justificante.

### B.2 Qué se reutiliza tal cual

| Necesidad | Lo que ya hay |
|---|---|
| Subir varios PDF/imágenes | `subidaDocumento` (multer en memoria, 15 MB), `exigirDocumentoValido` + `tipoReal`, `guardarDocumento`, bucle de subida de `Informes.tsx` |
| Lectura automática | `escanearFactura(entrada, extractor)` con `sentido: "PAGO"` y `sessionId: null`: devuelve fecha, emisor (nombre/NIF), número, concepto, base/IVA/total, tipo de documento, moneda, avisos; deja rastro en `cash_invoice_scans` |
| Lectura en segundo plano de un lote | Patrón de `autoscan/worker.ts` (`cogerUno` con `FOR UPDATE SKIP LOCKED`, lote de 3, cada 15 s) |
| Revisión/corrección humana | `CampoPropuesto<T>` (`estado: RELLENAR/REVISAR/VACIO`), `avisos` graves/leves, `anotarConfirmacion` con `campos_corregidos` |
| Categoría | `cash_expense_concepts` (`Dietas`, `Peajes`…, `tipo_destino = PERSONA`) y `cash_expense_targets` (el trabajador) |
| Duplicados | `sha256` (mismo fichero), `cobroPrevioDeFactura(..., "PAGO")` (mismo número de factura ya pagado), `normalizarReferencia` |
| Pago | `registrarOperacion` tipo `PAYMENT`, `PaymentMethodPicker` + `DenominationGrid` de `Pagos.tsx`, formas con `enPagos` |
| Conservar justificantes | `cash_operation_documents` + patrón `promover` (misma ruta, sin copiar) |
| PDF resumen + anexos | `report.ts`: pdfkit para la portada, `montar` (pdf-lib) para incrustar PDF/JPG/PNG, `paginaDeAviso` |
| Aprobación por otra persona | `sodActivo` + `exigirOtraPersona` (`sod.ts`); `exigirReautenticacion` (`reauth.ts`) |
| Permisos | `PERMISOS`/`POR_ROL`/`exigirPermiso`; `modulosApp.ts` para que Administración los asigne |
| Auditoría | `registrarAuditoriaEnTransaccion` / `registrarAuditoria` |
| Numeración | `siguienteNumeroDe(client, codigo, prefijo, anio)` (como `EN`, `CB`, `IB`) |
| Estadística | `informeDeGasto` (`expensestats.ts`) y pantalla `GastoPorConcepto.tsx` |

### B.3 Qué falta (y es nuevo de verdad)

1. **La liquidación** como entidad: cabecera (trabajador, estado, totales,
   quién presentó/aprobó/pagó, pago asociado) y líneas (un ticket = una línea:
   fichero, lectura, campos revisados, concepto, importe).
2. **El flujo de estados con aprobación.** No existe ninguno en el repositorio.
3. **La categoría del ticket.** El escáner hoy propone forma de cobro y sección,
   no concepto de gasto. Hace falta un tercer clasificador, con el mismo molde
   de reglas (`seccion.ts` / `cash_section_rules`) y, opcionalmente, una pista
   de lectura nueva («qué tipo de establecimiento es») que el modelo puede dar
   sin que en `schema.ts` viva ninguna regla financiera.
4. **Un pago con varios conceptos.** `cash_operations` admite **un** concepto
   por operación. Una liquidación de 82,28 € es Dietas 66,40 + Peajes 15,88.
   Ver B.5.
5. **Quién es el trabajador para el sistema.** Ver B.4: es la decisión que más
   condiciona el alcance.
6. **La pantalla** (`GastosTrabajadores.tsx`) y su entrada en `NAV`.

### B.4 Decisiones que hay que tomar antes de programar

**D1. ¿Quién sube los tickets: el trabajador con su usuario, o el mostrador
por él?**

Hoy un trabajador que no es cajero **no tiene forma de entrar en `/cash`**:
sin rol en `app_usuario_modulos` no pasa `cargarPermisosCaja`, y sin
`cash.view` no carga `/bootstrap`. Darle `cash.view` le enseñaría las cajas,
la jornada y el histórico de todos.

- **Opción A — mostrador**: cajero/responsable crea la liquidación a nombre de
  un destino PERSONA y sube los tickets que el trabajador le entrega. Cero
  cambios en usuarios. Cubre el 100 % del flujo pedido salvo el «sube él».
- **Opción B — autoservicio**: rol nuevo `empleado` con un único permiso
  `cash.expense_claim.own`; `/bootstrap` acepta también ese permiso y devuelve
  un payload reducido; el sidebar solo enseña «Mis gastos»; el trabajador se
  vincula a su destino PERSONA por una columna nueva
  `cash_expense_targets.user_id`.

**Recomendación:** construir **A completa en la fase 2** con el modelo ya
preparado para B (`solicitante_user_id` en la cabecera y `user_id` en el
destino), y dejar B como bloque final opcional del prompt. B toca bootstrap,
layout y Administración, que es lo que más se puede llevar por delante otra
cosa.

**D2. ¿Un pago o un pago por concepto?** Ver B.5. Recomendación: **uno**.

**D3. ¿Puede pagarse por transferencia?** Sí sin tocar nada: activar
`enPagos` en la forma `BANK_TRANSFER` desde Configuración. Un pago sin
efectivo no pide piezas. Sigue exigiendo jornada abierta, porque todo
`PAYMENT` cuelga de una `cash_sessions`; es el mismo precio que paga hoy una
liquidación de entrega.

**D4. ¿La categoría la decide el modelo?** No del todo. Regla de la casa
(`invoice-scan/schema.ts`): «aquí no vive ninguna regla financiera; el modelo
LEE». Propuesta: el modelo puede decir **qué tipo de establecimiento** ve
(`tipo_establecimiento`: RESTAURANTE, PEAJE, GASOLINERA, PARKING, HOTEL,
TRANSPORTE, TAXI, OTRO), que es leer el papel; y qué concepto de la empresa
corresponde a cada tipo lo dicen **reglas configurables**, como ya pasa con
la forma de cobro y la sección.

### B.5 Un pago, varios conceptos: cómo cuadrarlo con la estadística

El cajón ve **una** salida de 82,28 € con **una** composición de piezas y
**un** número (`P-26-041`). Partirla en dos `PAYMENT` obligaría a componer dos
juegos de piezas (66,40 y 15,88) para un solo billete de 100, y
`validarOperacion` exige que las piezas cuadren con cada operación: no es
viable en el mostrador.

Propuesta: **un `PAYMENT` por el total**, con `expense_concept_id` y
`expense_target_id` a NULL (la coherencia la exige
`validarClasificacionGasto`: sin concepto no puede haber destino), y el
desglose por concepto vive en las **líneas de la liquidación**.
`expensestats.ts` se amplía para que, cuando una operación es el pago de una
liquidación, sume **sus líneas** (cada una con su concepto y el trabajador
como destino) y no cuente la operación como «sin clasificar». Es un `LEFT
JOIN` más en las tres consultas que ya filtran por `o.expense_concept_id`, y
una prueba de integración que lo fije.

### B.6 Conflictos y duplicidades a vigilar

- **Entregas de dinero vs liquidaciones.** Un trabajador puede haber recibido
  50 € por `Entregas` y traer después el mismo ticket a una liquidación. La
  detección por `sha256` y por (emisor, fecha, total) tiene que mirar también
  los justificantes colgados de `cash_operations` (los de la liquidación de la
  entrega), no solo las otras liquidaciones.
- **`cash_expense_targets` no es `sea_employees`.** No se intenta unificar
  ahora (precedente: `vinculoTecnicos.ts` tardó una fase entera en emparejar
  `techs` con Core y se hace a mano). Se deja la puerta: `user_id` opcional.
- **Anular el pago** (`anularOperacion`) tiene que devolver la liquidación a
  `APROBADA` en la misma transacción, o quedaría «pagada» con el dinero de
  vuelta en el cajón.
- **El informe de cierre** incrusta `documentosDeJornada(sessionId)`, que lee
  por `session_id`. Los tickets tienen que promoverse a
  `cash_operation_documents` del pago (misma ruta) para salir ahí; si se
  dejaran solo en la liquidación, el papeleo del día quedaría incompleto.
- **ERP**: el pago es `origen = MANUAL` → `erp_sync_status = NOT_APPLICABLE`.
  No se exporta (limitación general documentada en `docs/mobilink-cash.md` §9).
- **Fiscalidad**: una factura simplificada sin el NIF de la empresa no es
  deducible. Se guarda lo que el papel dice (base/IVA cuando existen) y se
  avisa cuando falta el NIF del receptor; no se decide nada fiscal aquí.

---

## C. PROMPT MAESTRO (fase 2: implementación)

> Copiar desde aquí hasta el final en una conversación nueva.

### C.0 Contexto y reglas de la casa

Vas a implementar **liquidaciones de gastos de trabajadores** en Mobilink
Cash (repositorio `jcruset-create/mobilink`). Antes de tocar nada lee
`CLAUDE.md`, `docs/mobilink-cash.md` (especialmente §7 ter, §7 quater,
§7 novies, §7 undecies) y `docs/PROMPT_gastos_trabajadores.md` (partes A y
B: la auditoría y las decisiones ya tomadas). Trabaja en la rama que se te
indique; `git fetch origin main` y `git merge origin/main` antes de empezar;
`bash scripts/check-versions.sh` antes de cada commit; sube la versión de
`package.json`; al acabar, PR y merge cuando la CI esté verde, comprobando que
el diff contra `main` solo trae tus ficheros.

Convenciones que se respetan sin excepción:

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
- Ficheros nuevos en su sitio: servidor en `server/cash/expenseclaims/`
  `(NUEVO)`, pantalla en `src/modules/cash/pages/`, tipos en
  `src/modules/cash/types/index.ts`, API en `src/modules/cash/services/api.ts`.

### C.1 Alcance

Flujo: **trabajador entrega tickets → se suben varios PDF/imágenes → lectura
automática → revisión y corrección → total por concepto → presentar → aprobar
→ pagar (sale del cajón o por transferencia) → los tickets quedan como
justificantes del pago → PDF con resumen y anexos.**

Ejemplo de referencia (úsalo en pruebas y en la pantalla renderizada):

```
Dietas: 66,40 €
Peajes: 15,88 €
TOTAL: 82,28 €
```

Se construye la **opción A** (el mostrador sube por el trabajador) con el
modelo preparado para la **opción B** (autoservicio), que va como bloque
opcional en C.12. No construyas B sin que el usuario lo confirme.

### C.2 Modelo de datos `(NUEVO)`, en `server/cash/schema.ts`

Se añade a `initCash`, con `CREATE TABLE IF NOT EXISTS` y `ALTER … ADD COLUMN
IF NOT EXISTS`, **después** de las tablas a las que referencia
(`cash_expense_concepts`, `cash_expense_targets`, `cash_operations`,
`cash_invoice_scans`), y con un comentario de bloque explicando por qué existe
cada tabla, como hace el resto del fichero.

```sql
CREATE TABLE IF NOT EXISTS cash_expense_claims (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  centro_id UUID,                          -- ámbito; NULL = sin limitar
  numero TEXT NOT NULL,                    -- LG-26-001, ver C.4
  estado TEXT NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR','PRESENTADA','APROBADA','RECHAZADA','PAGADA','ANULADA')),
  expense_target_id INTEGER NOT NULL REFERENCES cash_expense_targets(id) ON DELETE RESTRICT,
  solicitante_user_id UUID,                -- quien la creó (opción B: el propio trabajador)
  periodo_desde DATE, periodo_hasta DATE,  -- calculados de las líneas al presentar
  total_centimos BIGINT NOT NULL DEFAULT 0,-- suma de líneas INCLUIDAS; se recalcula en servidor
  notas TEXT,
  presentada_por UUID, presentada_at_ms BIGINT,
  aprobada_por UUID,   aprobada_at_ms BIGINT,
  rechazo_motivo TEXT, rechazada_por UUID, rechazada_at_ms BIGINT,
  operation_pago_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
  session_id_pago INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  pagada_por UUID,     pagada_at_ms BIGINT,
  anulada_por UUID,    anulada_at_ms BIGINT, anulada_motivo TEXT,
  creado_por UUID, created_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL,
  UNIQUE (empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS cash_expense_claim_lines (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  claim_id INTEGER NOT NULL REFERENCES cash_expense_claims(id) ON DELETE RESTRICT,
  orden INTEGER NOT NULL DEFAULT 0,
  -- El fichero, como en cash_autoscan_inbox: aquí vive hasta que el pago existe.
  nombre TEXT NOT NULL, mime TEXT NOT NULL, tamano_bytes INTEGER NOT NULL,
  ruta TEXT NOT NULL, sha256 TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','ANALIZANDO','LISTA','FALLIDA','REVISADA','EXCLUIDA')),
  scan_id INTEGER REFERENCES cash_invoice_scans(id) ON DELETE SET NULL,
  error TEXT,
  -- Lo LEÍDO (no se toca después) y lo REVISADO (lo que vale). Dos juegos a propósito.
  leido JSONB,                             -- {fecha, emisorNombre, emisorNif, numero, concepto, base, iva, total, moneda, tipoEstablecimiento, confianza}
  fecha DATE, emisor_nombre TEXT NOT NULL DEFAULT '', emisor_nif TEXT,
  numero_documento TEXT, concepto TEXT NOT NULL DEFAULT '',
  base_centimos BIGINT, iva_centimos BIGINT,
  importe_centimos BIGINT NOT NULL DEFAULT 0,
  expense_concept_id INTEGER REFERENCES cash_expense_concepts(id) ON DELETE SET NULL,
  concepto_propuesto_id INTEGER, concepto_confianza NUMERIC(3,2), concepto_regla_id INTEGER,
  campos_corregidos JSONB,                 -- mismo criterio que cash_invoice_scans
  duplicado_de TEXT,                       -- 'LINEA:123' | 'DOCUMENTO:456' | 'OPERACION:P-26-003' cuando se detectó
  duplicado_aceptado_motivo TEXT,          -- si alguien decidió mantenerla igualmente
  excluida_motivo TEXT, excluida_por UUID,
  subido_por UUID, subido_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_expense_claim_lines_claim_idx ON cash_expense_claim_lines(claim_id, orden);
CREATE INDEX IF NOT EXISTS cash_expense_claim_lines_sha_idx   ON cash_expense_claim_lines(empresa_id, sha256);
CREATE INDEX IF NOT EXISTS cash_expense_claims_estado_idx     ON cash_expense_claims(empresa_id, estado, updated_at_ms DESC);

-- Reglas de concepto: mismo molde que cash_section_rules.
CREATE TABLE IF NOT EXISTS cash_expense_rules (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  campo TEXT NOT NULL CHECK (campo IN ('TIPO_ESTABLECIMIENTO','NOMBRE_EMISOR','NIF_EMISOR','CONCEPTO')),
  patron TEXT NOT NULL,
  expense_concept_id INTEGER NOT NULL,     -- sin FK, como cash_section_rules → cash_sections
  confianza NUMERIC(3,2) NOT NULL DEFAULT 0.9,
  auto_seleccionar BOOLEAN NOT NULL DEFAULT true,
  prioridad INTEGER NOT NULL DEFAULT 100,
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_por UUID, created_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL,
  UNIQUE (empresa_id, campo, patron)
);

ALTER TABLE cash_expense_targets ADD COLUMN IF NOT EXISTS user_id UUID;  -- opción B
CREATE UNIQUE INDEX IF NOT EXISTS cash_expense_targets_user_idx
  ON cash_expense_targets(empresa_id, user_id) WHERE user_id IS NOT NULL;
```

No se crean migraciones de Supabase: las tablas `cash_*` nacen en `initCash`.
Prueba el arranque contra PostgreSQL real (las restricciones `CHECK` y el
orden de los `ALTER` solo fallan ahí).

### C.3 Almacenamiento de los tickets

- `server/cash/storage.ts`: añadir `rutaDeTicket(empresaId, claimId, ext,
  ahora)` `(NUEVO)` → `${empresaId}/gastos/${claimId}/${ahora}${ext}`, al lado
  de `rutaDocumento`. Mismo bucket privado, mismos `guardarDocumento`,
  `leerDocumento`, `urlFirmada`.
- Validación del fichero con `exigirDocumentoValido` de
  `invoice-scan/service.ts` (MIME real, 15 MB) y `subidaDocumento` del router.
- **Un blob, varias filas**: al pagar, cada línea incluida genera una fila en
  `cash_operation_documents` (`operation_id` = el pago, `session_id` = su
  jornada, `ruta`/`sha256`/`mime`/`nombre` copiados) **sin copiar el fichero**,
  exactamente como `autoscan/promote.ts`. Así el informe de cierre los lleva y
  `Justificantes` los enseña en el histórico. Deja el mismo comentario que
  `promote.ts` sobre retención: el objeto ya no es de una sola fila.

### C.4 Servicio `server/cash/expenseclaims/` `(NUEVO)`

Ficheros: `service.ts` (ciclo de vida), `lines.ts` (subida, análisis,
edición), `domain.ts` (puro: transiciones, totales, clave de duplicado),
`conceptos.ts` (clasificador por reglas), `report.ts` (PDF),
`worker.ts` (análisis en segundo plano). Todos importan `ErrorCaja` de
`../errors.ts`, `enTransaccion` de `../repository.ts`, `Contexto` de
`../service.ts`.

**Numeración**: `siguienteNumeroDe(client, codigoEmpresaOCentro, "LG", anio)`.
Como una liquidación no tiene caja al nacer, usa como `codigo` el `codigo` de
la caja por defecto del centro si `centro_id` está fijado, y si no `"LG"`
(queda `LG-LG-26-001`; documenta por qué y ofrece cambiarlo si el usuario
prefiere `codigoDeCaja` en el momento del pago).

**`domain.ts`** (sin BD, con pruebas unitarias):

```ts
export type EstadoLiquidacion = "BORRADOR"|"PRESENTADA"|"APROBADA"|"RECHAZADA"|"PAGADA"|"ANULADA";
export function transicion(desde: EstadoLiquidacion, accion: "PRESENTAR"|"APROBAR"|"RECHAZAR"|"REABRIR"|"PAGAR"|"ANULAR"|"DESHACER_PAGO"): EstadoLiquidacion | null;
export function totalesPorConcepto(lineas: LineaParaTotal[]): { porConcepto: {conceptoId: number|null; nombre: string; importeCentimos: number}[]; totalCentimos: number; sinConcepto: number };
export function claveDeDuplicado(l: {emisorNif: string|null; emisorNombre: string; fecha: string|null; importeCentimos: number}): string | null;
export function puedePresentar(lineas): { ok: true } | { ok: false; codigo: "SIN_LINEAS"|"LINEA_SIN_IMPORTE"|"LINEA_SIN_CONCEPTO"|"DUPLICADO_SIN_RESOLVER"|"LINEA_SIN_ANALIZAR" };
```

Transiciones: `BORRADOR → PRESENTADA` (PRESENTAR), `PRESENTADA → APROBADA`
(APROBAR), `PRESENTADA → RECHAZADA` (RECHAZAR, motivo obligatorio),
`RECHAZADA → BORRADOR` (REABRIR), `APROBADA → PAGADA` (PAGAR),
`PAGADA → APROBADA` (DESHACER_PAGO, solo desde `anularOperacion`),
`BORRADOR|PRESENTADA|APROBADA|RECHAZADA → ANULADA` (ANULAR, motivo). Nunca
desde `PAGADA` a `ANULADA` sin anular antes el pago. Cualquier otra combinación
devuelve `null` y el servicio lanza `ErrorCaja("TRANSICION_NO_VALIDA", …, 409)`.

**`service.ts`**:

- `crearLiquidacion(ctx, { expenseTargetId, notas })` → exige destino de tipo
  `PERSONA` y activo (reusa la consulta de `validarClasificacionGasto`), fija
  `centro_id = ctx.centroId`, numera, audita `cash.expense_claim.create`.
- `listar(ctx, filtros)` → filtra por `empresa_id`, por `centro_id` cuando
  `ctx.centroId` no es null (mismo criterio que `/bootstrap` con las cajas),
  por estado, trabajador y fechas.
- `detalle(ctx, id)` → cabecera + líneas con `url` firmada por línea +
  `totalesPorConcepto`.
- `presentar(ctx, id)` → `puedePresentar`; recalcula `total_centimos`,
  `periodo_desde/hasta`; congela: a partir de aquí las líneas no se editan.
- `aprobar(ctx, id)` → permiso `cash.expense_claim.approve`; si
  `sodActivo(empresaId)`, `presentada_por` ≠ `ctx.userId` (reutiliza el
  mensaje y el código de `exigirOtraPersona`); si `reauthActivo`,
  `exigirReautenticacion(ctx.userId)`; audita.
- `rechazar(ctx, id, motivo)` y `reabrir(ctx, id)`.
- `pagar(ctx, id, { sessionId, formasPago, efectivoEntregado, efectivoRecibido })`
  → permiso `cash.expense_claim.pay`; estado `APROBADA`; **en una sola
  transacción**: bloquea la liquidación (`FOR UPDATE`), llama a
  `registrarOperacion(ctx, {...}, client)` con `tipo: "PAYMENT"`,
  `importeCentimos: total_centimos`, `partyNombre: nombre del destino`,
  `concepto: "Liquidación de gastos LG-26-001 (Dietas 66,40 · Peajes 15,88)"`,
  `referencia: numero`, `expenseConceptId: null`, `expenseTargetId: null`;
  promueve las líneas incluidas a `cash_operation_documents`; pasa a `PAGADA`
  con `operation_pago_id`, `session_id_pago`; audita
  `cash.expense_claim.pay` con el número del pago. Si `formasPago` no lleva
  efectivo, no se mandan piezas (transferencia): el motor ya lo admite.
- `anular(ctx, id, motivo)`.
- **Gancho en `anularOperacion`** (`server/cash/service.ts`): si la operación
  anulada tiene una liquidación con `operation_pago_id = id`, en la misma
  transacción la liquidación vuelve a `APROBADA`, se anulan (no se borran) las
  filas promovidas de `cash_operation_documents` con motivo «pago anulado», y
  queda auditado. Sin este gancho una liquidación podría constar pagada con el
  dinero de vuelta en el cajón.

**`lines.ts`**:

- `subirTickets(ctx, claimId, ficheros[])` → uno a uno (un fallo no tumba a los
  anteriores); por cada uno: `exigirDocumentoValido`, `sha256`, **duplicado
  por contenido** contra `cash_expense_claim_lines` (misma empresa, no
  `EXCLUIDA`, liquidación no `ANULADA`) y contra `cash_operation_documents`
  (`duplicadosDe` de `documents.ts`): si existe, se crea la línea igual pero
  con `duplicado_de` relleno y aviso; guarda con `rutaDeTicket`; inserta en
  estado `PENDIENTE`. Devuelve las líneas creadas. Solo en `BORRADOR`.
- `analizarLinea(claimLineId)` (la llama el worker): `leerDocumento`,
  `escanearFactura({ empresaId, userId: null, sessionId: null, fichero,
  sentido: "PAGO" })`; guarda `scan_id`, `leido`, rellena los campos revisables
  a partir de `propuesta` (`fecha`, `emisor`, `referencia`, `concepto`,
  `totales`), aplica `clasificarConcepto` (C.5), calcula `claveDeDuplicado` y
  busca líneas de la empresa con la misma clave (segunda detección: mismo
  ticket escaneado dos veces con dos ficheros distintos) y, si hay número de
  documento, `cobroPrevioDeFactura(empresaId, numero, pool, null, "PAGO")`
  (tercera: ya pagado como factura de proveedor, incluida una entrega
  liquidada por `Entregas`). Estado → `LISTA`, o `FALLIDA` con `error`
  recortado a 300 caracteres. **El fichero se queda aunque falle**, como en
  `EscanerFactura.tsx`.
- `editarLinea(ctx, lineId, cambios)` → solo `BORRADOR`; acepta `fecha`,
  `emisorNombre`, `emisorNif`, `numeroDocumento`, `concepto`,
  `baseCentimos`, `ivaCentimos`, `importeCentimos` (> 0), `expenseConceptId`
  (concepto activo y `tipo_destino = PERSONA`, vía
  `validarClasificacionGasto(empresaId, conceptoId, claim.expense_target_id)`),
  `duplicadoAceptadoMotivo`; anota en `campos_corregidos` qué campos difieren
  de `leido` (es la métrica que ya usa `anotarConfirmacion`); estado →
  `REVISADA`.
- `excluirLinea(ctx, lineId, motivo)` / `incluirLinea(ctx, lineId)`.
- `reintentarLinea(ctx, lineId)` → `FALLIDA → PENDIENTE`.

**`worker.ts`**: copia la forma de `autoscan/worker.ts` (`cogerUno` con
`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, lote 3, cada
15 s, `arrancarWorkerGastos`/`pararWorkerGastos` exportados desde
`server/cash/index.ts` y arrancados en `mountCash`). Alternativa más simple si
el usuario lo prefiere: analizar en la propia petición de subida, de uno en
uno, como hace `EscanerFactura`. Elige el worker: cinco tickets son cinco
llamadas a la IA y la pantalla no debe quedarse colgada; deja la decisión
escrita en el comentario de cabecera.

### C.5 Extracción y categoría (`invoice-scan/` y `expenseclaims/conceptos.ts`)

1. `invoice-scan/schema.ts`: añadir al `ESQUEMA_FACTURA` el campo opcional
   `tipo_establecimiento` (`["string","null"]`) con descripción: «Qué clase de
   negocio emite el ticket, con una de estas palabras exactas: RESTAURANTE,
   PEAJE, GASOLINERA, PARKING, HOTEL, TRANSPORTE, TAXI, SUPERMERCADO, OTRO.
   Es lo que el propio papel dice ser (una autopista, un menú, un surtidor);
   null si no se distingue.» Una línea en `INSTRUCCIONES`. Sin backticks
   dentro del template literal (usa «»).
2. `invoice-scan/types.ts`: `tipo_establecimiento?: string | null` en
   `ExtraccionCruda` (opcional, como `tipo_documento`, para no romper los
   análisis guardados) y `tipoEstablecimiento: TipoEstablecimiento` en
   `ExtraccionNormalizada`. `normalize.ts`: `tipoDeEstablecimiento()` con
   `DESCONOCIDO` para lo que no esté en la lista, como `tipoDeDocumento()`.
   `evidenciaDeConcepto(normalizada)` `(NUEVO)` junto a `evidenciaDeSeccion`.
3. `expenseclaims/conceptos.ts`: `clasificarConcepto(evidencia, reglas,
   catalogoDeConceptosPersona)` con la misma forma que `clasificarSeccion`
   (prefijo y contención sobre `claveDeCotejo`-like normalizado, prioridad,
   primera regla que casa manda, `confianza`, `autoSeleccionar`; solo puede
   proponer conceptos activos con `tipo_destino = PERSONA`). Reglas de
   `cash_expense_rules` vía `config.ts`: `listarReglasGasto`,
   `guardarReglaGasto` (upsert por `(campo, patron)`, valida que el concepto
   exista), `borrarReglaGasto`, calcados de las de sección. Endpoints
   `GET/PUT/DELETE /expense-rules` con `cash.configure`.
4. **No siembres conceptos.** Si la empresa no tiene «Dietas», el clasificador
   no propone nada y la pantalla lo dice («Crea el concepto en Configuración»).
5. `validar` no se toca: la propuesta de ticket de gasto se construye en
   `lines.ts` a partir de `PropuestaCobro` (`fecha`, `emisor`, `referencia`,
   `concepto`, `totales`, `avisos`, `esFactura`, `tipoDocumento`).

### C.6 Router: `server/cash/router.ts`

Añadir, con `exigirPermiso` y `ruta(...)`, siguiendo el bloque de
`/expense-concepts`:

```
GET    /expense-claims                       cash.expense_claim.view
POST   /expense-claims                       cash.expense_claim.create
GET    /expense-claims/:id                   cash.expense_claim.view
POST   /expense-claims/:id/lines             cash.expense_claim.create   (multipart, subidaDocumento.array("documentos", 20), envuelto en subida(...))
PATCH  /expense-claims/:id/lines/:lineId     cash.expense_claim.create
POST   /expense-claims/:id/lines/:lineId/exclude | /include | /retry
POST   /expense-claims/:id/present           cash.expense_claim.create
POST   /expense-claims/:id/approve           cash.expense_claim.approve
POST   /expense-claims/:id/reject            cash.expense_claim.approve
POST   /expense-claims/:id/reopen            cash.expense_claim.create
POST   /expense-claims/:id/pay               cash.expense_claim.pay
POST   /expense-claims/:id/void              cash.expense_claim.approve
GET    /expense-claims/:id/report.pdf        cash.expense_claim.view
GET    /expense-claims/:id/lines/:lineId/file cash.expense_claim.view   (redirige a urlFirmada)
GET/PUT/DELETE /expense-rules                cash.configure
```

Cuerpos con los mismos ayudantes (`enteroPositivo`, `formasPago`, `lineas`).
`multer` con `.array()` necesita el mismo tratamiento de errores que
`subida()`.

### C.7 Permisos (`server/cash/permissions.ts`, `modulosApp.ts`, `navigation.ts`)

Nuevos en `PERMISOS`, con su comentario de porqué:

- `cash.expense_claim.view` — ver liquidaciones del ámbito.
- `cash.expense_claim.create` — crear, subir tickets, corregir, presentar.
- `cash.expense_claim.approve` — aprobar, rechazar, anular.
- `cash.expense_claim.pay` — registrar el pago.

`POR_ROL`: `cajero` → `view`, `create`; `responsable` → los cuatro; `admin`
→ todos (ya lo es por `PERMISOS`); `consulta` → `view`. **Pagar es de
responsable a propósito**: hoy el cajero tampoco puede registrar un pago
manual (`cash.payment.create_manual`), y una liquidación es un pago manual.
Déjalo escrito en el comentario. `modulosApp.ts` no cambia salvo que se haga
C.12. `navigation.ts`: `{ key: "gastosTrabajadores", path:
"gastos-trabajadores", label: "Gastos de trabajadores", icon: ReceiptText,
permiso: "cash.expense_claim.view" }` debajo de `entregas`.

### C.8 Estadística (`server/cash/expensestats.ts`)

En las consultas que leen `cash_operations` con `o.tipo IN ('PAYMENT',
'MANUAL_OUT')`: `LEFT JOIN cash_expense_claims cl ON cl.operation_pago_id =
o.id AND cl.estado = 'PAGADA'`; para las operaciones con `cl.id IS NOT NULL`
sumar desde `cash_expense_claim_lines` (estado ≠ `EXCLUIDA`) con su
`expense_concept_id` y `expense_target_id = cl.expense_target_id`; para el
resto, como hasta ahora. Que el pago de una liquidación **no** caiga en «sin
clasificar». Prueba de integración: una liquidación Dietas 66,40 + Peajes
15,88 pagada aparece como dos líneas de concepto y el total del periodo no
cambia respecto al pago de 82,28.

### C.9 PDF (`server/cash/expenseclaims/report.ts`, reutilizando `server/cash/report.ts`)

- Exportar de `report.ts` dos funciones hoy privadas: `montar(portada,
  documentos)` generalizando el tipo del segundo parámetro a `{ ruta; mime;
  nombre; operacionNumero }[]`, y `paginaDeAviso`. No cambies su comportamiento.
- `informeLiquidacion(empresaId, claimId)`: portada con pdfkit (misma cabecera
  y `M`, `GRIS`, `TINTA` que `construirPortada`): número, trabajador, periodo,
  estado, tabla de líneas (fecha, establecimiento, concepto, base, IVA,
  importe), **totales por concepto y TOTAL**, y el pie con presentada /
  aprobada / pagada (usuario y fecha; nombre vía `app_usuarios.nombre` si
  existe, si no el id) y el número del pago con su jornada. Detrás, cada
  ticket incluido con `montar`; los excluidos no van, pero la portada dice
  cuántos se excluyeron y por qué.
- Endpoint `GET /expense-claims/:id/report.pdf`; en la pantalla, `BotonInforme`
  (ya baja PDFs con `descargarPdf`).

### C.10 Frontend

- `src/modules/cash/pages/GastosTrabajadores.tsx` `(NUEVO)`: lista (filtros
  estado/trabajador/fechas, con `TableWrap`, `Pill` por estado) y detalle en la
  misma pantalla (como `Entregas.tsx`). Detalle: selector de trabajador
  (destinos PERSONA de `api.conceptosDeGasto()`), zona de subida múltiple
  (`<input type="file" multiple>`, bucle de uno en uno como `Informes.tsx`),
  líneas con estado (`ANALIZANDO` con `Loader2`, `FALLIDA` con reintento),
  edición en línea de los campos revisables, concepto propuesto con
  `CampoPropuesto` y chip de confianza (misma semántica que
  `EscanerFactura`: `RELLENAR` se rellena, `REVISAR` se resalta), aviso de
  duplicado con botón «Mantener igualmente» que pide motivo, botón excluir con
  motivo; **totales por concepto y TOTAL** siempre visibles; acciones según
  estado y `puede(...)`.
- Pago: reutiliza `PaymentMethodPicker` y `DenominationGrid` de `Pagos.tsx` en
  un `Modal` («Pagar 82,28 € a …»): formas de `formasParaPagos`, piezas
  entregadas/recibidas, `disponible` del contexto; tras pagar, `refrescar()`.
  Si no hay jornada abierta, `Aviso` y botón deshabilitado, como en `Pagos`.
- `services/api.ts`: `liquidaciones`, `crearLiquidacion`, `liquidacion`,
  `subirTickets(id, ficheros)`, `editarLinea`, `excluirLinea`, `incluirLinea`,
  `reintentarLinea`, `presentarLiquidacion`, `aprobarLiquidacion`,
  `rechazarLiquidacion`, `reabrirLiquidacion`, `pagarLiquidacion`,
  `anularLiquidacion`, `reglasGasto`/`guardarReglaGasto`/`borrarReglaGasto`.
- `types/index.ts`: `Liquidacion`, `LineaLiquidacion`,
  `EstadoLiquidacion`, `ETIQUETA_ESTADO_LIQUIDACION`, `ReglaGastoConfig`.
- `utils/liquidacion.ts` `(NUEVO)` con prueba: `totalesPorConcepto` (espejo del
  de dominio, para pintar sin esperar al servidor) y `accionesDisponibles(estado,
  permisos)`.
- `Configuracion.tsx`: bloque «Reglas de concepto de gasto» calcado de
  `ReglasSeccion` (campo, patrón, concepto), con texto de ayuda que explique
  el campo `TIPO_ESTABLECIMIENTO`.
- `CashApp.tsx`: ruta `gastos-trabajadores`.
- `Historico.tsx`: en la fila de un pago que es liquidación, enlace al detalle
  (`referencia` = número de liquidación).

### C.11 Auditoría, eventos, errores

- Acciones de auditoría: `cash.expense_claim.create | line.upload | line.edit
  | line.exclude | line.include | present | approve | reject | reopen | pay |
  void | payment_reversed`. Las de dinero (`pay`, `payment_reversed`) dentro de
  la transacción.
- Eventos: no añadas `TipoEvento` nuevos; `OPERATION_REGISTERED` ya sale del
  pago. Si el usuario quiere que MC Central vea liquidaciones pendientes, es
  fase aparte.
- Códigos `ErrorCaja` nuevos: `LIQUIDACION_NO_ENCONTRADA` (404),
  `TRANSICION_NO_VALIDA` (409), `LIQUIDACION_SIN_LINEAS`,
  `LINEA_SIN_IMPORTE`, `LINEA_SIN_CONCEPTO`, `DUPLICADO_SIN_RESOLVER`,
  `LINEA_SIN_ANALIZAR` (400), `DESTINO_NO_ES_PERSONA` (400),
  `LIQUIDACION_DE_OTRO_CENTRO` (403), `IMPORTE_NO_COINCIDE` (400, si el
  cliente manda un total distinto del recalculado). Reutiliza los existentes:
  `FORMATO_NO_ADMITIDO`, `DOCUMENTO_DEMASIADO_GRANDE`, `JORNADA_NO_OPERABLE`,
  `FORMA_PAGO_NO_EN_PAGOS`, `CONCEPTO_INACTIVO`, `PERMISO_DENEGADO`.

### C.12 Bloque opcional: autoservicio del trabajador (opción B)

Solo si el usuario lo confirma. Rol `empleado` en `POR_ROL` con únicamente
`cash.expense_claim.own`; `modulosApp.ts` añade `{ value: "empleado", label:
"Empleado (solo sus gastos)" }`; `GET /bootstrap` acepta `cash.view` **o**
`cash.expense_claim.own` y, en el segundo caso, devuelve `cajas: []`,
`permisos` y `rol`; `CashLayout` esconde selector de caja e indicador de
jornada cuando no hay `cash.view`; `NAV` añade «Mis gastos» con permiso
`own`; `cash_expense_targets.user_id` se asigna desde Configuración (selector
de usuario de la empresa, `app_usuarios`); las rutas `GET/POST
/expense-claims*` con `own` filtran por `solicitante_user_id = ctx.userId` y
solo permiten `create`, `lines`, `present`, `reopen` sobre las propias. Nada de
`approve`/`pay`.

### C.13 Casos límite que hay que cubrir (y probar)

- Fichero repetido (mismo sha256) en la misma liquidación, en otra
  liquidación, o ya colgado de un pago (p. ej. liquidado antes por
  `Entregas`).
- Mismo ticket con dos escaneos distintos (clave emisor+fecha+total).
- Ticket con número de factura ya pagado (`cobroPrevioDeFactura` sentido PAGO).
- Lectura fallida: la línea queda `FALLIDA`, el fichero se conserva, se
  rellena a mano y se puede reintentar.
- PDF con varios tickets (`facturasDetectadas > 1`): aviso, importe a mano.
- Moneda distinta de EUR: aviso grave, importe a mano.
- Total negativo / `tipoDocumento = ABONO`: la línea no puede incluirse (una
  liquidación no devuelve dinero al cajón).
- Ticket sin importe legible: no se puede presentar hasta corregirlo.
- Concepto inactivado entre la revisión y el pago: `pagar` lo comprueba
  dentro de la transacción y falla con `CONCEPTO_INACTIVO`.
- Presentar con 0 líneas incluidas, o con total 0.
- Aprobar quien presentó con SoD activa: 403 con el código de `sod.ts`.
- Pagar sin jornada abierta, en una caja de otro centro, o dos veces (segunda
  petición ve `PAGADA` por el `FOR UPDATE`).
- Pagar por transferencia (sin piezas) y pagar mixto.
- Anular el pago desde Histórico: la liquidación vuelve a `APROBADA`, los
  documentos promovidos quedan anulados con motivo, la estadística deja de
  contarla.
- Anular una liquidación ya pagada: rechazado hasta anular el pago.
- Usuario con ámbito de centro que intenta ver/pagar una liquidación de otro.

### C.14 Pruebas

- **Unitarias** (`expenseclaims/domain.test.ts`, `conceptos.test.ts`,
  `src/modules/cash/utils/liquidacion.test.ts`): tabla de transiciones
  completa (cada par estado×acción), totales del ejemplo (66,40 + 15,88 =
  82,28), clave de duplicado (NIF con y sin puntuación, nombre con tildes),
  clasificador (regla por `TIPO_ESTABLECIMIENTO`, por nombre, prioridad,
  concepto inactivo o de tipo `CENTRO_COSTE` nunca propuesto).
- **Integración** (`server/cash/expenseclaims.integration.test.ts`, con
  `RUN_DB_TESTS=1`, `CASH_STORAGE_LOCAL=1`, `sufijo` para ser idempotente y
  un extractor falso inyectado como en `scan.integration.test.ts`): crear →
  subir tres ficheros (uno repetido) → analizar → corregir → presentar →
  aprobar (con y sin SoD) → pagar en jornada abierta con piezas → comprobar
  `cash_operations` (tipo, importe, `party_nombre`, `referencia`),
  movimientos de piezas, `cash_operation_documents` promovidos (misma
  `ruta`), `app_auditoria`, `informeDeGasto` con dos conceptos, PDF de la
  liquidación y de cierre con los tickets incrustados, segundo pago rechazado,
  anulación del pago que devuelve a `APROBADA`, ámbito de centro.
- **Mutaciones** (disciplina de la casa): rompe cada regla y confirma el rojo
  —sumar líneas excluidas, permitir `APROBADA → BORRADOR`, no bloquear la
  liquidación al pagar, contar el pago como «sin clasificar», aceptar un
  destino `CENTRO_COSTE`, aceptar total negativo, saltarse SoD, promover los
  excluidos—. Una mutación que «no aplica» da un verde sin valor.
- Los tres typechecks (`npx tsc -p tsconfig.server.json --noEmit`, `npx tsc
  -b`, `npx tsc -p autoscan_agent/tsconfig.json --noEmit`), `npm run build`, y
  render de la pantalla nueva con el CSS del bundle (procedimiento de las
  entregas anteriores).

### C.15 Documentación y entrega

- `docs/mobilink-cash.md`: sección «7 quaterdecies. Liquidaciones de gastos de
  trabajadores» con las decisiones (un pago por el total; líneas como desglose;
  tickets promovidos sin copiar; aprobación como primera bandeja del módulo y
  por qué aquí sí; opción B pendiente). Actualiza §7 (permisos) y §9.
- `docs/PROMPT_gastos_trabajadores.md`: añade al final «Lo que entró en la
  fase 2» con desvíos respecto a este prompt.
- Versión, PR, CI verde sobre el commit de código, diff contra `main` solo con
  tus ficheros, merge, y aviso con la versión desplegada.
