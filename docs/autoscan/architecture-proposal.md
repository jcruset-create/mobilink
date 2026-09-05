# AutoScan — propuesta de arquitectura

Fase 0. Qué se reutiliza, qué hay que crear, qué decisiones quedan abiertas y
qué riesgos hay. **Todavía no se ha escrito una línea de AutoScan.**

Se lee después de `current-document-flow.md`, que es de dónde salen los hechos.

---

## 1. La decisión que hay que tomar antes que ninguna

El flujo actual no tiene bandeja de entrada: el fichero solo se guarda cuando
ya existe un cobro, y todo documento cuelga de una jornada
(`session_id NOT NULL`). Un escáner no sabe de jornadas.

**¿Dónde espera un documento que llega sin jornada abierta?**

### Opción A — Bandeja propia (recomendada)

Tabla nueva `cash_autoscan_uploads` con el documento en el bucket y su estado.
No cuelga de ninguna jornada hasta que alguien lo usa para cobrar.

- ✅ Un documento puede llegar a las 20:40 y esperar al lunes.
- ✅ No toca `cash_operation_documents` ni su `NOT NULL`.
- ✅ La bandeja es exactamente lo que la pantalla de Cobros necesita enseñar:
  «tienes 3 facturas escaneadas sin cobrar».
- ❌ Un sitio más donde vive un fichero. Hay que decidir su retención.

### Opción B — Colgarlo de la jornada abierta

Reutilizar `POST /sessions/:id/documents` con la jornada que esté abierta.

- ✅ Cero tablas nuevas.
- ❌ **Se cae solo si no hay jornada abierta**, que es la mitad de los casos
  reales. Y elegir «la jornada abierta» cuando hay varias cajas es adivinar.

### Opción C — Relajar `session_id` a NULL

- ❌ Toca una tabla con datos y un invariante que hoy sostiene el informe de
  cierre. El coste no compensa cuando la opción A no lo necesita.

**Recomiendo A**, y el resto del documento la asume. Es una decisión de
producto tanto como técnica: define qué ve el usuario al día siguiente.

---

## 2. Arquitectura

```
ESCÁNER
   ↓  guarda el PDF
CARPETA VIGILADA
   ↓
AGENTE (Windows, Node + TS)
   · vigila, espera a que el fichero esté estable
   · SHA-256, cola persistente, reintentos
   ↓  HTTPS + credencial de DISPOSITIVO
POST /api/cash/autoscan/documents
   · empresa y centro salen de la credencial, NUNCA del cuerpo
   · duplicado por (empresa, sha256) con restricción en la base
   ↓
cash_autoscan_uploads  +  bucket privado (storage.ts, ya existe)
   ↓
escanearFactura(...)   ← EL MISMO de la carga manual, sin duplicar nada
   ↓
BANDEJA en Cobros → una persona revisa → POST /collections
```

La regla que ordena todo: **AutoScan es una puerta, no un cerebro.** No
analiza, no decide forma de cobro, no crea cobros, no toca importes.

---

## 3. Autenticación de máquina

Hoy todo el modelo asume una persona con sesión de Supabase. Hace falta una
identidad de máquina, y **no puede reutilizar el token de un empleado**: caduca,
es personal, y su revocación no debería tumbar el escáner de una tienda.

### Alta

```
Configuración → AutoScan → Añadir dispositivo
      ↓  se elige centro y nombre
código de un solo uso, caducable:  MC-AS-8472-DFQ2
      ↓  se teclea una vez en el agente
el agente lo canjea por una credencial permanente
```

Del secreto se guarda **solo el hash**, como ya se hace con la autorización de
duplicados (`server/cash/duplicates.ts`). Revocable y rotable.

### Aislamiento (punto 16, crítico)

`empresaId` y `centroId` se derivan **de la credencial**. El cuerpo de la
petición no se mira ni para leerlos. Es la misma regla que ya cumple el resto
del módulo con la empresa, extendida al centro.

Debe haber una prueba que mande `centerId` de otro centro y compruebe que se
ignora, no que se rechaza: ignorarlo es más seguro que discutirlo.

---

## 4. Duplicados e idempotencia

Son dos problemas distintos y conviene no mezclarlos:

