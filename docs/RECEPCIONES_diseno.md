# Recepciones — control de la recepción física de mercancía: diseño e implementación

> **Estado: FASE 1 implementada** (circuito manual completo). Pedidos y albaranes
> se crean a mano; la recepción se cierra desde la pantalla del operario; el
> albarán recepcionado se genera, se guarda y se imprime con el navegador.
> **No existe todavía** la lectura automática de los correos de Soledad
> (IMAP): los campos que necesitará ya están en el modelo (§F).

Principio que gobierna el módulo: **Mobilink controla la recepción física, no el
stock.** Cerrar una recepción registra qué llegó, quién lo contó, cuándo y con
qué resultado, y deja un papel. No escribe en `movimientos_stock`, no conoce el
saldo de nada, no integra con GENES: la entrada del albarán en el ERP la sigue
haciendo una persona, después, a mano. Hay una prueba de integración que falla
si el código del módulo nombra una tabla del almacén.

---

## A. Arquitectura

```
Alta manual (panel) ──► service.crearPedido / crearAlbaran ──► rcp_pedidos · rcp_albaranes (EN_TRANSITO)
[fase 2: correo Soledad ──► misma puerta]                              │
                                                                       ▼
                                                    BANDEJA · Recepciones pendientes
                                                                       │
                          Pantalla del operario ──► service.cerrarRecepcion()   UNA transacción:
                                                      SELECT rcp_albaranes FOR UPDATE
                                                      relee pendiente = expedida − recibida
                                                      REC-AAAA-nnnnnnnn (rcp_contadores, atómico)
                                                      rcp_recepciones + rcp_recepcion_lineas
                                                      rcp_incidencias (una por diferencia)
                                                      acumulados + estados derivados
                                                      rcp_eventos + app_auditoria
                                                      COMMIT
                                                                       │
                                                                       ▼   (tras el COMMIT; si falla → ERROR + regenerar)
                                              documentos/generar.ts ──► ORIGINAL (intacto) + hoja del sello ──► bucket privado + SHA-256
                                                                       │
                                                                       ▼
                                              Panel: iframe con la sesión + window.print()
```

Molde: `server/therefore/` (esquema idempotente, `Ejecutor` para transacciones,
contadores `ON CONFLICT … RETURNING`, permisos por `app_usuario_modulos`,
histórico inmutable por trigger, storage por hash). Frontend con la forma de
Cash/Therefore (`App` + `Context` + `Layout` + `services/api.ts` + `pages/`).

```
server/recepciones/
  index.ts · schema.ts · router.ts · service.ts · repository.ts · permissions.ts · errors.ts · storage.ts
  domain/estados.ts (vocabularios + estadoPedido/estadoAlbaran) · cantidades.ts · numero.ts · articulos.ts
  documentos/generar.ts (sello con pdfkit, montaje con pdf-lib)
  *.test.ts (dominio) · recepciones.integration.test.ts (HTTP contra PostgreSQL)
src/modules/recepciones/
  RecepcionesApp.tsx · contexts/ · layouts/ · config/navigation.ts · services/api.ts · types/
  components/ui.tsx · Timeline.tsx · VisorDocumento.tsx
  pages/Bandeja · Pedidos · Pedido · AlbaranDetalle · Recepcion (operario) · RecepcionDetalle · Incidencias · Proveedores
```

## B. Modelo de datos (`rcp_*`)

