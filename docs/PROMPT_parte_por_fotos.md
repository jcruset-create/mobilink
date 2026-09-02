# Parte de servicio a partir de fotografías — cómo lo haría

Análisis previo a programar. El encargo llega con una tecnología concreta
escrita, y esa tecnología **no es la de TyreControl**. Eso es lo primero que
hay que resolver, porque decide todo lo demás.

## 1. La contradicción de partida

El encargo pide construir **dos proyectos nuevos**:

| Pide | TyreControl es |
|---|---|
| Android nativo en Kotlin + Jetpack Compose | **Flutter / Dart** (`tyrecontrol_app/`) |
| MVVM, CameraX, Room, Material 3 | Flutter con `image_picker`, caché propia, tema propio |
| Servidor Python 3.11 + FastAPI | **Node + Express + TypeScript** (`server/`) |
| ReportLab + pypdf | **pdf-lib**, ya en uso en cuatro módulos |
| Retrofit/OkHttp, FileProvider | `http` + Supabase, ya cableado |
| Historial local en Room | Supabase + cola offline ya existente |

Pero la instrucción es «añadir esta funcionalidad a **nuestra** app y APK de
TyreControl». Las dos cosas no caben a la vez.

Construir lo que dice la letra significa un **segundo sistema en paralelo**:
segunda app que instalar en las mismas tablets, segundo servidor que desplegar
y vigilar, segundo servicio de IA, segundo generador de PDF, segundo historial,
segunda autenticación y un segundo sitio donde vive la verdad sobre qué
neumático lleva un vehículo. Es exactamente lo que el encargo anterior prohibía
("NO crear sistemas paralelos", "NO crear otro catálogo").

**Propuesta: se implanta dentro de TyreControl**, en Flutter y en el servidor de
Node, y la lista de tecnologías se lee como lo que de verdad pide —cámara,
galería, análisis en la nube, formulario editable, PDF, historial— no como una
lista de librerías.

## 2. Lo que YA está construido y hay que reutilizar

Comprobado en el repositorio, no supuesto:

| Lo que pide el encargo | Lo que ya hay |
|---|---|
| Visión en la nube con salida estructurada y confianza por campo | `server/tyrecontrol/ficha-tecnica/ocrService.ts` sobre `pedirIA` |
| **Leer marca, modelo, medida, índices y DOT de la goma** | `server/tyrecontrol/flanco/` — hecho esta semana, con 20 pruebas |
| «La IA propone → la persona confirma → se guarda» | El flujo de ficha técnica y `documentos/:id/aplicar` |
| No inventar; marcar lo dudoso | `CONFIANZA_MINIMA` y la distinción dudoso/vacío de `flanco.ts` |
| No confundir la medida con el número de serie | Ya está escrito en el prompt del flanco |
| Cámara y galería | `image_picker` en el APK |
| Subir fotos y guardarlas | `subirFotoRevision` / `subirFotoFlanco`, bucket `tc-revisiones-fotos` |
| Que no se pierda sin cobertura | `offline_store.dart`, con cola de fotos |
| Generar PDF | `pdf-lib` en `cash/report.ts`, `connect/report.ts`, `tacografos/documents.ts` y `/api/otf/:id/report.pdf` |
| Convertir un PDF en imágenes para la IA | `ficha-tecnica/pdfRasterizer.ts` (mupdf, sin dependencias del sistema) |
| Token y protección de endpoints | `authenticate` + `requireModule("tyrecontrol")` |
| Clave de OpenAI solo en el servidor | Ya es así: `OPENAI_API_KEY` vive en Render, el APK nunca la ve |
| Matrícula, km y su origen | `tc_vehiculos.matricula`, `km_actual`, `origen_km` |
| Marca, modelo y medida normalizadas | `tc_cat_marcas/modelos_neumatico`, `tyre_sizes`, `tc_referencias_neumatico` |
| Historial de partes | `tc_intervenciones` + `InformeIntervencion.tsx`, ya en tres niveles |

Es decir: **de las trece piezas del encargo, once ya existen**. Lo que falta de
verdad es poco, y está en el punto 4.

## 3. El PDF adjunto: es un escaneo, no un formulario

Comprobado con pdf-lib sobre `09896.pdf`:

```
paginas: 1
tamano pagina: 591 x 835 pt
campos de formulario: 0
XObjects (imagenes): /FXX1
Fuentes: ninguna  → es un escaneo
```

No tiene campos rellenables ni una sola fuente: es una foto de un parte de
papel ya cumplimentado. Consecuencias que hay que decidir antes de programar:

- **No se puede «rellenar el formulario»**: no hay formulario que rellenar.
- Quedan dos caminos:
  - **(a) Estampar texto por coordenadas** sobre una plantilla en blanco
    escaneada. Es lo que insinúa el encargo. Sale idéntico al papel, pero
    depende de una plantilla que **hoy no tenemos** y de una tabla de
    coordenadas que hay que calibrar a mano contra el escaneo.
  - **(b) Redibujarlo con pdf-lib** con el mismo diseño y tamaño de página.
    Sale nítido, se busca el texto, la segunda página de neumáticos es trivial
    y no depende de ningún escaneo. Es además como se generan hoy los otros
    PDF del sistema.
