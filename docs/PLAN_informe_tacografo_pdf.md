# Informes técnicos de tacógrafo en PDF, adjuntos a la ficha

> Plan para discutir ANTES de programar. Lo que sigue no es código escrito ni
> prometido: es lo que se ha medido en los cinco PDF de ejemplo y en la base de
> producción, las trampas que se han encontrado, las decisiones que hay que
> tomar y el orden en que se haría.

## 1 · Lo que se pide

Literalmente:

> «Son informes de tacógrafos, quiero que los adjuntes a la ficha del vehículo
> y si la revisión no está dada de alta la des de alta importando los datos del
> informe, al lado de la revisión un clip para ver y descargar el informe.
> También, si adjunto un PDF de una revisión ya grabada en la ficha,
> únicamente que la adjunte para poder consultar.»

Son, por tanto, **tres cosas** y en este orden de importancia:

1. **Guardar el PDF** y poder abrirlo desde la ficha del vehículo (el clip).
2. **Reconocer si esa intervención ya está** en el histórico. Si está: solo se
   adjunta. Si no está: se crea, con los datos del propio informe.
3. Que las dos vías —el Excel mensual del centro y el PDF suelto— acaben en la
   misma tabla sin duplicar ni pisarse.

## 2 · Lo que ya hay, y que no se va a reinventar

| Pieza | Dónde | Estado |
|---|---|---|
| Tabla de intervenciones | `tc_tacografo_intervenciones` | **1.744 filas** en producción, 52 columnas |
| Identidad de una intervención | `unique (empresa_id, sistema_origen, id_origen)` | ya creada |
| Importador del Excel del centro | `server/tyrecontrol/tacografo/{parser,importar,escribir}.ts` | en producción |
| Lotes y deshacer | `tc_tacografo_lotes`, `deshacer.ts` | 1 lote aplicado |
| Cálculo de vencimiento | `vencimiento.ts`, `control.ts` | la ficha y la pantalla de control usan el MISMO módulo |
| Sección Tacógrafo de la ficha | `src/modules/tyrecontrol/components/SeccionTacografo.tsx` | con el histórico, donde va el clip |
| Documentos de vehículo | `tc_vehiculo_documentos` + bucket privado `tc-documentos` | 5 filas, todas `ficha_tecnica` |
| URL firmada de un documento | `urlFirmadaDoc()` en `server/index.ts` | 1 h de validez |
| Lectura de PDF | `pdftotext` (poppler) en el contenedor, y `pdf-parse` / `mupdf` en `package.json` | disponibles |

El PDF **tiene capa de texto**: no hace falta OCR. `pdftotext` saca ~32 KB de
texto por informe y los campos salen con su código delante (`E27.`, `S73.`…).
Esto es un parser determinista, no un reconocimiento con confianza y margen de
error, y por eso no debe pasar por el `ocr_estado` de la ficha técnica.

## 3 · Lo que se ha medido en los cinco PDF

Los cinco son el mismo impreso oficial —«Informe Técnico de Tacógrafo Digital»,
centro técnico `E943009`, COMERCIAL SEA, S.A.— y el **A1. Nº de orden de la
intervención es exactamente el `id_origen` del Excel**. Comprobado contra
producción:

| A1 (nº de orden) | Matrícula | ¿Está ya en la base? | Fecha |
|---|---|---|---|
| `E943009005028K` | 0008JDJ | **sí** | 2026-06-05 |
| `E943009005396O` | 7555JNT | **sí** | 2026-11-02 |
| `E943009005397P` | 8318JVM | **sí** | 2026-11-02 |
| `E943009005405X` | 8235JDF | **sí** | 2026-11-04 |
| `E943009005308E` | 9204HMM | **sí** (transferencia) | 2026-10-02 |
| `E943009005411D` | 9832LXT | **NO** | 2026-11-07 (hoy) |

Es decir: la muestra que se ha subido contiene **los dos casos que se piden**,
cinco para adjuntar sin más y uno para dar de alta. No hay que inventarse el
caso de prueba, ya está encima de la mesa.

