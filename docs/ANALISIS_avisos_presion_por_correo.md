# Fase 0 — Avisos de presión del arco por correo → incidencia

> Análisis previo pedido en `docs/PROMPT_avisos_presion_por_correo.md` §5.
> **No hay código escrito todavía.** Este documento es lo que hay que aprobar
> antes de empezar.
>
> Comprobado contra el repo el 20-08-2026, sobre `origin/main` en `5f788c5`.

---

## A. Qué hay hoy

Todo lo que el prompt marcaba **[verificado]** lo sigue estando, con **dos
salvedades** que salen abajo (A.3 y A.7) y que cambian el plan.

### A.1 El vigilante — `server/checkpointMail.ts`

Es exactamente el molde que hay que reutilizar:

- `revisarBuzonCheckpoint()` hace **una pasada** y se puede llamar a mano; el
  panel ya tiene el botón: `POST /api/tyrecontrol/checkpoint/revisar`
  (`server/index.ts:5581`).
- `startCheckpointMail()` arranca el temporizador (`server/index.ts:17340`) y
  **no arranca sin credenciales**.
- Busca `search({ seen: false })` y coge **los 20 primeros no leídos**.
- **Un correo que falla se queda SIN leer**; solo se marca `\Seen` lo que se
  procesó o se descartó. Es la lección de los dos días y se respeta entera.
- `avisar()` manda correo a `CHECKPOINT_AVISO_A` si hay SMTP; si no, el rastro
  se queda en la tabla.

Hoy `procesarCorreo()` devuelve `"importado" | "sin_adjunto" | "error"`, y
**todo lo que no trae adjunto se marca como leído sin dejar rastro**. Ése es
justo el camino por el que hoy se pierden los avisos de presión.

### A.2 El registro — `tc_checkpoint_ejecuciones`

Una fila por correo del **informe**, con `message_id` **único** (la migración
lo comprueba con un `raise exception`, no lo supone). Las columnas son del
informe: `mediciones`, `revisiones`, `altas`, `ya_cargados`, `sin_medir`.
Detalle importante del código: una fila en `estado='error'` **se borra antes de
reintentar**, porque el unique impediría insertar el reintento.

### A.3 El mapeo de la rueda — `src/modules/tyrecontrol/services/checkpoint.ts`

`senasPosicion(eje, posicion, ruedasDelEje)` devuelve `{codigo, lado,
interiorExterior}` y `codigoPosicion()` se apoya en ella.

**Salvedad 1 — no entiende el texto del aviso.** Busca `"izquierda"` y
`"derecha"` (femenino, como los escribe el Excel: *"Exterior izquierda"*). El
aviso escribe **`Eje 2 - izquierdo exterior`**: masculino y con el lado
delante. Hoy `senasPosicion(2, "izquierdo exterior", 4)` devuelve **`null`**.

El orden no importa (la función usa `includes`, no posiciones), así que la
ampliación es mínima: `includes("izquierd")` / `includes("derech")`. Se hace
**con test**, como pide el prompt.

### A.4 El respaldo por atributos

`importRevisiones.ts:141-145` y `checkpointImport.ts` buscan la posición
**primero por código** y, si el tipo usa otra nomenclatura (los sembrados en la
Fase 3 llaman `DEL_IZQ` a lo que aquí es `E1_IZQ`), **por las señas**: `eje`,
`lado`, `interior_exterior`. Mismo criterio aquí, más un tercer intento que
explico en E.2.

### A.5 Incidencias — `tc_incidencias` + `tc_incidencia_problemas`

- `tipo` ya incluye `presion_baja`: **no hace falta tipo nuevo**.
- `detectada_por uuid` es **nullable y sin FK** → el vigilante puede dejarlo a
  `null` sin tocar nada.
- `medicion_inicial jsonb` = `{profundidad_mm, presion_bar, estado_visual}`.
- La definición de **incidencia abierta** ya existe en el repo, en el RPC
  `tc_resolver_incidencia_parcial` (`tyrecontrol_fase35_incidencias_resolver.sql:137`):
  `estado not in ('solucionada','cancelada','no_procede')`. **Uso ésa**, no una
  mía.

