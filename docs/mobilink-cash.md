# Mobilink Cash — mapa técnico y decisiones

Módulo de caja física: cobros, pagos, denominaciones, cambio, arqueo y cierre.
Se integra opcionalmente con una ERP externa; **sin ERP el módulo es
completamente funcional**.

## 1. Lo que ya había en Mobilink (y que se reutiliza)

El análisis previo a programar. Nada de esto se ha reinventado.

| Pieza | Dónde está | Cómo se usa en Cash |
|---|---|---|
| Stack web | React 18 + TS + Vite 5 + Tailwind 4 + react-router 7 + lucide | Igual, sin librerías nuevas |
| Backend | Express 5 (`server/index.ts`) + `pg` Pool (`server/db.ts`) | Router propio montado en `/api/cash` |
| Esquema | SQL crudo idempotente (`initDb()`) + `supabase/migrations/*.sql` | `server/cash/schema.ts` + `supabase/migrations/cash_fase1.sql` |
| Autenticación | `server/core/auth.ts` → `authenticate` (Bearer Supabase) | Mismo middleware, sin sistema de usuarios nuevo |
| Licencias | `app_licencias` + `requireModule("modulo")` | Se añade el módulo `cash` al CHECK |
| Permisos | `app_usuario_modulos (modulo, rol, pantallas)` | Rol + pantallas de Cash, mismo mecanismo |
| Auditoría | `app_auditoria` + `registrarAuditoria()` | Toda operación sensible de caja |
| Front sesión | `src/modules/sessionHeaders.ts` | `Authorization: Bearer` en cada fetch |
| Dominio puro + tests | `server/connect/pricing/*` (money.ts, engine.ts, vitest) | Mismo patrón para el motor de caja |
| Conectores externos | `server/integration-hub/` (`Connector`, `ConnectorRegistry`, `integration_operations` con `retry_count`) | Mismo contrato para `ICashErpConnector` |
| Numeración | `nextDocumentNumber()` sobre `integration_document_counters` | `MC-C-YYYY-NNNNNN` / `MC-P-YYYY-NNNNNN` |
| Lenguaje visual | `src/modules/administracion/components/ui.tsx` (slate-900/800, acento sky) | Se reutilizan `Card`, `Modal`, `TableWrap`, `Pill`, `inputCls`… |

Decisión de arquitectura clave: **el backend de Cash va en Node/Express con
`pg`**, no en funciones RPC de Postgres como TyreControl. Motivo: las
credenciales de la ERP no pueden vivir en el navegador (§46), el motor de
cambio tiene que ser testeable con vitest como `pricing/`, y el worker de
outbox necesita proceso Node. Las transacciones y los bloqueos siguen siendo
de Postgres (`BEGIN` / `SELECT … FOR UPDATE`).

## 2. Dinero

`server/cash/domain/money.ts`. Dinero = **entero de céntimos** (`Centimos`),
nunca `float`. `pricing/money.ts` usa `bigint` escalado a diezmilésimas porque
allí hay precios por km y porcentajes; en caja no existe nada por debajo del
céntimo (no hay moneda de menos de 1 c), así que el entero de céntimos es
exacto y hace el algoritmo de cambio directamente indexable.

## 3. Modelo de datos (tablas `cash_*`)

```
cash_denominations        catálogo (valor en céntimos, tipo billete/moneda, cartucho)
cash_registers            cajas físicas (centro + nombre)
cash_sessions             jornada: DRAFT|OPEN|PENDING_CLOSE|CLOSED|REOPENED|CANCELLED
cash_operations           operación normalizada (COLLECTION|PAYMENT|MANUAL_IN|…)
                          source = MANUAL|ERP|API|IMPORT|POS|OTHER
                          erp_sync_status = NOT_APPLICABLE|PENDING|SYNCING|SYNCED|ERROR|…
cash_operation_payments   formas de pago por operación (soporta mixtos)
cash_denomination_movements  libro mayor inmutable de piezas (IN/OUT + reason)
cash_counts               arqueo: cabecera
cash_count_lines          arqueo: piezas contadas por denominación
cash_external_documents   caché local de documentos ERP (externalSystem+externalId únicos)
cash_erp_configs          integración por empresa/centro (sin secretos en claro)
cash_erp_outbox           eventos pendientes de enviar a la ERP (patrón outbox)
```