Y los dos últimos no son relleno:

- `E943009005308E` es una **transferencia de datos + sustitución**, el otro
  tipo de intervención del impreso. Trae vacíos todos los campos de calibrado
  —km, medida, parámetros, equipos, precintos— y el resultado en blanco. Sin
  ella, el parser solo estaría probado contra calibrados.
- `E943009005411D` es el único con un tacógrafo **Stoneridge** en vez de un
  VDO, y el único que trae la versión de software dentro del impreso.

Y el nombre del fichero (`InfTec_E943009005411D.pdf`) repite el A1, lo que da
una comprobación cruzada gratis: si el A1 del contenido y el del nombre no
coinciden, algo va mal y conviene decirlo en vez de elegir uno.

## 4 · El mapa de campos

Del impreso al esquema que ya existe. Solo se listan los que se guardarían:

| Código del impreso | Columna | Nota |
|---|---|---|
| `A1` Nº de orden | `id_origen` | **la clave**; es el mismo del Excel |
| `A3` Fecha | `fecha` | `dd-mm-yyyy hh:mm:ss`; la columna es `date` |
| `A2`/orden de trabajo | `orden_trabajo` | si aparece |
| bloque `D` | `tipo_operacion` | ver trampa 6 |
| `C11` | `tecnico` | |
| `C12` / `C13` | `tecnico_tarjeta`, `tecnico_tarjeta_cad` | |
| `E22` Matrícula | `matricula_origen`, `matricula_norm` | con la normalización que ya existe |
| `E23` Bastidor | `bastidor_origen` | |
| `E25` / Modelo / Categoría | `marca`, `modelo`, `categoria` | |
| `E26` Titular | `cliente_nombre_origen`, `cliente_nif_origen` | |
| `E27` Lectura cuentakilómetros | `km_nuevo` | **ver trampa 3** |
| `E28` Tamaño de neumáticos | `medida_neumatico`, `medida_neumatico_norm` | normalizador ya escrito |
| `E29` / `E30` / `E31` | marca, escultura y profundidad del neumático | hoy **no hay columna**; ver §6 |
| `F33`/`F34` Presiones | — | hoy no hay columna; ver §6 |
| `I41` Fabricante | `fabricante` | **ver trampa 5** |
| `I42` Nº de pieza de la VU | `referencia` | **ver trampa 4** |
| `I44` Nº de serie de la VU | `num_serie` | **ver trampa 4** |
| `I46` Versión de mapa y software | `version_mapa` | a menudo vacío |
| `M56` Nº de serie del sensor | `num_sensor` | **ver trampa 4** |
| `O65` Circunferencia / `O66` Coeficiente | contrastan con `S75` / `S73` | |
| `S73` W / `S74` K / `S75` L | `param_w`, `param_k`, `param_l` | |
| `S76` Tamaño | contrasta con `E28` | |
| `S78` Lectura cuentakilómetros | `km_anterior` | **ver trampa 3** |
| `T79`–`T82` | `b_rodillos`, `eq_calibrado`, `manometro`, `cronometro` | |
| `U83`/`U84` Precintos | `precintos` | |
| `V85`/`V86` FAVORABLE / DESFAVORABLE | `resultado` | **ver trampa 1**; alimenta el vencimiento |
| `W` Observaciones | `observaciones` | |
| `K`, `L`, `N`, `Q`, `R`, `Z` (sí/no y errores) | `comprobaciones jsonb` | la columna ya existe para esto |

Lo que **no** se guardaría: el membrete del centro (nombre, dirección,
contraseña), idéntico en las 1.744 filas. Es la misma decisión que se tomó con
el Excel y por la misma razón.

## 5 · Las trampas

Las seis salen mal **en silencio**: la fila se crea, el clip funciona, y el
dato es falso. Por eso van aquí con su evidencia y cada una con su prueba.

### Trampa 1 · las cruces no están donde el texto dice

Las marcas del impreso son objetos de texto sueltos colocados por coordenadas.
En el mismo PDF, el mismo campo:

```
pdftotext -layout →  V85.  (x) FAVORABLE      V86.  ( ) DESFAVORABLE
pdftotext -raw    →  V85. ( )
                     x FAVORABLE V86. ( ) DESFAVORABLE
```

En `-raw` la `x` aparece **antes de la etiqueta siguiente**. Un parser que lea
líneas en modo `raw` concluiría «V85 sin marcar» y, con un poco de mala suerte,
«V86 DESFAVORABLE». Y `V85/V86` es justo el campo `resultado`, el que usa
`vencimiento.ts` para decidir si el plazo se reinicia: equivocarlo convierte un
tacógrafo favorable en uno desfavorable en la pantalla de control.

Y hay un segundo filo en el mismo campo: en la página 1 el código y su valor
caen en **líneas distintas** (`A1. Nº de orden de la intervención:` y debajo
`E943009005405X`), mientras que en los pies de página van juntos. Un parser que
solo mire «código y valor en la misma línea» se queda sin el A1 de la portada.

**Regla:** los valores escalares se leen en `-raw`, admitiendo el valor en la
misma línea (`W (imp/km) S73. 10399`) o en la siguiente; las **casillas sí/no
se leen con coordenadas** (`-layout`, o mejor el texto estructurado con cajas de `mupdf`,
emparejando cada `x` con el `( )` más cercano). Nunca las dos cosas del mismo
modo.

**Prueba:** los cinco informes son FAVORABLE, y los cuatro que ya están en la
base dicen `resultado = 'Favorable'`. El parser tiene que sacar los cinco bien;
y un test con las casillas invertidas a mano tiene que sacar DESFAVORABLE.

### Trampa 2 · cada PDF trae el impreso DOS veces

Los cinco informes tienen **7 páginas** con la misma estructura exacta:

```
p1-p3  el impreso completo      → p3 pone «Ejemplar para el taller»
p4     en blanco (1 carácter)
p5-p7  el MISMO impreso otra vez → p7 pone «Ejemplar para el cliente»
```

Las páginas 1 y 5 son idénticas al carácter, y las 3 y 7 difieren en una sola
palabra. Por eso `A1` aparece **seis veces** y `S73` dos. Si el parser acumula,
sale una intervención con todo duplicado o, peor, una lista de dos
intervenciones idénticas que se intentan grabar.

**Regla:** se toma la primera aparición con valor de cada código y se
**comprueba que las demás coinciden**. Si dos copias discrepan, no se elige
ninguna: se rechaza el fichero diciendo qué campo discrepa. Un impreso con dos
números de serie distintos es un impreso que hay que mirar a mano.

### Trampa 3 · «km anterior» y «km nuevo» están al revés de su nombre

En el Excel las columnas se llaman «Cuentakm (viejo)» y «Cuentakm (nuevo)», y
el importador las guardó tal cual. Pero en producción:

```
km_anterior > km_nuevo : 1.529 filas
km_anterior < km_nuevo :     4 filas
iguales                :    10 filas
```

De 1.543 filas con los dos datos, **1.529 tienen el «anterior» más alto que el
«nuevo»**. Y contra el PDF de `E943009005405X` cuadra exactamente:

| | valor |
|---|---|
| `km_anterior` en la base | 652266 = **`S78`** (lectura al acabar el calibrado) |
| `km_nuevo` en la base | 652259 = **`E27`** (lectura de recepción) |

O sea que la columna llamada «anterior» guarda la lectura POSTERIOR. Es un
nombre heredado del Excel del centro y ya está así en 1.744 filas.

**Regla:** el PDF rellena `km_anterior ← S78` y `km_nuevo ← E27`, igual de
«mal» que las demás. La coherencia con las 1.744 filas existentes vale más que
el nombre: la ficha enseña `km_nuevo`, y una fila creada del PDF con el
criterio opuesto saldría con 7 km de diferencia respecto a sus vecinas sin que
nada lo explique. Arreglar el nombre de las columnas, si se quiere, es otra
tarea y afecta a las dos vías a la vez.

