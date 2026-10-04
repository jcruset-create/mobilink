# Asistente IA (Self Storage)

Capa **opcional** sobre el [Call Center](CALL_CENTER.md). Puede atender o
asistir una llamada; se apaga sin que el Call Center lo note. Mobilink es la
fuente de verdad: el proveedor de IA sólo decide **qué decir**; los datos y las
acciones pasan siempre por los servicios de Mobilink.

> «El Call Center informa y ayuda. La web vende.»

## Arquitectura

```
Telefonía (sustituible)            integrations/telephony   (preparada: interfaz + simulado)
      ↓
Call Center                        modules/callcenter       (registro, enrutado humano | IA | híbrido)
      ↓
Asistente IA                       modules/asistente
  ├─ motor        bucle de conversación, guardas, escalado, resumen, calidad
  ├─ herramientas READ_ONLY / WRITE_SAFE / SENSITIVE, con permisos y registro
  ├─ conocimiento base ESTÁTICA (ES/CA) + carga inicial TLC
  └─ proveedor    AIProvider ─▶ OpenAIAdapter ─▶ core/openaiService (capa única de Mobilink)
                             └▶ MockAIProvider (simulado, sin coste)
      ↓
Servicios de Self Storage          clientes, contratos, centros, disponibilidad, incidencias
      ↓
Auditoría · cronología de la llamada · registro de herramientas · informes
```

- **Tres conceptos separados**: la telefonía transporta, el Call Center
  gestiona la llamada, el asistente atiende o asiste. Ninguno depende del
  proveedor concreto del otro.
- **Independencia de proveedor**: el dominio depende de `AIProvider`, nunca de
  OpenAI. `integrations/ai/openai.ts` es el ÚNICO fichero de Self Storage que
  importa `core/openaiService.ts` (excepción con nombre en
  `aislamientoModulo.test.ts`).
- **Multiempresa**: todo por `empresa_id` y configuración. Nada de «si la
  empresa es X».

## Abstracciones de proveedor

| Interfaz | Fichero | Hoy |
|---|---|---|
| `AIProvider` — `decidir({sistema, mensajes}) → DecisionIA` | `integrations/ai/types.ts` | `openai` (delega en la capa única), `mock` |
| `VoiceProvider` — `transcribir`, `sintetizar` | `integrations/voice/types.ts` | `mock` |
| `TelephonyProvider` — `verificarFirma`, `parsearEntrante`, `responder` | `integrations/telephony/types.ts` | `mock` |

La decisión es la misma para todos (esquema JSON **estricto**):
`{ idioma, accion: responder | herramienta | escalar | finalizar, respuesta,
herramienta, parametros_json, motivo_escalado, resumen }`.

## Motor (una vuelta)

1. Se guarda lo que dice quien llama.
2. Instrucciones = reglas obligatorias + reglas de la empresa + enlaces
   (marca, web, calculadora…) + **conocimiento estático relevante** +
   herramientas activas.
3. Proveedor → decisión. Si falla: **proveedor de respaldo** (si está
   configurado); si no hay o también falla: se **escala** a una persona y la
   sesión queda con el error y marcada para revisión.
4. Si pide una herramienta: se ejecuta (con todas las comprobaciones), el
   resultado vuelve al proveedor (máximo 4 por turno).
5. **Guardas** sobre la respuesta: un importe con moneda no llega a quien
   llama (se remite a la web y se marca `posible_precio_inventado`).
6. Escalar / finalizar / responder. Se actualizan turnos, tokens, coste
   estimado (si hay precios configurados), idioma y resumen.

Límite de turnos por sesión (`ai_assistant.max_turns`): al llegar, se escala.

## Datos dinámicos y conocimiento estático

| Dinámico (SIEMPRE por herramienta) | Estático (base de conocimiento) |
|---|---|
| disponibilidad, cliente, contrato, centro, estado de acceso, incidencias | cómo funciona, contratación online, calculadora, visitas, modelo low cost, preguntas frecuentes, procedimientos |

La base de conocimiento no contiene precios, disponibilidad, horarios ni
direcciones.

## Herramientas

| Herramienta | Riesgo | Por defecto | Qué hace |
|---|---|---|---|
| `buscar_cliente_por_telefono` | READ_ONLY | activa | ¿es cliente? nombre de pila, contratos activos, acceso bloqueado (nada más) |
| `consultar_centro` | READ_ONLY | activa | nombre, dirección y enlaces del centro |
| `consultar_disponibilidad` | READ_ONLY | activa | disponibilidad REAL por tipo (sí/no), sin precios |
| `obtener_base_conocimiento` | READ_ONLY | activa | busca en la base estática |
| `registrar_llamada` | WRITE_SAFE | desactivada | registra la llamada si no lo está |
| `registrar_resultado` | WRITE_SAFE | desactivada | resultado de la llamada (no escalar: eso es `accion=escalar`) |
| `solicitar_visita` | WRITE_SAFE | desactivada | anota la SOLICITUD (no la confirma) |
| `crear_incidencia` | WRITE_SAFE | desactivada | abre una incidencia de la llamada (urgentes por tipo) |
| `crear_seguimiento` | WRITE_SAFE | desactivada | deja la llamada pendiente de seguimiento |
| `modificar_contrato`, `cancelar_contrato`, `modificar_precio`, `emitir_devolucion`, `modificar_pago` | SENSITIVE | **bloqueadas siempre** | sólo existen para que el intento quede registrado |