| Tabla | Qué es | Claves |
|---|---|---|
| `rcp_proveedores` | proveedores de mercancía (SOLEDAD…) | `UNIQUE (empresa_id, codigo)` |
| `rcp_proveedor_articulos` | mapeo descripción del proveedor → artículo Mobilink (`producto_texto`, `producto_id` sin FK, `ean`) | `UNIQUE (empresa_id, proveedor_id, descripcion_normalizada)` |
| `rcp_pedidos` | pedido a proveedor; `numero_proveedor` literal y `numero_normalizado`; `centro_id`/`centro_nombre`; `origen`, `external_message_id`, `source_received_at` | `UNIQUE (empresa_id, proveedor_id, numero_normalizado)` |
| `rcp_pedido_lineas` | `cantidad_pedida`, precio en céntimos, acumulados `cantidad_expedida`/`cantidad_recibida` | `UNIQUE (pedido_id, numero_linea)` |
| `rcp_albaranes` | expedición del proveedor; nace `EN_TRANSITO`; `cerrado_at` = diferencia aceptada | `UNIQUE (empresa_id, proveedor_id, numero_normalizado)` |
| `rcp_albaran_lineas` | `cantidad_expedida` y acumulado `cantidad_recibida` | `UNIQUE (albaran_id, numero_linea)` |
| `rcp_recepciones` | el acto físico: `numero` REC-…, `resultado`, `recibido_por/nombre/at` (servidor), `idempotency_key`, `documento_*` | `UNIQUE (empresa_id, numero)`, `UNIQUE (empresa_id, idempotency_key)` |
| `rcp_recepcion_lineas` | instantánea: expedida, esperada (pendiente al cerrar), recibida, diferencia | `UNIQUE (recepcion_id, albaran_linea_id)` |
| `rcp_incidencias` | estructuradas: tipo, esperada, recibida, diferencia, producto, proveedor, centro, transportista, estado, resolución | — |
| `rcp_rectificaciones` + `_lineas` | RECT-…: motivo, quién, cuándo, cantidad anterior → nueva | `UNIQUE (empresa_id, numero)` |
| `rcp_documentos` | ORIGINAL / RECEPCION, nombre, ruta por hash, `hash_sha256`, origen | un único ORIGINAL por albarán (índice parcial) |
| `rcp_eventos` | histórico inmutable (huella + trigger que rechaza UPDATE/DELETE) | — |
| `rcp_contadores` | `(empresa_id, serie, anio)` → `last_seq` | PK |

Gemelo SQL: `supabase/migrations/recepciones_fase1.sql` (generado a partir de
las sentencias de `schema.ts`) y `saas_modulo_recepciones.sql` (licencia y
CHECK de módulos).

## C. Estados (derivados, nunca escritos a mano)

- **Pedido**: `PENDIENTE_EXPEDICION` → `PARCIALMENTE_EXPEDIDO` → `EXPEDIDO` → `COMPLETADO`; `CANCELADO` a mano y sólo sin recepciones.
- **Albarán**: `EN_TRANSITO` → `PARCIALMENTE_RECIBIDO` → `RECIBIDO` | `RECIBIDO_CON_INCIDENCIA` (`EMITIDO` reservado para la fase del correo).
- **Incidencia**: `ABIERTA` → `EN_GESTION` → `RESUELTA` | `CANCELADA` (resolver o cancelar exige explicar cómo).

`pedida ≠ expedida` → pendiente de suministro (no es incidencia). `expedida ≠
recibida` → incidencia (`FALTA_MERCANCIA` / `SOBRA_MERCANCIA` automáticas si el
operario no marca motivo). Un gestor puede cerrar un albarán con diferencia
aceptada: pasa a `RECIBIDO_CON_INCIDENCIA` y las unidades que faltan cuentan
como servidas a efectos del pedido.

## D. API — `/api/recepciones/*`

`authenticate` → `requireModule("recepciones")` → `cargarPermisos` → `exigirPermiso`.

| Ruta | Permiso |
|---|---|
| `GET /bootstrap` | view |
| `GET /bandeja?pestana&estado&centroId&proveedorId&q` | view |
| `GET /pedidos` · `POST /pedidos` · `GET /pedidos/:id` · `POST /pedidos/:id/cancelar` | view / pedido.create |
| `POST /pedidos/:id/albaranes` | albaran.create |
| `GET /albaranes/:id` | view |
| `POST /albaranes/:id/recepcion` (cabecera `Idempotency-Key`) | recibir |
| `POST /albaranes/:id/cerrar` | incidencia.manage |
| `POST /albaranes/:id/original` (multipart `documento`, PDF) | albaran.create |
| `GET /recepciones/:id` · `POST /recepciones/:id/rectificar` · `POST /recepciones/:id/documento/regenerar` | view / rectificar |
| `GET /documentos/:id/contenido` (PDF inline) · `GET /documentos/:id/verificar` | view |
| `GET /incidencias` · `POST /incidencias/:id/estado` | view / incidencia.manage |
| `GET/POST/PATCH /proveedores` · `GET/POST /mapeo` | view / proveedores.manage / recibir |

