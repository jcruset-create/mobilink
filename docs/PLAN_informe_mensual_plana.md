# Replicar el informe mensual de Plana con los datos de TyreControl

Plan previo. **No se programa nada hasta que esto esté acordado.**

Referencia: `Informe_Plana_2023_12_DICIEMBRE_1.pdf` — 81 páginas A4, diciembre
de 2023, 590 autobuses, 3.604 neumáticos revisados. Hecho por Grupo Soledad.

---

## 1 · Qué es el documento, por dentro

No es un informe: son **siete informes distintos encuadernados juntos**, y
conviene verlos por separado porque ni cuestan lo mismo ni dependen de los
mismos datos.

| # | Páginas | Bloque | Qué es |
|---|---|---|---|
| A | 1–2 | **Portada y estado de la flota** | Recuentos, silueta del bus y cuatro matrices por posición: marca, medida, rayadas/recauchutadas y profundidades |
| B | 2 | **Profundidades por medida** | Matriz medida × milímetro (17→2 mm), agrupada por llanta 22,5" / 17,5"–19,5" / 16". Y la misma para reesculturados |
| C | 3–7 | **Evolución de 12 meses** | Tabla y barras apiladas de los seis niveles de desgaste, mes a mes, en unidades y en porcentaje |
| D | 8 | **Medida × marca** | Matriz de doble entrada, 21 medidas × 19 marcas. Y la misma para reesculturados |
| E | 9–10 | **Quesitos** | Estado del banco de goma y recauchutadas/reesculturadas, con su tabla de 12 meses al pie |
| F | 11–59 | **Detalle vehículo a vehículo** | 49 páginas. Seis autobuses por página, seis líneas cada uno: marca, modelo, recauchutada, reesculturada, profundidad y trabajo a realizar, por posición |
| G | 60–73 | **Listados por banda de profundidad** | Un listado por banda (hasta 4 mm, >4<6, >6<8, >8<10, >10<12, >12) |
| H | 74–81 | **Lista de planificación del mes siguiente** | Mismo formato que G, con toda la flota |

Y una maqueta constante en las 81 páginas: banda roja a la izquierda,
cabecera con el logo de Grupo Soledad y el sello UNE 66102, la mascota, y un
pie con los logos de VDO, Goodyear, Conti360, INSA Turbo y demás.

---

## 2 · Qué tenemos y qué no

Esto es lo que decide si el informe se puede replicar, así que va comprobado
contra producción, no de memoria.

### Lo que está entero

| Dato del informe | De dónde sale | Estado |
|---|---|---|
| Flota controlada | `tc_vehiculos` de la empresa | ✅ |
| Flota revisada / pendientes | `revisiones_vehiculo` en el mes | ✅ |
| Profundidad por posición | `revisiones_neumaticos_detalle.profundidad_mm` — 65.957 filas | ✅ |
| Marca, modelo y medida por posición | `tc_neumaticos` vía `tc_montajes_actuales` | ✅ |
| Base del vehículo | `tc_delegaciones` | ✅ |
| Fecha de la última revisión y km | `revisiones_vehiculo` | ✅ |
| Número de unidad y matrícula | `tc_vehiculos` | ✅ |
| Silueta del bus con posiciones | `imagen_chasis_url` + `VehicleLayoutImage` | ✅ |
| Las seis bandas de profundidad | Son los mismos cortes que los «niveles de desgaste» del original: nivel 1 = menos de 4 mm (cambiar), nivel 6 = más de 12 mm | ✅ |

Los bloques **A, B, D, E (los quesitos), F, G y H se pueden replicar con lo
que hay.** Es la mayor parte del documento: 77 de las 81 páginas.

### Los tres huecos, medidos

**1 · «RAYADAS» no existe como dato.**

El original cuenta 215 rayadas en diciembre de 2023, repartidas por posición.
En TyreControl no hay ningún campo para eso. El más cercano es
`revisiones_neumaticos_detalle.estado_visual`, y está **vacío en la práctica**:

```
(nulo)                66.850
desgaste_irregular         5
correcto                   2
dano_lateral               1
```

