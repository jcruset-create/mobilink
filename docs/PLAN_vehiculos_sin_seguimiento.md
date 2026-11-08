# Vehículos activos que no están en el mantenimiento integral

> Plan. **Nada de esto está programado todavía.**

## La pregunta

Hay matrículas que están **activas y en la telemática** pero **no entran en el
mantenimiento integral**: nadie les revisa los neumáticos ni se les hace
seguimiento. Hoy cuentan como un vehículo más, así que ensucian los recuentos
de los informes y aparecen en las colas de revisión como si alguien tuviera
que ir a mirarlas.

Hace falta poder decirlo desde la ficha, y que dejen de contar **sin romper
nada**.

## Lo que hay hoy, medido

En Plana, de **717 vehículos activos**:

| | |
|---|---:|
| Sin un solo montaje **y** sin una sola revisión | **108** |
| De ésos, sin tipo de vehículo | 82 |
| Creados desde la conciliación telemática | 79 |
| El resto, de la importación de Excel | 29 |

El de la captura, **1654KWF**, es exactamente eso: un Peugeot 308 de turismo,
activo, con posición conocida de hace 27 días, sin ficha técnica, sin
tacógrafo, sin montajes y sin revisiones.

Los 108 no son necesariamente todos los que hay que marcar —puede haber una
goma montada en un vehículo que tampoco esté en el contrato— ni todos los 108
hay que marcarlos. **La lista la decide una persona, no una consulta**: estar
o no en el mantenimiento integral es un hecho comercial, no se deduce de los
datos. Eso manda en todo el diseño de abajo.

## La decisión: qué es este estado y qué NO es

El repositorio ya tropezó una vez con esto. En
`server/tyrecontrol/altaOperativa/estado.ts` está escrito:

> «Mezclarlas fue el error que ya se cometió una vez: `pendiente_validar` marca
> lo segundo, y por eso NO se usa aquí.»

Así que lo primero es no volver a mezclar. Hay **cuatro** estados distintos y
este es el cuarto:

| Estado | Qué dice | Quién lo resuelve |
|---|---|---|
| `activo` | el vehículo existe y circula | oficina, al darlo de baja |
| `pendiente_validar` | le faltan datos administrativos | oficina |
| alta operativa (calculado) | no tiene tipo/plano/inventario, el técnico no puede trabajar | taller |
| **nuevo** | **no está en el contrato: nadie le hace seguimiento** | **comercial / oficina** |

Un vehículo puede estar activo, validado, perfectamente operativo **y aun así
fuera del contrato**. Y al revés. Son independientes y ninguno sustituye a
otro.

### Por qué una columna y no un cálculo

El mismo fichero dice que el estado del alta **se calcula y no se guarda**,
porque guardarlo sería «un segundo sitio donde mirar». Aquí es al revés y hay
que decirlo: **esto no se puede calcular**. Que una matrícula esté en el
mantenimiento integral es un hecho que vive en un contrato, no en la base. No
hay consulta que lo deduzca: un vehículo sin revisiones puede estar en el
contrato y llevar dos meses sin pasar, y uno con revisiones viejas puede haber
salido del contrato el mes pasado.

Dato que solo conoce una persona → columna.

## Dónde vive

```sql
alter table tc_vehiculos
  add column if not exists en_seguimiento boolean not null default true;
```

**`en_seguimiento`**, con las palabras del encargo —«no se les hace
seguimiento»—. Nombra lo que hacemos nosotros, no el contrato del cliente, que
puede llamarse de otra manera en cada empresa. La alternativa sería
`bajo_contrato`; se descarta porque mañana puede haber un vehículo propio al
que tampoco se le hace seguimiento y no es cuestión de contrato.

**`default true` es la pieza clave de «sin romper nada»**: los 909 vehículos
que hay hoy nacen en `true`, así que **el día que se aplique la migración no
cambia ni un solo número**. Lo que cambie, cambiará cuando alguien pulse el
botón.

Y con ella, dos columnas más para que el cambio deje rastro —esto mueve las
cifras de los informes y dentro de tres meses alguien preguntará por qué—:

```sql
  add column if not exists seguimiento_motivo     text,
  add column if not exists seguimiento_cambiado_en timestamptz,
  add column if not exists seguimiento_cambiado_por uuid references tc_usuarios(id);
```

Alternativa a considerar: anotarlo en `tc_vehiculo_ficha_historial`, que ya
existe y guarda `valor_anterior`/`valor_nuevo`/`motivo_cambio`/`cambiado_por`.
Es más limpio si ese historial ya se enseña en la ficha. **A decidir al
programar, mirando si esa tabla está viva.**