| | Qué evita | Cómo |
|---|---|---|
| **Duplicado** | El mismo PDF escaneado dos veces | `UNIQUE (empresa_id, sha256)` **en la base**, no solo en la aplicación |
| **Idempotencia** | Un reintento tras perder la conexión | `Idempotency-Key = deviceId + sha256`; la segunda petición devuelve el mismo `documentId` |

La restricción va en la base a propósito: dos agentes pueden subir el mismo
fichero a la vez y una comprobación en la aplicación no lo impide. Es la misma
lección del cobro duplicado, donde el bloqueo de jornada fue lo que hizo el
trabajo.

**Duda pendiente:** ¿la unicidad es por empresa o por empresa+centro? Dos
talleres de la misma empresa **no** deberían compartir facturas, así que
`empresa + sha256` parece correcto y además detecta el caso peor (la misma
factura subida en dos sitios). Queda por confirmar contigo.

---

## 5. Sin fase de refactorización: la carga manual no se toca

`escanearFactura` ya recibe `{ empresaId, userId, sessionId, fichero }` y
`sessionId` **ya admite `null`**. AutoScan puede llamarla tal cual con
`userId: null` y `sessionId: null`.

No hace falta ningún `processCashDocument(...)` común ni mover la carga manual:
el punto de convergencia que pide la especificación **ya existe** y es esa
función.

---

## 6. Síncrono o asíncrono

Hoy `POST /invoice-scan` espera a la IA. Para AutoScan conviene lo contrario:

```
POST /autoscan/documents  →  202, guardado y encolado
                              ↓
                          worker analiza
```

Motivo práctico: al agente le da igual esperar, pero una petición larga con
reintentos hace que un tiempo de espera agotado parezca un fallo cuando el
servidor sí procesó. Menos casos raros con la respuesta rápida.

El patrón de worker **ya existe** en `server/cash/erp/worker.ts` (`setInterval`
con reencolado de errores). Se copia la forma, no se inventa nada.

---

## 7. El agente

**Node + TypeScript**, que es el stack del repositorio. Nada de Electron ni
Tauri: no hace falta una aplicación de escritorio.

- **Vigilancia**: `chokidar` o `fs.watch` con comprobación de estabilidad —
  tamaño en `t0`, esperar, tamaño en `t1`. Un PDF a medio escribir no se sube.
- **Cola**: **SQLite**. Sobrevive a apagones, que es justo lo que no hace mover
  ficheros entre carpetas.
- **Estados**: `NEW → READY → UPLOADING → UPLOADED | RETRY | ERROR | DUPLICATE`.
- **Reintentos**: 5 s, 15 s, 30 s, 1 min, 5 min, 15 min, con tope.
- **Interfaz**: icono de bandeja del sistema. Estado, carpeta, pendientes,
  última subida. Nada más.
- **Arranque**: entrada en `Run` del usuario. Un servicio de Windows exige
  administrador y complica la actualización; el escáner solo funciona con la
  sesión iniciada de todos modos.
- **Secreto**: DPAPI de Windows (`win-dpapi`), que cifra por usuario sin pedir
  nada. Si complica el instalador, fichero con permisos restringidos y se
  documenta la diferencia.

**El original nunca se borra.** Tras subirlo se mueve a `procesados/`. La
retención se configura; por defecto, no borrar nada.

---

## 8. Tablas nuevas

```sql
cash_autoscan_devices
  id, empresa_id, centro_id, nombre,
  secret_hash, version,
  creado_at_ms, ultimo_visto_at_ms,
  revocado_at_ms, revocado_por

cash_autoscan_activation_codes
  id, empresa_id, centro_id, codigo_hash,
  creado_por, creado_at_ms, expira_at_ms,
  usado_at_ms, usado_device_id

cash_autoscan_uploads
  id, empresa_id, centro_id, device_id,
  sha256, nombre_original, mime, tamano_bytes, ruta,
  estado,                          -- RECIBIDO | ANALIZADO | ERROR | USADO
  scan_id      → cash_invoice_scans
  operation_id → cash_operations   -- NULL hasta que alguien cobre con él
  recibido_at_ms, analizado_at_ms

  UNIQUE (empresa_id, sha256)
```

`ONLINE`/`OFFLINE` **no se guarda**: se calcula de `ultimo_visto_at_ms`. Un
estado que se puede derivar y se persiste acaba mintiendo.

