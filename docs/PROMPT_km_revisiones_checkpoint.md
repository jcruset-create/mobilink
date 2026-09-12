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

El autobús cruza el arco **al terminar servicio**, y acto seguido se queda
parado en la base. Entre el paso y la mañana siguiente el odómetro no se mueve.

Y pasar por el arco **es entrar en la base**. Eso ya lo detectamos:
`server/webfleetSync.ts` (`syncWebfleetOnce`) cruza la posición contra el
geocerco de la delegación (`tc_delegaciones.webfleet_lat/lng/webfleet_radio_m`,
300 m por defecto) y mantiene `estado`, `entrada_base_at` y **`odometro_km`** en
`tc_vehiculo_webfleet_estado`.

Es decir: **el kilometraje del momento del paso ya se está calculando hoy**.
Pero esa tabla tiene `primary key (vehiculo_id)` —es un estado actual— y la
siguiente pasada del sync lo sobreescribe. Se está tirando.

## Camino principal: una foto del odómetro en cada entrada en base

Guardar el odómetro cada vez que un vehículo entra en base. **Una fila por
estancia, no una por pasada del sync**: es una al día por autobús, barato y
acotado.

Cuando el informe del arco llegue tres días después, el importador no pregunta
nada a nadie: busca la foto más cercana a `medido_at` y la encuentra a minutos.
Exactitud de tiempo real sin depender de que Bridgestone haga una API — y si
algún día la hace, es el mismo camino con la latencia a cero, no se tira nada.

Trabajo:

1. Tabla nueva para las fotos (p. ej. `tc_odometro_entradas`): `vehiculo_id`,
   `empresa_id`, `delegacion_id`, `entrada_base_at`, `odometro_km`,
   `capturado_at` (el `pos_time` de la lectura, que NO es lo mismo que la hora
   de entrada), `provider`, `account_key`. Único por
   `(vehiculo_id, delegacion_id, entrada_base_at)`, igual que ya hace
   `tc_webfleet_alertas` con la estancia. Retención: decidir y dejarla escrita.
2. Escribir la foto donde ya se detecta la entrada nueva en `webfleetSync.ts`
   (busca `esNuevaEntrada`). No inventar un segundo detector.
3. Enchufarle a Movertis la misma lógica de geocerco: `showvehicles` trae
   posición y `counters.odometer`, así que la detección de base es la misma
   cuenta. Ojo con el nombre de la tabla `tc_vehiculo_webfleet_estado`: es de
   Webfleet por historia, no por diseño; decide si se generaliza o si Movertis
   escribe en ella, pero no dupliques la lógica.
4. En la importación del arco (`server/tyrecontrol/checkpointImport.ts`, insert
   de `revisiones_vehiculo` sobre la línea 208, y su gemela del panel
   `src/modules/tyrecontrol/services/importCheckpoint.ts`), resolver
   `km_vehiculo` buscando la foto más cercana a `medido_at`.

## Red: preguntar el actual, con prueba de inmovilidad

Para el vehículo que no tenga foto de esa entrada. Se pregunta el odómetro
actual y **se demuestra que no se ha movido** desde `medido_at`: aquí
`showtrips` sirve justo para eso. No tiene odómetro, pero tiene posiciones, así
que prueba que un vehículo NO se ha movido. El histórico de posiciones es
inútil para reconstruir kilómetros y perfecto para validar que los de hoy
siguen siendo los de ayer.

- No se ha movido → el actual es el del paso: `km_vehiculo` real.
- Se ha movido → `null` con su motivo, o estimado y marcado como tal. **Nunca**
  el actual disfrazado de exacto.

Dos trampas:

- **Los autobuses salen muy temprano.** Si el informe entra a las 08:00 y el
  autocar salió a las 06:30, esta red ya ha perdido para esa unidad. Por eso la
  consulta va **encadenada a la importación**, no a una hora fija.
  Antes de invertir mucho aquí, **mide sobre datos reales cuántas unidades
  siguen en base cuando llega el informe**: es lo que dice cuánto vale esta red.
- **El odómetro de un vehículo parado puede venir «viejo»** porque el GPS se
  duerme. Aquí es una ventaja: la última lectura es la de la llegada. Pero hay
  que guardar `capturado_at` y el desfase.

## Procedencia obligatoria (envuelve a las dos)

Un km sin procedencia ni desfase es justo el dato que el Telematics Hub existe
para no producir. Mira cómo lo hace `server/tyrecontrol/kilometrajeOperacion.ts`
—que ya redacta la nota con proveedor, desfase y tolerancia— y sigue el mismo
criterio.

- `OrigenKm` es hoy `"manual" | "webfleet" | "importacion_excel"`
  (`src/modules/tyrecontrol/types/index.ts:141`). Ampliarlo, y actualizar
  `ORIGEN_KM_LABELS` (línea 546) para que el panel lo sepa nombrar.
- En `revisiones_vehiculo`, junto a `km_vehiculo` y `origen_km`: `km_capturado_at`
  y `km_desfase_min`. La escalera de confianza del Hub (±5/±15/±30/±60) ya está
  en `VehicleOdometerService.ts`; usa sus peldaños, no inventes otros.
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
- **Sin unidad de odómetro declarada, no hay odómetro.** `MovertisConfig.odometroEn`
  es obligatoria a propósito; ver la trampa de las unidades en
  `server/integration-hub/connectors/telematics/movertis/mapeo.ts`.
- **Nada de reconstruir kilómetros sumando tramos GPS** para dar un km como
  real: el requisito es que cuadre con el cuadro de mandos. Si alguna vez se
  hace, sale marcado `odometerSource: "gps"`, que es lo que
  `kilometrajeOperacion.ts` ya avisa.
- `medido_at` es cuándo se midió, `created_at` cuándo se grabó, y `momento` es
  la generada por la que ordena el histórico
  (`supabase/migrations/tyrecontrol_revision_momento.sql`). No las confundas: el
  km se busca contra `medido_at`.

## Qué NO hacer

- Pedir el km al conductor en la pasada: el sentido del arco es que nadie baje
  ni teclee nada.
- Esperar a que Bridgestone tenga API. Preguntar si el informe puede traer el
  odómetro cuesta un correo y vale la pena; esperarla, no. El camino principal
  no la necesita.
- Escribir una foto del odómetro en cada pasada del sync «por si acaso». La
  entrada en base es el disparador correcto: uno al día por vehículo.
