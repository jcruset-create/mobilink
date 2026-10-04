# Call Center (Self Storage)

Atención telefónica dentro de Self Storage. Mobilink es la fuente de verdad:
el Call Center gestiona la **llamada** y su ciclo de vida, la atienda una
persona, una IA o las dos. Funciona **sin** el Asistente IA
([AI_ASSISTANT.md](AI_ASSISTANT.md)).

> «El Call Center informa y ayuda. La web vende.»

## Arquitectura

```
Telefonía (futura, sustituible)        ← sólo transporta la llamada
        ↓
Call Center  (server/self-storage/modules/callcenter)
        ↓
Humano | IA | Híbrido                  ← handled_by de la llamada
        ↓
Servicios de Self Storage: clientes, contratos, centros, disponibilidad, incidencias
        ↓
Auditoría (self_storage_audit_logs) · cronología (self_storage_call_events) · informes
```

- Vive **dentro** de Self Storage (tablas `self_storage_*`, permisos `ss.*`,
  menú «Call Center» del módulo). No tiene licencia propia.
- No sabe nada de proveedores: la llamada sólo guarda `telephony_provider` +
  `external_call_id` (únicos por empresa, para que un webhook repetido no
  duplique) y las sesiones de IA, cuando lleguen, apuntarán a la llamada.
- Multiempresa: todo va por `empresa_id` y configuración. Nunca hay lógica
  del tipo «si la empresa es X».

## Activación: dos llaves

| Llave | Dónde | Por defecto | Efecto |
|---|---|---|---|
| Global (kill switch) | `SELF_STORAGE_CALL_CENTER_ENABLED` | permitido | `0/false/off` lo apaga en todas las empresas (503) |
| Empresa | ajuste `call_center.enabled` | **apagado** | sin él, la empresa ve el estado y prepara el catálogo, pero no opera (409) |

Las incidencias **no** dependen de estas llaves: son de Self Storage.

## Tablas (migración `0010_call_center.sql`)

| Tabla | Para qué |
|---|---|
| `self_storage_call_catalog` | motivos y resultados por empresa. Los de partida (`is_system`) se crean al primer uso, idempotentes; se renombran/ordenan/desactivan, no cambian de código |
| `self_storage_calls` | la llamada: centro, cliente, contrato y `lead_id` (reservado, sin FK) opcionales; teléfono E.164 y el texto original; sentido; `handled_by` (human/ai/hybrid); operador; proveedor e id externo; idioma; inicio/contestada/fin/duración; motivo, resultado, estado, prioridad; `requires_human`; resumen, transcripción (sólo si está activado), notas; escalado; seguimiento |
| `self_storage_call_events` | cronología de cada llamada, **sólo inserción** (trigger) |
| `self_storage_incidents` | la **única** entidad de incidencias de Self Storage (ver abajo) |

RLS activo y cerrado en las cuatro: sólo el servidor lee y escribe.

### Interesados (sin tabla de leads)

Un interesado es una llamada **sin** `customer_id`, agrupada por
`phone_e164`. Quien llama nunca se convierte en cliente por llamar. El día que
la web pública defina su modelo de lead, se rellena `lead_id` (hoy reservado y
sin FK) sin rehacer el Call Center.

## Estados y resultados

Estados: `started` (iniciada) → `in_progress` (en curso) → `finished`
(finalizada) / `escalated` (escalada) / `follow_up` (pendiente de seguimiento)
→ `closed` (cerrada). Una llamada cerrada no se reabre: si vuelve a llamar, es
otra llamada.

El resultado decide el estado (`domain/callcenter.ts`):

| Resultado | Estado |
|---|---|
| resuelto, enviado_web, enviado_calculadora, enviado_contratacion, incidencia_creada | cerrada |
| visita_virtual_solicitada, visita_guiada_solicitada, requiere_seguimiento | seguimiento (por defecto, mañana) |
| escalado_tlc | escalada (pide humano) |
| no_resuelto y los propios de la empresa | finalizada |

Motivos de partida: precio_disponibilidad, tamano_trastero,
calculadora_espacio, contratacion_online, visita_virtual, visita_guiada,
ubicacion, acceso (alta), seguridad (urgente), cliente_existente, facturacion,
baja_cancelacion, incidencia (alta), reclamacion (alta), otro. La prioridad
por defecto del motivo nunca baja la de la llamada.

