# AutoScan — Fase 1: lo que se ha construido

Qué existe ya en el código, dónde vive y por qué está donde está. El diseño y
las decisiones que lo justifican están en `phase-1-design.md`; esto es el mapa
de lo entregado.

## Resumen en una frase

Un escáner del mostrador deja una factura en una bandeja del centro; un worker
la analiza con **el mismo** motor que la subida manual; cuando alguien cobra,
elige esa factura de la bandeja y el documento pasa a ser el justificante del
cobro.

```
ESCÁNER ──POST /autoscan/documents──▶ cash_autoscan_inbox (PENDIENTE)
                                             │
                                    worker ──┤ escanearFactura(sessionId: null)
                                             ▼
                                          LISTO ──▶ COBROS · «Usar»
                                                        │
                                                confirmar cobro
                                                        ▼
                                        cash_operation_documents + USADO
```

## Ficheros nuevos

| Fichero | Qué hace |
| --- | --- |
| `server/cash/autoscan/devices.ts` | Códigos de activación y credenciales de máquina. |
| `server/cash/autoscan/inbox.ts` | Recepción, deduplicación, listado, contador, descarte y reintento. |
| `server/cash/autoscan/worker.ts` | Coge pendientes y los manda a `escanearFactura`. |
| `server/cash/autoscan/promote.ts` | De la bandeja al justificante de un cobro. |
| `server/cash/autoscan/autoscan.integration.test.ts` | 27 casos contra PostgreSQL real. |
| `src/modules/cash/components/BandejaAutoScan.tsx` | La bandeja en Cobros y el aviso de cierre. |
| `Configuracion.tsx` · `DispositivosAutoScan` | Dar de alta escáneres, ver cuáles responden y revocarlos. |

## Tablas

- `cash_autoscan_devices` — un dispositivo por máquina, con `secret_hash`. No se
  borran al revocar: los documentos que dejaron siguen apuntando a ellos.
- `cash_autoscan_activation_codes` — códigos de una hora y de un solo uso.
- `cash_autoscan_inbox` — la bandeja. Dos índices únicos que valen por toda la
  lógica antiduplicados:

  ```sql
  -- El mismo papel no entra dos veces en el mismo centro…
  (empresa_id, centro_id, sha256) WHERE estado <> 'DESCARTADO'
  -- …y un reintento del agente no crea una segunda fila.
  (device_id, idempotency_key)
  ```

## Las cuatro reglas que sostienen esto

1. **Un documento entra sin jornada abierta.** `sessionId: null` en todo el
   camino. La factura llegó a las 20:40 con la caja cerrada y no pertenece a
   ninguna jornada; inventarle una sería meter dinero en un cierre que no lo vio.
2. **La empresa y el centro salen de la credencial, nunca de la petición.** Un
   dispositivo de Sabadell no puede dejar una factura en Terrassa aunque alguien
   reescriba la llamada.
3. **Duplicado e idempotencia son preguntas distintas.** Reintentar la misma
   subida devuelve la misma fila (200). Escanear el mismo papel dos veces desde
   dos sitios también, pero por otro camino y con otra respuesta.
4. **Escanear no es cobrar.** Elegir una factura de la bandeja no la marca como
   usada. Solo `promover`, dentro de la transacción del cobro ya registrado, la
   pasa a `USADO`.

## Un documento físico, un blob

Al promover, la fila de `cash_operation_documents` apunta a la **misma ruta**
del bucket que la de la bandeja. No se copia el fichero: duplicarlo daría dos
originales de la misma factura con dos ciclos de vida.

Consecuencia que hay que tener presente el día que se escriba una política de
retención: **el objeto del bucket ya no es de una sola fila**. Por eso en esta
fase no se borra nada del almacenamiento, ni al descartar ni al usar.

## Dos autenticaciones que no se mezclan

```
PERSONA                      MÁQUINA
Bearer de Supabase           x-autoscan-key
→ usuario, empresa, centro   → dispositivo, empresa, centro
→ permisos cash.*            → SOLO subir documentos suyos
```

Una credencial de dispositivo no es un usuario: no puede mirar cajas, jornadas,
cobros ni configuración. `req.autoscan` va aparte de `req.authCtx` justo para
que no se puedan confundir.

## Rutas

**De máquina** (`x-autoscan-key`, salvo la primera). Van en un **router
aparte**, montado antes que el de personas sobre el mismo prefijo: el router de
personas aplica `authenticate` a todo lo suyo, y un escáner no tiene sesión de
Supabase. Mientras estas tres rutas vivieron dentro de aquél, respondían «Falta
el token de sesión» y el agente no podía ni activarse.

La licencia del módulo se comprueba aquí explícitamente, con la empresa del
dispositivo: al salir de debajo de `requireModule("cash")` se perdía esa
comprobación, y una empresa sin licencia habría seguido ingiriendo facturas por
la puerta de atrás. Un fallo de licencia responde **403**, no 401: la credencial
del escáner es buena, así que un agente bien hecho no debe borrarla ni obligar a
reinstalar.

**De máquina** (`x-autoscan-key`, salvo la primera):

