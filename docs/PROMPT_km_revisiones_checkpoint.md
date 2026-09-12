# Los kilómetros en las revisiones del CheckPoint

Rama de trabajo: `claude/sonda-movertis-hy5ua8`
Lee `CLAUDE.md` antes de empezar (pull, `scripts/check-versions.sh`, PR y merge).

## El problema

El CheckPoint de Bridgestone es un arco por el que pasa el autobús y que le lee
presión y profundidad de todas las ruedas sin que nadie baje. Su informe entra
solo, por correo (`server/checkpointMail.ts`, mira el buzón cada 15 min), y se
importa a `revisiones_vehiculo` + `revisiones_neumaticos_detalle`.

El arco **no lee kilómetros**. Está dicho en
`src/modules/tyrecontrol/services/importCheckpoint.ts:94`:

> «El arco no lee kilómetros: no hay km que apuntar ni origen que presumir.»

Así que las revisiones del arco entran con `km_vehiculo` a null y `origen_km` a
su default `'manual'` —que además es falso—, y sin km no hay desgaste por
1.000 km, ni planes por km fieles, ni «este neumático se montó a 512.480 y se
desmontó a 578.864».

Lo que el arco SÍ da es el **instante** (`medido_at`) y la **identidad**
(matrícula). Los kilómetros salen de la telemática, siempre. El problema, por
tanto, no es de dónde sacar el número: es que cuando el informe llega, el
instante que importa ya es pasado, **y Movertis no sabe decir el odómetro de un
instante pasado** (`showtrips` devuelve `{time, timeString, pos}`: posiciones,
sin odómetro ni distancia). Autocares Plana es Movertis.

## El dato que lo resuelve: el arco está A LA ENTRADA

El autobús cruza el arco **al terminar servicio** y acto seguido se queda parado
en la base. Cruzar el arco **es entrar en la base**, y eso ya lo detectamos:
`server/webfleetSync.ts` (`syncWebfleetOnce`) cruza la posición contra el
geocerco de la delegación (`tc_delegaciones.webfleet_lat/lng/webfleet_radio_m`,
300 m por defecto) y mantiene `estado`, `entrada_base_at` y **`odometro_km`** en
`tc_vehiculo_webfleet_estado`.

Es decir: **el kilometraje del momento del paso ya se está calculando hoy**.
Pero esa tabla tiene `primary key (vehiculo_id)` —es un estado actual— y la
siguiente pasada del sync lo sobreescribe. Se está tirando.

Y la salida también se puede detectar y tampoco se guarda: el bucle tiene el
estado anterior en `previos` (`delegacion_id`, `estado`, `entrada_base_at`), así
que `en_base → en_ruta` ES la salida. Al irse a ruta, `delegId` queda a null, la
estancia se descarta y el odómetro de ese momento se tira igual que el de la
entrada.

## El camino: histórico de estancias, con entrada Y salida

No una foto por entrada: **una fila por estancia**, que se abre al entrar y se
cierra al salir. Guardar los dos odómetros es lo que convierte una lectura en un
dato confirmado dos veces:

- **El paso queda acotado, no estimado.** El arco está a la entrada, así que el
  km del paso es el de la entrada y el de la salida siguiente es el techo:
  `km_paso ∈ [km_entrada, km_salida]`. Iguales → el odómetro no se movió mientras
  estuvo parado, dato confirmado por dos lecturas independientes. Distintos →
  son maniobras dentro de la base, y la diferencia ES la incertidumbre: se
  registra, no se esconde.
- **Tapa el GPS dormido.** El odómetro de un vehículo parado puede venir viejo
  porque el GPS se duerme; la lectura de salida da una segunda oportunidad y el
  hueco entre ambas dice cuánta ambigüedad hay.
- **Los km de la jornada salen gratis y son reales.** Salida → entrada siguiente
  es el kilometraje de ese día, restando dos odómetros de verdad. Y el delta
  entre dos pasadas del arco —los mm por cada 1.000 km, que es el informe que de
  verdad se busca— es una suma de jornadas. Nada de reconstruir distancias con
  tramos GPS.

