# Prompt — Avisos de presión del arco por correo → incidencia automática

> Prompt listo para pegar en una sesión de Claude Code sobre el repo `mobilink`.
> Léelo entero antes de tocar nada.
>
> Los hechos marcados **[verificado]** se comprobaron contra el código el
> 20-08-2026. Si al leer el repo alguno ya no es cierto, dilo antes de seguir.

---

## 0. Qué llega hoy y qué queremos

Cuando un vehículo cruza el arco con una rueda por debajo del umbral, llega un
correo con la marca Goodyear titulado **"Presión baja!"**. Es una plantilla fija
con campos etiquetados:

```
Presión está en el rango crítico (debajo 75%)
Soledad // La Plana

Matrícula:              7851JNT
ID de flota:            1015
Rueda:                  Eje 2 - izquierdo exterior
Etiquetas:
Fecha y hora:           19.08.2026 · 22:13:23
Presión recomendada:    8.0 bar
Presión bruta:          5.5 bar (-31.08%)

Ubicación de CheckPoint
Nombre de CheckPoint:   Soledad // La Plana
```

Hoy esos correos se leen a mano y no dejan rastro en TyreControl. Queremos que
**abran una incidencia sola**, sobre el vehículo y la rueda correctos, para que
aparezcan en la pantalla de Incidencias y puedan planificarse como cualquier
otra.

---

## 1. La decisión de diseño más importante: la IA NO extrae los datos

El encargo dice "pasarlo por la IA". **No lo hagas para extraer los campos**, y
explica por qué en el código:

Ese correo es una **plantilla fija con etiquetas**. Extraer `Matrícula: 7851JNT`
con una expresión regular es determinista, instantáneo, gratis y verificable con
un test. Pedírselo a un modelo introduce coste, latencia y —lo único que
importa de verdad— **la posibilidad de que invente una matrícula o una presión**.
Una incidencia con la matrícula equivocada manda a un técnico a un camión que
está bien y deja sin avisar al que va con 5.5 bar.

Es la misma regla que ya rige el informe de intervención
(`docs/PROMPT_intervenciones_operaciones.md` §5): **la IA redacta, nunca decide
los hechos**.

**Dónde SÍ tiene sentido la IA**, y es donde debe usarse:

- **Correos que NO encajan con la plantilla.** El día que Goodyear cambie el
  diseño, o llegue un aviso de otro tipo, el analizador determinista fallará. Ahí
  la IA es la red: se le pasa el correo y se le pide que devuelva los campos en
  JSON **o que diga que no sabe**. Lo que salga de ahí se marca como
  `origen_datos = 'ia'` y **no se da por bueno sin que una persona lo confirme**.
- **La `accion_recomendada`** en lenguaje normal, a partir de datos ya extraídos.

**[verificado]** El servidor ya tiene el ayudante: `pedirIA()` en
`server/core/openaiService.ts`, usado desde `server/index.ts`. No crees otro
cliente de OpenAI ni otro modelo: los modelos se configuran por variable de
entorno (`OPENAI_DEFAULT_MODEL`…), no en código.

---

## 2. Lo que ya existe y hay que reutilizar

### El vigilante de correo

**[verificado]** `server/checkpointMail.ts` ya hace exactamente esta forma:
IMAP con `imapflow`, `simpleParser` de `mailparser`, una función que hace UNA
pasada (`revisarBuzonCheckpoint`) y un temporizador que la repite
(`startCheckpointMail`). Apagado si faltan credenciales. Busca solo los **no
leídos** y los marca como leídos al terminar.

**Reutiliza ese molde.** No escribas un segundo sistema de correo: extrae lo
común si hace falta, pero el comportamiento —una pasada a mano, temporizador,
apagado sin credenciales— ya está resuelto y probado.

Ojo a la lección que costó dos días: **un correo que falla se queda SIN leer** y
se reintenta; solo se marca leído lo que se procesó o se descartó a conciencia
(`tyrecontrol_deshacer_sustitucion` no, esto está en `checkpointMail.ts`, en el
bucle de `revisarBuzonCheckpoint`).

