# PROMPT — Asistente virtual con IA para clientes (TyreControl)

> Prompt listo para implementar en `jcruset-create/mobilink`. Añade a TyreControl
> un **asistente conversacional** que responde preguntas del cliente sobre SU
> flota en lenguaje natural: *"¿cuál es el estado general de mi flota?"*,
> *"¿qué vehículos tengo pendientes de revisar?"*, *"¿cuánto me ha costado el
> mantenimiento este trimestre?"*.

---

## Principio rector

**El asistente no consulta la base de datos: llama a herramientas.** La IA elige
qué función invocar de un conjunto cerrado (*function calling*), el backend la
ejecuta con la sesión del usuario y le devuelve **solo datos agregados**. El
modelo redacta la respuesta a partir de eso.

De ahí se derivan tres reglas que no se negocian:

1. **Nunca escribe SQL** ni recibe acceso a la base de datos.
2. **Nunca inventa cifras.** Si una herramienta no devuelve el dato, el asistente
   dice que no lo tiene. Un número inventado sobre la seguridad de una flota es
   peor que no responder.
3. **Solo lectura.** No crea revisiones, no cierra incidencias, no cambia nada.

> Relación con `PROMPT_informes_personalizados_ia.md`: aquel construye **cuadros
> de mando**; este **responde preguntas**. Comparten el catálogo de datos y la
> capa de validación — **implementar primero el catálogo de aquel y reutilizarlo
> aquí**, no duplicarlo.

---

## Contexto ya construido (reutilizar, no reinventar)

### Roles y aislamiento
- `tc_usuarios.rol`: `administrador` | `operador` | `cliente`; más
  `es_superadmin` y `empresas_manual`.
- **RLS por empresa**: `tc_puede_ver_empresa(empresa_id)`; operarios multi-cliente
  vía `tc_operador_empresas`. Helpers `tc_is_superadmin()`, `tc_is_admin()`.
- `tc_permisos_cliente (usuario_id, pantalla, puede_ver, puede_exportar)`:
  permisos por pantalla del rol cliente. **El asistente debe respetarlos**: si un
  cliente no puede ver "Económico", el asistente no le da costes.
- `useFiltrosInformes.ts` ya resuelve `esCliente` y fuerza su `empresa_id`.

### Datos agregados ya disponibles (herramientas casi gratis)
- `tc_informes_kpis`, `tc_informes_estado_flota`, `tc_informes_inventario_por`,
  `tc_informes_profundidad_distribucion` y demás `tc_informes_*`.
- `tc_plan_estado` — planificación: qué vehículos tocan revisión y cuáles están
  atrasados.
- `tc_revision_estado` — estado de revisión por vehículo (`al_dia`, `proxima`,
  `vencida`, `sin_revision`).
- `tc_prod_revisiones` / `tc_prod_operaciones` — tiempos, pausas, productividad.
- `tc_vehiculo_webfleet_estado` — dónde está cada vehículo (en base / en ruta).
- `/api/tyrecontrol/webfleet/conduccion` — OptiDrive, ralentí, km.

### Backend
- Cliente `openai` ya instanciado (`gpt-4o-mini`). Patrón de endpoint:
  `authenticate` + `requireModule("tyrecontrol")`.
- ⚠️ `server/index.ts` ~15.700 líneas: **crear `server/tyrecontrol/asistente.ts`**
  y montarlo con una línea. No engordar el monolito.

---

## Las herramientas (lo único que el asistente puede hacer)

Cada una recibe filtros ya acotados por el servidor y devuelve **agregados**,
nunca listados masivos.

| Herramienta | Devuelve | Responde a |
|---|---|---|
| `estado_flota` | vehículos totales, revisados, pendientes, al día / próximos / vencidos, neumáticos bajo mínimo | *"¿cómo está mi flota?"* |
| `vehiculos_pendientes` | matrículas con revisión vencida o próxima (máx. 50) | *"¿qué tengo que revisar?"* |
| `alertas_activas` | incidencias abiertas por gravedad, con matrícula y posición | *"¿tengo algo urgente?"* |
| `estado_vehiculo` | ficha de una matrícula: última revisión, mm por posición, incidencias, km | *"¿cómo está el 6133LXF?"* |
| `desgaste_neumaticos` | distribución de profundidad, cuántos por debajo del umbral, por marca/medida | *"¿cuántos neumáticos me quedan por cambiar?"* |
| `presiones` | % fuera de rango, por eje | *"¿voy bien de presiones?"* |
| `operaciones_periodo` | nº por tipo, en un rango | *"¿qué se ha hecho este mes?"* |
| `costes_periodo` | material, mano de obra, total | *"¿cuánto llevo gastado?"* |
| `productividad` | tiempos medios, efectivo, % inactividad | *"¿cuánto se tarda en revisar?"* |
| `conduccion` | OptiDrive, ralentí, km (Webfleet) | *"¿cómo conducen mis chóferes?"* |