El **stock teórico se reconstruye siempre** sumando
`cash_denomination_movements` de la jornada. Es la única fuente de verdad; no
hay saldo acumulado que se pueda desincronizar.

## 4. Motor de dominio (`server/cash/domain/`, sin dependencias de BD ni UI)

- `money.ts` — céntimos, formateo, parseo.
- `denominations.ts` — catálogo y cartuchos.
- `inventory.ts` — inventario por denominación: sumar, restar, validar, total.
- `change.ts` — cambio con **stock limitado**: programación dinámica exacta,
  minimiza piezas, `NO_SOLUTION` explícito cuando no hay combinación.
- `operations.ts` — invariantes de la operación (recibido − cambio = cobrado,
  mixtos, parciales). En un pago el cuadre es el mismo del revés, y por eso
  admite **vuelta**: pagar 19,50 € con un billete de 20 € y recibir 0,50 € son
  dos movimientos —sale el billete, entra la moneda— y el pago es la
  diferencia. Registrarlo como "salen 19,50 €" sería mentir sobre las piezas.
- `arqueo.ts` — teórico vs contado por denominación, doble cuadre, reparto
  cambio final / ingreso bancario.
- `cartridges.ts` — cartuchos de monedas. Un tubo **se abre y no se vuelve a
  cerrar**. La regla que manda es **dar siempre las piezas de mayor valor**: si
  la moneda que toca está encartuchada, el tubo se abre. El precinto solo se
  respeta DENTRO de cada denominación — si de esa misma moneda hay sueltas
  suficientes, se gastan las sueltas. Lo que no se hace es esquivar la apertura
  a base de piezas más pequeñas: devolver 19,50 € con nueve monedas de 0,50 €
  teniendo un tubo de 2 € deja la caja sin calderilla, que es justo lo que hay
  que conservar. El stock distingue sueltas de encartuchadas y abrir un tubo
  deja su propio par de asientos (`CARTRIDGE_OPENED`).

  Desde la versión 1.8.8 hay un **tercer formato: la bolsa**, que es el precinto
  grande con el que el banco sirve las monedas a granel (500 monedas de 1 €, por
  ejemplo). Funciona igual que el cartucho: se cuenta aparte, viaja aparte y el
  motor la puede abrir sola cuando hace falta, con su propio par de asientos
  (`BAG_OPENED`). Dentro de una denominación el orden es **sueltas → bolsas →
  cartuchos**, siempre, sin mirar tamaños: la bolsa es lo que llega del banco y
  se deshace nada más abrirla, y el cartucho es lo que se guarda ordenado para
  el cajón. Cuántas monedas trae una bolsa se configura por denominación
  (`piezas_por_bolsa`), porque cada banco sirve el suyo, y **puede ser menos que
  un cartucho** — hubo una validación que lo prohibía y rechazaba la
  configuración real de un taller con bolsas de veinte y cartuchos de cincuenta.

  Un asiento es de un solo formato: la restricción `cash_mov_un_formato` impide
  que una fila lleve `cartuchos > 0` y `bolsas > 0` a la vez, porque entonces no
  se sabría qué precinto se rompió al abrirla.

  Los tubos **entran y salen precintados** —la aportación de cambio del banco
  llega en tubos y se le devuelve igual— y solo se abren cuando un cobro o un
  pago necesita monedas sueltas que no hay. Sacar un tubo cerrado no es abrirlo:
  se comprueba que existe, y no se rompe nada.

## 5. Integración ERP

`server/cash/erp/`: interfaz `ICashErpConnector` (`getReceivables`,
`getPayables`, `registerCollection`, `registerPayment`, `cancel*`,
`healthCheck`) + `MockCashErpConnector` para desarrollo y tests. El dominio
**no conoce ninguna ERP**: recibe siempre una `CashOperation` normalizada,
venga de un documento externo o de una alta manual.

Fiabilidad: el evento de sincronización se escribe en `cash_erp_outbox`
**dentro de la misma transacción** que la operación y sus movimientos. Un
worker lo envía después con reintentos e `idempotencyKey =` número de
operación. Una ERP caída nunca revierte un movimiento físico que ya ocurrió.

## 6. Frontend (`src/modules/cash/`)