Y todo esto sin depender de que Bridgestone haga una API. Si algún día la hace,
es el mismo camino con la latencia a cero: no se tira nada.

### Trabajo

1. Tabla de estancias (p. ej. `tc_vehiculo_estancias`): `vehiculo_id`,
   `empresa_id`, `delegacion_id`, `entrada_at`, `km_entrada`,
   `km_entrada_capturado_at`, `salida_at`, `km_salida`,
   `km_salida_capturado_at`, `provider`, `account_key`. Único por
   `(vehiculo_id, delegacion_id, entrada_at)`, igual que ya hace
   `tc_webfleet_alertas` con la estancia. Retención: decidirla y dejarla escrita.
   Los `capturado_at` son el `pos_time` de cada lectura y NO son lo mismo que la
   hora de entrada o de salida: ver las trampas.
2. Abrir y cerrar la estancia donde ya se detecta la transición en
   `webfleetSync.ts` (busca `esNuevaEntrada` y el `previos` que lo alimenta). No
   inventar un segundo detector ni un segundo criterio de base.
3. Enchufarle a Movertis la misma lógica de geocerco: `showvehicles` trae
   posición y `counters.odometer`, así que la cuenta es idéntica. Ojo con el
   nombre `tc_vehiculo_webfleet_estado`: es de Webfleet por historia, no por
   diseño. Decide si se generaliza o si Movertis escribe en ella, pero no
   dupliques la lógica.
4. **Regla de casado**, en la importación del arco
   (`server/tyrecontrol/checkpointImport.ts`, el insert de `revisiones_vehiculo`
   sobre la línea 208, y su gemela del panel
   `src/modules/tyrecontrol/services/importCheckpoint.ts`): para cada revisión,
   la estancia cuya `entrada_at` esté **más cerca de `medido_at`**, y de ahí
   `km_entrada`. Con tope: si la entrada más cercana está a más de unas horas,
   **no se usa**. Ahí hay un descuadre —un paso por el arco sin entrada
   detectada, o una entrada sin paso— y vale más un null con su motivo que un
   número casado a la fuerza.

### Las trampas

- **La salida se detecta tarde.** El sync corre cada pocos minutos y el GPS
  tarda en despertar: un autobús que sale a las 06:00 puede detectarse a las
  06:07 y ya 3 km fuera. `km_salida` se pasa por arriba. No rompe nada —es el
  techo del intervalo— pero por eso se guarda el `capturado_at` de cada lectura
  y no se vende el intervalo como más estrecho de lo que es. La entrada tiene el
  problema simétrico y ahí es despreciable: el geocerco son 300 m.
- **Salidas que no son servicio**: al taller de al lado, a repostar, al
  lavadero. Fragmentan el histórico y ensucian los «km del día». No las
  clasifiques: adivinar el motivo de una salida es inventar. Registra todas las
  estancias como son y que el informe agregue por día.
- **Estancias abiertas**: salida que no llega nunca (GPS muerto, vehículo
  aparcado un mes). La fila se queda abierta y hay que saber leerla: `km_entrada`
  sola sirve, simplemente no hay intervalo.
- **El odómetro no puede bajar.** `km_salida < km_entrada` es un centinela, un
  cambio de unidad o un cambio de dispositivo: se descarta, no se apunta un
  delta negativo.

## Red: preguntar el actual, con prueba de inmovilidad

Para la revisión que no tenga estancia con la que casar —las de antes de
desplegar esto, o un vehículo cuyo geocerco no esté configurado—. Se pregunta el
odómetro actual y **se demuestra que no se ha movido** desde `medido_at`: aquí
`showtrips` sirve justo para eso. No tiene odómetro, pero tiene posiciones, así
que prueba que un vehículo NO se ha movido. El histórico de posiciones es
inútil para reconstruir kilómetros y perfecto para validar que los de hoy siguen
siendo los de ayer.