La APK inserta **directamente** en las dos tablas
(`tyrecontrol_app/lib/services/supabase_service.dart:600` — el prompt decía 598,
son dos líneas de desplazamiento) con `detectada_por = auth.uid()`.

**Decisión: el servidor hace lo mismo, inserción directa con la clave de
servicio.** No monto un RPC `security definer`: la clave de servicio ya se salta
la RLS, un RPC no aportaría permiso ninguno, y `checkpointImport.ts` ya escribe
así todas las revisiones. La atomicidad que sí hace falta (que no se creen dos
incidencias a la vez) la resuelvo con un índice, no con un RPC (D.3).

### A.6 Hay presión objetivo nuestra

`tc_presiones_objetivo` + `tc_presion_objetivo(vehiculo, eje)` ya existen
(`fase35`). El correo trae *su* "Presión recomendada: 8.0 bar". Sirven para
contrastar, no para decidir: ver B.3.

### A.7 La pantalla — `src/modules/tyrecontrol/pages/Incidencias.tsx`

**Salvedad 2 — la pantalla da por hecho que toda incidencia viene de una
revisión.** Agrupa por `revision_id ?? "sin-" + vehiculo_id`, y la cabecera de
cada tarjeta imprime siempre `Revisión: {fecha}`. Una incidencia sin revisión
—que es exactamente lo que crea un aviso del arco— saldría como:

```
7851JNT
Revisión: Fecha no disponible
```

Y el botón dice *"Ver revisión"* (aunque navega al vehículo, así que no rompe).
Se arregla con tres líneas: E.3.

A favor: `listarIncidencias()` selecciona `"*"`, así que **una columna nueva
llega sola al panel**, sin tocar la consulta.

### A.8 La IA — `server/core/openaiService.ts`

`pedirIA()` es la única puerta: Responses API, modelo por variable de entorno,
**`esquema` con `json_schema` estricto**, reintentos y respaldo solo ante fallos
técnicos, y **nunca lanza**: devuelve `ok:false`. Encaja tal cual con lo que
necesito en C.

### A.9 Las pruebas

Vitest. **No hay ni un solo test en el repo que simule el cliente de Supabase**,
y el esquema de TyreControl **no está** en el arranque de pruebas con base de
datos (`vitest.setup.ts` solo levanta `server/db.ts` + `server/connect/schema.ts`;
las tablas `tc_*` viven en Supabase).

Consecuencia, y condiciona el diseño de E.2: **todo lo que decida algo tiene que
ser una función pura**. Lo que toque Supabase se queda en una capa fina de
lectura/escritura sin decisiones dentro.

---

## B. El analizador determinista

Módulo nuevo `server/tyrecontrol/avisoPresion.ts`: **sin base de datos, sin
red, sin IA**. Entra texto, sale un objeto o un fallo explicado.

### B.0 Antes de las expresiones: el cuerpo del correo

El correo lleva la marca Goodyear, así que casi seguro viene en **HTML** con las
etiquetas y los valores en celdas de una tabla. `simpleParser` da `text` (la
parte plana, si el emisor la manda) y `html`.

- Si hay `text`, se usa.
- Si no, `html` → texto plano: se quitan `<style>`/`<script>`, cada `</tr>`,
  `</p>`, `<br>`, `</td>` se convierte en salto o tabulador, se decodifican las
  entidades y se colapsan los espacios (incluido `&nbsp;`, que en estos correos
  aparece a montones).

**La trampa**: al aplanar una tabla, la etiqueta y su valor pueden quedar en
líneas distintas. Por eso cada campo se busca en dos pasadas: valor **en la
misma línea** y, si no, **en la siguiente**. Y en la segunda pasada el valor se
descarta si él mismo parece una etiqueta (`/^[\p{L} ]{2,30}:$/u`) — si no,
`Etiquetas:` (que en el ejemplo viene vacía) se comería `Fecha y hora:`.