Ocho filas de 66.856. No es que el campo esté mal: es que nadie lo rellena,
porque la tablet no lo pide. Esa fila del informe saldría a cero, lo cual es
peor que no sacarla — un cero dice «no hay ninguna rayada», y lo que pasa es
que no se miran.

**2 · «RECAUCHUTADA» y «REESCULTURADA» están casi vacías.**

`tc_neumaticos.reesculturado` está marcado en **16 de 6.541** neumáticos. El
original contaba 36 recauchutadas y 110 reesculturadas solo en 295/80R22,5.

Recauchutada ni siquiera es un campo del neumático: es la *condición de la
operación de montaje* (`shared/condicionNeumatico.ts`), y solo se conoce
cuando el montaje vino del histórico de albaranes importado o salió del
almacén de usados.

**3 · No hay doce meses de histórico.**

El bloque C son cinco páginas de evolución mensual. Esto es lo que hay para
Plana:

| Mes | Revisiones | Vehículos |
|---|---:|---:|
| 2026-11 | 503 | 258 |
| 2026-10 | 3.890 | 340 |
| 2026-09 | 2.847 | 338 |
| 2026-08 | 2.502 | 353 |
| 2026-07 | 77 | 77 |
| 2026-06 | 40 | 40 |
| 2026-05 | 17 | 17 |
| 2026-01 | 155 | 153 |
| 2025-12 | 65 | 63 |

**La operación de verdad empieza en agosto de 2026.** Antes son cuatro
revisiones sueltas al mes. Dibujar doce barras con eso daría una gráfica
descendente espectacular que no cuenta nada sobre los neumáticos: cuenta
cuándo se empezó a usar TyreControl.

### Y una diferencia que no es un hueco, pero hay que decirla

El original pone **FLOTA REVISADA 590 — 100,00%**. Hoy en TyreControl Plana
tiene **807 vehículos** y en el mejor mes se revisaron **353**. El informe
replicado va a enseñar una cobertura del 40 %, no del 100 %. Eso no es un
fallo del informe: es lo que hay, y el informe debe decirlo tal cual.

---

## 3 · Cómo se construye

### Por dónde: HTML que se imprime, no PDF dibujado a mano

Hay dos caminos en el repositorio y la elección no está reñida:

- **PDF en servidor con `pdf-lib`** (lo de `informePendientes/pdf.ts`). Va muy
  bien para tablas. Para los quesitos y las barras apiladas habría que
  dibujar arcos a mano, punto por punto.
- **HTML + impresión del navegador** (lo del informe ejecutivo). Ya tiene
  resuelto lo que aquí cuesta: la cabecera de marca (`CabeceraInforme`), las
  reglas de impresión A4 (`src/estilos/impresion.css`), el corte de página
  (`.bloque-informe`) y las gráficas en SVG escrito a mano
  (`components/informes/charts.tsx`, más el quesito en 3D del ejecutivo).

**Se hace por HTML.** Es reutilizar lo que se mergeó en #555 en vez de
reimplementarlo en otro lenguaje, y un informe de 81 páginas con quesitos no
se dibuja a mano dos veces.

### El cálculo, en el servidor y en un sitio

Una RPC o un módulo de servidor que devuelva **el informe entero como un
objeto**, igual que `tc_informe_ejecutivo`. Nada de que la pantalla sume.
Razones de peso, las dos ya vividas en este proyecto:

- El mismo número tiene que salir igual en la pantalla y en el papel.
- Son 590 vehículos × 10 posiciones; agregar eso en el navegador significa
  bajarse 65.000 mediciones.

Y **paginando con orden fijo**: el tope de 1.000 filas de PostgREST se come
una flota de 807 vehículos sin avisar.

### Un aviso de rendimiento que ya nos ha mordido hoy