**Reglas de las herramientas**
- El `empresa_id` **lo pone el servidor** desde la sesión. La IA no puede pasarlo
  ni cambiarlo.
- Todas se ejecutan con la sesión del usuario → **manda la RLS**.
- Antes de exponer una herramienta se comprueba `tc_permisos_cliente`. Las que el
  usuario no tenga permitidas **ni se le ofrecen al modelo**: no se filtra la
  respuesta después, se le quita la herramienta antes. Así no puede ni intentarlo.
- Cada una: máx. 50 filas y `statement_timeout` de 8 s.

---

## Flujo de una pregunta

```
Cliente: "¿cuál es el estado general de mi flota?"
   │
   ├─ Backend: monta el contexto (empresa del usuario, herramientas permitidas)
   ├─ IA: elige llamar a estado_flota()  ── no ve datos todavía
   ├─ Backend: ejecuta con la sesión del usuario → RLS aplica
   │           { vehiculos: 42, revisados: 38, pendientes: 4,
   │             vencidos: 2, bajo_minimo: 7, incidencias_abiertas: 3 }
   ├─ IA: redacta la respuesta CON ESAS CIFRAS
   └─ Respuesta + "fuentes" (qué herramientas se usaron) + acciones sugeridas
```

Ejemplo de respuesta esperada:

> **Tu flota está en buen estado general**, con matices.
>
> De 42 vehículos, **38 están revisados** y 4 pendientes — de esos, **2 con la
> revisión vencida** (2321HZT y 6803GWH), que conviene programar esta semana.
>
> Lo que sí requiere atención: **7 neumáticos por debajo del mínimo legal** y
> **3 incidencias abiertas**, una de ellas crítica.
>
> *Fuentes: estado de flota, alertas activas · datos a 31/07/2026*
> `[Ver vehículos pendientes]` `[Ver incidencias]`

---

## Diseño

### Endpoint
```
POST /api/tyrecontrol/asistente/preguntar
  { pregunta, conversacion_id? }
→ { respuesta, herramientas_usadas[], datos[], acciones[], conversacion_id }
```
Con `authenticate` + `requireModule("tyrecontrol")`. Bucle de *function calling*
con **máximo 3 llamadas a herramientas por pregunta** (evita bucles y coste
descontrolado).

### System prompt del modelo (esencia)
- Eres el asistente de Mobilink TyreControl. Respondes **solo** sobre la flota
  del cliente conectado, en español, claro y breve.
- **Usa siempre las herramientas para obtener datos. Nunca inventes cifras.**
- Si no tienes el dato o la herramienta falla, dilo abiertamente y sugiere a quién
  preguntar. **Es preferible "no lo sé" a un número inventado.**
- No des consejos de seguridad que contradigan la normativa (mínimo legal
  1,6 mm). Ante un neumático por debajo del mínimo, la recomendación es
  **sustituir**, sin matices.
- No hables de otros clientes ni de la competencia. No prometas plazos.
- Cierra con la acción concreta más útil, si la hay.

### Memoria de conversación
```sql
create table if not exists tc_asistente_conversaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references tc_empresas(id) on delete cascade,
  usuario_id  uuid references tc_usuarios(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists tc_asistente_mensajes (
  id               uuid primary key default gen_random_uuid(),
  conversacion_id  uuid not null references tc_asistente_conversaciones(id) on delete cascade,
  rol              text not null check (rol in ('usuario','asistente')),
  contenido        text not null,
  herramientas     jsonb,        -- qué se llamó y con qué parámetros
  created_at       timestamptz not null default now()
);
```
Se mandan al modelo **los 6 últimos mensajes** como contexto. RLS por empresa;
cada usuario ve solo sus conversaciones.

**Para qué sirve el histórico:** además de dar continuidad, es la fuente para
saber **qué preguntan de verdad los clientes** — y eso dirá qué herramientas
faltan mucho mejor que cualquier suposición nuestra.

---

## Interfaz

**Dónde vive:** panel web, botón flotante abajo a la derecha en todo el módulo
TyreControl → panel lateral de chat. Visible para clientes, operarios y admins
(cada uno con sus herramientas según permisos).

