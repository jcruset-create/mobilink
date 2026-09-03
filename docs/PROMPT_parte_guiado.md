# Parte de servicio guiado desde la tablet

Prompt de trabajo. **No hay código todavía.**

Este fichero es tu prompt, revisado contra el código. Primero lo que hay que
arreglar de él y por qué; después el prompt corregido, que es lo que se
implementará cuando cierres las decisiones del final.

---

# Parte 1 · Revisión de tu prompt

## Tres contradicciones que lo bloquean

### 1. Pide implementar y a la vez prohíbe la única forma de hacerlo

Tu prompt dice tres cosas incompatibles:

- «Implementa la funcionalidad», «No te limites a explicar cómo hacerlo».
- «Si consideras necesario añadir algo, indícalo antes de implementarlo».
- «No amplíes permisos globales para resolver el flujo».

El **Recorrido B** —crear el vehículo desde la tablet— es imposible hoy:

```sql
-- tyrecontrol_fase3.sql:75-78
create policy tc_vehiculos_write on tc_vehiculos for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );
```

El operador no está, y la APK no tiene ningún camino para crear vehículos.
Hace falta abrir algo. Tu prompt exige la funcionalidad y prohíbe el
mecanismo, así que tal cual está no se puede ejecutar. → **Decisión 1**.

### 2. Pide una comprobación visual que aquí no se puede hacer

«Comprueba visualmente el flujo en tamaño tablet» choca con tu propia última
frase, «no afirmes que algo funciona si no lo has probado realmente».

En este entorno **no hay Flutter**: el Dart lo compila la CI. Puedo dar build
verde y análisis estático limpio, y puedo mirar el panel; **no puedo ver la
APK corriendo**. Sustituido en el prompt corregido por lo que sí es
verificable.

### 3. «El formulario existente» no existe como una sola cosa

Dices «reutiliza el formulario existente» y «localiza el formulario actual».
Hay **tres** cosas distintas:

| Qué | Dónde | Qué escribe |
|---|---|---|
| **Revisión** | `review_screen.dart` | `revisiones_vehiculo` + mediciones |
| **Cambios / operaciones** | `cambio_neumatico_screen.dart` | `operaciones_neumaticos` + movimientos |
| **Parte Conti360** | `parte_fotos_screen.dart` + `server/tyrecontrol/parte/` | cabecera y servicios de `tc_intervenciones`, y el PDF |

Tus catorce pasos **mezclan revisión y operaciones**: los pasos 5–6
(«revisión de los neumáticos instalados», «registro de mediciones y estado»)
son una revisión, y los 7–10 son una intervención. Hoy están separados a
propósito.

Eso no es «reutilizar el formulario»: es **fusionar dos flujos**. Se puede
hacer y probablemente sea lo correcto para el taller, pero hay que decirlo,
porque cambia qué se escribe en la base de datos. → **Decisión 2**.

## Cuatro afirmaciones del prompt que el código desmiente

### «Cualquier otro campo que el modelo de datos marque como obligatorio»

En `tc_vehiculos` lo único `not null` es `empresa_id` y `matricula`
(`km_actual` tiene defecto 0). **`tipo_vehiculo_id`, `marca` y `modelo` son
nulables.**

Pero sin `tipo_vehiculo_id` no se generan las posiciones, y sin posiciones el
parte no puede decir de qué rueda salió cada goma. O sea:

> obligatorio para la base de datos ≠ obligatorio para que sirva

Si sigues el prompt tal cual, pedirás marca y modelo creyendo que la base de
datos los exige —no los exige— y no pedirás el tipo, que sí hace falta.

### «Evitar duplicados comprobando nuevamente la matrícula antes de guardar»

Ya existe `unique (empresa_id, matricula)`. Comprobar y luego insertar es una
carrera: entre la comprobación y el insert cabe otra tablet. Lo correcto es
**intentar el alta y tratar el error de unicidad**, ofreciendo el vehículo que
ya existía.