### Trampa 4 · el Excel normaliza y el PDF no

Mismo informe, mismo campo, distinta forma:

| Campo | En el PDF | En la base (vía Excel) |
|---|---|---|
| `I42` nº de pieza VU | `1381.7550303007` | `13817550303007` |
| `M56` nº de serie sensor | `0015105011` | `15105011` |
| `I44` nº de serie VU | `840533` | `840533` |

El Excel quita el punto y los ceros a la izquierda. Si el PDF los deja, el
mismo tacógrafo aparece como dos aparatos distintos en la sección «Datos
técnicos» de la ficha —que coge cada campo de la intervención más reciente que
lo traía— y el día que se cambie de verdad nadie sabrá si cambió el aparato o
el parser.

**Prueba, y es gratis:** los **cuatro informes que ya están en la base** son el
banco de pruebas. El parser tiene que producir, campo a campo, exactamente lo
que el Excel dejó en esas cuatro filas. Lo que no cuadre es una regla de
normalización que falta, y se arregla antes de seguir.

### Trampa 5 · el PDF no trae todo lo que trae el Excel, y en un campo dice otra cosa

| Columna | Excel | PDF |
|---|---|---|
| `version` (versión software) | `30041` | **no aparece en ningún sitio** |
| `tipo_tacografo` | `Digital` | no hay campo, pero el impreso se titula «INFORME TÉCNICO TACÓGRAFO DIGITAL» |
| `fabricante` | `VDO` | `I41` = `Aumovio Germany GmbH` |

`version` se queda a null, y no pasa nada: la ficha ya enseña cada dato técnico
con la fecha de la intervención de la que sale, justamente porque no todas las
intervenciones traen todos los campos.

`tipo_tacografo` sale del propio impreso —es el formulario del tacógrafo
digital, no hay otro— y por eso se puede poner `Digital` sin inventarse nada.
El día que llegue un impreso de otro tipo, el reconocimiento de la cabecera
fallará y el parser lo dirá, que es lo que tiene que pasar.

El tercero es distinto, y al medirlo se resolvió solo. El impreso pone en I41
la **razón social** («Aumovio Germany GmbH», «Stoneridge Electronics AB») y el
Excel guarda la **marca**. Y la lista de marcas de producción es de tres:

```
VDO         1.665 filas
STONERIDGE     78
ASELSAN         1
```

Con tres valores y una correspondencia evidente —VDO es hoy Aumovio: la
división de tacógrafos de Continental cambió de nombre—, **se traduce**. No es
una tabla de equivalencias inventada: es que la ficha coge cada dato técnico
de la intervención más reciente que lo traía, y un vehículo con «Aumovio
Germany GmbH» al lado de otro con «VDO» obliga a quien lo lea a averiguar si
cambió el aparato o cambió el nombre de la empresa. La razón social literal no
se pierde: está en el PDF que se queda adjunto, que es de lo que va todo esto.
Un fabricante que no esté en la lista se guarda tal cual y se avisa.

### Trampa 6 · el tipo de intervención es más fino en el PDF que en el Excel

El bloque `D` del impreso no tiene casillas numeradas: son líneas de texto. En
los cinco informes dice lo mismo:

```
Control periódico de un tacógrafo
+ Calibrado de un tacógrafo
```

Y el Excel solo tiene tres valores en toda la tabla:

```
Calibrado o Parametrización / Control / Reparación   1.300
Instalación / Activación                               243
Transferencia / Certificado de intransferibilidad /    201
Sustitución
```

De las tres, **dos están comprobadas** contra informes que ya estaban
importados:

| El impreso dice (bloque D) | El Excel guarda |
|---|---|
| «Control periódico de un tacógrafo + Calibrado de un tacógrafo» | Calibrado o Parametrización / Control / Reparación |
| «Transferencia de datos + Sustitución de un tacógrafo» | Transferencia / Certificado de intransferibilidad / Sustitución |

La tercera, **instalación**, NO: no hay ningún PDF de una instalación entre los
ejemplos, así que sus pistas son las palabras del propio impreso y nada más.

