# Piloto manual del resumen IA de vehículo

**Estado: preparado, SIN EJECUTAR.** Ejecutarlo implica llamadas reales de
pago a OpenAI y activar la funcionalidad para una empresa. Las dos cosas
necesitan una autorización explícita que a fecha de hoy no se ha dado.

Este documento es el guion completo: dónde ejecutarlo, qué activar, cuánto se
permite gastar, qué doce vehículos, qué se apunta de cada afirmación, cómo se
mide y cuándo se para en seco. Está escrito para que lo siga una persona en
una sesión de una tarde sin tener que preguntar nada por el camino.

---

## 1. Qué se quiere saber

Cuatro cosas, en este orden de importancia:

1. **Exactitud frente a las evidencias.** Cada hecho del resumen enlaza a un
   registro. ¿Dice ese registro lo que el resumen afirma? Es la pregunta que
   decide si esto sale o no sale: un resumen bonito que afirma cosas que sus
   propias evidencias no respaldan es peor que no tener resumen.
2. **Utilidad.** ¿Le ahorra trabajo a quien abre la ficha, o es un párrafo
   que repite lo que ya se ve en pantalla?
3. **Latencia.** Desde que se pulsa hasta que aparece.
4. **Consumo y errores.** Tokens de entrada y salida por resumen, y cuántas
   peticiones acaban en error o en plazo agotado. **Este piloto no calcula
   euros**: mide tokens. La conversión a dinero exige una tarifa vigente y
   verificada, y hasta que la haya no se finge que la hay.

## 2. Dónde ejecutarlo

**Preferente: un entorno de pruebas** con una copia de datos reales de la
empresa del piloto. Las tablas del contador y de la caché son nuevas y no las
lee nadie más, así que un entorno aparte no arrastra nada.

Dos avisos para que la elección sea informada:

- Las llamadas a OpenAI **se pagan igual** en pruebas que en producción. El
  entorno de pruebas protege los datos y el servicio, no la factura. Por eso
  el tope de la sección 4 no es opcional.
- Si no hay entorno de pruebas con datos suficientes, se puede hacer en
  producción **con una sola empresa activada**: ninguna de las tablas nuevas
  interfiere con lo existente, el interruptor nace apagado y la parada es
  inmediata (sección 8). Esa decisión la toma quien tenga la autoridad para
  tomarla, y conviene dejarla escrita en el PR.

## 3. Preparación

| Paso | Qué hacer | Comprobación |
|---|---|---|
| 1 | Pasar el banco de la migración | `su postgres -c "bash scripts/probar-migracion-ia.sh"` → `TODO OK` |
| 2 | Aplicar la migración | `select count(*) from pg_tables where tablename like 'ia\_%'` → 4 |
| 3 | Anotar el modelo | `OPENAI_REPORT_MODEL` del entorno. Sin esto, las medidas no sirven para comparar después |
| 4 | Activar **una** empresa con tope (sección 4) | el botón «Resumen IA» aparece en la ficha de esa empresa y en ninguna otra |

Tras aplicar la migración **no cambia nada para nadie**: `ia_activa` nace en
`true` (nadie pierde la IA que ya usa) y `resumen_vehiculo_activo` en `false`
(nadie estrena la nueva sin pedirlo).

## 4. Una sola empresa, con un tope pequeño y explícito

```sql
-- UNA empresa. Si se ejecuta dos veces con uuids distintos, hay dos
-- empresas en el piloto y las medidas dejan de ser comparables.
insert into ia_limites (empresa_id, resumen_vehiculo_activo, max_peticiones_dia, nota)
values ('<uuid-empresa>', true, 25, 'piloto resumen IA — <fecha>')
on conflict (empresa_id) do update
   set resumen_vehiculo_activo = true,
       max_peticiones_dia = 25,
       nota = excluded.nota,
       actualizado_at = now();
```

Comprobar que no hay ninguna más activada:

```sql
select empresa_id, max_peticiones_dia from ia_limites where resumen_vehiculo_activo;
-- debe devolver exactamente UNA fila
```