### «Registrar quién lo creó»

Para la intervención ya está: `tc_intervenciones.tecnico_id`.

**Me corrijo**: en la versión anterior de este documento escribí que la
intervención no tenía dueño. Sí lo tiene. Lo que falta es el dueño del
**vehículo creado desde la tablet**.

### «Todas las modificaciones en una única transacción»

Es el mejor requisito de tu prompt, y tiene una consecuencia que conviene
saber: **desde Flutter contra Supabase no hay transacción de cliente**. Varias
llamadas seguidas no son atómicas; si la cuarta falla, las tres primeras ya
están escritas.

Para cumplirlo hace falta **una sola función de base de datos** que reciba el
parte entero y lo escriba de una vez: `tc_guardar_parte_guiado(jsonb)`. No es
un detalle de implementación, es el diseño.

Y con eso, la doble pulsación se resuelve con una **clave de idempotencia**
generada en la tablet al empezar el borrador, con índice único: si la petición
llega dos veces, la segunda devuelve la misma intervención en vez de crear
otra.

## Lo que tu prompt tiene y el mío no tenía

Me lo quedo entero:

- Transacción única y todo-o-nada.
- Idempotencia al finalizar.
- Borrador con autoguardado, salir y continuar.
- Aviso si el kilometraje es menor que el último registrado.
- Pantalla de revisión final con cada apartado pulsable para volver a su paso.
- Indicador de progreso, teclado numérico, valores frecuentes como botones.
- «No inventes campos, botones, operaciones ni estados».
- La lista de casos de prueba.

## Lo que falta

1. **Sin cobertura.** Lo tienes como caso de prueba, no como comportamiento
   decidido. Hay que decidirlo.
2. **Tractora y remolque.** Ya decidimos que son dos partes. El flujo guiado
   tiene que saberlo.
3. **Dónde vive la pestaña.** La barra de abajo de la APK ya tiene cinco
   destinos; una sexta la aprieta.
4. **Qué pasa con el vehículo creado en la tablet.** Si nadie lo repasa, se
   queda para siempre sin marca ni modelo.
5. **APK o panel.** No lo dices. Es la APK (Flutter). El panel es React: si se
   entendiera mal, el trabajo sería otro completamente distinto.
6. **«Paso 4 de 10»** pero la lista tiene catorce pasos.
7. **Stock.** Das por hecho que siempre hay control de stock. En TyreControl
   hay clientes **sin control de stock** y existe «montar fuera de almacén».
   «Actualizar correctamente el stock» no siempre aplica.

---

# Parte 2 · Prompt corregido

## Objetivo

Una entrada nueva en la **APK de TyreControl** (Flutter, para tablet) llamada
**«Realizar operación»**, que guíe al operario paso a paso siguiendo el orden
del parte de servicio, con interfaz táctil y sencilla.

Reutilizar lo que ya hay: catálogo de neumáticos, clientes, vehículos,
almacenes, operaciones, intervenciones, validaciones y permisos. **No** crear
tablas de partes, catálogos paralelos ni sistemas de fotos nuevos.

No inventar campos, botones, operaciones ni estados. Si hace falta añadir algo,
decirlo antes de implementarlo.

## Paso 1 · Identificar el vehículo

Matrícula a mano, por foto, o eligiendo de los vehículos recientes. El
reconocimiento ya existe (`ocr_service.dart`).

1. Normalizar antes de buscar.
2. Buscar en TyreControl.
3. Enseñar lo detectado para confirmar o corregir.
4. **No** continuar solo si la lectura tiene poca confianza.

### Recorrido A · La matrícula existe

Traer sin volver a preguntar: cliente, matrícula, nº de flota, marca, modelo,
tipo, configuración de ejes, kilometraje, neumáticos montados con su posición,
marca, modelo, dimensión y número de serie, mediciones anteriores y almacén.