**Regla:** se mapea lo que se ha visto, y lo que no encaja en ninguna familia
—o encaja en dos— **se deja sin categoría y se dice** («el tipo de intervención
del informe no se reconoce: "…"»), en vez de meterlo en la más probable. Un
tipo mal asignado mueve el vencimiento de un vehículo, que es lo único que esa
pantalla sirve para mirar.

## 6 · Decisiones de diseño, con recomendación

### D1 · Dónde vive el PDF → **se reutiliza lo que hay**

Bucket privado `tc-documentos` y tabla `tc_vehiculo_documentos`, con
`tipo = 'informe_tacografo'`. Trae ya el sha256 para duplicados, la URL firmada,
el tamaño, las páginas y el `vehiculo_id` **nullable** (que hace falta: la
matrícula puede no casar con ningún vehículo).

Dos diferencias con la ficha técnica, a propósito:

- **`vigente` no se usa.** La ficha técnica tiene una vigente y archiva la
  anterior; los informes de tacógrafo son un histórico donde todos valen.
- **`ocr_*` se queda a null.** Esto es un parser determinista, no un OCR.

### D2 · Cómo se ata el PDF a su intervención → **columna en el documento**

```sql
alter table tc_vehiculo_documentos
  add column if not exists intervencion_id uuid
    references tc_tacografo_intervenciones(id) on delete set null;
```

La clave ajena va en el documento y no al contrario, porque un informe
pertenece a una intervención y porque así caben dos (el original y una copia
corregida) sin tocar el esquema. `on delete set null` **y no cascade**: si
alguien deshace un lote de importación, el PDF que subió una persona no se
borra con él.

Y **`deshacer.ts` tiene que aprender esto**: hoy se niega a deshacer un lote si
hay trabajo humano encima (una vinculación a mano, una propuesta aceptada). Un
informe adjunto es trabajo humano exactamente igual, y tiene que entrar en esa
lista de estorbos.

### D3 · La clave única, que es la decisión importante

`unique (empresa_id, sistema_origen, id_origen)`. Si una fila creada desde un
PDF lleva `sistema_origen = 'informe_tecnico_pdf'`, el día que el Excel mensual
traiga ese mismo A1 **entrará como fila nueva**: dos intervenciones idénticas
en el histórico, el contador de «X intervenciones» inflado y dos fechas para el
mismo vencimiento.

**Propuesta:** la fila creada desde un PDF usa el **mismo**
`sistema_origen = 'informe_intervenciones'`, para que la clave única haga su
trabajo, y la procedencia real se guarda aparte:

```sql
alter table tc_tacografo_intervenciones
  add column if not exists creada_de_pdf boolean not null default false;
```

Con una consecuencia que hay que resolver en la misma fase: el importador del
Excel hoy **se salta** los A1 que ya están (`leerYaImportados`). Si se deja
así, la fila provisional creada del PDF nunca recibe los campos que el PDF no
trae (`version`, `tipo_tacografo`, los que no estaban). Por eso el importador
tiene que **completar** las filas con `creada_de_pdf = true`: rellenar lo que
esté a null, no tocar lo que ya tenga valor, y dejar `creada_de_pdf = false`
cuando la fila ya viene del origen oficial. Sin esto, subir el PDF «mejora» la
ficha hoy y la empeora para siempre.

### D4 · Si la matrícula del PDF no es la del vehículo abierto → **se para y se pregunta**

Es el error más fácil de cometer (subir el informe en la ficha de al lado) y el
más caro: deja una intervención colgando del vehículo equivocado y le mueve el
vencimiento a los dos. El servidor compara `E22` con la matrícula del vehículo
y, si no coinciden, **no graba**: responde con las dos matrículas y la pantalla
pregunta si de verdad es ese vehículo. El `E23` (bastidor) sirve de segunda
comprobación.

### D5 · El mismo PDF dos veces → **409 y el id del que ya está**

