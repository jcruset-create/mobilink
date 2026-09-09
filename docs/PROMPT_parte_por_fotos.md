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

## 3. La plantilla en blanco, ya recibida — y lo que revela

`Parte_de_Servicio_conti360_SEA_III_2019.pdf`. Comprobado:

```
paginas: 1   (el sistema decia 76; el /Count del fichero dice 1)
tamano: 595 x 842 pt  → A4 exacto
fuentes: 5   imagenes: 32   → PDF NATIVO, no un escaneo
campos de formulario: 0     sin XFA
```

Que sea nativo y A4 exacto es una buena noticia: se puede estampar texto
encima con pdf-lib con precisión, sin depender de la resolución de un escaneo.
(El primer PDF, `09896.pdf`, sí era un escaneo de un parte ya relleno: servía
de ejemplo, no de plantilla.)

### Lo que el formulario pide de verdad

Y aquí está lo importante. **El modelo de datos del encargo cubre una parte
pequeña de este parte.** El formulario real tiene:

- **Cabecera**: Parte de Servicio nº, Nº de Orden Flota, Flota, Matrícula, Km,
  Fecha, y **cinco marcas de tiempo** —Inicio Servicio, Inicio Mecánico, Fin
  Mecánico, Fin Servicio, Km Recorridos Mecánico.
- **Lugar del servicio**: taller / instalaciones de la flota / carretera.
- **Diagrama de posiciones** propio de Conti360, numeradas del 1 al 22 con
  códigos `1IZI`, `2IZE`, `3DE`… y **cabeza tractora + remolque en el mismo
  parte**, más `Rpto 1` y `Rpto 2`.
- **Tabla de desmontados/permutados**: posición, dimensión y modelo, bar, nº de
  serie/DOT, mm, y dos bloques de casillas — **Razón de Sustitución** (10
  opciones) y **Destino del Neumático** (7 opciones).
- **Tabla de montados**: posición, dimensión y modelo, **origen**, serie/DOT, mm.
- **Neumáticos nuevos montados**: marca, dimensión, modelo, unidades, con
  Continental y Semperit preimpresas.
- **Servicios realizados con cantidad**: desmontar/montar cubierta, quitar y
  poner rueda, equilibrados, pinchazo, rayados, alineación (standard o
  compleja), salida de servicio móvil, kilómetros recorridos, horas de oficial
  de 1ª, válvulas, alargaderas.
- **Firmas**: nombre y DNI del cliente, firma y sello, nombre y firma del técnico.

El JSON del encargo —matrícula, km, vehículo, flota, fecha y una lista de
neumáticos— **cubre la cabecera y poco más**.

### Qué de eso ya existe, comparado uno a uno

| Bloque del parte | En TyreControl |
|---|---|
| Matrícula, km, fecha, flota | Ya está |
| Tiempos de servicio y mecánico | La intervención ya cronometra (inicio, fin, pausas). Encaja parcialmente |
| Desmontados con posición, serie, mm | `operaciones_neumaticos` + `revisiones_neumaticos_detalle` |
| **Razón de Sustitución** (10) | `tc_cat_motivos` cubre 4: desgaste, pinchazo, desgaste irregular y (aprox.) roces en flanco. **Faltan** cambio de posición, daño por golpe, cortes, daño en banda de rodadura, rodaje sin presión y robo |
| **Destino del Neumático** (7) | `tc_cat_destinos` cubre destruir y aproxima almacén y carcasa. **Faltan** comprada por el taller, reclamación, y distinguir almacén de flota de almacén de taller |
| Montados con origen | Ya está (`origen`: almacén nuevo/usado, catálogo) |
| Neumáticos nuevos por marca y unidades | Se deriva de las operaciones |
| **Servicios realizados con cantidad** | **NO existe.** Hay `tc_cat_tipos_reparacion` con equilibrado, válvula y pinchazo, pero no líneas de servicio con cantidad — que es justo lo que se factura |
| **Firmas de cliente y técnico** | **NO existe** |
| **Posiciones 1IZI…22, Rpto 1/2** | `tc_posiciones_vehiculo` usa otro esquema (`E1_IZQ`). Hay que **mapear**, y no es mecánico |
| **Cabeza tractora + remolque en un parte** | TyreControl trata **cada vehículo por separado**. Un parte que cubre tractora y remolque son DOS vehículos en un documento |

### Lo que esto significa

No es «rellenar un formulario con lo que ya sabemos». Faltan piezas de modelo
—servicios facturables, firmas, seis motivos, cuatro destinos— y hay dos
cuestiones de fondo:

1. **Las posiciones.** Hay que decidir el mapeo entre la numeración de Conti360
   y la de Mobilink, y eso depende de cómo estén tipados los vehículos. No me
   lo puedo inventar.
2. **Tractora y remolque en el mismo parte.** O el parte apunta a dos
   vehículos, o se emiten dos partes, o se admite que el documento agrupe lo
   que el sistema guarda por separado.

Y una observación que conviene tener presente: esto es un documento **Conti360
de Continental**, con casillas como «Carcasa a Continental» y «Reclamación».
Es un parte contractual con un tercero, así que el aspecto y los códigos
probablemente no son negociables.

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

## 8. DECIDIDO también esto

| | Decisión |
|---|---|
| **Posiciones** | Se usa **el esquema de Mobilink** (el tipo de vehículo y su plano, 2x2x2 y demás), no la numeración de Conti360. No hay mapeo que inventar, y es el esquema que ya tienen las mediciones |
| **Tractora y remolque** | **Dos partes**. Un parte, un vehículo — que es como TyreControl los guarda |
| **Servicios facturables** | Se **añaden a TyreControl** con cantidad |
| **Firmas** | **En la tablet** |

Con esto no queda ninguna decisión abierta. El plan es:

1. ~~Base de datos~~ — hecho: catálogo de servicios con unidad, líneas por
   parte, firmas, tiempos del mecánico, lugar, y los motivos y destinos que
   faltaban.
2. ~~Lector de fotos~~ — hecho.
3. El **PDF** sobre la plantilla, con su tabla de coordenadas.
4. La **pantalla del APK**: fotos, revisión, servicios, firmas y PDF.