## E. Pantallas

Bandeja (tabla en escritorio, tarjetas en móvil, botón **Recibir**) · Pedidos
(+ alta manual con líneas) · Pedido (tres cantidades, albaranes, alta de
albarán, recepciones, incidencias, historial) · Albarán (líneas, original,
recepciones, cierre con diferencia) · **Recibir** (pantalla del operario: dos
botones de 64 px, −/+ de 44 px sólo si hay incidencia, confirmación en dos
toques, `Idempotency-Key` al abrir) · Recepción (sello en pantalla, PDF con
Imprimir, rectificar) · Incidencias · Proveedores (+ mapeo de artículos).

## F. Preparado para el correo de Soledad (fase 2, no implementada)

`rcp_pedidos` y `rcp_albaranes` llevan `origen ('MANUAL'|'CORREO')`,
`external_message_id` (índice único parcial), `source_received_at` y
`enlace_pdf_proveedor`. `normalizarNumero()` cruza `B-2026-5688837` con
`5688837`. `rcp_proveedores.remitentes_correo` guarda desde qué direcciones
manda cada proveedor. La ingesta llamará a `service.crearPedido` /
`crearAlbaran` con `origen: "CORREO"`; el buzón copiará `therefore/buzon.ts`.

## G. Documentos e impresión

- **Original**: `POST /albaranes/:id/original` guarda el PDF byte a byte por
  hash como `<PROVEEDOR>_<albarán>_ORIGINAL.pdf`; un segundo original es 409.
- **Recepcionado**: `<PROVEEDOR>_<albarán>_<REC-…>.pdf` (sufijo `_Rn` tras n
  rectificaciones): páginas del original copiadas con pdf-lib, con una franja
  «RECEPCIONADO REC-… · fecha hora · nombre · OK/CON INCIDENCIA» en cada una, más
  la hoja del sello (pdfkit) con OK verde o CON INCIDENCIA ámbar, líneas, detalle
  de incidencias, rectificaciones, línea de firma y número de recepción.
- Se genera **después del COMMIT**; si falla, `documento_estado = ERROR` y se
  regenera desde la ficha. SHA-256 guardado; `GET /documentos/:id/verificar`
  relee del bucket y compara.
- **Impresión**: `VisorDocumento` pide el PDF como Blob con la sesión, lo
  enseña en un iframe y lanza `window.print()` (automático al cerrar, en
  escritorio); en móvil, «Abrir / guardar» al visor del sistema. Sin PrintNode,
  agente ni print server.

## H. Concurrencia, idempotencia y auditoría

`cerrarRecepcion` bloquea el albarán (`FOR UPDATE`) y sus líneas, recalcula lo
pendiente con la base, exige estado recibible y pendiente > 0, toma el número
atómicamente, escribe recepción, líneas, incidencias, acumulados, estados,
evento y auditoría (`registrarAuditoriaEnTransaccion`, que lanza) y confirma.
Dos operarios a la vez: uno 201, otro 409. La misma `Idempotency-Key` devuelve
la misma recepción (200, `repetida: true`). Recepciones cerradas: inmutables
en lo de negocio; corregir = rectificación numerada con usuario, hora, motivo y
cambio, y otro documento (el anterior se conserva).

## I. Pruebas

Unitarias (`domain/*.test.ts`) y de integración por HTTP contra PostgreSQL
(`recepciones.integration.test.ts`): los siete casos del encargo (OK; 10/6/6
sin incidencia; 10/10/8 con FALTA −2; concurrencia; 8+2 sin duplicar; original
intacto y recepcionado aparte; sin mapeo), más rectificación, idempotencia,
aislamiento entre empresas (404), histórico inmutable, y la prueba de que el
módulo no nombra ni escribe ninguna tabla de stock.