Por `hash_sha256`, igual que la ficha técnica. Y como el A1 va dentro, un
informe distinto del mismo A1 (una copia corregida del centro) no es un
duplicado: es una versión nueva, se adjunta y se dice que ya había otra.

## 7 · Las fases

**Fase 1 · el parser, a solas y con los informes reales como juez. HECHA.**
`server/tyrecontrol/tacografo/informePdf.ts`: de un Buffer a una
`FilaTacografo`, la misma que produce el Excel (así `importar.ts` y
`escribir.ts` no se enteran de por dónde entró el dato). Sin tocar la base.

Resultado de contrastarlo contra producción, informe a informe:

| Informe | Campos comparados | Resultado |
|---|---|---|
| `E943009005028K` | 37 columnas + el jsonb | **idéntico** |
| `E943009005396O` | 37 columnas + el jsonb | **idéntico** |
| `E943009005397P` | 37 columnas + el jsonb | **idéntico** |
| `E943009005405X` | 37 columnas + el jsonb | **idéntico** |
| `E943009005308E` (transferencia) | 37 columnas + el jsonb | idéntico, y **además** trae el bastidor y el modelo que el Excel dejó vacíos |
| `E943009005411D` | — | no está en la base; se lee entero y sin avisos |

Lo que hizo falta para llegar ahí, y que ninguna de las dos lecturas de texto
plano habría dado: leer líneas con su caja y emparejar cada cruz con la casilla
en la que CAE; separar las dos copias del impreso y exigir que concuerden;
distinguir las cabeceras de bloque (cuerpo 10) del contenido (cuerpo 8), porque
si no la fecha de caducidad de la tarjeta del técnico acaba valiendo
«INSTALACIÓN DEL»; y reproducir las normalizaciones del Excel una por una
—puntos de los códigos largos, ceros de delante del equipo de calibrado,
espacios de los precintos, `0,0` → `0`, la marca del fabricante—.

Las pruebas van en dos ficheros, y a propósito: `informePdf.test.ts` construye
impresos de pega con la geometría real y cubre las trampas una a una (38
pruebas, se ejecutan siempre), y `informePdf.reales.test.ts` compara contra las
cifras de producción usando los PDF de verdad. Estos **no están en el
repositorio**: llevan matrículas, bastidores y el nombre y la tarjeta
profesional del técnico, y subirlos sería publicarlos en el historial de git
para siempre. Se ejecuta apuntando a donde estén:

```bash
TACOGRAFO_INFORMES_DIR=/ruta/a/los/informes npx vitest run informePdf.reales
```

Sin la variable se salta y lo dice, en vez de pasar en verde sin haber
comprobado nada.

**Fase 2 · la migración. HECHA.** Las dos columnas de §6 (`intervencion_id`,
`creada_de_pdf`), un índice parcial por `intervencion_id`, y las políticas RLS
al mismo patrón que las demás. Versionada en `supabase/migrations/`, con su
md5, para aplicar a mano como las anteriores.

**Fase 3 · las rutas. HECHA.**
`POST /api/tyrecontrol/vehiculos/:id/informe-tacografo`: lee el PDF, parsea,
compara matrícula (D4), busca el A1, y entonces o bien **solo adjunta** (ya
estaba) o bien **crea y adjunta** (no estaba), siempre en el mismo orden:
primero la intervención, después el documento, y si lo segundo falla, la
intervención queda sin adjunto pero correcta. Devuelve qué hizo, para que la
pantalla lo diga con palabras y no con un «OK». Comprobación de empresa en
código, como en el resto del módulo: el servidor habla con `service_role` y RLS
no le aplica. Más `GET` de los informes de un vehículo con su URL firmada, y
`deshacer.ts` enterándose del adjunto (D2): un informe adjunto es trabajo de
una persona y entra en la lista de estorbos, al lado de las vinculaciones a
mano y las propuestas aceptadas.

Y la pieza de D3 que no se podía dejar para después: el importador del Excel
**completa** las filas que creó un PDF en vez de saltárselas por «ya
importadas». Solo rellena lo que está a null —si el Excel dice una cosa y la
fila otra, se queda lo que ya había— y sí manda en la trazabilidad y en
`km_sospechoso`, que se decide comparando con las lecturas anteriores del
mismo vehículo y que un PDF suelto no tiene con qué comparar.