## El radio de la explosión, enumerado

No es una estimación: es la lista de **lo que hay hoy en producción**.

### Funciones de la base que filtran por `v.activo`: 25

**Filtran también por `en_seguimiento` (9 informes):** `tc_informes_kpis`,
`tc_informes_estado_flota`, `tc_informe_control_revisiones`,
`tc_informe_ejecutivo`, `tc_informe_ejecutivo_base`, `tc_informe_flota_detalle`,
`tc_informes_alertas`, `tc_informes_economico`,
`tc_informes_ranking_vehiculos`.

**Filtran también (4 de revisión y planificación):** `tc_revision_estado`,
`tc_plan_estado`, `tc_alta_operativa_recuentos`, `tc_pendientes_identificar`.

**NO filtran (12).** Son acciones sobre un vehículo concreto —montar,
inventariar, dar de alta un tipo— y listados de almacén o de bases. Si alguien
decide montarle una goma a un vehículo sin seguimiento, la acción **tiene que
funcionar**: bloquearla sería inventar un modo de fallo nuevo para arreglar un
problema de recuentos. `tc_alta_operativa_tipo`, `tc_alta_vehiculo_desde_parte`,
`tc_aplicar_plantilla`, `tc_montar_desde_almacen`, `tc_montar_desde_catalogo`,
`tc_montar_fuera_almacen`, `tc_inventario_inicial_finalizar`,
`tc_inventario_inicial_posicion`, `tc_imp_posiciones_norma`,
`tc_neumatico_por_identidad`, `tc_almacen_usados`, `tc_base_habitual`.

### Los tres informes nuevos

`tc_informes_km_por_mm`, `tc_informes_desgaste` y
`tc_informes_sustituciones_previstas` **no miran `activo` hoy**. Los dos
últimos se apoyan en `tc_montajes_actuales`, que ya deja fuera a los 108
actuales porque no tienen gomas. Pero un vehículo **con** gomas al que se
marque sin seguimiento sí colaría, así que los tres se filtran igual.

### Panel y servidor

| Sitio | ¿Filtra? | Por qué |
|---|---|---|
| Disponibles para revisar | **Sí** | es la cola de trabajo: ahí está el daño |
| Planificación de revisiones | **Sí** | igual |
| Lista de vehículos | **No**, pero con columna y filtro | hay que poder verlos y encontrarlos |
| Ficha del vehículo | **No** | es donde se marca y donde se ve |
| Conciliación telemática | **No** | es de donde vienen |
| Vehículos en bases · Kilómetros por vehículo | **No** | son pantallas de telemática, y en la telemática sí están |
| `resolverVehiculo` de Assist (`server/tyrecontrol/vehiculos.ts`) | **No** | si uno se avería en carretera, la asistencia tiene que encontrarlo |
| Tablet del técnico (`tyrecontrol_app`) | **Sí** | no tiene que aparecerle para revisar |

**No hay ninguna vista en la base sobre `tc_vehiculos`** —comprobado—, así que
no hay un sitio escondido más.

## Cómo se ve

**En la ficha**, junto a la chapa de «Activo», un segundo estado. Cuando está
sin seguimiento, la chapa lo dice y la ficha explica por qué está así y desde
cuándo. El botón vive en «Editar vehículo» o al lado de la chapa, y **pide un
motivo** al quitar el seguimiento: un vehículo que deja de contar sin que nadie
sepa por qué es exactamente lo que no queremos.

**En la lista de vehículos**, una columna y un filtro de tres posiciones, como
el de activos: *con seguimiento* (por defecto) / *sin seguimiento* / *todos*.

**En los informes**, y esto es lo que hace que la cifra se pueda defender:
donde hoy pone «Vehículos activos: 717» pasará a poner **«609»**, y al lado
**«+108 sin seguimiento»**. El número no encoge en silencio. Es el mismo
criterio que ya usan «Km por mm» y «Previsión de compra» con sus columnas de
letra pequeña.

## Las fases

**Fase 0 · inerte.** La migración, la columna en los tipos, el botón en la
ficha y la columna en la lista. **Ningún filtro todavía.** Se puede marcar y
desmarcar, se ve en la ficha y en la lista, y **ningún informe cambia**. Esto
se puede mergear y aplicar con cero riesgo.

**Fase 1 · las colas.** «Disponibles para revisar», «Planificación» y la
tablet. Es donde más molesta y donde el daño de equivocarse es menor: si se
filtra de más, un vehículo deja de aparecer en una lista y se nota el mismo
día.

