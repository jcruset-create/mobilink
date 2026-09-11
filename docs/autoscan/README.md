# AutoScan — qué hay hoy

El escáner del mostrador deja un PDF en una carpeta y la factura aparece en
Mobilink Cash sin que nadie suba nada. Este documento es **el estado real**,
leído del código; los otros tres de esta carpeta son históricos y se listan al
final.

> **Lo primero, porque condiciona todo lo demás:** el agente **nunca se ha
> ejecutado en Windows**. Ni una vez. Lo que está probado es la lógica en Node
> —189 pruebas entre agente y servidor—; lo que toca el sistema operativo
> —instalador, bandeja, DPAPI, tarea programada, actualizador— está escrito y
> revisado y **sin ejecutar**.
>
> **Queda pendiente la prueba en un PC de verdad**, y hasta pasarla AutoScan no
> se despliega en más de un mostrador. El guion está en
> [`PRUEBA-EN-WINDOWS.md`](./PRUEBA-EN-WINDOWS.md).

---

## 1. Las piezas

```
                 mostrador                    │            Mobilink
                                              │
   escáner ──► Inbox\  ──► agente ──HTTPS──►  │  /api/cash/autoscan/documents
   (iX1500)         │       (Node)            │            │
                    │         │               │            ▼
                    │         └─► cola SQLite │   cash_autoscan_inbox
                    │                         │            │
                    └──────► Sent\ / Failed\  │            ▼
                                              │   bandeja en Cobros y Pagos
```

**En el servidor** (`server/cash/autoscan/`):

| Fichero | Qué hace |
|---|---|
| `devices.ts` | Alta por código de un solo uso, canje, verificación, revocación, latido |
| `inbox.ts` | La bandeja: listar, resumen, fichero firmado, descartar, reintentar |
| `promote.ts` | Enganchar un documento de la bandeja a un cobro o un pago |
| `worker.ts` | Análisis del documento recién llegado |
| `version.ts` | Qué agente hay publicado y dónde (§4) |

Tres tablas: `cash_autoscan_devices`, `cash_autoscan_activation_codes`,
`cash_autoscan_inbox`.

**En el panel**: `BandejaAutoScan.tsx`, que sale en Cobros, en Pagos y en el
aviso de Cierre; y `DispositivosAutoScan` en Configuración, que da de alta los
PCs y genera los códigos. El código recién creado vive **en memoria y nada
más**: mientras dura es una credencial, y una credencial no se deja escrita en
el navegador de recepción.

**En el mostrador** (`autoscan_agent/`, Node + TypeScript, sin Electron ni
Tauri):

| Módulo | Qué hace |
|---|---|
| `vigilante.ts` | Mira la carpeta y encola lo que ya está terminado |
| `estabilidad.ts` | Decide cuándo un fichero ha dejado de crecer |
| `cola.ts` | SQLite: lo apuntado antes de subir |
| `enviador.ts` | Sube, archiva y reconcilia lo que quedó a medias |
| `api.ts` | Las tres rutas de máquina, y ninguna más |
| `panel.ts` | El servidor local que alimenta la bandeja de Windows |
| `credencial.ts` + `dpapi.ts` | La credencial, cifrada con DPAPI |
| `version.ts` + `actualizador.ts` | La actualización (§4) |
| `registro.ts` | El log, sin secretos dentro |

---

## 2. Las decisiones que no conviene reabrir

**Del dispositivo solo se guarda el hash del secreto.** Una copia de la base de
datos no debe permitir subir nada.

**El dispositivo no elige su centro**: lo hereda del código con el que se
activó, y ese código lo creó una persona. Si pudiera declararlo, un PC
cualquiera subiría documentos a cualquier centro.

**No se sube en cuanto salta el evento del sistema de ficheros.** El escáner
todavía está escribiendo: hay que esperar a que el tamaño se estabilice. Un PDF
a medias sube igual de bien y no se puede leer.