## Identificación de quien llama

1. Se normaliza el teléfono (E.164, mismo normalizador que los clientes).
2. Se busca en el teléfono principal del cliente, en sus teléfonos adicionales
   y en las personas autorizadas de sus contratos.
3. Si coincide, **ficha mínima**: nombre, estado, contratos (número, estado,
   trastero, zona, centro, fecha de alta), acceso bloqueado sí/no, pagos
   pendientes sí/no, incidencias abiertas. Nada de importes, NIF, dirección,
   documentos ni el motivo detallado de un bloqueo.
4. Un único cliente: la llamada se vincula sola. Varios (número compartido):
   elige el operador. Ninguno: **interesado**.

Cada consulta queda en la auditoría (`call_center.customer_lookup`) con el
número enmascarado.

## Incidencias

`self_storage_incidents`: empresa, centro, cliente/contrato/llamada
opcionales, tipo, prioridad, estado (`open`, `in_progress`, `resolved`,
`closed`, `cancelled`), origen (`panel`, `call`, `system`, `portal`), título,
descripción, resolución, quién la abrió, a quién se asigna y fechas.

**Siempre urgentes** (lo impone el dominio y un CHECK en la base):
`no_access` (no puede acceder), `security`, `unauthorized_access`,
`emergency`, `facility_failure` (fallo grave de instalaciones). Normales por
defecto: facturación, documentación, reclamación, baja, consulta
administrativa, otra.

Desde una llamada, la incidencia hereda su cliente y contrato, sube la
prioridad de la llamada y deja el evento `incident_created`. La fase 4 la
amplía (SLA, adjuntos…) sin sustituirla.

## Operadores y permisos

No hay otro sistema de usuarios: son usuarios de Mobilink con rol en el módulo
`self-storage` (`app_usuario_modulos`). Rol nuevo **`call_center`**.

| Permiso | call_center | employee | maintenance | admin |
|---|---|---|---|---|
| `ss.callcenter.view` (dashboard, llamadas, ficha mínima, centro, disponibilidad, logs) | ✔ | ✔ | | ✔ |
| `ss.callcenter.create` | ✔ | ✔ | | ✔ |
| `ss.callcenter.edit` (resultado, resumen, seguimiento, cierre) | ✔ | ✔ | | ✔ |
| `ss.callcenter.escalate` | ✔ | ✔ | | ✔ |
| `ss.callcenter.configure` (motivos y resultados) | | | | ✔ |
| `ss.incidents.view` / `.create` | ✔ / ✔ | ✔ / ✔ | ✔ / | ✔ |
| `ss.incidents.manage` | | ✔ | ✔ | ✔ |

`call_center` **no** tiene `ss.view` (trasteros con precio), ni clientes,
contratos, facturas, pagos, ajustes ni auditoría completos. Configurar el Call
Center usa `ss.settings.manage` (administración).

### Superadministrador: empresa activa

El superadministrador de Mobilink elige con qué empresa trabaja en Self
Storage (selector en la cabecera). El panel manda `X-SS-Empresa`; el servidor
(`auth/empresa.ts`) sólo la acepta si la sesión es de superadministrador y la
empresa está activa y con la licencia de Self Storage vigente; si no, 404 (no
«cae» en otra). Para el resto de usuarios la cabecera se ignora. La auditoría
registra quién fue y en qué empresa.

## API (`/api/self-storage/admin`)

| Método y ruta | Permiso |
|---|---|
| `GET /call-center/status` | view (siempre responde) |
| `GET /call-center/catalog` · `POST` · `PATCH /:id` | view · configure |
| `GET /call-center/dashboard?from&to&centerId` | view |
| `GET /call-center/operators?from&to` | view |
| `GET /call-center/customer-by-phone?phone=` | view |
| `GET /call-center/center-info?centerId=` | view |
| `GET /call-center/availability?centerId=` | view |
| `GET /call-center/events?callId&eventType` | view |
| `GET /call-center/calls` (filtros) · `GET /call-center/calls/export` (CSV) | view |
| `POST /call-center/calls` (iniciar) | create |
| `GET /call-center/calls/:id` | view |
| `PATCH /call-center/calls/:id` (datos, resumen, transcripción) | edit |
| `POST /call-center/calls/:id/answer` · `/finish` · `/close` | edit |
| `POST /call-center/calls/:id/result` | edit |
| `POST /call-center/calls/:id/follow-up` | edit |
| `POST /call-center/calls/:id/escalate` | escalate |
| `POST /call-center/calls/:id/incident` | incidents.create |
| `GET /incidents` · `GET /incidents/:id` · `POST /incidents` · `PATCH /incidents/:id` | incidents.view · .create · .manage |

