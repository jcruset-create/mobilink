# AutoScan — diseño de la Fase 1

Con las cuatro decisiones tomadas: bandeja propia, unicidad por
`empresa + centro + sha256`, nada se borra en silencio, y varios dispositivos
por centro.

Este documento se presenta **antes de programar**. Lo que hay debajo es lo que
se va a construir, no lo que ya está.

---

## 1. Las tres tablas

Convención del módulo: DDL idempotente al arrancar, estados en mayúsculas, una
columna `..._at_ms` en milisegundos, y comentarios donde una decisión no se
explique sola.

### `cash_autoscan_devices`

```sql
id                 SERIAL PRIMARY KEY,
empresa_id         UUID NOT NULL,
centro_id          UUID NOT NULL,      -- de app_centros
nombre             TEXT NOT NULL,      -- «Recepción-PC01»
secret_hash        TEXT NOT NULL UNIQUE,
version            TEXT,               -- versión del agente, del latido
creado_por         UUID,
creado_at_ms       BIGINT NOT NULL,
ultimo_visto_at_ms BIGINT,
revocado_por       UUID,
revocado_at_ms     BIGINT
```

**No se guarda `estado`.** `ONLINE`/`OFFLINE` se calcula de
`ultimo_visto_at_ms`, y `REVOCADO` de `revocado_at_ms IS NOT NULL`. Un estado
derivable que se persiste acaba mintiendo el día que un proceso no corre.

Del secreto solo el hash, como en `cash_duplicate_overrides`. Revocar uno **no
toca a los demás**: es una fila.

### `cash_autoscan_activation_codes`

```sql
id             SERIAL PRIMARY KEY,
empresa_id     UUID NOT NULL,
centro_id      UUID NOT NULL,
codigo_hash    TEXT NOT NULL UNIQUE,
creado_por     UUID,
creado_at_ms   BIGINT NOT NULL,
expira_at_ms   BIGINT NOT NULL,
usado_at_ms    BIGINT,
usado_device_id INTEGER REFERENCES cash_autoscan_devices(id) ON DELETE SET NULL
```

El código lleva la empresa y el centro dentro. Es lo que hace que el
dispositivo no pueda elegirlos: **los hereda de cómo nació**.

De un solo uso y caducable (propongo **1 hora**: se instala en el momento). La
caducidad se comprueba **en el servidor**, nunca contra el reloj del PC.

### `cash_autoscan_inbox`

```sql
id                SERIAL PRIMARY KEY,
empresa_id        UUID NOT NULL,
centro_id         UUID NOT NULL,
device_id         INTEGER NOT NULL REFERENCES cash_autoscan_devices(id) ON DELETE RESTRICT,

sha256            TEXT NOT NULL,
nombre_original   TEXT NOT NULL,       -- metadato, NUNCA identificador
mime              TEXT NOT NULL,
tamano_bytes      INTEGER NOT NULL,
ruta              TEXT NOT NULL,       -- en el bucket privado; la URL se firma al pedirla

estado            TEXT NOT NULL DEFAULT 'PENDIENTE'
  CHECK (estado IN ('PENDIENTE','ANALIZANDO','LISTO','USADO','FALLIDO','DESCARTADO')),
error             TEXT,                -- por qué falló, para poder reintentar

idempotency_key   TEXT NOT NULL,
scan_id           INTEGER REFERENCES cash_invoice_scans(id) ON DELETE SET NULL,
operation_id      INTEGER REFERENCES cash_operations(id) ON DELETE SET NULL,

escaneado_at_ms   BIGINT,              -- lo que dice el escáner
recibido_at_ms    BIGINT NOT NULL,
analizado_at_ms   BIGINT,
usado_at_ms       BIGINT,
usado_por         UUID,
descartado_por    UUID,
descartado_at_ms  BIGINT,
descartado_motivo TEXT
```

Índices:

```sql
-- Unicidad de contenido, por centro. Excluye los descartados a propósito:
-- si alguien tira un documento y luego lo vuelve a escanear, es que lo quiere.
CREATE UNIQUE INDEX cash_autoscan_inbox_contenido_idx
  ON cash_autoscan_inbox(empresa_id, centro_id, sha256)
  WHERE estado <> 'DESCARTADO';

-- Idempotencia: el reintento de una subida cortada no crea otra fila.
CREATE UNIQUE INDEX cash_autoscan_inbox_idem_idx
  ON cash_autoscan_inbox(device_id, idempotency_key);

-- La bandeja de un centro, que es la consulta de la pantalla.
CREATE INDEX cash_autoscan_inbox_bandeja_idx
  ON cash_autoscan_inbox(empresa_id, centro_id, estado, recibido_at_ms);
```

`empresa_id` y `centro_id` se repiten aunque salgan del dispositivo: es la
consulta de la bandeja, y pasar por `devices` en cada listado sobra.

---

## 2. Estados y transiciones

```
                        ┌──────────────┐
    subida ────────────▶│  PENDIENTE   │
                        └──────┬───────┘
                               │ lo coge el worker
                        ┌──────▼───────┐
                        │  ANALIZANDO  │
                        └───┬──────┬───┘
                   análisis │      │ la IA falla
                        ok  │      │
                 ┌──────────▼─┐  ┌─▼─────────┐
                 │   LISTO    │  │  FALLIDO  │──┐
                 └──┬──────┬──┘  └───────────┘  │ reintentar
                    │      │                    └──▶ PENDIENTE
        se cobra    │      │  alguien lo tira
        con él      │      │
             ┌──────▼──┐ ┌─▼────────────┐
             │  USADO  │ │  DESCARTADO  │
             └─────────┘ └──────────────┘
```

`USADO` y `DESCARTADO` son terminales. `FALLIDO` vuelve a `PENDIENTE` si
alguien reintenta: un fallo de la IA no debe condenar una factura.

### Sobre `stale`

Pediste un estado `stale` a los 30 días. **Propongo derivarlo, no guardarlo**,
por la misma razón que `ONLINE`: es `recibido_at_ms < ahora − 30 días` y estado
`LISTO` o `FALLIDO`. Guardarlo obliga a un proceso que voltee filas cada noche,
y el día que ese proceso no corra la pantalla mentirá.

La bandeja lo pinta destacado igual, y el usuario no nota la diferencia. Si
prefieres la columna de verdad, se añade — pero quería que la decisión fuera
tuya sabiendo el coste.

**Nada se borra.** `DESCARTADO` es un estado, no un `DELETE`. El fichero se
queda en el bucket; el borrado físico es una política de retención posterior y
va aparte, como pediste.

---

## 3. Endpoints nuevos

Todos bajo `/api/cash`, siguiendo las convenciones del router.

### Para las personas (sesión de Supabase, permisos `cash.*`)

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/autoscan/devices` | `cash.view` |
| `POST` | `/autoscan/devices` | `cash.autoscan.manage` |
| `POST` | `/autoscan/devices/:id/revoke` | `cash.autoscan.manage` |
| `GET` | `/autoscan/inbox` | `cash.view` |
| `GET` | `/autoscan/inbox/summary` | `cash.view` |
| `GET` | `/autoscan/inbox/:id/file` | `cash.view` |
| `POST` | `/autoscan/inbox/:id/discard` | `cash.autoscan.manage` |

`POST /autoscan/devices` devuelve el código de activación **una sola vez**. No
se puede volver a consultar: si se pierde, se genera otro.

### Para las máquinas (credencial de dispositivo, sin permisos de interfaz)

| Método | Ruta | Devuelve |
|---|---|---|
| `POST` | `/autoscan/activate` | Canjea el código por la credencial |
| `POST` | `/autoscan/documents` | `202` con el `id` de la bandeja |
| `POST` | `/autoscan/heartbeat` | `ok`, y actualiza `ultimo_visto_at_ms` |

**Dos autenticaciones distintas que no se mezclan.** La credencial de máquina
no pasa por `authenticate` ni por `cargarPermisosCaja`: es su propio
middleware, resuelve el dispositivo y deja `req.autoscanDevice`. Un dispositivo
no tiene permisos de interfaz y un usuario no puede subir por la vía de
máquina.

### Permiso nuevo

```
cash.autoscan.manage    — alta, revocación y descarte. De responsable.
```

Es el único. Ver la bandeja va con `cash.view`, que ya existe.

---

## 4. El flujo, de punta a punta

```
ESCÁNER  guarda Factura_8542.pdf
   ↓