Rutas `/cash/*`, layout propio con la misma topbar+sidebar que Administración.
Pantallas: Jornada actual · Cobros · Pagos · Movimientos · Stock de caja ·
Arqueo · Cierre · Histórico · Integración ERP · Configuración.

Componente central reutilizable: `DenominationGrid`, la rejilla de −/+ por
denominación pensada para tablet, que se usa igual en cobro, pago, movimiento,
arqueo y cierre.

Lo común (`Card`, `Modal`, `TableWrap`, `Pill`, `inputCls`…) se **reexporta**
de `administracion/components/ui.tsx` en vez de copiarse; en
`cash/components/ui.tsx` solo vive lo que no existía (botones de 56 px para el
mostrador, distintivos de origen ERP/manual y de estado de sincronización).

## 7. Permisos

`server/cash/permissions.ts` traduce el rol de `app_usuario_modulos` (módulo
`cash`) a permisos finos. No hay tabla de permisos nueva: sería un mecanismo
paralelo que mantener.

| Rol | Puede |
|---|---|
| `consulta` | ver |
| `cajero` | cobrar, pagar, mover efectivo, arquear, adjuntar justificantes |
| `responsable` | además abrir/cerrar/reabrir, ajustar, anular, reintentar ERP, dar de alta cajas, pedir cambio al banco y entregar dinero |
| `admin` | además configurar la integración y el catálogo de denominaciones |

`cash.configure` (cajas) y `cash.denominations.configure` (catálogo) van
separados **porque su alcance es distinto**: las cajas son de la empresa, pero
`cash_denominations` no tiene columna de empresa — es el catálogo de toda la
instalación. Si un responsable pudiera desactivar la moneda de 1 c, se la
estaría desactivando también a las demás empresas. La pantalla lo advierte.

Los cobros y pagos distinguen permiso ERP de permiso manual
(`cash.collection.create` vs `cash.collection.create_manual`), que era lo que
pedía el encargo: se puede dejar cobrar facturas de la ERP a quien no debe
poder inventarse un cobro.

## 7 bis. Formas de cobro

`cash_payment_methods`, por empresa. Cada fila activa es un botón en Cobros y
en Pagos, por su `orden`; si tiene `imagen_url` el botón enseña la imagen y si
no, el nombre.

`codigo` es lo que se guarda en `cash_operation_payments.forma_pago` desde el
primer día, así que **la baja es lógica**: un cobro por AMEX de hace un año
sigue diciendo AMEX aunque hoy ya no se acepte. El código no se puede cambiar
—es la clave del histórico— pero el nombre sí, y ese cambio arrastra a las
pantallas a propósito.

Dos reglas que el backend impone dentro de la transacción, no en la pantalla:

- **El efectivo no se da de baja ni se duplica.** Un índice único parcial
  (`WHERE afecta_efectivo`) impide que haya dos formas que muevan el cajón: con
  dos, el desglose por denominación de cada operación dejaría de ser
  interpretable. Y sin ninguna no habría arqueo ni cierre que hacer.
- **Una forma dada de baja no admite cobros nuevos**, ni aunque la pantalla la
  tuviera pintada de antes. Es la misma razón por la que el stock se relee con
  la jornada bloqueada.

`pide_referencia` obliga a introducirla al cobrar. Viene activada en todo lo
que no es efectivo, porque es lo que luego permite cuadrar con el banco.

`en_cobros` y `en_pagos` deciden en qué pantalla sale cada botón, porque **no
son la misma lista**: se cobra por tarjeta, Bizum o transferencia, pero a un
proveedor se le paga del cajón. De salida solo el efectivo aparece en pagos, y
el resto se marca desde Configuración el día que haga falta. El efectivo no se
puede quitar de ninguna de las dos: es el único que mueve el cajón. Se valida
en la transacción, como todo lo demás del catálogo.

Esto obligó a **abrir `FormaPago` en el dominio**: era una unión cerrada y
`afectaAlEfectivo()` comparaba con el literal `"CASH"`. Ahora es un código y las
funciones del motor reciben el conjunto de códigos que son efectivo. El motor
sigue sin saber nada de base de datos: quien consulta el catálogo es el
servicio y se lo pasa hecho.

La imagen del botón se sube a Supabase Storage y de ella se guarda la URL, igual
que el avatar de técnicos. En disco local no: el contenedor de Render es
efímero y la imagen se perdería en el siguiente despliegue.

