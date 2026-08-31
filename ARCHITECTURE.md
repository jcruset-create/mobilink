# Arquitectura de Mobilink Assist y Central

Este documento existe para que quien llegue —persona o agente— no tenga que
deducir la arquitectura leyendo el código y adivinando por qué está así. Lo que
cuenta no es qué hace cada fichero, sino **qué decisiones se tomaron y qué
problema resolvía cada una**. Las decisiones son lo que no se puede deducir de
un `grep`.

Regla al ampliarlo: si cambias una decisión de las de aquí, cambia también su
explicación. Un documento que describe una arquitectura que ya no existe es
peor que no tenerlo.

---

## 1. Las dos aplicaciones, y por qué van en el mismo paquete

En el mismo repositorio y el mismo despliegue conviven dos productos:

| | **Mobilink Assist** | **Central (Connect Pro)** |
|---|---|---|
| Rutas web | `/asistencias/*` | `/connect/*` |
| API | `/api/...` | `/api/connect/...` |
| Autenticación | cabecera `x-admin-token` | Supabase, `Authorization: Bearer` |
| Usuarios | `usuarios` del core | `connect_users` |
| Guarda | `requireSupervisorRole` | `requireConnectRole(rol)` |
| Asistencias | `roadside_assistances` | `connect_assistances` |
| Quién lo usa | un taller que atiende averías | una central que coordina talleres |

Van juntos porque comparten servidor, base de datos y buena parte del dominio
(vehículos, talleres, documentos, correo). No comparten **tablas de negocio**:
una asistencia de Assist y una de Central son dos expedientes distintos aunque
describan el mismo servicio, y eso es deliberado —ver §5.

Cuidado con el nombre: **`src/modules/central` NO es Central**. Es MC Central,
el módulo de supervisión de caja. Central (el producto) vive en
`src/modules/connectpro`.

## 2. Multiempresa: qué es un tenant aquí

Hay **dos** conceptos de tenant, por razones históricas, y conviene no
confundirlos:

- **`app_empresas`** (UUID) — el cimiento SaaS antiguo. Lo usa `core/auth.ts`
  (`ctx.empresaId`), la caja y la auditoría.
- **`connect_control_centers`** (SERIAL) — la **plataforma/central**. Es el
  tenant del que habla todo lo nuevo: acuerdos, enrutado, envíos, documentos.

Cuando en el código nuevo se lee «tenant», «centro» o `controlCenterId`, es el
segundo. En Assist el equivalente es el **taller** (`tallerId`).

La **empresa** (`connect_provider_companies`) es una entidad maestra separada
del tenant: una empresa es una sola ficha —una razón social, un CIF, un
domicilio— y puede ser proveedora de una plataforma y cliente de otra a la vez.
Lo que es «de cada plataforma» vive en la **relación**:

- `connect_tenant_companies` — la cartera: qué papeles juega esa empresa para
  esta central (`CUSTOMER`, `PROVIDER`, `PARTNER`, `WORKSHOP_OWNER`), su código
  interno, condiciones de pago, límites.
- `connect_provider_authorizations` — el **acuerdo comercial** con un
  proveedor: servicios, zonas, horarios, SLA, tarifas, límites, vigencia.

> **Por qué no se duplicó la identidad en cada tenant:** porque entonces
> corregir el domicilio de una empresa habría que hacerlo N veces, y a la
> tercera ya no coincidirían. Una empresa, una ficha; N relaciones.

## 3. Aislamiento: dónde vive de verdad

**El aislamiento está en las consultas, no en el panel.** Un panel se salta con
`curl`. Las reglas que se siguen sin excepción:

1. **El id nunca viaja solo.** Toda consulta que lee o escribe un recurso lleva
   el centro en el `WHERE`. No hay `SELECT ... WHERE id = $1` suelto en los
   módulos multiempresa.
2. **El tenant sale del usuario autenticado o de la credencial, nunca del
   cuerpo de la petición.** Un tenant que se puede mandar es un tenant que se
   puede falsificar.
3. **404, no 403.** «No existe» y «no es tuyo» contestan igual. Un 403
   confirmaría que el expediente existe, y quien va probando números no tiene
   por qué averiguarlo.
4. **El superadministrador atraviesa las plataformas.** `centroDe(req)`
   devuelve `null` para él; `centroPedido(req)` le obliga a decir en cuál
   trabaja cuando la operación necesita una concreta.

Estas reglas se comprueban con pruebas de integración por HTTP contra
PostgreSQL real, no llamando a funciones internas —eso no demostraría nada de
lo que importa. Ver `server/dispatch/aislamiento.integration.test.ts`, que
existe por **tres agujeros reales** encontrados en revisión: reintentar el
envío de otro, listar sus envíos y republicar sus documentos.