Para no tener dos mapeos de fila a columna, el que había dentro de `preparar()`
se ha sacado a `aFilaInsert()` y lo usan los dos caminos. Con dos, el día que
se añadiera una columna se añadiría en uno y no en el otro, y la ficha
enseñaría un dato según por dónde hubiera entrado.

**Fase 4 · el clip. HECHA.** En `SeccionTacografo.tsx`, una columna más en el
histórico: clip si esa intervención tiene informe, nada si no. Abre en pestaña
nueva con la URL firmada —que caduca en una hora, así que los informes se
piden aparte de la ficha— y ofrece descargarlo. Y un botón «Adjuntar informe
(PDF)» en la cabecera de la sección, que es donde se busca.

Dos cosas más que la pantalla enseña y que salen de decisiones de arriba: si
la matrícula del impreso no es la del vehículo abierto, el servidor no graba y
aquí aparece un botón de «sí, es este vehículo» —la pantalla no reintenta por
su cuenta—; y los informes cuyo lote se deshizo siguen listados aparte, porque
el PDF no se borra con la intervención y abrirlo tiene que seguir siendo
posible.

**Fase 5 · comprobar contra la realidad.** Subir los cinco: los cuatro que ya
están tienen que quedarse en «solo adjuntado» sin crear nada —y el contador de
intervenciones del vehículo no puede moverse—, y `E943009005411D` (9832LXT,
hoy) tiene que aparecer como intervención nueva con su clip. Después, el Excel
del mes que viene traerá ese A1: la fila no se duplica y se completa.

## 8 · Lo que no se toca

Sigue en pie lo acordado: no se modifican `tc_montajes_actuales`,
`tc_neumaticos`, `tc_vehiculo_ejes`, `config_ejes_id` ni
`tc_vehiculos.km_actual`. Las lecturas de cuentakilómetros del informe son
lecturas fechadas de la intervención, no el km del vehículo, que viene de la
telemática. Nada se aplica directo en producción: rama, migraciones
versionadas, pruebas y PR revisable.

Y una más, de este plan: el informe **no escribe la medida habitual del
vehículo**. `E28`/`S76` dicen con qué medida se calibró, no qué rueda está
puesta. Si de un PDF sale una medida que no cuadra, eso es una **propuesta**,
por el camino que ya existe (`tc_tacografo_medida_propuesta`), y la acepta
alguien mirándola. Queda como pregunta en §9 si se quiere ya en la fase 3 o
más adelante.

## 9 · Preguntas abiertas

1. ~~**Fabricante.**~~ Resuelto al medirlo: solo hay tres marcas en
   producción y la correspondencia con la razón social del impreso es
   evidente, así que se traduce (ver trampa 5). Si se prefiere la razón social
   literal, es un cambio de una línea.
2. **Propuestas de medida desde el PDF.** ¿Se generan ya en la fase 3, o
   primero solo se adjunta y se crea, y las propuestas vienen después?
   Propuesta: después, para no mezclar dos pantallas en una entrega.
3. **Quién puede subir.** ¿Cualquier usuario del panel con acceso a la empresa,
   como la ficha técnica, o solo administradores? Los informes crean
   intervenciones, que mueven vencimientos.
4. **E29/E30/E31 y F33/F34** (marca, escultura y profundidad de los neumáticos
   motrices, y sus presiones) son datos de neumático que el Excel no trae y
   para los que hoy no hay columna. ¿Se guardan en `comprobaciones jsonb` para
   verlos, se les hace columna, o se dejan fuera? Propuesta: en el jsonb, que
   es donde ya viven los campos que solo traen algunos informes.
5. **Varios PDF de golpe.** El centro manda los informes de uno en uno, pero
   nada impide arrastrar cinco. ¿Se admite una subida múltiple en la fase 4 o
   se deja de uno en uno?