**Fase 2 · los informes.** Los 9 + los 3 nuevos, cada uno con su «+N sin
seguimiento» al lado del total. Antes y después medidos contra producción,
informe por informe, como se hizo con el km/mm.

**Fase 3 · marcar los de verdad.** Un script que marque la lista que diga la
oficina. **No lo decide una consulta**: lo más que puedo hacer es darles los
108 candidatos para que digan cuáles sí.

## Los riesgos, y qué los tapa

| Riesgo | Qué lo tapa |
|---|---|
| Que al filtrar se caiga un vehículo que sí está en el contrato | `default true`: solo desaparece lo que alguien haya marcado a mano |
| Que un informe quede filtrado y otro no, y las cifras no cuadren | Fase 2 de una vez, con los antes/después medidos, y pruebas de que los informes cuadran entre sí |
| Que se bloquee una acción legítima sobre un vehículo marcado | Las 12 funciones de acción **no** se tocan |
| Que la asistencia en carretera no encuentre una matrícula | `resolverVehiculo` **no** se toca |
| Que alguien marque un vehículo y nadie sepa por qué | Motivo obligatorio, con quién y cuándo |
| Que se marque uno por error y no se vea | Filtro en la lista y chapa en la ficha |

## Lo que necesito que decidas

1. **El nombre.** `en_seguimiento` (lo que propongo) o `bajo_contrato`.
2. **El motivo**, ¿obligatorio u opcional? Yo lo pondría obligatorio.
3. **¿Quién puede marcar?** ¿Solo administrador, o también el cliente en su
   propia flota? Yo lo dejaría en administrador.
4. **¿Fase 0 primero y la miras**, o tiro las tres seguidas?
5. **Los 108 candidatos**: ¿te paso la lista para que oficina diga cuáles son?

---

# Lo que se hizo, y en qué se desvió del plan

Decidido: **`en_seguimiento`**, **motivo obligatorio**, **solo administrador**,
**las cuatro fases de una vez**.

Cinco cosas salieron distintas de lo planeado, todas a mejor:

**1. «Disponibles para revisar» y «Planificación» no necesitaron ni una línea.**
Las dos construyen sus filas a partir de `tc_revision_estado` y
`tc_plan_estado`, y saltan el vehículo que no tiene fila de estado. Filtrando
las dos funciones en la base, los vehículos sin seguimiento desaparecen solos.
No se añade un filtro en el cliente: dos sitios donde acertar es un sitio de
más donde fallar.

**2. La tablet tampoco.** `tyrecontrol_app` pide la cola con el mismo
`tc_revision_estado`. Su buscador de matrículas se queda abierto a propósito:
si hay que montarle una goma a uno de éstos, el técnico tiene que poder
encontrarlo. **Cero cambios en Dart y ninguna versión que subir.**

**3. El aviso «+N sin seguimiento» va en la cabecera de Informes, no en los
nueve informes.** El mismo texto repetido nueve veces son nueve sitios donde
olvidarse de uno. Arriba se ve en todas las pestañas y no se puede perder.

**4. `tc_pendientes_identificar` NO se filtra.** El plan lo metía en la lista y
estaba mal: parece de vehículos y es de NEUMÁTICOS —lista gomas sin
identificar, montadas o en almacén—. Una goma nuestra en un vehículo fuera del
contrato sigue siendo una goma nuestra sin identificar.

**5. `tc_informes_km_por_mm` tampoco, y es deliberado.** Ese informe no mide
nuestra flota, mide **modelos de neumático**. Una medición de un vehículo fuera
del contrato sigue siendo una medición buena de un AH51, y tirarla solo empeora
la cifra. El filtro va en `tc_informes_desgaste` —que sí dice a qué goma hay
que ir a cambiar— y no en la base de mediciones que los dos comparten.

**6. Las doce funciones de la fase 2 no se copian a la migración.** Copiarlas
eran 1.200 líneas duplicadas —una sola, `tc_informe_ejecutivo_base`, ocupa
18 KB— para añadirles cuatro palabras, y cada copia es una errata esperando a
pasar. La migración lee la definición que hay, le aplica la sustitución y
vuelve a crearla: dice **qué cambio hace**, no cómo queda cada función.

Y para que eso no sea un `replace` a ciegas, **cada función declara cuántas
veces tiene que casar el patrón**. Si no cuadra, la migración se para entera.
Es preferible que no entre a que entre a medias: unos informes filtrando y
otros no es peor que ninguno. Comprobado contra producción antes de darla por
buena —las once cuadran— y probado contra PostgreSQL que se niega cuando no.