> **Pregunta para Jordi (no bloquea):** mándame el `.eml` de uno de estos avisos
> tal cual (reenviar como adjunto). Con el original ajusto esto de una vez en
> lugar de defenderme de las dos formas.

### B.1 Reconocer que ES un aviso — `esAvisoPresion(asunto, texto)`

Por lo que **es**, no por lo que le falta (§4). Exige las dos cosas:

1. **Asunto**: `/presi[óo]n\s+baja/i`.
2. **Plantilla**: al menos **tres** de estos marcadores en el cuerpo:
   `Matrícula:`, `Rueda:`, `Presión bruta:`, `Presión recomendada:`,
   `Nombre de CheckPoint:`.

Y el informe semanal se reconoce como hasta hoy, por `esAdjuntoInforme()`. Las
dos puertas son **estrechas y excluyentes**: el informe se comprueba primero, y
un correo con adjunto `.xlsx` nunca entra por la puerta del aviso aunque el
asunto encaje. Lo que no pase ninguna de las dos, se ignora sin ruido.

### B.2 Los campos

`num()` acepta coma o punto (`5,5` y `5.5`), como el `num()` que ya hay en
`checkpoint.ts`.

| Campo | De dónde | Expresión | Si falta |
|---|---|---|---|
| `rango` | 1ª línea | `/rango\s+([\wíáéó]+)/i` | **leve** + observación (§3.2) |
| `umbralPct` | 1ª línea | `/debajo\s+(?:de\s+)?([\d.,]+)\s*%/i` | se anota, no decide |
| `matricula` | `Matrícula:` | valor → mayúsculas, `/^[A-Z0-9]{6,10}$/` tras quitar guiones y espacios | **fallo explícito** |
| `idFlota` | `ID de flota:` | valor tal cual | null (solo contrasta) |
| `eje`,`lado`,`intExt` | `Rueda:` | `/eje\s*(\d+)/i` + `includes("izquierd"/"derech")` + `includes("interior"/"exterior")` | **fallo explícito** si no hay eje o lado |
| `medidoAt` | `Fecha y hora:` | `/(\d{1,2})[./-](\d{1,2})[./-](\d{4})\D{1,4}(\d{1,2}):(\d{2})(?::(\d{2}))?/` | **fallo explícito** |
| `presionRecomendadaBar` | `Presión recomendada:` | `/(-?[\d.,]+)\s*bar/i` | null (ver B.3) |
| `presionBar` | `Presión bruta:` | `/(-?[\d.,]+)\s*bar/i` | **fallo explícito** |
| `desviacionPct` | `Presión bruta:` | `/\(\s*([+-]?[\d.,]+)\s*%\s*\)/` | null; el signo se guarda tal cual |
| `checkpoint` | `Nombre de CheckPoint:` | valor tal cual | null (va a observaciones) |
| `Etiquetas:` | — | **se ignora** | — |

**Cordura, además de forma.** Una presión fuera de `0 < p < 20` bar o un eje
fuera de `1..5` **no se acepta**: se trata como plantilla cambiada. Un número
que se ha cogido del sitio equivocado es peor que no tener número.

**El fallo es explícito y entero.** `leerAvisoPresion()` devuelve
`{ ok: true, aviso }` o `{ ok: false, faltan: ["matricula", "presionBar"] }`.
**Nunca campos a medias**: si falta uno obligatorio no se devuelve ninguno, y
`faltan` es lo que se escribe en el registro y en el correo de aviso.

### B.3 Dos números que no deciden nada, pero se contrastan

- **`Presión recomendada` del correo vs `tc_presion_objetivo(vehiculo, eje)`.**
  Si difieren más de 0,5 bar, va a las observaciones de la incidencia: significa
  que la ficha del arco y la nuestra no dicen lo mismo, y eso lo tiene que ver
  una persona. No cambia nada más.
- **`desviacionPct`.** Se guarda tal cual. **No** se recalcula ni se usa para
  decidir gravedad (§3.2).

### B.4 La hora, que tiene trampa