Filtros de llamadas: `from`, `to`, `centerId`, `customerId`, `phone`,
`language`, `reasonCode`, `resultCode`, `status`, `priority`, `handledBy`,
`direction`, `operatorUserId`, `telephonyProvider`, `pendingFollowUp`,
`interested`, `limit`, `offset`. Todo validado con Zod.

## Disponibilidad

`GET /call-center/availability` sale de los trasteros **reales en ese
momento** y sólo dice, por tipo de trastero, si hay o no (con sus medidas
nominales). Sin precios, sin reservar, sin bloquear y sin garantizar nada:
**Mobilink informa de disponibilidad; la web confirma precio y contratación.**

## Pantallas (menú «Call Center» de Self Storage)

- **Dashboard**: hoy/semana/mes, duración media, entrantes/salientes, %
  resueltas y escaladas, humano/IA/híbrido, clientes existentes, nuevos
  interesados, visitas, incidencias, consultas de precio y tamaño, enviados a
  calculadora y a contratación; gráficos por día, motivo, resultado, idioma,
  centro, quién atiende y duración media.
- **Llamadas**: lista con todos los filtros, paginada, exportable a CSV.
- **Llamada** (operativa): teléfono → ficha mínima automática → motivo →
  un botón de resultado (resuelta, web, calculadora, contratación, visita
  virtual/guiada, incidencia, escalar, seguimiento). Centro, enlaces y
  disponibilidad a mano. Cronología de la llamada.
- **Incidencias**, **Operadores**, **Motivos y resultados**,
  **Configuración** (activación, marca, centro por defecto, enlaces,
  protección de datos) y **Logs** (cronología de todas las llamadas).

La operadora (`call_center`) entra directamente al Call Center.

## Configuración por empresa

| Ajuste | Por defecto |
|---|---|
| `call_center.enabled` | `false` |
| `call_center.default_center_id` | ninguno (el único centro activo si sólo hay uno) |
| `call_center.links` | `{brandName, web, calculator, contracting, virtualVisit}` todo vacío |
| `call_center.store_transcripts` | `false` |
| `call_center.transcript_retention_days` | 90 |
| `call_center.store_audio` | `false` (sólo admite `false`: no hay grabación de audio) |

Nada de la marca (p. ej. «TLC - Trasteros-Low Cost», su web o la dirección
del centro) está en el código: se configura por empresa y por centro.

## Protección de datos

- Audio: no se graba.
- Transcripciones: desactivadas por defecto. Si se activan, se borran solas
  pasados los días de retención (trabajo `llamadas_retencion`); si se
  desactivan, se borran todas. La llamada (motivo, resultado, resumen) se
  conserva.
- La auditoría guarda **qué** cambió, no el contenido de la conversación.
- Ficha mínima y teléfono enmascarado en la auditoría de consultas.

## Reporting

Dashboard + lista filtrable + CSV (`;`, UTF-8 con BOM, protegido contra
fórmulas). Filtros: fechas, centro, idioma, motivo, resultado, estado,
prioridad, humano/IA/híbrido, sentido, operador, proveedor de telefonía,
interesados y seguimientos pendientes.

## Pruebas

- `server/self-storage/domain/callcenter.test.ts`: reglas puras.
- `server/self-storage/auth/permissions.test.ts`: rol `call_center`.
- `server/self-storage/callcenter.integration.test.ts` (PostgreSQL): alta,
  fin, identificación (cliente, persona autorizada, interesado), resultados,
  escalado, seguimiento, incidencias urgentes, permisos, multiempresa,
  superadministrador, interruptores, filtros, informes, CSV, disponibilidad
  sin precios, transcripciones y cronología de sólo inserción.
