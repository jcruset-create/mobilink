# Recepciones — control de la recepción física de mercancía: diseño e implementación

> **Estado: FASES 1 y 2 implementadas.** Fase 1: circuito manual completo
> (pedidos, albaranes, recepción desde la pantalla del operario, albarán
> recepcionado generado e impreso con el navegador). Fase 2: los correos de
> Soledad (aviso de pedido y emisión de albarán) entran solos por un buzón
> IMAP o importados como `.eml`, crean el pedido, asocian el albarán y guardan
> el PDF original (§F).

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

## F. El correo de Soledad (fase 2)

```
IMAP (buzon.ts, cada N min) ──┐
Importar .eml (panel)        ──┤──► procesarFuente() ─► simpleParser ─► adjuntos PDF
                               │                                   │
                               │                                   ▼
                               │    ingesta.procesarCorreo(): rcp_correos UNIQUE(empresa, message_id)
                               │        ├─ proveedor por remitente (rcp_proveedores.remitentes_correo)
                               │        ├─ domain/correo: detectarTipo · parsearPedido · parsearAlbaran (puros)
                               │        ├─ PEDIDO  → service.crearPedido(origen CORREO) → despierta albaranes en espera
                               │        ├─ ALBARAN → busca pedido por número normalizado
                               │        │     · no existe → PENDIENTE_REVISION (se reprocesa al llegar el pedido)
                               │        │     · existe   → service.crearAlbaran(EN_TRANSITO) + ORIGINAL (adjunto o descarga del enlace)
                               │        └─ resultado: PROCESADO · DUPLICADO · IGNORADO · PENDIENTE_REVISION · ERROR
                               └─ rcp_buzon_pasadas: qué llegó en cada pasada (nunca el cuerpo)
```

- **Tablas nuevas**: `rcp_correos` (el correo entero, su resultado y a qué
  pedido/albarán dio lugar), `rcp_buzon_pasadas`, `rcp_config`
  (`buzon.activado_el`, `correo.asumir_expedicion_completa`). `rcp_pedidos`
  gana `destino_texto` y `cliente_proveedor`.
- **Variables**: `RECEPCIONES_IMAP_HOST/PORT/USER/PASS/CARPETA/MIN/EMPRESA_ID`
  (documentadas en `.env.example`). Sin ellas el buzón queda apagado y todo
  sigue funcionando por `.eml` importado a mano. En producción:
  `imap.comercialsea.com` (cdmon) y `pedidos@comercialsea.com`.
- **El buzón es dedicado** (nadie trabaja dentro), y aun así el módulo no
  escribe en él: no marca `\Seen` ni toca ninguna bandera, y lleva su avance
  por UID en `rcp_config` (`buzon.progreso.<carpeta>`, con el UIDVALIDITY).
  Con `\Seen`, un vistazo por webmail bastaría para saltarse un correo o para
  reprocesarlos todos; el UID sólo lo mueve este módulo. Un correo que falla
  no deja avanzar la marca. Y sin remitentes configurados en ningún proveedor
  el buzón no procesa nada: también llega publicidad, y guardarla sería meter
  su cuerpo en la base.
- **Rutas**: `GET /correo/buzon` (estado, remitentes, pasadas, correos en
  revisión) · `PUT /correo/config` · `POST /correo/buzon/revisar` ·
  `POST /correo/buzon/historico {desde}` · `POST /correo/eml` (multipart
  `archivo`) · `GET /correo?resultado=` · `GET /correo/:id` ·
  `POST /correo/:id/reprocesar` · `POST /albaranes/:id/original/descargar`.
- **Pantalla «Correo del proveedor»**: estado del buzón, remitentes, última
  pasada, importar `.eml`, revisar ahora, cargar histórico, lista de correos
  con resultado y enlace al pedido/albarán, reprocesar, ver el texto original.
- **Líneas del albarán**: las que detalle el correo (casadas por descripción
  normalizada), o una «cantidad expedida» total si el pedido tiene una línea,
  o todo lo pendiente si la configuración lo asume. Nunca más de lo pendiente.
- **Centro destino**: la localidad del bloque «Destino» (`43006 TARRAGONA` →
  `TARRAGONA`) casada con `app_centros` por nombre; si no casa, se guarda como
  texto y el correo lo dice en su motivo.
- **Pruebas** (`domain/correo/correo.test.ts`, `correo.integration.test.ts`):
  los dos correos reales; pedido → albarán con adjunto; duplicados por
  Message-ID y por número; albarán antes que pedido; remitente desconocido;
  pedido sin líneas; descarga del enlace (portal HTTP local) y enlace que no es
  PDF; cantidad expedida parcial; buzón falso (no leído, marca leído, deja sin
  leer lo que falla, pasadas) y buzón que no abre.

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