## 4. Permisos

**Hay un solo sistema de permisos**, y no se estrena otro por módulo.

Jerarquía de Central (`server/connect/rbac.ts`):

```
superadmin > cc_admin > supervisor > operator > analyst
```

`provider_user` es lateral: es el taller entrando a ver sus propias ofertas, no
un escalón de la jerarquía.

Criterio para elegir el rol de un endpoint: **leer es de operador; lo que
compromete dinero o cambia cómo se elige partner es de supervisor; lo que
cambia el comportamiento del sistema entero es de `cc_admin`.** Por eso aceptar
un presupuesto es de supervisor y pasar el enrutado a automático es de
`cc_admin`.

Las credenciales de partner (`connect_api_keys`) llevan **scopes**; las
equivalencias entre scopes viejos y nuevos están en **un solo sitio**
(`server/connect/auth.ts`, `expandirScopes`) y se resuelven en las dos
direcciones. Tenerlas en dos sitios fue un error que ya costó un 403 en
producción.

## 5. Subcontratación: dos expedientes, nunca una fila compartida

Cuando Assist o una Central subcontrata a otra plataforma, **cada lado
mantiene su propio expediente**. No se comparte la fila de base de datos. Cada
uno tiene su id, sus costes, sus márgenes, sus documentos privados, su
facturación y sus estados internos.

Lo que los une es el **`correlationId`**: viaja en el sobre, vuelve en cada
aviso y es lo que permite seguir la cadena entera de punta a punta.

### Central A → Central B pasa por HTTP

Los dos tenants viven en la misma aplicación y en la misma base. Sería
técnicamente trivial que A escribiera directamente en las asistencias de B con
un `INSERT`.

**No se hace, y es la decisión que gobierna todo el módulo.** A llama a la API
pública de B por HTTP, con su credencial, igual que si B estuviera en otra
empresa y otro servidor. Con eso:

- el aislamiento no depende de que nadie se acuerde de filtrar por tenant;
- la privacidad económica la garantiza el propio sobre, que no lleva costes;
- el día que un tenant se lleve su Central a su servidor, no cambia nada;
- la trazabilidad es la misma para todos los caminos.

La abstracción que lo permite es `server/dispatch/fuentes.ts`: cada sistema
aporta un adaptador que sabe leer su asistencia, decir su expediente y anotar
la referencia del destino. El servicio de envío no nombra ninguna tabla.

## 6. Estados: dos vocabularios, a propósito

Assist y Central **no comparten estados**, y forzarlos a compartirlos sería el
primer paso para no poder cambiar ninguno de los dos: en cuanto Central
añadiera un estado propio, Assist tendría que desplegar a la vez.

En medio hay un **vocabulario de eventos** (`server/dispatch/estados.ts`), y es
lo único que viaja por la red:

```
REQUESTED · RECEIVED · ACCEPTED · REJECTED · INFO_REQUESTED
QUOTED · QUOTE_ACCEPTED · QUOTE_REJECTED
ASSIGNED · EN_ROUTE · ON_SITE · IN_PROGRESS · COMPLETED · CANCELLED
DOCUMENTED · BILLABLE
```

Regla al ampliarlo: **un evento describe qué ha pasado, no en qué pantalla está
nadie.** `ACCEPTED` es un hecho; «pendiente de revisar» es una bandeja, y las
bandejas no se exportan.

Dos detalles que parecen olvidos y no lo son:

- **`ACCEPTED` no mueve el estado de Assist.** Que Central se haga cargo no
  significa que haya nadie conduciendo; pintar «asignada» haría creer al
  cliente que el servicio arrancó. Se espera a `ASSIGNED`.
- **`QUOTED` deja el envío en `RECEIVED`, no en `ACCEPTED`.** Ofrecer precio no
  es comprometerse a ir.

Aparte está el **estado técnico del envío** (`PENDING`, `SENDING`, `SENT`,
`RECEIVED`, `ACCEPTED`, `REJECTED`, `COMPLETED`, `CANCELLED`, `ERROR`), que no
es el estado de la asistencia. Se separan porque «la asistencia va de camino» y
«no consigo hablar con Central» son dos cosas distintas y hay que poder verlas
a la vez; sin la separación, un fallo de red se disfraza de asistencia parada.

El envío **solo avanza**: un `ASSIGNED` que llega tarde tras un `COMPLETED` no
lo hace retroceder. Los rechazos y cancelaciones sí mandan siempre, porque son
decisiones y no progreso.