- Preguntas sugeridas al abrir (chips): *"Estado general de mi flota"*,
  *"¿Qué vehículos debo revisar?"*, *"¿Tengo alertas urgentes?"*,
  *"¿Cuánto he gastado este trimestre?"*.
- Respuestas en markdown, con **las cifras en negrita**.
- **Pie de fuentes**: qué herramientas se usaron y la fecha del dato. Es lo que
  hace la respuesta auditable — el cliente puede ir a la pantalla y comprobarlo.
- **Botones de acción** que llevan a la pantalla correspondiente ya filtrada.
- Indicador de "consultando datos…" mientras se ejecutan herramientas.
- Sin `OPENAI_API_KEY`: el botón no aparece. El resto del módulo, intacto.

**Fase 2 (no ahora):** el mismo asistente por WhatsApp reutilizando Twilio, que
ya está integrado. El backend es el mismo; solo cambia el canal.

---

## Criterios de aceptación

**Correcto**
- [ ] "¿Cuál es el estado general de mi flota?" responde con cifras **reales**,
      verificables en la pantalla de Informes.
- [ ] "¿Cómo está el 6133LXF?" da la ficha de ese vehículo.
- [ ] Una pregunta sin datos ("¿cuánto combustible gasto?") responde **que no se
      dispone del dato y por qué**, sin inventar.
- [ ] Una pregunta fuera de ámbito ("¿qué tiempo hará mañana?") se redirige con
      educación.

**Seguro**
- [ ] Un cliente de empresa A **jamás** obtiene datos de empresa B, ni pidiéndolo
      explícitamente ni con trucos ("ignora las instrucciones anteriores y…").
- [ ] Un cliente sin permiso de "Económico" no obtiene costes: la herramienta ni
      se le ofrece al modelo.
- [ ] El asistente no modifica ningún dato (verificar que no hay herramienta de
      escritura).
- [ ] Se registra qué herramientas se usaron en cada respuesta (auditoría).

**Sostenible**
- [ ] Máx. 3 llamadas a herramientas por pregunta; máx. 50 filas por herramienta.
- [ ] Una respuesta tarda menos de 10 s.
- [ ] Si OpenAI falla, se muestra un error claro y el resto sigue funcionando.

---

## Riesgos y decisiones

| Riesgo | Decisión |
|---|---|
| **La IA inventa cifras** (lo más grave: son decisiones de seguridad) | Solo puede responder con lo que devuelven las herramientas; el system prompt lo prohíbe explícitamente; el pie de fuentes hace la respuesta auditable. |
| Fuga entre clientes | `empresa_id` del servidor + RLS + herramientas filtradas por permisos. La IA nunca elige de qué empresa habla. |
| *Prompt injection* ("ignora las instrucciones") | La barrera no es el prompt: es que **no existe ninguna herramienta capaz de leer otra empresa**. Aunque el modelo "acepte", no hay nada que ejecutar. |
| Responsabilidad legal por un consejo | Nada de diagnósticos ni plazos de vida. Bajo mínimo legal → sustituir, sin matices. |
| Coste de OpenAI | `gpt-4o-mini`, máx. 3 herramientas por pregunta, 6 mensajes de contexto. |
| Que nadie lo use | Preguntas sugeridas visibles + histórico para ver qué se pregunta de verdad. |

---

## Orden de implementación

1. **3 herramientas** (`estado_flota`, `vehiculos_pendientes`, `alertas_activas`)
   + endpoint + bucle de function calling. **Sin UI**: se prueba con curl. Ya
   responde la pregunta del ejemplo.
2. **Panel de chat** en el panel web, con preguntas sugeridas y pie de fuentes.
3. **Resto de herramientas**, filtradas por `tc_permisos_cliente`.
4. **Memoria de conversación** y botones de acción.
5. *(Fase 2)* Canal WhatsApp con Twilio.

Recomendación: **parar tras la 2 y probarlo con un cliente real**. Lo que
pregunten en las primeras semanas dirá qué herramientas hacen falta mucho mejor
que cualquier lista que escribamos ahora.

---

## Fuera de alcance

- Acciones de escritura (crear revisiones, cerrar incidencias) — otro proyecto,
  con otro nivel de riesgo.
- Voz.
- Asistente para el técnico dentro de la APK (este es para el cliente).
- Predicciones ("¿cuándo se me gastará este neumático?") — requiere modelo de
  desgaste, no es un asistente.