- `POST /api/cash/autoscan/activate` — canjea el código por la credencial.
- `POST /api/cash/autoscan/documents` — deja un documento. 202 nuevo, 200 repetido.
- `POST /api/cash/autoscan/heartbeat` — sigo vivo, y con esta versión.

**De persona** (sesión y permisos de siempre):

- `GET /autoscan/devices`, `POST /autoscan/devices`, `POST /autoscan/devices/:id/revoke`
- `GET /autoscan/inbox`, `GET /autoscan/inbox/summary`
- `GET /autoscan/inbox/:id` — el análisis **ya hecho**; abrir no vuelve a llamar a la IA.
- `GET /autoscan/inbox/:id/file`, `POST /autoscan/inbox/:id/discard`, `POST /autoscan/inbox/:id/retry`
- `POST /autoscan/inbox/:id/promote` — cuelga el documento de un cobro registrado.

Permiso nuevo: `cash.autoscan.manage` (responsable y admin). Ver la bandeja y
elegir de ella basta con `cash.view`; descartar y reintentar, no.

## En la pantalla de Cobros

El bloque «Facturas escaneadas» va encima del adjunto manual, porque si la
factura ya está en la bandeja ése es el gesto más corto. **Si el centro no tiene
ningún escáner dado de alta, el bloque no existe**: un contador a cero
permanente en una pantalla que se usa cien veces al día es ruido.

El contador separa lo usable de lo que aún no («2 listas · 1 analizando · 1 sin
leer»): un solo número haría que alguien abriera la bandeja para descubrir que
las tres estaban analizándose.

La factura elegida se ve con la bandeja abierta o cerrada, y es **excluyente**
con el adjunto manual: un cobro, un justificante.

## Dar de alta un escáner

En **Configuración → AutoScan · escáneres**. Sin esta pantalla la funcionalidad
no es alcanzable: no hay otra forma de generar un código de activación, y sin
código no se activa ningún escáner.

Se pone nombre a la máquina, se elige el taller, y sale un código
`MC-AS-XXXX-YYYY` que **se enseña una sola vez**. De la credencial se guarda
solo el hash, así que no se puede volver a consultar: si se pierde, se genera
otro. Guardarlo recuperable lo convertiría en una credencial permanente, que es
justo lo que no es — por eso el código vive en memoria de la pantalla y en
ningún sitio más.

La tabla dice cuáles responden (`conectado` se deriva del último latido, nunca
se guarda), con qué versión del agente, y permite revocar. **Los revocados no
se esconden**: los documentos que dejaron apuntan a ellos, y saber de qué
máquina vino una factura es lo que hace falta el día que se investiga algo.
Revocar uno no toca a los demás del centro.

## Al cerrar la jornada

Un aviso, **no un bloqueo**. Puede haber en la bandeja un albarán escaneado por
error o una factura que se paga por transferencia; impedir cerrar la caja por
eso pararía el taller por un papel. Lo que hace falta es que quien cierra lo
vea, porque es el único momento del día en que alguien mira la caja entera.

## Lo que NO hace esta fase

- No borra nada a los 30 días. Lo antiguo se marca y se enseña; una factura de
  hace cinco semanas sin cobrar es exactamente lo que hay que mirar.
- No hay agente de escritorio: la API de máquina existe y está probada, pero el
  programa que corre en el PC del mostrador es trabajo aparte.
- No cobra nada sola. Sigue habiendo una persona que confirma.

## Lo que el agente TIENE que cumplir

- **`Idempotency-Key` es obligatoria** en cada subida — por cabecera o como
  campo del multipart. Sin ella, 400. Es lo que distingue «reintento de lo
  mismo» de «ha llegado otro papel», y es la segunda columna del índice único.
- **Si va como campo del multipart, tiene que ir ANTES del fichero.** `multer`
  solo deja en `req.body` los campos que llegan antes; mandarla después parece
  funcionar y deja la idempotencia muda.
- **401 y 403 no significan lo mismo.** 401 es «esta credencial no vale»
  (revocada o inventada) y pide volver a activarse. 403 con
  `LICENCIA_CADUCADA` es «la credencial vale, la licencia no»: hay que esperar
  y reintentar, no reinstalar.
- Un fichero de más de 15 MB se rechaza con **400** `FICHERO_DEMASIADO_GRANDE`
  desde el guardián de subida, antes de llegar al dominio.

## Cómo se ha comprobado

- 27 casos de dominio y **18 por HTTP**, contra PostgreSQL real.
- Los de HTTP montan con el **`mountCash` de verdad**, no con un montaje a
  medida: es la única forma de que prueben lo que hay que probar —que el router
  de máquina va delante—. Con el orden anterior, 15 de los 18 se ponen rojos.
- 2851 en total en verde, dos veces seguidas y **contra una base creada desde
  cero**, que es lo que hace la CI.
- La bandeja y el aviso de cierre, renderizados y mirados en un navegador de
  verdad en sus cuatro estados (cerrada, abierta, con factura elegida, y el
  aviso).
- La pantalla de escáneres, igual, en sus cuatro casos: con dispositivos, justo
  después de generar el código, instalación nueva sin ninguno, y sin permiso de
  gestión.