## 7. Privacidad económica

Requisito crítico y transversal. Si A subcontrata a B por 155 €:

- **A puede saber**: 155 €, lo que le cobran.
- **A no puede saber**: los 120 € que a B le cuesta el taller, ni su margen.
- **B no puede saber**: lo que A le cobra a su cliente final.

Cómo se aplica, y en qué capas —porque taparlo solo en la pantalla no sirve:

| Capa | Mecanismo |
|---|---|
| Sobre saliente | `construirSobre` es **lista blanca**: se construye campo a campo. Además hay una lista `PROHIBIDOS` que las pruebas verifican. |
| Respuesta del destino | `respuestaDeCentral` lee tres campos y nada más. Lo que no se lee no puede entrar. |
| Webhook de facturación | entra el **importe**; el coste interno y el margen del otro lado no se leen aunque vengan en el mismo sobre. |
| Documentos | la factura del proveedor nace **`interno`** por defecto (`visibilidadPorDefecto`). |
| Métricas | `server/enrutado/metricas.ts` **no calcula ningún importe**. Un «coste medio del partner» es justo el dato que su competencia no puede leer. |
| Notas internas | la fuente de Central devuelve `notes: null`: pueden llevar el margen y las condiciones con el taller, así que no existe ni la opción de mandarlas. |

## 8. Acuerdos comerciales

`connect_provider_authorizations` **ya era** el acuerdo: centro + empresa
proveedora + servicios + SLA + vigencia, con las tarifas en
`connect_tariff_lines`. Se le añadieron zonas, horarios, límites, documentación
y política de cancelación **encima**, no en una tabla nueva: dos tablas de
acuerdos serían dos sitios donde mirar quién trabaja con quién.

Las reglas viven en `server/acuerdos/dominio.ts`, **código puro sin base de
datos**, porque decidir si un acuerdo cubre un servicio es negocio y no una
consulta: intervienen zona, horario, servicio, importe y vigencia a la vez, y
el resultado tiene que **poder explicarse**, no solo devolver sí o no.

Decisiones que se olvidan siempre y aquí están fijadas con pruebas:

- **La guardia que cruza la medianoche** (22:00–06:00) es el caso normal en
  carretera.
- **La exclusión de un CP gana sobre la inclusión** de la provincia: se pacta
  justo para recortar una zona ya incluida.
- **Provincia y CP son alternativas, no requisitos simultáneos**: quien pactó
  «Tarragona» y quien pactó «43» dicen lo mismo.
- **Pedir presupuesto NO descarta al partner.** Es un paso más antes de
  encargar; confundirlo con una incompatibilidad dejaría fuera justo a aquéllos
  con los que aún no hay tarifa cerrada.
- **Un acuerdo antiguo, sin ninguno de estos campos, cubre todo a cualquier
  hora.** Nadie acordó una restricción que nadie escribió.

### Presupuestos

`connect_quotes`, con flujo `REQUESTED → QUOTED → ACCEPTED | REJECTED |
EXPIRED`. Tabla propia y no columnas en la asistencia porque se pide precio a
**varios** partners y hay que conservar los que no se aceptaron: es lo que
justifica la elección seis meses después. Un aceptado no vuelve atrás —
desaceptar dejaría un servicio en marcha sin precio.

La oferta entra por **`correlationId`**, no por nuestro id de presupuesto: el
partner no conoce nuestros ids, y dárselo sería regalarle una forma de escribir
en un presupuesto que no es suyo.

## 9. Enrutado

Tres pasos, **siempre en este orden**:

1. **Quién puede** — `acuerdos/dominio.ts`.
2. **Qué dice la central** — `enrutado/reglas.ts`. Las excepciones explícitas.
3. **Quién es mejor** — `enrutado/dominio.ts`. Ocho criterios ponderados.

Las reglas van **antes** de puntuar porque una exclusión no es un peso: no se
compensa siendo barato.

Decisiones del motor de puntuación:

- **Lo que no se sabe puntúa 0,6, no 0 ni 1.** Con 0 se hundiría cualquier
  partner nuevo y el sistema no lo probaría nunca; con 1 ganaría siempre justo
  por no tener historial.
- **El precio se juzga contra la media de los candidatos**, no contra una
  escala fija: 200 € es caro para una batería y barato para un rescate.
- **Llegar pronto pesa más que costar poco** en los pesos por defecto. Es una
  postura, no un descuido: hay alguien esperando en el arcén. Los pesos son
  configurables por central justo para poder opinar distinto.