Los campos de empresa y centro se repiten en `uploads` a propósito, igual que
`session_id` en `cash_operation_documents`: las consultas de la pantalla van
por ahí.

---

## 9. Permisos

De los 21 `cash.*` actuales, ninguno encaja: `cash.document.attach` es para
adjuntar a un cobro, no para dar de alta máquinas. Propongo **uno solo**:

```
cash.autoscan.manage     — alta, revocación y actividad. De responsable.
```

Ver la actividad puede ir con `cash.view`, que ya existe.

**La credencial del dispositivo no lleva permisos de interfaz.** Solo puede
subir documentos de su empresa y su centro. Son dos sistemas de autorización
distintos y mezclarlos sería el error clásico.

---

## 10. Riesgos

| Riesgo | Por qué preocupa | Cómo se acota |
|---|---|---|
| **Documentos que nadie mira** | Se escanean 40 facturas y quedan en la bandeja. El dinero no entra y nadie se entera | Contador visible en Cobros y aviso al cerrar la jornada. Sin esto, AutoScan crea trabajo invisible |
| **Coste de IA** | Cada documento llama al modelo. Un taco de 60 páginas escaneado por error son 60 llamadas | Límite por dispositivo y día, configurable |
| **Escáner que reescribe el fichero** | Algunos escriben el PDF en pasadas: la comprobación de estabilidad puede engañarse | Ventana amplia por defecto (3 s), configurable, y validar que el PDF abre antes de subirlo |
| **Reloj del PC** | Si va mal, la caducidad del código de activación se descuadra | Las caducidades se comprueban **en el servidor** |
| **Carpeta en red** | `fs.watch` es poco fiable sobre SMB | Sondeo como respaldo; documentar que se prefiere carpeta local |
| **El PC no está** | La factura escaneada no llega y nadie lo sabe | Latido y aviso en Configuración cuando un dispositivo lleva horas sin dar señales |

---

## 11. Lo que NO se hace en esta versión

Kafka, Kubernetes, microservicios, event sourcing, Redis. Autoactualización del
agente: la arquitectura queda preparada con `version` en el dispositivo, pero
no se implementa. Nada de MC Central más allá de que los modelos llevan
`empresa_id` y `centro_id` desde el principio.

---

## 12. Plan de la Fase 1

Backend mínimo, sin interfaz, en este orden:

1. **Esquema** — las tres tablas, con `UNIQUE (empresa_id, sha256)` y los
   índices. Migración idempotente al arrancar, como todo el módulo.
2. **Credencial de dispositivo** — alta, canje del código, verificación,
   revocación. Detrás de un puerto enchufable, como `reauth.ts`, para poder
   probar la regla sin infraestructura.
3. **`POST /api/cash/autoscan/documents`** — autenticación de máquina, empresa
   y centro **de la credencial**, tipo real del fichero por magic bytes (no por
   extensión), mismo límite de 15 MB, SHA-256, idempotencia, guardar en el
   bucket, `202`.
4. **Análisis** — llamar a `escanearFactura` con `sessionId: null`. Ni una
   línea de análisis nueva.
5. **Auditoría** — con `registrarAuditoria`, que ya existe:
   `autoscan.device.created/activated/revoked`,
   `autoscan.document.received/duplicate/failed`, `autoscan.device.auth_failed`.
6. **Pruebas de integración** — dispositivo revocado, empresa ajena, **centro
   ajeno mandado en el cuerpo**, duplicado por contenido con distinto nombre,
   idempotencia bajo reintento, MIME falso, fichero grande, código caducado,
   código ya usado, y dos subidas simultáneas del mismo fichero.

**No se toca** la carga manual, ni `POST /invoice-scan`, ni el clasificador, ni
la transacción de cobros.

---

## 13. Lo que necesito de ti antes de la Fase 1

1. **¿Opción A?** (bandeja propia). Es la decisión con más consecuencias.
2. **¿Unicidad por empresa o por empresa+centro?**
3. **¿Qué pasa con un documento que nadie usa en, digamos, 30 días?** ¿Caduca,
   avisa, o se queda para siempre?
4. **¿Un dispositivo por centro o varios?** Cambia la pantalla de
   Configuración, no el modelo.