AGENTE   detecta · espera a que el tamaño no cambie · SHA-256 · encola
   ↓     POST /autoscan/documents   (credencial de dispositivo)
SERVIDOR · resuelve el dispositivo → empresa y centro
         · tipo real por magic bytes, no por extensión
         · ¿mismo sha256 en este centro?  → 409 con el id que ya existe
         · ¿misma idempotency_key?        → 200 con el id de antes
         · guarda en el bucket privado
         · fila PENDIENTE
         · 202
   ↓
WORKER   PENDIENTE → ANALIZANDO
         escanearFactura({ empresaId, userId: null, sessionId: null, fichero })
                          ↑ EL MISMO de la carga manual
         guarda scan_id · → LISTO   (o FALLIDO con su motivo)
   ↓
COBROS   la bandeja enseña «AutoScan · 7 pendientes»
         alguien abre uno: se rellenan importe, factura, cliente, concepto y
         forma de cobro con la propuesta YA CALCULADA — no se vuelve a llamar
         a la IA
   ↓
PERSONA  revisa, corrige, confirma
   ↓     POST /collections
CAJA     registra el cobro
   ↓
PROMOCIÓN  el fichero pasa a cash_operation_documents
           la fila de la bandeja → USADO, con operation_id
```

La frase que resume la regla: **escanear no es cobrar**. AutoScan recibe,
guarda, analiza y propone. La persona revisa y confirma. La caja registra.

---

## 5. Deduplicación

**Por contenido, nunca por nombre.** `factura.pdf` y `factura_copia.pdf` con
los mismos bytes son el mismo documento.

```
UNIQUE (empresa_id, centro_id, sha256) WHERE estado <> 'DESCARTADO'
```

Por **centro**, como decidiste: dos talleres funcionan independientes y el
mismo justificante puede existir legítimamente en los dos.

Cuando el índice salta:

```json
409  { "code": "DOCUMENT_ALREADY_EXISTS", "documentId": 1841, "estado": "LISTO" }
```

El agente lo marca `DUPLICATE` y **no reintenta**: no es un error, es el
sistema funcionando.

Queda apuntado para más adelante lo que pediste: **el mismo `sha256` en otro
centro de la misma empresa se avisa, no se bloquea.** No entra en la Fase 1,
pero el índice por centro deja la puerta abierta sin cambiar el modelo.

---

## 6. Concurrencia

Tres carreras, tres respuestas:

| Carrera | Cómo se resuelve |
|---|---|
| Dos agentes suben el mismo PDF a la vez | El **índice único** de la base. `ON CONFLICT DO NOTHING` + releer para devolver el id que ganó. Una comprobación en la aplicación no basta, y ya aprendimos eso con el cobro duplicado |
| El agente reintenta tras perder la conexión | `UNIQUE (device_id, idempotency_key)`. La segunda petición devuelve el mismo id, no crea nada |
| Dos workers cogen la misma fila | `UPDATE … SET estado='ANALIZANDO' WHERE id=$1 AND estado='PENDIENTE' RETURNING id`. Quien no reciba fila, no la tenía |

La clave de idempotencia la calcula el agente: `deviceId + sha256`. Determinista
—el reintento del mismo fichero da la misma clave— y no hace falta guardarla en
el PC antes de la primera llamada.

---

## 7. Promover un documento de la bandeja a documento de operación

Es el punto donde tu principio de arquitectura se hace código:

> AutoScan Inbox Document ≠ Cash Operation Document, hasta que el usuario lo use.

Cuando se confirma un cobro que viene de la bandeja:

1. El cobro se registra por `POST /collections`, **sin tocar nada de AutoScan**.
2. Después, en una segunda llamada —igual que hoy con la carga manual, que
   adjunta después a propósito para que un fallo de almacenamiento no tumbe un
   cobro ya contado— el documento se **copia** a `cash_operation_documents` con
   su `operation_id` y su `session_id`.
3. La fila de la bandeja pasa a `USADO`, con `operation_id` y `usado_por`.

**El fichero no se mueve ni se duplica en el bucket**: `cash_operation_documents.ruta`
apunta al mismo objeto. Duplicarlo sería tener la factura de un cliente en dos
sitios con dos ciclos de vida, que es justo lo que el código actual evita.

Trazabilidad en los dos sentidos: de la bandeja al cobro por `operation_id`, y
del cobro a la bandeja por la fila que lo referencia.

---

## 8. Cambios exactos en Cobros

`src/modules/cash/pages/Cobros.tsx`, y **solo esto**:

1. **Un bloque nuevo arriba**, hermano del escáner manual: `BandejaAutoScan`.
   Enseña el contador y, plegada, la lista de pendientes del centro.
2. **Elegir uno** llama a la función que ya existe, `aplicarEscaneo(propuesta)`,
   con la propuesta guardada. Cero lógica nueva de relleno.
3. **Al confirmar**, si el cobro venía de la bandeja, la llamada de promoción.

Lo que **no** cambia: el escáner manual, el selector de formas, el panel
lateral, el flujo de duplicados. AutoScan es una vía **adicional**.

Componentes reutilizados: `Card`, `TableWrap`, `Aviso`, `BadgeDias`, los mismos
distintivos de estado. Ni un estilo nuevo.

---

## 9. El contador

```
┌─────────────────────────────────────┐
│ AUTOSCAN            7 pendientes    │
│ Tarragona · 2 de hace más de 30 días│
└─────────────────────────────────────┘
```

- **Del centro actual**, como pediste. Sale del centro de la caja
  seleccionada, no del usuario.
- Cuenta `LISTO` y `FALLIDO`. `ANALIZANDO` no: está en marcha y en segundos
  deja de estarlo.
- Los antiguos se destacan aparte, que es el caso que hay que sacar de la
  invisibilidad.
- **Si no hay ningún dispositivo dado de alta en el centro, el bloque no
  aparece.** Un contador a cero permanente es ruido que la gente aprende a no
  mirar.
- Se refresca al cargar la pantalla y tras cada cobro. Sin sondeo: un contador
  que se actualiza solo cada diez segundos no vale más y pesa en el servidor.

---

## 10. El aviso al cerrar

En `Cierre.tsx`, junto a `AvisoPendientes`, que es el patrón que ya existe para
esto:

```
⚠  Hay 7 documentos de AutoScan pendientes de revisar en este centro.
   Puede que sean de después de esta jornada. Míralos antes de cerrar.
   [ Ver la bandeja ]
```

**No bloquea el cierre**, como decidiste, y por tu motivo: un documento puede
haberse escaneado fuera de la jornada o ser de trabajo posterior.

Sí se ve, y no como una línea gris más: mismo tono ámbar que el resto de avisos
de cierre. Se pinta solo si el número es mayor que cero.

---

## Lo que NO se toca

`invoice-scan/classifier.ts`, la transacción de `registrarOperacion`,
`POST /invoice-scan`, `POST /operations/:id/documents`, y el contrato de los
104 endpoints existentes.

## Orden de implementación

1. Esquema + migración.
2. Credencial de dispositivo, detrás de un puerto enchufable como `reauth.ts`.
3. `POST /autoscan/documents` con aislamiento, magic bytes, dedup e idempotencia.
4. Worker de análisis, con la forma de `erp/worker.ts`.
5. Endpoints de bandeja y de gestión.
6. Pruebas de integración.
7. Interfaz: Configuración → AutoScan, bandeja en Cobros, aviso al cerrar.

El agente de Windows es la **Fase 2** y no entra aquí.