- **Cada resultado se explica** con los dos criterios que más pesaron. «Lo dijo
  el algoritmo» no es una respuesta cuando preguntan por qué se mandó al
  segundo más caro.
- **El ajuste de una regla se suma después de puntuar y se declara en el
  motivo.** Meterlo en los pesos lo escondería.
- **Orden estable** (desempate por nombre): la misma consulta da siempre la
  misma respuesta, y eso es lo que permite reproducir una queja.

El motor de reglas es **deliberadamente sencillo**: cinco campos comparados por
igualdad o pertenencia, sin expresiones ni anidamiento. En cuanto se admiten,
alguien escribe una regla que nadie sabe leer seis meses después. Cuando cinco
campos se queden cortos, se amplía la lista.

**Por defecto el motor sugiere; una persona encarga.** El automático existe
pero se enciende con `cc_admin` y queda auditado: una central no debería
descubrir que sus reglas están mal porque una grúa fue a Teruel.

Cada decisión se guarda en `connect_routing_decisions` con sus candidatos, sus
pesos y las reglas que dispararon. Es la única forma de contestar «por qué se
mandó a éste» un mes después. **Si no se puede guardar, el enrutado sigue**:
perder la traza es malo, dejar a alguien tirado es peor.

Nada de esto se calcula en el frontend. Si se calculara, el panel enseñaría un
orden y la API aplicaría otro en cuanto uno de los dos cambiara.

## 10. Integraciones salientes: destinos y credenciales

Un **destino** (`external_destinations`) es una plataforma a la que se puede
subcontratar. Se distingue por `ownerSystem` (`assist` / `central`) y
`ownerTenantId`, así que los destinos de una central no se mezclan con los de
Assist ni con los de otra central.

**Las credenciales nunca se guardan en base de datos.** El destino guarda
únicamente el **nombre de la variable de entorno** donde vive el secreto
(`secretName`). En consecuencia:

- La API **rechaza** (422 `secret_not_allowed`) cualquier credencial que venga
  en el cuerpo del alta, incluida la pegada por error en el campo del nombre.
- `destinoParaApi` es lista blanca y expone el **nombre** de la variable, nunca
  su valor.
- `resolverSecreto` es la única función que ve el valor.
- `sanearError` limpia `Bearer`, `Basic`, claves `mkc_*`, credenciales en la
  URL y ecos de `Authorization` antes de guardar o registrar cualquier error.

Un destino tiene **seis estados de configuración**, y distinguirlos importa
porque llevan a sitios distintos: `NO_DESTINATIONS` (dar de alta uno) y
`MISCONFIGURED` (crear una variable en Render) confundidos hacen perder media
hora buscando donde no es. Los otros: `AUTH_ERROR`, `UNREACHABLE`,
`AVAILABLE`, `DISABLED`.

La **prueba de conexión** comprueba en este orden: variable de entorno →
endpoint → autenticación, usando siempre un endpoint de **lectura**.

### Capacidades y degradación elegante

`external_destinations.capabilities` declara qué sabe hacer cada plataforma
(`supports_status_updates`, `supports_documents`, `supports_live_tracking`,
`supports_quotes`, `supports_invoice_sync`, `supports_cancellation`,
`supports_eta`).

Si el destino no sabe hacer algo, **se deja de pedir y se dice en la pantalla lo
que no habrá**. Nunca se falsea —no se inventa una posición ni un ETA— y nunca
se rompe el envío por una capacidad que falta. Un destino sin capacidades
declaradas se trata como el mínimo común (recibe asistencias y comunica
estados), que es lo único que puede darse por supuesto de algo recién
conectado.

## 11. Idempotencia, reintentos y entrega

- **Entrada**: cabecera `Idempotency-Key` → `connect_assistances.idempotencyKey`
  con `UNIQUE (partnerId, idempotencyKey)`. Si Assist reenvía la misma
  asistencia, Central **no crea dos**.
- **Salida**: `external_dispatches` tiene `UNIQUE (sourceSystem,
  sourceTenantId, sourceAssistanceId, destinationId)`, más un índice parcial
  para el caso de `sourceTenantId` nulo.
- **Reintentos**: solo desde `PENDING`, `ERROR` o `SENDING`. Reintentar algo ya
  aceptado crearía un segundo expediente allí si fallara la idempotencia del
  otro lado: **dos cerrojos para el mismo error**.
- **El `correlationId` se conserva entre reintentos**: es lo que hace que el
  destino reconozca el segundo intento como el mismo servicio.
- **Webhooks entrantes**: firma HMAC en tiempo constante con ventana temporal,
  para que un aviso capturado no valga eternamente. Se contesta **200 aunque no
  se aplique**: el emisor reintenta ante cualquier no-2xx, y un aviso que aquí
  no significa nada no se arregla reintentándolo.