`19.08.2026 · 22:13:23` **no dice zona**. El servidor de Render corre en UTC:
interpretarla con `new Date(2026, 7, 19, 22, 13, 23)` la guardaría dos horas
tarde en agosto. Uso el mismo criterio que ya usa la agenda
(`server/index.ts:11857`, `zonedDateTimeToUtcMs` con `Europe/Madrid`): la
plantilla es española, el arco está en La Plana.

Además, red de seguridad: si la fecha del aviso se aparta **más de 7 días** de
la fecha del propio correo, no se descarta el aviso, pero se anota. Es la señal
barata de que he leído el campo equivocado.

---

## C. El papel de la IA

**Confirmado el planteamiento del §1: la IA no extrae los campos.** El correo
es plantilla; `Matrícula: 7851JNT` con una expresión regular es determinista,
gratis y comprobable con un test. Un modelo ahí solo añade coste, latencia y la
posibilidad de inventarse una matrícula, y una incidencia con la matrícula
equivocada manda al técnico al camión que está bien y deja al de 5,5 bar sin
avisar. Va escrito en la cabecera del módulo, no solo aquí.

**Dónde entra, entonces:**

1. **Red para el correo que no encaja.** Un correo que `esAvisoPresion()`
   reconoce pero `leerAvisoPresion()` no sabe leer → `pedirIA()` con
   `esquema` estricto, `proposito: "documento"`, y **un campo `no_se: boolean`
   en el esquema** para que el modelo pueda decir que no sabe en vez de
   rellenar huecos. Lo que salga se guarda con `origen_datos = 'ia'`.