Este informe lee más que el ejecutivo, y el ejecutivo caducaba. Acabamos de
arreglarlo (#558, la RLS costaba una consulta por fila). Con eso hay margen,
pero el informe mensual hay que medirlo desde el primer día, no al final:
si vuelve a rozar los 8 segundos, el siguiente paso ya está escrito en la
cabecera de esa migración.

---

## 4 · Lo que necesito que decidas

Son cuatro, y las cuatro cambian lo que se programa.

### 4.1 · La marca de la portada

El original es de **Grupo Soledad**: su logo, su sello UNE 66102, su mascota
y los logos de sus proveedores en el pie.

| Opción | Qué implica |
|---|---|
| **a) Marca Mobilink TyreControl** | Ya está hecho (`CabeceraInforme`, con el nombre del taller y del cliente). Cero trabajo, y es lo coherente si el informe lo emite Mobilink |
| **b) Reproducir la de Grupo Soledad** | Hacen falta los ficheros de los logos y permiso para usarlos. No los tengo y no los voy a sacar del PDF |
| **c) Cabecera configurable por empresa** | Logo y pie subidos por el cliente. Más trabajo, pero vale para el siguiente cliente |

**Mi recomendación: (a) ahora, (c) si alguien más lo pide.**

### 4.2 · Qué hacer con los tres huecos

Para cada uno:

- **Rayadas** — ¿se quita la fila, se deja en blanco con una nota, o se
  empieza a pedir el dato en la tablet? Lo tercero es un cambio en la app de
  revisión, no en el informe.
- **Recauchutadas / reesculturadas** — ¿se saca con los 16 que hay, sabiendo
  que el número es falso por defecto, o se deduce de la condición del montaje
  cuando se conozca?
- **Evolución de 12 meses** — ¿se enseñan solo los meses con datos de verdad
  (de agosto de 2026 en adelante) y se dice «desde que se usa TyreControl», o
  se espera a tener doce meses?

**Mi recomendación**: enseñar lo que hay, diciendo desde cuándo. Una gráfica
de cuatro meses bien etiquetada es útil; una de doce con ocho a cero es una
mentira con forma de gráfico.

### 4.3 · «TRABAJO A REALIZAR» y «PTE. REPARAR»

El original las lleva en el detalle por vehículo y en los listados. Hoy no
tengo claro de dónde saldrían: ¿de las incidencias abiertas (`tc_incidencias`,
29 ahora mismo), de las observaciones de la medición, o es una columna que se
rellenaba a mano en el Excel? Dímelo y la enchufo; si era a mano, lo dejo como
columna vacía para escribir sobre el papel, que es para lo que servía.

### 4.4 · ¿Las 81 páginas, o lo que se mira?

49 de las 81 son el detalle vehículo a vehículo. Pregunta honesta: **¿alguien
se lee esas 49 páginas, o se consultan buscando un autobús concreto?** Porque
si es lo segundo, eso ya es la ficha del vehículo en TyreControl, y el informe
mensual puede quedarse en los bloques A–E y G–H — unas 25 páginas — con el
detalle como anexo opcional.

No lo decido yo: si el cliente espera su tocho de 81 páginas, se hace el tocho.

---

## 5 · Por dónde empezaría

En cuatro fases, cada una entregable y revisable por su cuenta:

| Fase | Qué | Páginas del original |
|---|---|---|
| **1** | El cálculo en el servidor y los recuentos de flota, con sus pruebas | A |
| **2** | Las cuatro matrices por posición y la de medida × marca | A, B, D |
| **3** | Los quesitos y la evolución mensual con los meses que haya | C, E |
| **4** | El detalle por vehículo y los listados por banda | F, G, H |

La 1 y la 2 son donde está el riesgo de que los números no cuadren; las
otras dos son maquetación sobre datos ya probados.

---

## 6 · Lo que este informe NO va a hacer

Lo mismo que el resto: no escribe nada. Ni montajes, ni neumáticos, ni ejes,
ni `km_actual`. Es un informe.

---

## Para contestar

1. Marca de la portada: **(a)**, (b) o (c).
2. Rayadas, recauchutadas y evolución: enseñar lo que hay, o esperar.
3. De dónde sale «TRABAJO A REALIZAR» y «PTE. REPARAR».
4. Las 81 páginas o la versión corta.

Con eso empiezo por la fase 1.