Antes de ejecutar: existe → no es sensible → está activa → no exige
confirmación humana (si la exige, en esta versión se bloquea y se escala) →
quien abrió la sesión tiene el permiso de Self Storage de la herramienta →
parámetros válidos (Zod). **Todo** queda en `self_storage_ai_tool_calls`
(sólo inserción): herramienta, riesgo, sesión, llamada, actor, parámetros
**saneados** (sin teléfonos ni emails completos), resultado, duración y
`success` / `error` / `blocked`.

No hay endpoint para ejecutar herramientas desde fuera: sólo el motor, en el
servidor.

## Base de conocimiento

`self_storage_ai_knowledge`: categoría, pregunta, respuesta, idioma (`es`,
`ca`, preparada para más), activa, prioridad y centro opcional (lo del centro
gana al buscar). Búsqueda por coincidencia de palabras (sin acentos, con raíz
tosca), en el idioma de la llamada y, si no hay nada, en castellano.

**Cargar conocimiento inicial TLC** (botón): 8 entradas en castellano y
catalán (empresa, modelo low cost, precio → web, tamaño → calculadora,
visitas, personal en las instalaciones, contratar → web, disponibilidad). Usa
el nombre comercial, la web y la calculadora de la configuración del Call
Center. **Idempotente** por empresa y por centro (clave `tlc.<entrada>` +
idioma): no duplica ni pisa lo editado. Nunca se inserta sola en producción.

## Sesiones

`self_storage_ai_sessions`: llamada opcional (una llamada puede tener varias
sesiones), centro, proveedor, modelo, idioma, modo (`console` / `call`),
estado (`active`, `finished`, `escalated`, `error`), turnos, tokens, segundos
de audio, coste estimado, resumen, error, escalado y **calidad** (marcada para
revisión y motivo; revisión `correct` / `partial` / `incorrect` con notas).

`self_storage_ai_messages`: el hilo mientras la sesión vive. Al terminar se
**borra** salvo que la empresa guarde transcripciones (y entonces se purga
por retención).

Se marcan para revisión automáticamente: escalados, herramientas fallidas o
bloqueadas, consultas sin respuesta en el conocimiento, errores y respaldo
de proveedor, decisiones no válidas y posibles precios inventados.

## Escalado IA → humano

Casos: no entiende, piden una persona, incidencia crítica, reclamación
compleja, acción no autorizada, problema de acceso, posible fraude, consulta
fuera de conocimiento, proveedor caído, límite de turnos.

Al escalar: motivo y resumen en la sesión → la llamada pasa a **escalada**,
`requires_human`, **híbrida**, con el resumen y el evento `escalated` (actor
`ai`) → la persona que la abre en el Call Center ve el contexto. Con
`ai_assistant.human_escalation` apagado, se remite a la web y se marca para
revisión.

## Seguridad

- Permisos: `ss.ai.view` (dashboard, sesiones, consola), `ss.ai.configure`
  (proveedores), `ss.ai.knowledge.manage`, `ss.ai.tools.manage`,
  `ss.ai.logs.view`, `ss.ai.review`. La configuración se guarda con
  `ss.settings.manage`.
  - admin: todo · employee: view, logs, review · call_center: view (consola
    con sus propios permisos) · maintenance: nada.
- Las herramientas se ejecutan con los permisos de quien abre la sesión
  (consola) o con un conjunto mínimo de sistema (telefonía).
- Nunca claves en la base ni en el código: variables de entorno.
- RLS cerrado en las cuatro tablas; multiempresa por `empresa_id` (404 a lo
  ajeno).
- Reglas obligatorias en el código (no se pueden quitar desde el panel).

## Configuración por empresa

| Ajuste | Por defecto |
|---|---|
| `ai_assistant.enabled` | `false` |
| `ai_assistant.mode` | `hybrid` (`ai`, `human`, `hybrid`) |
| `ai_assistant.provider` / `fallback_provider` | `mock` / ninguno |
| `ai_assistant.voice_provider` / `telephony_provider` | ninguno |
| `ai_assistant.languages` | `["es","ca"]` |
| `ai_assistant.store_transcripts` / `store_summary` | `false` / `true` |
| `ai_assistant.human_escalation` | `true` |
| `ai_assistant.extra_rules` | `[]` |
| `ai_assistant.tools` | `{}` (READ_ONLY activas, WRITE_SAFE no) |
| `ai_assistant.max_turns` | 30 |

Marca, web, calculadora, contratación, visita virtual y centro por defecto:
los del Call Center (`call_center.links`, `call_center.default_center_id`).

## Variables de entorno