Lo que se guarda no es el fichero que sube el usuario, sino una miniatura de
160 px de alto que hace `server/cash/images.ts` con `sharp`. El botón la pinta
a 32 px, así que guardar una foto de móvil de 4000 px solo serviría para que la
pantalla de cobros tarde en cargar. El usuario sube lo que tenga a mano y no
tiene que saber nada de píxeles.

Los errores de multer —el fichero pasa del límite, el campo no es el esperado—
se disparan **antes** que el manejador `ruta()`, así que sin envolverlos acaban
en el 500 genérico de `server/index.ts` ("Error interno del servidor"), que no
dice nada. `subida()` los traduce a un 400 con un mensaje que se entiende. Si
aparece otra ruta con `multer` en este módulo, tiene que pasar por ahí.

## 7 ter. Tesorería: cambio del banco y entregas de dinero

Dos documentos para el mismo problema: **dinero que sale hoy de la caja y
vuelve más tarde**. Ese hueco era lo que el módulo no sabía representar, y es
lo que hace que un arqueo descuadre 200 € sin que nadie recuerde por qué.

`cash_change_orders` — se va al banco con billetes y se vuelve con calderilla.
`cash_advances` — se le dan 50 € a alguien para que compre algo.

Tres decisiones sostienen lo demás:

- **Los asientos se hacen cuando el dinero se mueve**, no cuando se planea. Al
  crear el pedido salen los billetes; al recibirlo entra la calderilla. En
  medio, el stock teórico ya no cuenta ese dinero, así que el arqueo de la
  tarde cuadra sin trucos, y las pantallas de jornada y cierre dicen cuánto hay
  fuera y de quién.
- **Cruzan jornadas.** El banco no contesta el mismo día y el empleado vuelve
  en el turno siguiente. Cada asiento pertenece a la jornada en la que ocurrió.
  Era el encargo: que un billete de 50 € no desaparezca en un cambio de turno.
- **La liquidación de una entrega registra el pago REAL y no vuelve a mover
  piezas.** Si se entregan 50 €, la factura es de 40 € y devuelve 10 €, en el
  listado hay un pago de 40 € y en el libro mayor dos asientos: sale un billete
  de 50 y entra uno de 10. Volver a asentar las piezas del pago sacaría 90 € de
  una caja de la que solo salieron 50. Es la única excepción a "todo efectivo
  lleva su detalle de piezas" (`liquidaEntregaId` en el dominio), y no la
  rompe: las piezas existen y están asentadas, solo que en la entrega.

Si las cuentas no cuadran —factura de 40 € y solo devuelve 8— no se bloquea: el
dinero ya no está y negarse a registrarlo solo esconde el problema. Se exige un
motivo y queda auditado con el nombre de quien lo tenía. Lo mismo con el banco
cuando da algo distinto de lo pedido.

### Qué pedirle al banco

`domain/restock.ts`, y **sin ningún modelo de lenguaje**, a propósito: el libro
mayor registra cada moneda que ha salido al dar cambio, así que el consumo es
un dato y no una estimación. Una fórmula da siempre la misma respuesta, se
prueba y se audita; un modelo daría respuestas distintas para el mismo caso, y
en dinero eso es un defecto.

Consumo medio diario por denominación de las últimas jornadas → objetivo por
días de colchón → resta de lo que hay → redondeo a cartucho (al banco las
monedas se piden en tubos) → ajuste al importe que se cambia, priorizando lo
que antes se va a agotar. Cada línea sale con su porqué —"gastas unas 40
monedas de 1 € al día y te quedan 20"— porque una propuesta que no se entiende
no se corrige: se ignora.

Los billetes que salen a pagar el pedido se componen con los **más grandes**
que haya, que es lo contrario de dar un cambio: son justo los que sobran.

## 7 quater. Justificantes e informe de cierre

El escáner del mostrador saca un PDF y ese PDF se cuelga del cobro o del pago
(`cash_operation_documents`). Al cerrar, un solo fichero reúne el papeleo del
día: portada con el cierre y el arqueo, listado de operaciones, y **los
escaneados detrás**.

- **El fichero no va en la base de datos**: vive en un bucket de Supabase
  Storage y aquí solo queda la ruta. La URL tampoco se guarda: se firma al
  pedirla y caduca a los 15 minutos.