### El registro de ejecuciones

**[verificado]** `tc_checkpoint_ejecuciones` guarda una fila por correo
procesado, con `message_id` **único** para no procesar dos veces el mismo
mensaje. Decide y justifica: ¿otra tabla para los avisos, o la misma con una
columna que distinga el tipo? Un proceso que escribe sin que nadie mire tiene
que dejar rastro — eso no se negocia.

### El mapeo de la rueda

**[verificado]** `src/modules/tyrecontrol/services/checkpoint.ts` ya traduce la
nomenclatura del arco a la nuestra: `senasPosicion()` y `codigoPosicion()`
convierten "Eje 2 · Exterior izquierda" en eje/lado/interior-exterior y en
`E2_IZQ_EXT`. **Úsalo.** Y usa la búsqueda con respaldo por atributos que ya
tiene el importador (`importRevisiones.ts`): hay tipos de vehículo sembrados en
la Fase 3 que llaman `DEL_IZQ` a lo que aquí es `E1_IZQ`, y buscar solo por
código deja fuera esos vehículos.

El aviso dice `Eje 2 - izquierdo exterior`, con guion y en ese orden. Comprueba
si `senasPosicion` lo entiende tal cual; si no, amplíala **con un test**, no a ojo.

### El modelo de incidencias

**[verificado]** `tc_incidencias` + `tc_incidencia_problemas`
(`tyrecontrol_fase34_incidencias.sql`):

- `tc_incidencias`: `empresa_id`, `vehiculo_id`, `posicion_id`, `neumatico_id`,
  `gravedad` (`leve|importante|critica`), `gravedad_auto`, `estado`
  (`detectada|…|solucionada`), `detectada_por`, `detectada_at`,
  `accion_recomendada`, `medicion_inicial` jsonb
  (`{profundidad_mm, presion_bar, estado_visual}`), `foto_url`.
- `tc_incidencia_problemas`: una fila por problema, con `tipo` de una lista
  cerrada que **ya incluye `presion_baja` y `presion_alta`**.

No añadas tipos nuevos: el que hace falta ya está.

**[verificado]** La APK las crea insertando directamente en las dos tablas
(`supabase_service.dart:598`), no por RPC. Decide si el servidor hace lo mismo o
si conviene un RPC `security definer` — y ten en cuenta que el vigilante corre
**sin sesión de usuario**, con la clave de servicio, así que `detectada_por`
(que en la APK es `auth.uid()`) no puede rellenarse igual.

---

## 3. Reglas de negocio que hay que resolver

### 3.1 No inundar de incidencias — LO MÁS IMPORTANTE

Ese camión va a cruzar el arco **todos los días** con la rueda baja hasta que
alguien la infle. Si cada aviso abre una incidencia, en una semana hay siete
incidencias idénticas y la pantalla queda inservible.

**Regla:** si ya existe una incidencia **abierta** (estado distinto de
`solucionada`, `cancelada`, `no_procede`) para el **mismo vehículo, la misma
posición y el problema `presion_baja`**, no se crea otra. Se actualiza la que
hay: nueva medición, y anotación de que el aviso se repite.

Decide dónde se anota la repetición (¿un contador? ¿`motivo_observacion`? ¿una
tabla de avisos con FK a la incidencia?) y justifícalo. Lo que no vale es
perder la información de que el problema lleva cinco días sin resolverse.

### 3.2 La gravedad la dice el correo, no la inventes

El aviso trae **"rango crítico (debajo 75%)"** y el porcentaje (`-31.08%`).
Mapea eso a `gravedad`/`gravedad_auto` a partir de lo que dice el correo, no de
umbrales inventados. Si aparecen otros rangos (aviso, bajo…), trátalos; si llega
uno desconocido, **no adivines**: crea la incidencia con la gravedad más baja y
déjalo dicho en las observaciones.