- **Recomiendo (b)**, y dejar la tabla de coordenadas en un fichero aparte de
  todos modos, que es lo que el encargo pide poder ajustar.
- En cualquiera de los dos casos **hace falta el parte en blanco**. Sin él se
  hace una plantilla provisional y se documenta cómo sustituirla.

## 4. Lo que hay que construir de verdad

1. **Un lector de parte por fotos** en el servidor, hermano de `flanco/`:
   recibe N fotos de un mismo parte, las manda juntas al modelo y devuelve el
   JSON del encargo (`plate`, `kilometers`, `vehicle`, `fleet`, `date`,
   `tires[]`, `warnings[]`). La parte pura —qué es fiable, cómo se normaliza la
   matrícula y los km, cómo se detecta el mismo neumático fotografiado dos
   veces— separada y con pruebas, igual que `flanco.ts`.
2. **La pantalla del parte** en el APK: nuevo parte, hacer/elegir fotos,
   clasificarlas (matrícula, cuentakilómetros, vehículo, neumático), progreso,
   formulario editable con lo dudoso marcado, edición por neumático,
   confirmación y PDF.
3. **El generador del PDF** del parte, con pdf-lib, y su tabla de coordenadas.
4. **Dónde se guarda el parte**: ver decisión 5.1.

## 5. Lo que hay que decidir antes de escribir código

### 5.1 ¿Es un documento nuevo o es la intervención que ya existe?

El modelo de datos del encargo —matrícula, km, vehículo, flota, fecha y una
lista de neumáticos con marca, modelo, serie, medida y posición— es **casi
exactamente** lo que TyreControl ya guarda en un vehículo, sus montajes y su
intervención.

- Si el parte es **un documento suelto**, habrá dos verdades sobre qué goma
  lleva un vehículo: la del parte y la de `tc_montajes_actuales`. El día que no
  coincidan, nadie sabrá cuál vale.
- Si el parte **alimenta lo que ya hay** —crea o actualiza vehículo, km y
  montajes tras la confirmación del técnico— entonces el PDF es una *salida*
  del sistema, no una isla.

**Recomiendo lo segundo**, con el parte guardado como documento adjunto de la
intervención. Pero es tu decisión: si estos partes vienen de un tercero y no
deben tocar el inventario, entonces sí es un documento suelto y hay que decirlo
explícitamente.

### 5.2 ¿Vehículo que ya existe o alta desde el parte?

Si la matrícula leída no está en Mobilink: ¿se da de alta el vehículo, se
rechaza, o se guarda el parte sin vincular? Con la RLS de hoy, un técnico **no
puede** crear vehículos.

### 5.3 ¿Qué es «flota o cliente»?

En TyreControl eso es la **empresa**, y la RLS ya decide qué empresa ve cada
usuario. Leerla de la foto y hacerle caso sería dejar que una fotografía
cambie el ámbito de permisos. Propongo leerla solo como dato informativo y que
la empresa la siga poniendo la sesión.

### 5.4 ¿Sin cobertura?

Las fotos ya se encolan. El análisis necesita red. ¿Se permite crear el parte
sin cobertura y analizarlo al recuperarla, o se exige red como en la corrección
de neumático?

### 5.5 ¿Quién puede crear partes?

¿Solo el operador asignado, también el administrador, el cliente no? Hoy la
respuesta natural sería la misma que para la revisión.

## 6. Lo que NO haría, y por qué

- **No** un proyecto Kotlin nuevo. Serían dos APK que mantener e instalar en
  las mismas tablets, con dos cámaras, dos historiales y dos inicios de sesión.
- **No** un servidor FastAPI aparte. La clave de OpenAI, el token y el
  despliegue ya están resueltos en el servidor de Node; duplicarlos significa
  duplicar también quien los vigila.
- **No** ReportLab. `pdf-lib` ya genera los PDF de este sistema.
- **No** Room. El historial de partes tiene que ser el mismo que ve el panel,
  no una base de datos privada del móvil que nadie más puede consultar.

Todo eso son medios, no fines. Los fines del encargo —fotos, lectura por IA,
formulario editable, PDF compartible, historial— se cumplen enteros dentro de
lo que ya hay.

## 7. Sobre los criterios de aceptación

Dos son importantes y los asumo:

- **«No afirmes que la APK funciona si no has conseguido compilarla.»** Aquí no
  hay Flutter instalado: el Dart lo compila la CI. Diré siempre qué he probado
  yo y qué ha probado la CI, sin mezclarlo.
- **«Comprueba visualmente un PDF generado.»** Puedo generarlo y rasterizarlo
  para mirarlo, y lo haré antes de darlo por bueno.

## 8. Qué necesito de ti

1. La decisión **5.1**, que es la que más cambia el trabajo.
2. El **parte en blanco**, en PDF o escaneado. Sin él la plantilla es
   provisional.
3. Las decisiones 5.2 a 5.5, que son más rápidas.