Enseñar una ficha resumen para confirmar que es el camión. **Desde ese resumen
no se editan datos maestros.**

### Recorrido B · La matrícula no existe

Decirlo claro: «Este vehículo todavía no está registrado en TyreControl», y
ofrecer una parametrización rápida, solo la primera vez.

**Lo imprescindible, y nada más:**

| Campo | Por qué |
|---|---|
| Cliente | De quién es. Se elige de los existentes; **no se crean clientes aquí** |
| Matrícula | Ya viene del paso 1 |
| Configuración de ejes | De ella sale el tipo, y del tipo las posiciones |
| Medida principal | Qué goma monta |
| Nº de flota | Si lo hay |
| Kilometraje | Si se sabe |

**Marca, modelo, delegación y tipo de llanta no se preguntan**: son nulables y
se completan después desde el panel.

La configuración de ejes se elige **en dibujos**, de las que ya existen
(`2x2`, `2x4`, `2x2x2`, `2x2x4`, `2x4x4`, `2x2x2x2`), siempre de delante hacia
atrás. Si ninguna encaja, el parte continúa y queda anotado para que un
administrador cree el tipo: **no se inventan configuraciones desde la tablet**,
porque eso significa crear tipos de vehículo, que es otra cosa.

Antes de guardar, enseñar el plano con los ejes y las posiciones para que el
operario confirme.

Al confirmar: crear el vehículo, asociarlo al cliente, generar sus posiciones,
registrar quién lo creó y cuándo, **marcarlo pendiente de validar**, y seguir
con el parte sin salir del flujo.

El duplicado lo impide `unique (empresa_id, matricula)`: se intenta el alta y,
si choca, se ofrece el vehículo que ya existía.

## Pasos siguientes

Se adaptan a lo que el parte y las operaciones ya guardan:

1. Vehículo confirmado.
2. Cabecera: kilometraje, lugar del servicio, orden de flota.
3. Las ruedas, **sobre el plano**: se toca una posición y se dice qué le pasa.
4. Mediciones y estado de la posición tocada (ver Decisión 2).
5. Neumáticos desmontados y montados — salen del paso 3, aquí se revisan.
6. Neumáticos del almacén, nuevo o usado, cuando corresponda.
7. Servicios facturables con su cantidad.
8. Fotografías y observaciones.
9. Revisión final.
10. Firmas.
11. Guardar.

**Las tablas de desmontados y montados no se rellenan como listas.** El papel
las tiene así, pero copiarlas literalmente produce filas sin posición, y una
fila sin posición no alimenta el histórico. Se rellenan tocando la rueda, y las
dos tablas del PDF salen solas.

El indicador de progreso dice el número real de pasos, no diez fijos.

## Uso en tablet

Botones grandes; un grupo de datos por pantalla; «Anterior» y «Continuar»
fijos; «Continuar» solo activo con lo obligatorio cubierto; teclado numérico
para kilómetros y milímetros; valores frecuentes como botones; el plano
táctil, con la posición en curso resaltada y las hechas marcadas; nada de
desplegables minúsculos; confirmación antes de terminar; errores en castellano
llano.

Estilo: el de TyreControl. Misma paleta, tipografía, componentes, iconos y
navegación. No se rediseña la aplicación.

## Fotografías

Como ayuda para rellenar, nunca como confirmación. Se enseña lo detectado, se
puede corregir todo, se avisa cuando la lectura es floja, **lo que no se lee se
deja vacío**, no se confunden dimensión, DOT y número de serie, y se puede
repetir la foto. La clave de IA no sale del servidor.

## Discrepancias

Si el neumático físico no es el registrado, el operario marca **«No coincide»**
—ya existe, en la APK y en el panel— y se reutiliza tal cual: fotografiar,
leer, corregir, buscar la ficha o crearla, y sustituir solo el registro de esa
posición.