### 3.3 Vehículo que no está en TyreControl

El correo trae matrícula **e `ID de flota`** (1015). El importador del arco ya
casa vehículos; mira cómo lo hace y usa el mismo criterio.

Si no existe: **no lo des de alta a la ligera** desde un aviso de presión. Un
aviso no trae configuración de ejes ni medidas. Registra el aviso como no
casado, avisa por correo y que lo mire una persona.

### 3.4 Qué neumático

`tc_incidencias.neumatico_id` es opcional. Si el vehículo tiene montaje actual
en esa posición, enlázalo — así la incidencia queda pegada a la goma concreta y
sirve para su historial. Si no lo hay, deja `null` en vez de inventar.

### 3.5 ¿Incidencia u orden de trabajo?

El encargo dice "incidencia **u** orden de trabajo". **Empieza solo por la
incidencia**, y explica por qué en el análisis:

Una incidencia es *"esto está mal"* — un hecho que el arco ha medido. Una orden
de trabajo es *"hay que hacer esto"*, y eso ya es una decisión: puede que la
rueda solo necesite aire, puede que tenga un pinchazo lento, puede que haya que
cambiarla. El sistema ya sabe llevar una incidencia a una operación planificada
cuando alguien decide qué hacer; saltarse ese paso desde un correo automático es
decidir por el jefe de taller.

Si después se quiere el paso automático, que sea **configurable y explícito**,
no el comportamiento por defecto.

---

## 4. Configuración — DECIDIDO

**Mismo buzón.** Los avisos se reenvían a `tyrecontrol@mobilink.es`, donde ya
llega el informe semanal (decisión de Jordi, 20-08-2026). La regla de reenvío
desde la cuenta de Gmail con la etiqueta `Goodyear-Plana` **la pone él**: no es
trabajo del código, pero recuérdalo en la entrega.

Consecuencia directa: **un solo vigilante lee dos clases de correo**, así que lo
primero que hace al abrir cada mensaje es decidir cuál es. Y esa decisión tiene
que ser explícita y estrecha en los dos sentidos:

- Un aviso de presión **no puede** intentar procesarse como informe semanal.
- El informe semanal **no puede** intentar procesarse como aviso.
- Lo que no sea ninguno de los dos se descarta sin ruido.

**[verificado]** `esAdjuntoInforme()` en `checkpoint.ts` es hoy quien decide si
un correo trae el informe: mira el adjunto. Un aviso de presión **no lleva
adjunto**, así que ese es ya un criterio que separa limpiamente los dos casos —
pero no te apoyes solo en eso. Reconoce el aviso por lo que ES (asunto y
plantilla), no por lo que le falta, y escribe el test de los dos correos reales.

No hacen falta variables de entorno nuevas: se reutilizan las `CHECKPOINT_IMAP_*`
que ya existen. Si añades algo (por ejemplo, a quién avisar cuando un correo no
se reconoce), documéntalo en `.env.example` junto a las demás.

## 5. Cómo trabajar

### Fase 0 — Análisis, ANTES de tocar código

Entrega un documento con:

- **A.** Qué hay hoy: `checkpointMail.ts`, `tc_checkpoint_ejecuciones`,
  `checkpoint.ts` (mapeo de ruedas), `tc_incidencias` y cómo las crea la APK.
- **B.** El analizador determinista: qué campos, con qué expresiones, y qué pasa
  con cada uno si falta.
- **C.** Tu decisión sobre el papel de la IA (§1). La del buzón ya está tomada
  (§4): mismo buzón, un vigilante, y el reconocimiento del tipo de correo
  explícito en los dos sentidos.
- **D.** Tu regla de deduplicación (§3.1), con el caso "cinco días seguidos"
  resuelto explícitamente.
- **E.** Cambios mínimos: Base de datos · Servidor · Panel.
- **F.** Riesgos. Como mínimo: correo que cambia de formato, matrícula que no
  casa, posición que el tipo de vehículo no tiene, y avisos repetidos.