- **El bucket es privado**, a diferencia del que el proyecto usa para avatares
  y logotipos. Un logo puede verlo cualquiera; estas son las facturas de los
  clientes. Con un bucket público, una URL reenviada abriría la facturación del
  día a quien la reciba, sin sesión y para siempre. El bucket se crea solo la
  primera vez que se adjunta algo.
- **El documento se sube DESPUÉS de registrar la operación**, en otra petición.
  Si el almacenamiento falla, el dinero ya está contado y solo queda volver a
  adjuntar. Al revés —subir dentro de la transacción— un fallo de red dejaría
  sin registrar un cobro que ya ha ocurrido, y eso sí se paga dos veces.
- **No se borra: se anula**, con motivo y auditoría. Deja de salir en el
  informe pero consta que existió. Retirar es permiso de responsable, adjuntar
  lo tiene el cajero: quitar la factura que respalda una salida de caja no debe
  poder hacerlo quien la registró.

El informe usa **dos herramientas**: pdfkit para la portada y los listados, que
es lo que ya usa el proyecto en los partes de taller; y **pdf-lib** para el
montaje, porque pdfkit sabe dibujar pero no sabe incrustar las páginas de otro
PDF, y los justificantes vienen del escáner en PDF. Es la única dependencia
nueva del módulo y entra por eso.

Un justificante ilegible o que ya no esté **no rompe el informe**: sale una
página diciéndolo, con su número de operación. Un cierre sin informe por una
factura corrupta sería peor que un informe con un hueco señalado.

## 7 quinquies. Ingresos bancarios

El cierre de cada jornada aparta un importe "para el banco"
(`ingreso_bancario_centimos`), pero al banco no se va cada día: se acumulan
cierres y un solo ingreso los agrupa (`cash_bank_deposits` +
`cash_bank_deposit_sessions`). El banco solo admite billetes, así que las
monedas que no se consiguen convertir quedan en tienda como **remanente**, que
arrastra al ingreso siguiente. Cuánto se ingresa de verdad lo decide el
usuario: el sistema no puede saber cuántas monedas se convirtieron.

La ecuación es un `CHECK` de la tabla, no una validación de código:

    remanente_anterior + total_cierres − importe = remanente_nuevo

Decisiones que sostienen el resto:

- **El remanente no es una columna de saldo**: es el `remanente_nuevo` del
  último ingreso confirmado. Derivado, como el stock teórico — no existe un
  contador que pueda desincronizarse.
- **Concurrencia en dos capas**: crear o anular bloquea la fila de la caja
  (`FOR UPDATE`), que serializa la cadena de remanentes; y un índice único
  parcial sobre los cierres vigentes impide a nivel de base de datos que el
  mismo cierre entre en dos ingresos, incluso si el bloqueo fallara.
- **Solo se anula el último** ingreso confirmado de cada caja: los siguientes
  arrancaron de su remanente, y anular uno del medio dejaría la cadena
  apuntando a un número que ya no existe. Se deshace en orden, y cada paso
  restaura exactamente (cierres a pendientes, remanente anterior).
- **Una jornada conciliada no se puede reabrir** sin anular antes su ingreso:
  al recerrarla cambiaría el importe y el ingreso conciliaría un número que ya
  no existe (`JORNADA_CONCILIADA` en `reabrirJornada`).
- Aislamiento por caja en todas las consultas, numeración `MC-IB-YYYY-NNNNNN`,
  anulación lógica con quién/cuándo/por qué, y auditoría en `app_auditoria`.

## 7 sexies. Días atrasados (arranque del módulo)

Al poner la caja en marcha hay días que ya se llevaron a mano en papel y que
hay que meter en el sistema. La fecha del cobro tiene que ser **la del día en
que se cobró**, no la del día en que se teclea.

El modelo ya lo permitía sin tocar nada, y conviene saber por qué: las
operaciones **no llevan fecha propia**. Cuelgan de una jornada
(`cash_operations.session_id`) y la fecha contable es la de la jornada
(`cash_sessions.fecha`). Hasta la numeración sale de ahí —el año de
`MC-CO-2026-000001` es el de la jornada, no el del reloj—. `created_at_ms`
sigue guardando cuándo se tecleó de verdad, que es información de auditoría y
no debe confundirse con la fecha contable.