- No se ha movido → el actual es el del paso: `km_vehiculo` real.
- Se ha movido → `null` con su motivo, o estimado y marcado como tal. **Nunca**
  el actual disfrazado de exacto.

Con el histórico de estancias en marcha esto es un caso de borde, no el camino
principal. Y tiene su propia trampa: **los autobuses salen muy temprano**, así
que si el informe entra a las 08:00 y el autocar salió a las 06:30, la red ya ha
perdido para esa unidad. Por eso la consulta va **encadenada a la importación**,
no a una hora fija. Antes de invertir aquí, **mide sobre datos reales cuántas
unidades siguen en base cuando llega el informe**.

## Procedencia obligatoria (envuelve a todo lo anterior)

Un km sin procedencia ni desfase es justo el dato que el Telematics Hub existe
para no producir. Mira cómo lo hace `server/tyrecontrol/kilometrajeOperacion.ts`
—que ya redacta la nota con proveedor, desfase y tolerancia— y sigue el mismo
criterio.

- `OrigenKm` es hoy `"manual" | "webfleet" | "importacion_excel"`
  (`src/modules/tyrecontrol/types/index.ts:141`). Ampliarlo, y actualizar
  `ORIGEN_KM_LABELS` (línea 546) para que el panel lo sepa nombrar.
- En `revisiones_vehiculo`, junto a `km_vehiculo` y `origen_km`:
  `km_capturado_at` y `km_desfase_min`. La escalera de confianza del Hub
  (±5/±15/±30/±60) ya está en `VehicleOdometerService.ts`: usa sus peldaños, no
  inventes otros.
- Distinguir un km **confirmado** (entrada y salida coinciden) de uno con
  intervalo abierto. Es la diferencia que justifica haber guardado las dos
  lecturas; si al final las dos acaban en el mismo `origen_km`, no se ha ganado
  nada.
- Un km **estimado** entra en los informes de desgaste y **no** dispara un
  mantenimiento. El trigger `tyrecontrol_revision_a_mantenimiento.sql` copia
  `new.km_vehiculo` a mantenimientos y a `ultima_km`: decide ahí qué orígenes
  pasan.

## Reglas que no se saltan

- **La importación del arco nunca falla por falta de km.** Un informe de
  presiones y profundidades no puede caerse porque la telemática no conteste,
  igual que una sustitución de neumático no puede fallar porque Webfleet no
  responda.
- **Sin dato, null con motivo; jamás un cero de relleno.** Y con Movertis, ni
  `0` ni `-348201.3876` pueden convertirse nunca en «0 km»: los dos significan
  «sin lectura».
- **Sin unidad de odómetro declarada, no hay odómetro.**
  `MovertisConfig.odometroEn` es obligatoria a propósito; ver la trampa de las
  unidades en `server/integration-hub/connectors/telematics/movertis/mapeo.ts`.
- **Nada de reconstruir kilómetros sumando tramos GPS** para darlos como reales:
  el requisito es que cuadren con el cuadro de mandos. Si alguna vez se hace,
  sale marcado `odometerSource: "gps"`, que es lo que `kilometrajeOperacion.ts`
  ya avisa.
- `medido_at` es cuándo se midió, `created_at` cuándo se grabó, y `momento` la
  generada por la que ordena el histórico
  (`supabase/migrations/tyrecontrol_revision_momento.sql`). No las confundas: el
  km se casa contra `medido_at`.

## Qué NO hacer

- Pedir el km al conductor en la pasada: el sentido del arco es que nadie baje
  ni teclee nada.
- Esperar a que Bridgestone tenga API. Preguntar si el informe puede traer el
  odómetro cuesta un correo y vale la pena; esperarla, no. El camino principal
  no la necesita.
- Escribir una lectura en cada pasada del sync «por si acaso». Entrar y salir de
  la base son los dos disparadores correctos: dos lecturas al día por vehículo.