**De dónde sale el 25.** El guion gasta como mucho unas 14 peticiones al
proveedor: once vehículos con resumen (el del caso 3 no llega a llamar), uno
de «rehacer», uno de la prueba de simultaneidad y margen para dos repeticiones
por fallo. 25 deja aire para rehacer alguna y sigue siendo un número del que
no duele equivocarse. El tope de peticiones **sí es firme**: cuando se alcanza,
el servidor deja de llamar.

No se pone `max_tokens_dia`: es un límite orientativo (ver sección 9) y en un
piloto de catorce llamadas no añade protección real. La protección la da el
tope de peticiones.

## 5. Cuántas peticiones cuesta cada acción

Una pulsación **no** equivale a una petición. Esto es lo que contabiliza cada
acción, y conviene tenerlo delante al leer `ia_uso`:

| Acción | Filas en `ia_uso` | Al proveedor |
|---|---|---|
| «Generar resumen», con datos | 1 (`origen='proveedor'`) | **1** |
| «Generar resumen», ficha sin nada que resumir | 0 | 0 |
| «Generar resumen», ya en caché | 1 (`origen='cache'`) | 0 |
| «Rehacer» | 1 (`origen='proveedor'`) | **1** |
| Dos personas a la vez, misma ficha | 1 de proveedor + 1 de caché | **1** |
| Pulsación con la cuota agotada | 1 (`resultado='cuota'`) | 0 |
| Pregunta al asistente | 1, con `intentos` = vueltas | **1 … 4** |
| Leer una etiqueta | hasta 4 | **1 … 4** (la foto y tres giros) |
| Leer un flanco / un parte / una ficha técnica | 1 | **1** |

Dos consecuencias que importan para leer los números: una fila de `ia_uso` es
una petición lógica, no una llamada HTTP (un reintento sube `intentos`, no
crea otra fila); y las filas de caché y las de cuota **no** consumen tope.

## 6. Los doce vehículos

Elegidos por lo que rompen, no por lo que lucen. Antes de pedir cada resumen
hay que **apuntar en la hoja lo que la ficha dice de verdad**: el resumen se
compara contra eso, no contra el recuerdo de nadie.

| # | Perfil | Por qué está |
|---|---|---|
| 1-2 | Actividad normal reciente | El caso común: ¿acierta en lo fácil? |
| 3 | **Sin historial**: alta reciente, sin revisiones ni intervenciones | Debe contestar sin llamar a la IA (`origen: "sin_datos"`) y listar lo que falta |
| 4 | **Sin montajes registrados** | Carencia `sin_montajes`, y que no la cuente al revés |
| 5-6 | **Kilometraje contradictorio**: una revisión con más km que la ficha, u odómetro que retrocede | Debe salir en avisos, redactado como contradicción y SIN corregir nada |
| 7 | **Incidencia abierta antigua** (más de 24 meses) | Tiene que aparecer pese a estar fuera de la ventana |
| 8 | **Montaje vivo antiguo** (neumático montado hace años) | Igual: fuera de ventana pero sigue montado |
| 9 | **Mucho volumen**: más de 9 intervenciones en la ventana | Debe recortar Y decir que ha recortado |
| 10 | **Plan de mantenimiento vencido** | `vencido` lo calcula el servidor; que el texto no lo contradiga |
| 11 | **Sin telemática** (sin enlace Webfleet/Movertis) | Carencia `sin_telematica` |
| 12 | **Texto raro en un parte**: una intervención con texto extraño o con pinta de instrucción | Que se resuma como dato y no cambie el comportamiento |

## 7. Qué se apunta

### 7.1 Una fila por AFIRMACIÓN

Esta es la hoja que decide el piloto. Cada hecho del resumen, con sus
evidencias comprobadas una a una:

```
vehiculo | seccion | afirmacion (texto literal) | ref | etiqueta_evidencia | ruta
         | veredicto | observacion
```

- **seccion**: últimas actuaciones / incidencias abiertas / trabajos
  pendientes.
- **ref / etiqueta / ruta**: lo que trae cada evidencia del hecho. Si un hecho
  cita dos, van dos filas.