2. **`accion_recomendada`.** Se redacta **siempre** una frase determinista a
   partir de números ya extraídos ("Inflar a 8,0 bar. Está a 5,5 bar, un 31%
   por debajo; si vuelve a bajar, buscar pérdida"). Si hay `OPENAI_API_KEY`, la
   IA la pule **solo al crear** la incidencia, nunca en los avisos repetidos, y
   si falla se queda la determinista. La IA redacta; los números ya están.

**Y aquí necesito que decidas tú, porque el prompt marca el límite pero no el
lado (§1: "no se da por bueno sin que una persona lo confirme"):**

> **Cuando la IA sí consigue leer un correo que la plantilla no reconoce,
> ¿creamos la incidencia marcada como sin confirmar, o solo avisamos?**
>
> - **(a) Solo avisar — mi recomendación.** Se registra el aviso con los campos
>   que la IA cree haber leído y `estado='pendiente_confirmacion'`, y sale un
>   correo a `CHECKPOINT_AVISO_A` con lo extraído. **No se crea incidencia.**
>   Motivo: una incidencia sin confirmar en la pantalla es exactamente el dato
>   falso que todo este diseño evita, y hoy no hay ninguna pantalla donde
>   confirmarla. Y no empeora nada respecto a hoy: hoy esos correos también los
>   lee una persona; la diferencia es que ahora suena una alarma en vez de
>   pasar desapercibidos.
> - **(b) Crear la incidencia marcada.** Aparece sola, con distintivo de "sin
>   confirmar". Se ve antes, pero puede llevar una matrícula inventada.
>
> Si no dices nada, hago **(a)**.

---

## D. La deduplicación

### D.1 La regla

Antes de crear nada, se busca una incidencia **abierta** —`estado not in
('solucionada','cancelada','no_procede')`, la definición que ya usa la Fase 35—
del **mismo vehículo**, la **misma posición** y con un problema **`presion_baja`
abierto**. Si la hay: **no se crea otra, se actualiza**.

Ojo a un detalle deliberado: la búsqueda **no filtra por origen**. Si un técnico
abrió ayer la incidencia de presión baja de esa misma rueda con la APK, el aviso
del arco **se engancha a la suya** en vez de duplicarla. Es el mismo problema
físico; que lo haya visto antes una persona no lo convierte en otro.

### D.2 Dónde se anota la repetición

**Tabla propia, `tc_avisos_presion`, una fila por correo, con FK a la
incidencia.** Descarto las otras dos opciones del §3.1:

- *Un contador en la incidencia* → dice cuántas veces, no **cuándo** ni **con
  qué presión**. "Lleva cinco días" y "cinco avisos, el primero a 5,5 y el
  último a 4,8" no son la misma información, y la segunda es la que decide si
  esa rueda pierde aire o es un pinchazo lento.
- *Todo en `motivo_observacion`* → un texto que crece sin límite y del que no se
  puede consultar nada.

Con la tabla, el histórico **es** la tabla y el resumen se **recalcula** (no se
acumula) en la incidencia en cada aviso, así que no puede desviarse del hecho:

```
motivo_observacion = "Aviso del arco repetido 5 veces entre el 19/08 y el
23/08. Última medición: 4,8 bar (-40%), rango crítico. CheckPoint:
Soledad // La Plana."
```

**El caso de los cinco días, entero:**

| Día | Qué llega | Qué pasa |
|---|---|---|
| 1 | Aviso 5,5 bar | Fila en `tc_avisos_presion`. **Se crea** la incidencia: `presion_baja`, `E2_IZQ_EXT`, `gravedad='critica'`, `medicion_inicial={presion_bar:5.5}`, `origen='checkpoint_aviso'` |
| 2–5 | Mismo aviso | Cuatro filas más, todas apuntando a **la misma incidencia**. En la pantalla **sigue habiendo una** |
| | | `medicion_inicial` **no se toca**: es la inicial, y el nombre no miente |
| | | `motivo_observacion` se regenera con el recuento y la última medición |
| | | `gravedad_auto` = la del último aviso; `gravedad` **solo sube**, nunca baja (ver abajo) |
| | | `updated_at` se mueve solo (ya hay trigger) |

**Por qué la gravedad solo sube:** si el lunes es "crítico" y el martes llega
"aviso", la rueda no ha mejorado por sí sola — o le han metido aire (y entonces
alguien cerrará la incidencia) o el arco ha leído distinto. Bajar la gravedad
sola escondería un problema que sigue ahí.

**Criterio C del §6 sale gratis:** si alguien la soluciona, la incidencia deja
de estar abierta, la búsqueda de D.1 no la encuentra y el aviso de la semana
siguiente **crea una nueva**. El problema volvió a aparecer, y eso es un hecho
distinto.

### D.3 Dos redes más, contra dos cosas distintas

- **El mismo correo dos veces** (el buzón lo repite al reconectar):
  `tc_avisos_presion.message_id` **único**. Misma solución que ya funciona en
  `tc_checkpoint_ejecuciones`.
- **Dos avisos a la vez** (dos correos en la misma pasada, o dos instancias del
  servidor): un **índice único parcial**, para que sea la base de datos la que
  lo impida y no el orden en que se ejecute el código:

```sql
create unique index if not exists ux_tc_incidencias_aviso_abierta
  on tc_incidencias (vehiculo_id, posicion_id)
  where origen = 'checkpoint_aviso'
    and estado not in ('solucionada','cancelada','no_procede');
```

Sólo alcanza a las filas del arco (`origen`), así que **no puede romper nada de
lo que hace la APK hoy**, y sólo a las abiertas, así que no estorba al criterio
C. Vale porque estas incidencias siempre llevan `posicion_id` (si no sabemos la
posición no se crea incidencia, D.4) y en un índice único los `null` no chocan
entre sí.

### D.4 Cuando no se puede crear

Todo esto deja fila en `tc_avisos_presion` **y** manda correo, y **no** crea
incidencia:

| Situación | `estado` de la fila |
|---|---|
| La matrícula no está en TyreControl (§3.3) | `sin_vehiculo` |
| La matrícula está en dos empresas | `vehiculo_ambiguo` |
| El tipo del vehículo no tiene esa posición | `sin_posicion` |
| Plantilla cambiada y la IA tampoco sabe | `no_reconocido` |
| La IA sí supo, opción (a) de C | `pendiente_confirmacion` |

**Nunca se da de alta un vehículo desde un aviso** (§3.3): un aviso no trae
configuración de ejes ni medidas, y el importador del informe semanal sí puede
darlo de alta con esos datos cuando toque.

Si el `ID de flota` del correo no cuadra con `numero_unidad` del vehículo que
casó por matrícula, **la incidencia se crea igual** (la matrícula manda) pero se
anota en las observaciones.

---

## E. Cambios mínimos

### E.1 Base de datos — una migración, `tyrecontrol_avisos_presion.sql`

Idempotente y terminada en el bloque `do $$ ... raise exception` que exige
`CLAUDE.md`, comprobando lo que promete: que existen las dos columnas, la tabla
y —como ya hace la migración del correo con su unique— **que el índice único
parcial existe**, porque es lo que impide la incidencia duplicada.

1. `alter table tc_incidencias add column if not exists origen text`
   con `check (origen is null or origen in ('revision','checkpoint_aviso'))`.
   Nullable: las filas de hoy se quedan como están y la APK no se toca.
2. El índice único parcial de D.3.
3. `create table if not exists tc_avisos_presion (...)`: `message_id` **unique**,
   `incidencia_id` FK, `empresa_id`, `vehiculo_id`, `posicion_id`, los campos
   leídos (`matricula`, `id_flota`, `eje`, `lado`, `int_ext`, `presion_bar`,
   `presion_recomendada_bar`, `desviacion_pct`, `rango`, `umbral_pct`,
   `medido_at`, `checkpoint`), `origen_datos ('plantilla'|'ia')`, `estado`,
   `faltan jsonb`, `cuerpo` (recorte del correo, solo para los no reconocidos),
   `aviso_enviado`, `created_at`. RLS igual que `tc_checkpoint_ejecuciones`:
   escribe el servidor con la clave de servicio, el panel solo lee lo suyo.

**Y `tc_checkpoint_ejecuciones` no se toca.** El §2 preguntaba si otra tabla o
la misma con una columna de tipo; va aparte porque sus columnas son del informe
(`mediciones`, `revisiones`, `altas`, `sin_medir` serían cinco ceros en cada
aviso), porque cada rama del vigilante se queda con su propia puerta anti-doble
—y la clasificación es determinista, así que un correo dado siempre entra por la
misma— y sobre todo porque **el camino del informe semanal ya funciona y no
tiene por qué moverse** para que entre esto.

### E.2 Servidor — tres ficheros nuevos y dos tocados

| Fichero | Qué |
|---|---|
| `server/tyrecontrol/avisoPresion.ts` **(nuevo)** | **Puro.** `esAvisoPresion()`, `textoPlano()`, `leerAvisoPresion()`, `gravedadDeRango()`, `accionRecomendadaBase()` y `decidirAviso(existente, aviso)` → `{ accion: 'crear' \| 'actualizar', ... }`. Aquí vive **toda** la decisión, y por eso se puede probar entera sin base de datos (A.9) |
| `server/tyrecontrol/avisoPresion.test.ts` **(nuevo)** | Lo de §5, ver E.4 |
| `server/tyrecontrol/avisoPresionIncidencia.ts` **(nuevo)** | La capa fina de Supabase: casar vehículo, resolver posición, montaje actual, buscar la abierta, crear/actualizar, escribir `tc_avisos_presion`. **Sin decisiones dentro**: pregunta a `decidirAviso()` |
| `server/checkpointMail.ts` | `procesarCorreo()` pasa a **clasificar primero** (informe / aviso / otro) y a repartir. El bucle, el temporizador, el apagado sin credenciales y la regla del correo que falla **no se tocan** |
| `src/modules/tyrecontrol/services/checkpoint.ts` | `senasPosicion`: `"izquierda"→"izquierd"`, `"derecha"→"derech"`. Dos caracteres, con sus tests (A.3) |

**Resolver la posición** (tres intentos, en este orden):
1. Por código exacto: `E2_IZQ_EXT`.
2. Por señas `(eje, lado, interior_exterior)` — el respaldo de A.4, el que
   salva a los tipos que llaman `DEL_IZQ` a `E1_IZQ`.
3. Si el aviso dijo interior/exterior y el tipo tiene ese eje **de rueda
   simple**, por `E{eje}_{LADO}` — es la trampa nº 3 del arco (manda cuatro
   huecos por eje y mete la rueda única en el "Interior"), aquí vista desde el
   otro lado.

Si ninguno acierta: `sin_posicion`, aviso, y **no se inventa una posición**.

**Marcar leído: quién sí y quién no.** La regla de oro se mantiene, pero hay que
distinguir dos fallos que no son iguales:

- **Fallo pasajero** (Supabase caído, IMAP cortado, la IA sin respuesta) → el
  correo **se queda sin leer** y se reintenta solo. Criterio G.
- **Fallo determinista** (plantilla cambiada, matrícula que no existe) →
  reintentar mil veces da mil veces lo mismo. Se **registra**, se **avisa una
  vez** y se **marca leído**. El correo sigue en el buzón para quien lo mire.

Y esto no es una preferencia estética: `revisarBuzonCheckpoint()` coge **los 20
primeros no leídos**. Veinte avisos que no se puedan leer y se queden sin marcar
taparían el informe semanal detrás de ellos.

**Variables de entorno: ninguna nueva** (§4). Se reutilizan `CHECKPOINT_IMAP_*`
y `CHECKPOINT_AVISO_A`. En `.env.example` solo cambia el comentario de
`CHECKPOINT_AVISO_A`, para decir que ahora también recibe los avisos de presión
que no se han podido procesar.

**Y una que no es código:** la regla de reenvío desde el Gmail con la etiqueta
`Goodyear-Plana` hacia `tyrecontrol@mobilink.es` **la pone Jordi**. Sin ella no
llega nada y el sistema no tiene forma de notarlo (F.6).

### E.3 Panel — `Incidencias.tsx`, tres líneas

`listarIncidencias()` ya trae `origen` (selecciona `"*"`), así que no hay que
tocar `data.ts`:

1. En `parse()`, leer `row.origen` y `row.motivo_observacion`.
2. En la cabecera del grupo: si no hay revisión, `Aviso del arco · 19/08/2026`
   en lugar de `Revisión: Fecha no disponible`, y el botón dice **Ver
   vehículo** (que es a donde ya navega).
3. Bajo los problemas, mostrar `motivo_observacion` cuando lo haya: ahí es donde
   se lee *"repetido 5 veces, última 4,8 bar"*.

Nada más. No hay pantalla de configuración nueva, ni pestaña nueva: la
incidencia del arco es una incidencia y va donde van las demás.

### E.4 Pruebas

Todas sobre funciones puras, que es lo que permite A.9:

- El correo del §0 **entero**, con sus valores exactos: `7851JNT`, eje 2,
  izquierdo exterior → `E2_IZQ_EXT`, 5,5 bar, -31,08%, rango crítico →
  `critica`, 19-08-2026 22:13:23 en Europe/Madrid.
- El mismo correo **en HTML** (tabla aplanada, valor en la línea siguiente).
- `5,5 bar` con coma **y** `5.5` con punto.
- Presión **sin** porcentaje, y con el porcentaje **en positivo**.
- Fecha `19.08.2026 · 22:13:23` y las variantes con `/`, con `-` y sin segundos.
- `Etiquetas:` vacía **no** se come `Fecha y hora:`.
- **El informe semanal**: `esAvisoPresion()` = false. **Publicidad**: false.
- **Plantilla cambiada**: `{ ok:false, faltan:[...] }`, y **ni un campo suelto**.
- Cordura: `55 bar` y `Eje 9` se rechazan.
- `senasPosicion` con `"izquierdo exterior"`, `"Exterior izquierda"` y
  `"derecho interior"`.
- **Dedup**: `decidirAviso(null, a)` → `crear`; `decidirAviso(abierta, a)` →
  `actualizar` con el resumen regenerado; `decidirAviso(solucionada, a)` →
  `crear`; gravedad que sube; gravedad que **no** baja.

Del SQL, lo que se puede probar sin base de datos es que la migración
**comprueba lo que promete**: el bloque final falla si falta el índice único
parcial. El esquema `tc_*` no está en el arranque de pruebas (A.9), así que
montar ahí una prueba de integración sería montar medio TyreControl para un
índice; lo digo abiertamente en vez de simularlo.

### E.5 Entrega

`package.json` 1.8.24 → 1.8.25 (los `pubspec.yaml` **no se tocan**, los lleva
CI). `bash scripts/check-versions.sh` antes de cada commit y de cada push, y
`npx tsc -b` **y** `npx tsc -p tsconfig.server.json`, los dos.

---

## F. Riesgos

**F.1 — El correo cambia de formato.** El día que Goodyear rediseñe la
plantilla, el analizador deja de leer. *Qué pasa entonces:* no se inventa nada
—falla entero, nunca a medias (B.2)—, la IA lo intenta, se registra
`no_reconocido` y **sale un correo**. El fallo es ruidoso, que es la única
forma aceptable de fallar en algo que nadie mira. *Lo que no cubre:* si además
cambia el **asunto**, `esAvisoPresion()` ni siquiera lo reconoce y el correo se
ignora en silencio, como hoy. Contra eso solo hay una defensa razonable: F.6.

**F.2 — La matrícula no casa.** No se crea nada, no se da de alta nada, fila
`sin_vehiculo` y correo (§3.3). El riesgo real que queda es más fino: el arco
escribe la matrícula con un formato distinto (`7851 JNT`, `7851-JNT`). Por eso
la comparación se hace sobre la matrícula **normalizada** —sin espacios ni
guiones, en mayúsculas—, y no solo con el `trim().toUpperCase()` que hace hoy el
importador.

**F.3 — El tipo del vehículo no tiene esa posición.** Los tres intentos de E.2
cubren las dos nomenclaturas del repo y la rueda única del arco. Si aun así no
está, `sin_posicion` y correo: **no se crea la incidencia colgando de una
posición aproximada**, porque una incidencia en la rueda equivocada es peor que
ninguna incidencia.

**F.4 — Avisos repetidos.** Es el riesgo que más se ha trabajado (D). Dos redes
independientes: la regla de negocio (D.1) y el índice único parcial (D.3), que
sigue valiendo aunque dos procesos corran a la vez. Lo que **no** cubre: si
alguien cierra la incidencia sin arreglar la rueda, el siguiente aviso abre una
nueva. Es correcto —el problema seguía— pero conviene saberlo.

**F.5 — La hora sin zona.** Detallado en B.4. Sin el ajuste a `Europe/Madrid`,
en verano toda medición entra dos horas tarde, y es un fallo silencioso: nadie
mira el segundero de una incidencia hasta que hay que reconstruir qué pasó.

**F.6 — El silencio.** Si Jordi cambia la regla de reenvío, o Goodyear deja de
mandar, o el buzón se llena, **no llega nada — y nada es exactamente lo que se
ve cuando todo va bien**. Es el fallo más peligroso de todos porque no produce
ningún error. No lo meto en esta fase (no está en el encargo), pero lo dejo
apuntado: la defensa es una comprobación semanal de "hace N días que no entra
ningún correo del CheckPoint", que serviría igual para el informe.

**F.7 — La IA se inventa un aviso.** Acotado por diseño: con la opción (a) de C
la IA **no puede crear una incidencia**, solo llenar una fila marcada
`origen_datos='ia'` y disparar un correo. Con la opción (b), sí puede — por eso
la pregunta está en C y no la decido yo.

**F.8 — Un correo que no se puede procesar tapa el buzón.** Explicado en E.2:
por eso el fallo determinista marca leído y el pasajero no.

---

## Lo que necesito de ti para seguir

1. **Aprobar el análisis** (o decirme qué cambia).
2. **La pregunta de C**: ¿la IA crea incidencia marcada como sin confirmar
   (b), o solo avisa (a)? Si no dices nada, hago **(a)**.
3. **Cuando puedas y sin que bloquee**: el `.eml` original de un aviso
   (reenviado como adjunto) y, si tienes alguno, un aviso de un rango que **no**
   sea "crítico" — hoy el mapeo de gravedad solo conoce esa palabra con
   certeza, y cualquier otra se guardará como `leve` con su nota, que es lo que
   manda el §3.2 pero no es lo que querríamos para siempre.