Lo que se añadió es la fecha en la pantalla de apertura y tres reglas:

- **Nunca al futuro** (`FECHA_EN_FUTURO`), y la fecha tiene que existir de
  verdad: `2026-02-31` pasa el patrón `AAAA-MM-DD` y no es un día
  (`FECHA_NO_VALIDA`). Una jornada fechada por delante rompería la herencia del
  fondo hasta que alguien la encontrase.
- **La herencia se acota por fecha.** `ultimaSesionCerrada(client, caja, hasta)`
  busca la última cerrada **con fecha ≤ la de la nueva**. Si alguien mete el 13
  después de haber cerrado el 14, el 13 tiene que heredar del 12, no del 14,
  que para él está en el futuro. Abriendo el día de hoy no cambia nada.
- **Repetir un día pasado avisa** (`FECHA_YA_TIENE_JORNADA`, con el `id` de la
  que ya hay) y se puede confirmar con `permitirFechaRepetida`. Solo para
  fechas pasadas: abrir un segundo turno HOY es operación normal y preguntar
  ahí sería un estorbo diario a cambio de nada.

El orden recomendado al meter atrasados es de más antiguo a más reciente, para
que el cambio final de cada día sea el fondo inicial del siguiente, igual que
pasó en el mostrador.

## 7 septies. Secciones de negocio (taller y gasolinera, un solo cajón)

Este taller lleva **dos negocios que liquidan por separado pero comparten un
único cajón**. Las dos salidas evidentes son malas:

- **Dos cajas** → cada una con su jornada y su arqueo. Pero solo hay un montón
  de billetes: no se puede arquear dos veces el mismo dinero, y el arqueo
  dejaría de significar nada.
- **Una sola caja** → el arqueo cuadra, pero se pierde la liquidación separada,
  que es justo lo que hacía falta.

La salida es partir **la liquidación, no el inventario**:

- **El cajón, la jornada, el arqueo y el cierre siguen siendo uno solo.** Esto
  no es negociable: es lo que garantiza que el módulo cuadra.
- Cada operación lleva su sección (`cash_operations.section_id`), y el resumen
  de la jornada trae `porSeccion` con cobros, pagos y efectivo neto de cada una.
  Es un **dato informativo**: ese dinero no está separado físicamente.

Decisiones que conviene no reabrir sin pensarlas:

- **Una operación pertenece a una sola sección.** Un cliente que reposta y deja
  el coche se registra como dos operaciones, no como una repartida. Repartir
  una operación entre secciones obligaría a repartir también sus piezas de
  efectivo, y ahí se acaba la trazabilidad.
- **Los pagos no preguntan la sección**: van todos al negocio principal. Pero
  **el campo se guarda igual**, relleno con la sección por defecto. Tenerlo
  desde el primer día ahorra una migración con datos reales dentro el día que
  se quiera imputar el gasto a cada negocio. Consecuencia conocida: el efectivo
  neto por sección sirve para saber **lo que ha entrado** por cada una, no para
  calcular un margen.
- **Lo anterior al catálogo sale como «Sin sección»**, agrupado aparte y no
  repartido a ojo entre las que hay: un número inventado es peor que un hueco
  declarado.
- **Una sola sección por defecto**, garantizado con un índice único parcial y
  no con una comprobación en el código. Y no se puede dar de baja: es la que
  rellena los pagos.
- El catálogo es **por empresa y configurable** (`cash_sections`), como las
  formas de cobro: mañana puede haber una tercera —tienda, lavadero— sin tocar
  código.

## 7 octies. El descuadre del arqueo

El arqueo compara lo contado con el teórico. Cuando no coinciden, la diferencia
**se asienta como un ajuste con su operación propia, pieza a pieza**: nunca se
disuelve en un total.

Hay **dos momentos** en que puede asentarse, y los dos comparten el mismo
código (`asentarAjusteDeArqueo`) para que no diverjan:

1. **Al regularizar** (`regularizarArqueo`), que es el camino recomendado: se
   cuenta, se recuenta, se acepta el descuadre con su motivo y a partir de ahí
   la caja cuadra. El cierre va después sobre limpio.
2. **Al cerrar**, como red de seguridad: si nadie regularizó, el cierre lo hace
   solo. Una caja ya regularizada no vuelve a asentar nada, porque para
   entonces el teórico y lo contado son el mismo número.