**Para en seco después de la Fase 0 y espera aprobación.**

### Tests

El analizador es lo que más se prueba, porque es lo único que puede convertir un
correo en un dato falso:

- El correo de ejemplo de §0, entero, con sus valores exactos.
- Coma decimal (`5,5 bar`) además de punto.
- Presión sin porcentaje, o con el porcentaje en positivo.
- Fecha en `19.08.2026 · 22:13:23` **y** en cualquier otra variante que
  encuentres en el buzón real.
- Un correo que NO es un aviso (el informe semanal, publicidad): no debe
  producir nada.
- Un correo con la plantilla cambiada: debe fallar **de forma explícita**, no
  devolver campos a medias.
- Y la deduplicación: dos avisos iguales seguidos = una incidencia.

Prueba también la lógica SQL/RPC que escribas, no solo el TypeScript.

---

## 6. Criterios de aceptación

| | Escenario | Resultado |
|---|---|---|
| **A** | Llega el aviso de 7851JNT, eje 2 izquierdo exterior, 5.5 bar | Una incidencia `presion_baja` en `E2_IZQ_EXT` de ese vehículo, gravedad según el rango del correo, con `medicion_inicial` = 5.5 bar |
| **B** | El mismo aviso, cinco días seguidos | **Una** incidencia, con constancia de que se repitió cinco veces |
| **C** | Se soluciona la incidencia y el aviso vuelve una semana después | Una incidencia **nueva** — el problema volvió a aparecer |
| **D** | Matrícula que no existe en TyreControl | No se crea nada, queda registrado y se avisa |
| **E** | Correo con formato distinto | No se inventa nada: se registra como no reconocido y se avisa |
| **F** | Llega el informe semanal al mismo buzón | Se procesa como informe, NO como aviso |
| **F2** | Llega publicidad o cualquier otro correo | Se ignora sin ruido |
| **G** | Falla el proceso a mitad | El correo se queda sin leer y se reintenta solo |

---

## 7. Ficheros de partida

| Qué | Dónde |
|---|---|
| Vigilante de correo (el molde) | `server/checkpointMail.ts` |
| Importador del arco | `server/tyrecontrol/checkpointImport.ts` |
| Mapeo de ruedas y lectura | `src/modules/tyrecontrol/services/checkpoint.ts` |
| Respaldo por atributos al buscar posición | `src/modules/tyrecontrol/services/importRevisiones.ts` |
| Ayudante de IA | `server/core/openaiService.ts` (`pedirIA`) |
| Incidencias: tablas y tipos | `supabase/migrations/tyrecontrol_fase34_incidencias.sql` |
| Cómo las crea la APK | `tyrecontrol_app/lib/services/supabase_service.dart:598` |
| Pantalla de incidencias | `src/modules/tyrecontrol/pages/Incidencias.tsx` |
| Registro de ejecuciones | `supabase/migrations/tyrecontrol_checkpoint_correo.sql` |
| Variables de entorno | `.env.example`, sección del CheckPoint |

---

## 8. Convenciones del repositorio

Las de `CLAUDE.md`, sin excepciones:

- `git fetch origin main` y `git pull` **antes** de empezar; si la rama se quedó
  atrás, integra `main` y resuelve conflictos antes de programar.
- `bash scripts/check-versions.sh` antes de cada commit y de cada push.
- Los `pubspec.yaml` los gestiona CI: **no los toques**. `package.json` sí.
- CI ejecuta **`npx tsc -b` Y `npx tsc -p tsconfig.server.json`**. Pasa los dos.
- Toda migración: idempotente y terminada en un bloque que `raise exception` si
  no se cumplió lo que promete.
- Y una que ha costado aprender: **una tabla temporal no sobrevive al editor SQL
  de Supabase** si el trabajo va repartido en varias sentencias. Si necesitas
  una, mete todo en un único `do $$ … $$`.