| Variable | Para qué |
|---|---|
| `SELF_STORAGE_AI_ASSISTANT_ENABLED` | interruptor global (vacío = permitido; `0` lo apaga) |
| `OPENAI_API_KEY`, `OPENAI_ASSISTANT_MODEL`, `OPENAI_FALLBACK_MODEL` | los de la capa única de IA de Mobilink |
| `SELF_STORAGE_AI_PRICE_INPUT_PER_MTOK`, `SELF_STORAGE_AI_PRICE_OUTPUT_PER_MTOK` | coste estimado (opcional) |
| `SELF_STORAGE_TELEPHONY_MOCK_SECRET` | firma de la telefonía simulada (pruebas) |

## API (`/api/self-storage/admin/ai-assistant`)

| Método y ruta | Permiso |
|---|---|
| `GET /status` | view |
| `GET /dashboard?from&to` | view |
| `GET /providers` · `GET /rules` · `GET /tools` | view |
| `PATCH /tools/:name` `{active, requiresConfirmation}` | tools.manage (SENSITIVE: 422) |
| `GET /knowledge` · `POST` · `PATCH /:id` · `DELETE /:id` | view · knowledge.manage |
| `POST /knowledge/seed` `{pack: "tlc", centerId?}` | knowledge.manage |
| `GET /sessions` · `GET /sessions/:id` | view |
| `POST /sessions` `{callId? \| simulateCall?, centerId?, language?}` | view |
| `POST /sessions/:id/message` `{text}` | view |
| `POST /sessions/:id/finish` · `POST /sessions/:id/escalate` `{reason}` | view |
| `POST /sessions/:id/review` `{reviewStatus, notes}` | review |
| `GET /tool-calls?outcome&tool&sessionId` | logs.view |

Configuración, proveedores y reglas de la empresa: `PUT /settings/ai_assistant.*`.

## Pantallas (menú «Asistente IA»)

Dashboard IA (sesiones, % resolución, escalados, errores, tiempo medio,
herramientas más usadas, consultas no resueltas, idioma, proveedor y modelo,
coste, calidad) · **Sesiones y consola** (conversación de prueba por texto,
con llamada simulada opcional) · Base de conocimiento (con el botón de carga
inicial) · Reglas · Herramientas · Proveedores · Logs IA · Configuración. En
la pantalla de una llamada del Call Center: «Asistir con IA».

## Cómo añadir un proveedor de IA (Anthropic, Google…)

1. `integrations/ai/<proveedor>.ts`: una clase que implemente `AIProvider`
   (`disponible()`, `modelo()`, `decidir()`), que devuelva la `DecisionIA`
   con el esquema estricto `ESQUEMA_DECISION` (o lo valide). La clave, en una
   variable de entorno.
2. Registrarla en `integrations/ai/index.ts` y su nombre en
   `integrations/ai/nombres.ts` (`PROVEEDORES_IA`).
3. Pruebas como `integrations/ai/ai.test.ts`.

El motor, las herramientas, el Call Center y el panel no cambian.

## Cómo conectar OpenAI (ya preparado)

1. `OPENAI_API_KEY` y, si se quiere, `OPENAI_ASSISTANT_MODEL` en el servidor.
2. Asistente IA → Proveedores: proveedor «OpenAI», respaldo «Simulado» o
   ninguno.
3. Probar en la consola antes de conectar telefonía.

## Cómo conectar telefonía (Twilio Voice, Telnyx, SIP)

1. `integrations/telephony/<proveedor>.ts` implementando `TelephonyProvider`
   (verificación de firma obligatoria, traducción del webhook a
   `LlamadaEntrante`, traducción de órdenes `decir` / `transferir` / `colgar`
   a su formato). Y, para voz, un `VoiceProvider`.
2. Un endpoint de webhook en `/api/self-storage/webhooks/telephony/:proveedor`
   que verifique la firma y llame a `modules/callcenter/enrutado.ts`
   (`llamadaEntrante`): registra la llamada (idempotente por id externo),
   decide humano / IA / híbrido y abre la sesión de IA si toca.
3. Mapear el número marcado a la empresa (y centro).
4. Avisar de la grabación/transcripción si se activa (RGPD).

## Pruebas

- `domain/asistente.test.ts`: guardas de precio, búsqueda ES/CA,
  instrucciones, saneado, enrutado, coste.
- `integrations/ai/ai.test.ts`: OpenAIAdapter delega en la capa única
  (propósito «asistente», esquema estricto); simulado sin inventar.
- `asistente.integration.test.ts` (PostgreSQL): interruptores (el Call Center
  sigue sin IA), conocimiento inicial idempotente por empresa y centro, sesión
  completa en catalán con conocimiento y disponibilidad, WRITE_SAFE sólo
  activada, SENSITIVE bloqueada, registro saneado y de sólo inserción,
  escalado IA → humano con resumen, revisión de calidad, proveedor no
  disponible y respaldo, guarda de precios y coste, permisos y multiempresa,
  dashboard, transcripción guardada si se activa, telefonía simulada
  idempotente y enrutado según el modo.