No genera trabajo, coste, venta ni movimiento económico. Queda en el histórico
con posición, lo que figuraba, lo encontrado, usuario, fecha, motivo y fotos.

## Guardado

Borrador local mientras se avanza, para no perder nada al salir.

Al finalizar, **una sola llamada** —`tc_guardar_parte_guiado(jsonb)`— que
escriba en una transacción la intervención, las operaciones, las mediciones,
los cambios de posición, los montajes y desmontajes, los movimientos de
almacén, las correcciones, las fotos, las observaciones y las firmas. Si algo
falla, no queda nada a medias.

Con **clave de idempotencia** generada al abrir el borrador: la segunda
pulsación devuelve la misma intervención en vez de crear otra.

## Validaciones

Matrícula obligatoria y normalizada · alta de vehículo por unicidad, no por
comprobación previa · cliente obligatorio en vehículos nuevos · configuración
de ejes de las existentes · kilometraje numérico y no negativo, con aviso si es
menor que el último · posiciones válidas para ese vehículo · campos
obligatorios según la operación · un neumático no puede estar en dos
posiciones · números de serie sin duplicar · no se finaliza con pasos
obligatorios a medias · **nada definitivo se escribe hasta confirmar**.

## Qué se verifica, y quién

| Se comprueba aquí | Lo compruebas tú |
|---|---|
| `tsc`, build del panel, pruebas del servidor | El flujo en una tablet real |
| Análisis estático y build de la APK en la CI | Que la lectura por foto acierta en tu taller |
| La función de guardado, en un PostgreSQL de usar y tirar | Que el PDF sale bien impreso |

**No afirmaré que la APK funciona por tener el build verde.** El build dice que
compila, no que sirva.

## Base de datos

Migración aditiva e idempotente, sin borrar ni transformar nada. Solo lo
imprescindible, con comprobación al final que la tumbe si algo no cuadra.

---

# Parte 3 · Decisiones pendientes

## Decisión 1 · Quién da de alta un vehículo desde la tablet

| Opción | Qué implica |
|---|---|
| **A. Función acotada `tc_alta_vehiculo_desde_parte` (recomendada)** | `security definer`, crea el vehículo con esos campos, lo marca pendiente de validar y genera posiciones. El operador no gana permiso sobre la tabla: gana permiso para **una** operación. Mismo patrón que el catálogo provisional, que ya aprobaste |
| B. Abrir `tc_vehiculos` a los operadores | Una línea. Pero podrían crear, editar y borrar cualquier vehículo de su empresa desde cualquier sitio |
| C. No crear nada | Un parte que no cuelga de un vehículo no alimenta el histórico |

## Decisión 2 · ¿El flujo guiado hace también una revisión?

Tus pasos 5 y 6 piden mediciones y estado. Hoy eso es una **revisión**, no una
operación.

| Opción | Qué implica |
|---|---|
| **A. Sí: crea revisión + intervención (recomendada)** | Lo que el operario mide se guarda donde se mide hoy, y el desgaste por mil kilómetros sigue saliendo. Es más trabajo, pero es el dato que da valor al sistema |
| B. No: solo intervención | Más simple, pero las profundidades que teclee el operario no llegan al histórico de mediciones y se pierden |

## Decisión 3 · Qué pasa con la pantalla de fotos que acabamos de hacer

Fundirla dentro del flujo guiado como atajo del paso 1 **(recomendada)**, o
dejar dos botones que hacen lo mismo.

## Preguntas menores

1. **¿Sin cobertura?** Propuesta: borrador en la tablet, pero finalizar y dar
   de alta un vehículo necesitan red. Encolar un alta fabrica matrículas
   duplicadas.
2. **¿Tractora y remolque encadenados**, o dos partes independientes?
3. **¿Azulejo en Inicio o sexta pestaña abajo?** Propongo azulejo.
4. **¿Quién valida los vehículos nacidos en la tablet**, y en qué pantalla del
   panel?