**Nada se borra**: lo entregado se mueve a `Sent\`, lo rechazado a `Failed\`.

**Se apunta en SQLite ANTES de subir.** Un corte de luz no pierde el documento:
al arrancar se rescata lo que quedó a medias y se termina de archivar lo
entregado, y eso pasa **antes** de subir nada nuevo, para no duplicar.

**Una sola instancia, y el portero es el puerto.** Dos agentes sobre la misma
carpeta se pisarían al archivar. No hace falta fichero de bloqueo con su PID y
su limpieza tras un cuelgue: el panel ya ocupa un puerto y el sistema operativo
no deja ocuparlo dos veces.

**Sin credencial no se para: se espera.** Un agente recién instalado no tiene
credencial y ése es su estado normal hasta que alguien pega el código. Salir con
error dejaría al técnico sin bandeja donde escribirlo.

**Tarea programada al iniciar sesión, no servicio.** DPAPI cifra con ámbito
`CurrentUser`; como servicio no podría leer su propia credencial.

**El panel escucha solo en 127.0.0.1, todo pide token, y se rechaza cualquier
petición con `Origin`.** Lo último es lo que impide que una web abierta en el
navegador del mostrador conduzca el agente por detrás.

**401 y 403 no significan lo mismo.** 401 es «esta credencial no vale» y pide
reactivar; 403 con `LICENCIA_CADUCADA` es «la credencial vale, la licencia no»:
se reintenta y **nunca** se borra la credencial.

---

## 3. La bandeja

Un documento que llega no es un cobro: espera en `cash_autoscan_inbox` hasta que
alguien lo engancha desde Cobros o Pagos. Nada se cobra solo.

Lo antiguo **no se borra a los 30 días**: se marca y se enseña. Una factura de
hace cinco semanas sin cobrar es exactamente lo que hay que mirar.

---

## 4. Actualizar el agente

Desde la bandeja de Windows: clic derecho → «Actualizar el agente».

```
push a autoscan_agent/**
        │
        ▼
  CI (build-autoscan-agent.yml)
        │  empaqueta y publica
        ▼
  release  autoscan-v1.0.3
           mobilink-autoscan-1.0.3.zip
        │
        │   el servidor CONSTRUYE esta URL desde
        │   autoscan_agent/package.json
        ▼
  latido ──► { agente: { version, url } } ──► el agente compara y ofrece
```

**La URL se construye, no se pregunta.** Es la misma decisión que las APK y por
el mismo motivo, que allí costó un incidente: la API de GitHub da 60 peticiones
por hora **por IP**, y en Render la IP es compartida. Con veinte agentes
latiendo, el cupo se quemaría el primer día.

**La versión se guarda en el repositorio DESPUÉS de publicar.** Si el número
está, su release existe. Al revés, todos los agentes verían un aviso cuya
descarga da 404.

**El servidor informa; el agente manda sobre su propia máquina.** La comparación
vive en el agente, en un solo sitio, y de ahí salen tres reglas:

1. Solo se instala una versión **estrictamente** más nueva. Ni la misma —nada
   que ganar, un reinicio que perder— ni una anterior: sin eso, quien pudiera
   contestar por el servidor devolvería veinte mostradores a una versión con un
   fallo ya arreglado, solos y en orden.
2. Solo se descarga de `github.com` y `objects.githubusercontent.com`, y solo
   por HTTPS. El agente ya se fía del servidor para **subir** facturas; fiarse
   de él para **ejecutar** lo que mande es otra confianza, y esa lista separa
   «te engaño con una respuesta» de «te ejecuto lo que quiera».
3. Las dos se comprueban otra vez dentro del actualizador, no solo donde se
   dibuja el botón: entre las dos hay una petición HTTP al panel.

**El cambio, con red debajo.** El guion prepara la versión nueva **al lado**
mientras el agente sigue subiendo facturas; solo entonces para, hace dos
renombrados, arranca y **pregunta al panel si responde**. Si no responde,
deshace los renombrados y vuelve la anterior. No toca la cola, ni los escaneos,
ni la credencial: se puede actualizar con documentos pendientes.

**No se actualiza solo, a propósito.** Ver la sección siguiente.

---

## 5. Lo que no está probado, y qué hacer con ello

El agente **nunca ha corrido en Windows**. En el entorno de desarrollo no hay
PowerShell, así que esto está escrito y revisado pero sin ejecutar ni una vez:

- `instalar.ps1`, `desinstalar.ps1`, `actualizar.ps1`.
- **DPAPI** (`dpapi.ts`): nunca ha cifrado nada de verdad.
- La tarea programada al iniciar sesión.
- El icono de bandeja (`NotifyIcon`).
- El escáner dejando el PDF en la carpeta vigilada.
- Y la más incierta: que el PowerShell lanzado `detached` **sobreviva a que el
  guion mate al agente**. No hay forma de saber desde aquí si Windows se lleva
  el hijo por delante.

Por eso la actualización pide un clic en vez de ir sola. Con alguien delante, un
cambio que salga mal se ve en el momento y en un mostrador; desatendido saldría
mal en los veinte a la vez y de madrugada. Cuando se haya usado unas cuantas
veces de verdad, automatizarlo es mover una llamada a un temporizador.

### La primera vez en un Windows, por orden

El guion completo —con lo que tiene que pasar en cada paso y qué mirar si no
pasa— está en [`PRUEBA-EN-WINDOWS.md`](./PRUEBA-EN-WINDOWS.md). En corto:

1. Instalar en **un solo PC**, no en veinte.
2. Comprobar que arranca sin credencial y que la bandeja pide el código.
3. Activar con un código de Configuración → Escáneres.
4. Escanear un papel de verdad y verlo aparecer en la bandeja de Cobros.
5. Reiniciar el PC y comprobar que vuelve solo.
6. Pulsar «Actualizar el agente» y ver si vuelve. Es el paso 6 el que dice si
   todo lo anterior vale.

Lo que **sí** está comprobado de punta a punta es el canal de publicación: la CI
publicó `autoscan-v1.0.3` y el asset se llama, carácter por carácter, lo que el
servidor construye. Hay además una prueba cruzada que ata las dos mitades.

### Pendiente de configurar

- El perfil «Mobilink AutoScan» del iX1500, a color 300 ppp o gris. En color a
  600 ppp un PDF de varias páginas pasa del tope de 15 MB.
- Carpeta **local**, no de red: `fs.watch` es poco fiable sobre SMB. El sondeo
  periódico está como respaldo, pero no es lo mismo.

---

## 6. Los documentos históricos de esta carpeta

Se conservan porque explican **por qué** las cosas son como son, pero describen
el momento en que se escribieron y no el de ahora. Lo vigente es este fichero.

| Documento | Qué es | Qué ha cambiado desde entonces |
|---|---|---|
| `current-document-flow.md` | Fase 0: cómo entraba una factura ANTES de AutoScan | Sigue siendo válido como retrato del flujo manual, que no se tocó |
| `architecture-proposal.md` | Fase 0: la propuesta y sus preguntas abiertas | Se eligió la opción A (bandeja propia). La tabla se llama `cash_autoscan_inbox`, no `cash_autoscan_uploads`. La autoactualización, que allí quedaba fuera, está hecha |
| `phase-1-design.md` | El diseño del backend y la bandeja | Implementado |
| `phase-1-implementation.md` | La entrega de la Fase 1 | Su «no hay agente de escritorio» ya no se sostiene: el agente existe y está entregado |

Y en `docs/mobilink-cash.md` §7 undecies hay un resumen de AutoScan dentro del
mapa del módulo entero.