- **Webhooks salientes**: outbox transaccional
  (`connect_webhook_deliveries`), heredando el patrón que ya existía en
  `cash_event_outbox`. El estado terminal de fallo es `dead`, no `failed`.

## 12. Diario de asistencias (event log)

`assistance_events` es el registro **inmutable** de todo lo que le pasa a una
asistencia. La inmutabilidad se impone en la **base de datos**, no en el
servidor: un trigger calcula una huella SHA-256 y otro `BEFORE UPDATE OR
DELETE` lanza excepción. (RLS no serviría: el servidor se conecta con `pg` y un
solo usuario.)

Hay **21 tipos de evento de diario**, que son un vocabulario **distinto** de los
eventos de cable de §6. No es duplicación: los de cable son el contrato
externo, que hay que mantener estable; los de diario son internos y se amplían
cuando hace falta.

`registrarEvento` **nunca lanza** (devuelve booleano): que falle el diario no
puede tumbar una operación. `registrarEnTransaccion` **sí lanza**, porque ahí
se pidió expresamente atomicidad.

`transition()` (`server/connect/service.ts`) escribe en **una sola
transacción**: estado + historial + diario + encolado del webhook. Si se
partiera, quedarían asistencias avanzadas sin aviso al partner.

## 13. Bandeja de excepciones

No es un listado de asistencias. Un listado obliga a mirarlas una a una para
encontrar las tres que necesitan algo; aquí **cada línea es una cosa que se
puede resolver**, con lo que le pasa escrito al lado. Siete cajones:
`sin_aceptar`, `sla_vencido`, `error_integracion`, `documentacion_pendiente`,
`coste_desviado`, `webhook_fallido`, `facturacion_bloqueada`.

Lo operativo va antes que lo administrativo: una grúa sin coger tiene a alguien
esperando en la carretera. Y una bandeja vacía es una buena noticia: se dice
con palabras, no con una tabla en blanco.

Una desviación grande de coste **bloquea la facturación** hasta que alguien la
aprueba, y la aprobación queda con nombre y fecha.

## 14. Convenciones que hay que respetar

**Migraciones.** No hay herramienta de migraciones. El esquema se crea y se
amplía al **arrancar**, con `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT
EXISTS`, orquestado por `prepararEsquema(nombre, fn)` en `server/index.ts`.
Consecuencias que no son opcionales:

- Toda columna nueva **necesita un valor por defecto que deje válidos los
  registros antiguos**. Si el defecto cambia el significado de una fila vieja,
  el defecto está mal.
- Las migraciones tienen que ser **idempotentes**: se ejecutan en cada
  arranque.
- Un índice que puede fallar (por datos preexistentes) va con `.catch()` y un
  aviso, no tumbando el arranque.

**`tsconfig.server.json`.** Un módulo que no esté en `include` **no se
comprueba**. Ya pasó dos veces: se escribió código que no compilaba y, peor, una
función local tapó a una importada del mismo nombre y los eventos se escribieron
en la tabla equivocada en silencio. **Al crear un módulo nuevo bajo `server/`,
añádelo al `include` en el mismo commit.**

**Nombres.** El dominio se escribe en castellano (`acuerdos`, `enrutado`,
`excepciones`, `despacho`), las columnas en `camelCase` entrecomillado
(`"controlCenterId"`), y los valores de estado que cruzan el cable en inglés y
mayúsculas. No es capricho: el castellano es la lengua de quien usa esto, y el
inglés la del contrato con otros sistemas.

**Pruebas.** Las de dominio son puras y no tocan base de datos —así se prueban
casos concretos en vez de sembrar media base. Las de aislamiento van **por
HTTP contra PostgreSQL real**, porque el aislamiento vive en las consultas.
Se activan con `RUN_DB_TESTS=1` y `DATABASE_URL` apuntando a una base
**desechable**.

Una prueba que no falla cuando se rompe lo que dice proteger no protege nada:
al añadir una de seguridad, **comprueba que falla sin el arreglo**.

**Lint.** No está verde y nunca lo ha estado (~2 250 avisos, casi todos
`catch (e: any)`). No lo tomes como referencia de si algo está bien; sí revisa
que tu código no añada categorías nuevas de problema.

**Versiones.** Varias sesiones tocan el repositorio a la vez. Antes de cada
commit: `bash scripts/check-versions.sh`. Si marca `CONFLICTO`, se hace
`git merge origin/main` y se sube la versión **por encima** de la de `main`.