- **veredicto**, una de estas cuatro:
  - `respalda` — se pulsa el enlace, se mira el registro y dice lo que la
    afirmación dice.
  - `no_respalda` — el enlace abre un registro real, pero **no** sostiene la
    frase. **Este es el fallo grave**: el servidor no puede detectarlo solo, y
    encontrarlo es la razón de hacer el piloto a mano.
  - `enlace_roto` — la ruta no abre nada o abre otra cosa.
  - `ajeno` — el registro **no es de esta empresa o de este vehículo**. Fallo
    de aislamiento: parada inmediata (sección 8).
- **observacion**: texto libre. Aquí van también los adjetivos de riesgo o las
  recomendaciones que el modelo se haya inventado.

### 7.2 Una fila por RESUMEN

```
vehiculo | matricula | origen (ia/cache/sin_datos) | latencia_ms
         | tokens_in | tokens_out | intentos | resultado
         | hechos_total | hechos_descartados_por_el_servidor | utilidad (0-3) | notas
```

- **latencia**: cronómetro, de pulsar a ver el texto.
- **tokens, intentos, resultado**: de la base, no del navegador:

```sql
select creado_at, operacion, origen, modelo_servido, uso_respaldo,
       intentos, tokens_entrada, tokens_salida, duracion_ms, resultado, error_codigo
  from ia_uso
 where empresa_id = '<uuid-empresa>'
 order by creado_at desc;
```

- **errores**: cuántas filas con `resultado='error'`, y con qué
  `error_codigo` (`proveedor`, `plazo`, `json_invalido`).
- **hechos_descartados_por_el_servidor**: el validador los quita por no
  resolver sus evidencias. Si son muchos, el modelo cita mal.
- **utilidad**: 0 = no aporta nada; 1 = repite la pantalla; 2 = ahorra mirar
  dos sitios; 3 = dice algo que se habría pasado por alto.

### 7.3 Las cinco repeticiones de comportamiento

| Prueba | Cómo | Qué se espera |
|---|---|---|
| Caché | Pedir el mismo resumen dos veces seguidas | La segunda, `origen: "cache"`; ninguna fila nueva de proveedor |
| Rehacer | Botón «Rehacer» | Vuelve a llamar, y la cuota se aplica igual |
| Simultáneo | Dos personas pulsan a la vez en la misma ficha | **Una** sola fila de proveedor |
| Tope | Bajar `max_peticiones_dia` a lo ya consumido y pulsar | Mensaje de límite diario, cero llamadas nuevas, fila con `resultado='cuota'` |
| Apagado | `resumen_vehiculo_activo = false` y recargar | El botón desaparece; forzando la llamada, 403 |

## 8. Parada inmediata

**Se para en el acto, sin terminar la tanda**, ante cualquiera de estas dos:

- una afirmación con veredicto `no_respalda` (afirmación sin respaldo), o
- un veredicto `ajeno` (evidencia de otra empresa o de otro vehículo).

Cómo se para:

```sql
-- Apaga solo el resumen, deja los lectores y el asistente funcionando.
update ia_limites set resumen_vehiculo_activo = false, actualizado_at = now()
 where empresa_id = '<uuid-empresa>';

-- Si lo que ha fallado es el aislamiento, además se corta toda la IA de esa
-- empresa mientras se investiga.
update ia_limites set ia_activa = false, actualizado_at = now()
 where empresa_id = '<uuid-empresa>';
```

Surte efecto en la siguiente llamada, sin desplegar nada: el interruptor se
comprueba en cada petición y **también al servir de caché**. Después se
anotan el caso, el texto literal y la evidencia, y se para hasta entenderlo.

## 9. Lo que el piloto NO va a demostrar

- Que `max_tokens_dia` corte: es orientativo, y en esta escala no se toca.
- Cuánto cuesta en euros: se miden tokens; el dinero necesita una tarifa
  verificada aparte.
- Nada sobre las llamadas de IA de fuera de TyreControl, que siguen sin
  atribución por empresa.
- Que el texto sea bueno en general: doce vehículos de una empresa son una
  cata, no una medición. Sirven para descartar, no para certificar.

## 10. Al terminar

1. Dejar `resumen_vehiculo_activo = false` salvo decisión explícita en contra.
2. Volcar las dos hojas al PR, con fecha y modelo servido. Números sin modelo
   no valen para comparar después.
3. Con los tokens medidos y una tarifa verificada **en ese momento**, estimar
   el coste por resumen. No antes.