Detalles que costaron un fallo en producción:

- **El cierre reparte LO CONTADO, no el teórico.** La pantalla usaba
  `jornada.totalStockCentimos` (el teórico). Con la caja cuadrada son el mismo
  número y no se nota; con un faltante pedía repartir un dinero que no estaba y
  **el cierre no se podía completar**. El resumen expone ahora `ultimoArqueo`
  con las piezas contadas.
- **Las monedas de los envases son monedas.** Al regularizar hay que sumar
  `cartuchos_contados × piezas_por_cartucho` y `bolsas_contadas ×
  piezas_por_bolsa` a las sueltas; si no, un precinto sin abrir se lee como un
  faltante que no existe.
- **Un CHECK lo recrea un único bloque de migración.** Dos bloques recreaban
  `cash_denomination_movements_motivo_check`, y el de arriba llevaba la lista
  vieja: en cuanto existió el primer asiento `BAG_OPENED`, arrancar el servidor
  fallaba con «check constraint … is violated by some row» y el proceso moría
  antes de escuchar. Ahora la lista de motivos vive en un solo sitio.
- **El importe del ajuste nunca es cero** (`|diferencia| || 1`): un descuadre
  solo de composición —sobra un billete de 10 y falta otro de 10— mueve piezas
  sin mover el total, y una operación de 0 € desaparecería de los listados.
- **El motivo es obligatorio** en la pantalla. Un ajuste sin explicación no lo
  entiende nadie un mes después.

## 8. Estado de la entrega

Implementado y probado:

- Motor de dominio completo, con contraste contra búsqueda exhaustiva.
- Esquema, migración y alta del módulo `cash` en `app_licencias`.
- Servicio transaccional, API `/api/cash/*` y montaje en `server/index.ts`.
- Conector ERP + mock + outbox con reintentos e idempotencia.
- Las diez pantallas del módulo, dadas de alta en `/inicio` y en `modulosApp`.
- Configuración: alta, renombrado y baja de cajas físicas, y edición del
  catálogo de denominaciones, cartuchos y bolsas, con la foto de cada billete y
  cada moneda. Con dos protecciones que evitan dejar
  el módulo en un estado sin salida: no se toca una caja con la jornada abierta
  (quedaría dinero contado en una caja invisible que nadie podría cerrar), y no
  se desactiva una denominación que aún tiene piezas en una caja abierta (el
  arqueo no podría contarla ni el cierre sacarla).

**975 pruebas en verde** (`npm test`), de las cuales 159 son de Mobilink Cash y
68 corren contra PostgreSQL real (`RUN_DB_TESTS=1`): escenario completo del
encargo sin ERP, concurrencia sobre la última pieza, ERP caída y reintento
idempotente.

Para estrenarlo hace falta, una sola vez, y los tres pasos se hacen desde la
interfaz —no hace falta tocar la base de datos a mano:

1. **Licencia**: Administración → Empresas → licencias, módulo `cash`. El
   esquema (tablas `cash_*` y el catálogo de denominaciones) se aplica solo al
   arrancar el servidor; la licencia no, porque es una decisión comercial.
2. **Permisos**: Administración → Usuarios, una fila por usuario en el módulo
   Mobilink Cash con su rol (`cajero` para mostrador, `responsable` para quien
   abre y cierra).
3. **La primera caja**: Mobilink Cash → Configuración. Sin ninguna caja dada de
   alta no se puede abrir jornada, así que este paso no es opcional.

Queda fuera de esta fase, y conviene decirlo:

- **Conector de una ERP real.** Solo está el mock. Escribir el de Business
  Central (o Sage, o A3) es implementar `ICashErpConnector` y registrarlo; el
  motor de caja no cambia.
- **Webhooks de entrada** (`invoice.created`, `invoice.updated`…). El modelo los
  admite —`cash_external_documents` ya hace upsert por
  `(empresa, sistema, id)`— pero no hay endpoint de recepción.
- **PDF del ingreso bancario.** Ahora se imprime la pantalla. El repo ya usa
  `pdfkit` en `server/index.ts`, así que generarlo es un añadido pequeño.
- **Exportación de una operación manual a la ERP.** El modelo lo permite
  (`source = MANUAL` + `erp_sync_status`), pero no hay acción de interfaz.
