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

## 5. DECIDIDO

**El parte alimenta lo que ya hay** (decisión 5.1), y **es una vía de entrada
opcional**: no todas las operaciones se harán así, solo las que el técnico
elija a mano.

Las dos cosas juntas fijan el diseño:

- El parte por fotos NO es un documento nuevo ni una tabla nueva de verdad:
  termina en una **intervención** (`tc_intervenciones`, que ya es el parte de
  trabajo, ya tiene número y ya la puede escribir un operador) con sus
  operaciones y sus montajes. El PDF es una SALIDA de eso, no una isla.
- Como es opcional, **no se toca ni el flujo de revisión ni el de Cambiar**.
  Es una entrada nueva y aditiva: quien no la use no se entera de que existe.

Lo que sigue son las decisiones menores, resueltas con la opción conservadora
y consistente con lo que ya hace el sistema. Cualquiera se puede cambiar.

| | Se hace | Por qué |
|---|---|---|
| Matrícula que no existe | NO se da de alta el vehículo: el parte queda sin vincular y se avisa | La RLS no deja a un técnico crear vehículos, y una matrícula mal leída crearía flota fantasma |
| «Flota / cliente» | Se lee como dato informativo; la empresa la pone la sesión | Hacerle caso sería dejar que una fotografía cambie el ámbito de permisos |
| Sin cobertura | Las fotos se encolan; el análisis exige red y se dice | Igual que la corrección de neumático |
| Quién puede | Operador asignado y administrador | Mismo criterio que la revisión |

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

## 8. Lo único que sigue faltando

El **parte en blanco**, en PDF o escaneado. Mientras no lo haya, la plantilla
del PDF es provisional y queda documentado cómo sustituirla.
