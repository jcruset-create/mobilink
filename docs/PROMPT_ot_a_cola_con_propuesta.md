# Prompt — De la orden de trabajo (PT) a la cola, con técnico propuesto

> Documento previo a programar. Recoge lo que se pide, lo que ya existe en el
> repositorio, las decisiones abiertas y el plan por fases.
> **No implementar nada hasta confirmar las decisiones del punto 4.**

## 1. Qué se pide

Partiendo del parte de trabajo que imprime el ERP (Comercial Sea / Grupo
Soledad), poder **volcarlo a los trabajos pendientes de asignar** y que la
aplicación **proponga a quién asignarlo**, en vez de teclear la entrada a mano.

## 2. Qué trae el papel

Del PT escaneado (`PT Nº D2_26/62`, 10/09/2026) salen estos datos:

| Bloque | Campos |
|---|---|
| Cabecera | `PT Nº`, Fecha, Entrada (fecha **y hora**) |
| Cliente | Nombre, domicilio, población, **CIF**, teléfono |
| Vehículo | **Matrícula** (`8072MNC`), KM, geometría |
| Examen | 23 posiciones de rueda, presiones por eje (1-6) |
| Recomendaciones | Texto libre por eje |
| **Operaciones a realizar** | Operación, unidades, precio *(vacío en este parte)* |
| **Productos y servicios** | Descripción, unidades, precio unitario, precio total |
| Firmas | Conf. Cliente, **Conf. Técnico** (`NEUS.02`) |

Las líneas de este parte concreto:

```
MONTAJE CAMION MAYOR 19.5"            4,00   18,54 €    74,16 €
MONTAJE FIJACIÓN(QUIT.PONER)CM        4,00   17,14 €    68,56 €
ALARGADERA PLASTICO 170               2,00    0,00 €     0,00 €
ALARGADERA ACODADA 50º CAMION B1198X  2,00    0,00 €     0,00 €
315/70X22.5 SAILUN SDL1 154L          4,00  600,00 €  2.400,00 €
ROBLES                                1,00    0,00 €     0,00 €
```

Lo importante para planificar: **el trabajo real está en las líneas de
servicio** (los dos MONTAJE), no en las de material. Cuatro montajes de camión
más cuatro fijaciones. El neumático, las alargaderas y "ROBLES" son material y
no consumen tiempo de taller.

## 3. Qué hay ya construido (no hay que inventarlo)

### 3.1 La bandeja de pedidos del ERP ya existe
`src/modules/workplanner/PedidosErpPage.tsx` — sección **Pedidos ERP** del menú.
El pedido nace en Business Central, baja al Integration Hub por sincronización y
aquí se consulta la copia local:

- `GET /api/v1/erp/sales-orders` (listado) y `/:id` (con líneas).
- Cada línea trae `tipo`, `bc_item_number`, `descripcion`, `qty_prevista`,
  `qty_consumida`, `um`, `precio_bc`.
- `wp_status` es el estado de planificación, **propiedad de WorkPlanner**, que
  nunca viaja a BC: `nueva → planificada → en_curso → finalizada`, más
  `cancelada_por_erp`.
- `PUT /api/v1/erp/sales-orders/:id/planning` cambia ese estado.

**Este es el sitio natural del PT.** Si el parte ya está en BC, no hay que
escanear nada: el pedido ya está en la bandeja y lo que falta es el puente
"pedido → trabajo de taller".

### 3.2 El motor de asignación ya propone técnico
`src/modules/assignment.ts`:

- `findCandidatesForArea` filtra por competencias del técnico y disponibilidad.
- `filterCandidatesByTemplate` / `sortCandidatesByTemplate` aplican
  `allowedTechs` y `priorityOrder` de la entrada rápida.
- `getOrderedCandidatesForJob` ordena además por **quién es más rápido en esa
  operación** (`techStats.fastestTech`, −500 de bonus) y por **carga acumulada**
  (`getTechLoadPenalty`).
- `desempatePorArea` rompe empates por el orden oficial del área.
- `allocateJobPure` devuelve responsable y apoyo, y `getAssignmentReason`
  redacta el porqué en una frase.

**No hay que escribir un algoritmo de asignación: ya está y está probado.**

### 3.3 El flujo de propuesta ya existe
Un trabajo con `status: "validacion"` es exactamente eso: una **propuesta** con
técnico asignado que espera confirmación humana. En Operativo 2 sale en
"Pendientes de validar", con botones para autorizar (`authorizeProposedJob`),
rechazar (`rejectProposedJob`), cambiar responsable
(`updateValidationResponsible`) o añadir apoyo.

**Ese es el destino correcto del PT**: no "cola a secas", sino propuesta con
técnico ya sugerido y el motivo escrito.

### 3.4 Las entradas rápidas son el catálogo de operaciones
`QuickTemplate`: `key`, `label`, `area`, `mode`, `allowedTechs`,
`priorityOrder`, `standardMinutes`, y en V2 `usesQuantity`, `unitMinutes`,
`unitPrice`. Un montaje de camión por cantidad ya sabe cuántos minutos cuesta
cada unidad.

## 4. Decisiones que hay que tomar antes de programar

Estas cambian el resultado; el resto son detalles de implementación.

1. **¿De dónde entra el PT?** Tres caminos, muy distintos en coste:
   - **(a) Desde el pedido de BC que ya está en la bandeja.** Botón "Crear
     trabajo" en Pedidos ERP. Cero OCR, cero papel, datos limpios.
   - **(b) Tecleando el `PT Nº`** y que la aplicación se lo traiga de BC.
   - **(c) Escaneando el PDF** y leyéndolo con IA.
   **Propuesta: (a) primero.** Si el PT sale del ERP, su pedido ya está en la
   bandeja: (c) es resolver con OCR un problema que no existe. Dejar (c) para
   partes de terceros que no pasan por BC, si es que los hay.
   → **Esta es la decisión que más trabajo ahorra o desperdicia. Contéstala.**

2. **Cómo se traduce una línea del ERP a una entrada rápida.** `MONTAJE CAMION
   MAYOR 19.5"` tiene que acabar siendo una plantilla del taller con su área y
   sus minutos. Hace falta una **tabla de correspondencias** `bc_item_number` →
   `templateKey`, editable desde la aplicación, porque el catálogo de BC cambia
   y nadie va a tocar código por ello.
   **Propuesta: tabla nueva, con una pantalla para mantenerla**, y las líneas
   sin correspondencia se enseñan para mapearlas a mano en el momento.

3. **Qué líneas generan trabajo.** Propuesta: **solo las de servicio**. El
   material (neumáticos, alargaderas) viaja al trabajo como referencia, para que
   el técnico sepa qué montar, pero no suma tiempo ni genera tarea propia. La
   marca de qué es servicio y qué es material sale del `tipo` de la línea del
   ERP, no de adivinar por la descripción.

4. **Un trabajo o varios.** El parte tiene 4 montajes + 4 fijaciones. ¿Un solo
   trabajo con cantidad 4 y las fijaciones como tarea incluida, o dos trabajos?
   **Propuesta: un trabajo por línea de servicio**, con `quantity` de la línea,
   agrupados por `linkedGroupId` para que se vean juntos y se puedan encadenar
   como ya hacen los trabajos combinados.

5. **Qué pasa si el vehículo no está.** Matrícula `8072MNC` puede no existir en
   la aplicación. **Propuesta: se crea el trabajo igual**, con la matrícula del
   parte; el trabajo de taller no puede quedarse bloqueado por una ficha.

6. **Hora de entrada.** El parte trae `Entrada: 17:27:57`. **Propuesta: se
   respeta como hora de llegada** del trabajo, no la hora en que alguien lo
   vuelca. Si no, la cola se ordena mal y los tiempos de espera mienten.

## 5. Qué debería pasar al pulsar el botón

Desde **Pedidos ERP**, en un pedido con `wp_status: "nueva"`, botón
**"Crear trabajo en taller"**:

1. Se leen las líneas y se separan servicios de material.
2. Cada línea de servicio se traduce a una entrada rápida con la tabla de
   correspondencias. Las que no casen se enseñan en un diálogo para resolverlas
   ahí mismo (elegir plantilla, o marcar la línea como material).
3. Se construye el trabajo: matrícula, cliente, teléfono, cantidad, minutos
   estimados (`unitMinutes × cantidad`), material como referencia, y el `PT Nº`
   guardado para poder volver del trabajo al pedido.
4. Se pasa por `allocateJobPure` y el trabajo entra en **`validacion`** con el
   responsable propuesto, el apoyo si el área lo pide, y el motivo redactado por
   `getAssignmentReason`.
5. El pedido pasa a `wp_status: "planificada"`.
6. En Operativo 2 aparece en **Pendientes de validar** con el técnico propuesto,
   listo para autorizar de un clic o cambiarlo.

Y en la tarjeta de la propuesta, **por qué se propone a ese técnico**: no basta
con el nombre. Algo del estilo "Ramón · es el más rápido en montaje de camión
(18 min de media) y es el que menos carga lleva hoy". La información ya está en
`techStats` y `techLoadStats`; solo hay que enseñarla.

## 6. Cambios de datos

- **Tabla de correspondencias** `erp_item_plantilla`: `bc_item_number`,
  `templateKey`, `workshopId`, `createdAtMs`, `updatedAtMs`. Con su
  `CREATE TABLE IF NOT EXISTS` en `server/db.ts` y su fichero en
  `supabase/migrations/`.
- **Enlace pedido ↔ trabajo**: `jobs.erpOrderId` y `jobs.erpPtNumber`, con
  `ADD COLUMN IF NOT EXISTS`. Sirve para volver del trabajo al pedido y para no
  volcar dos veces el mismo pedido.
- Endpoints nuevos con **upsert fila a fila**, nunca reemplazando la colección
  entera: es el error que ya ha costado tres pérdidas de datos en este
  repositorio (recordatorios de agenda, estados de técnico y citas).

## 7. Lo que hay que probar

Módulo puro `src/modules/erpPedidoATrabajo.ts`, sin React ni red:

- Línea de servicio con cantidad 4 → un trabajo con `quantity: 4` y
  `unitMinutes × 4` minutos.
- Línea de material → **no** genera trabajo, viaja como referencia.
- Línea sin correspondencia → se devuelve como "pendiente de mapear", no se
  descarta en silencio ni se inventa una plantilla.
- Pedido sin ninguna línea de servicio → no crea nada y lo dice.
- Pedido ya volcado → no se duplica (`erpOrderId` ya presente).
- Cantidad 0, negativa o no numérica → no genera trabajo.
- La hora de entrada del parte se respeta como hora de llegada.

## 8. Plan por fases

**Fase 1 — la traducción.** `erpPedidoATrabajo.ts` y sus tests. Sin pantalla y
sin backend. Se entrega con la suite en verde.

**Fase 2 — la tabla de correspondencias.** Tabla, endpoints y la pantalla para
mantenerla, con el diálogo de resolver líneas sin mapear.

**Fase 3 — el botón y la propuesta.** "Crear trabajo en taller" en Pedidos ERP,
paso por `allocateJobPure`, entrada en `validacion` y `wp_status: planificada`.
Explicación del porqué en la tarjeta de la propuesta.

**Fase 4 (solo si hace falta).** Lectura del PDF con IA, para partes que no
pasen por Business Central. **No empezar sin haber contestado la decisión 1.**

## 9. Restricciones del repositorio

- `git pull` antes de empezar y `bash scripts/check-versions.sh` antes de cada
  commit (ver `CLAUDE.md`).
- Validar con **`npx tsc -b`**, no con `tsc -p tsconfig.json`: ese fichero es
  solo una solución con `references`, no compila nada y pasa en silencio. Más
  `npx vite build` y `npx vitest run`.
- Subir `APP_VERSION` y `package.json` en cada entrega.
- `workplanner` es licenciable por separado: lo nuevo va dentro del módulo.

## 10. Lo que este documento NO decide

Las seis decisiones del punto 4. Hace falta respuesta al menos a la **1** (por
dónde entra el parte) y a la **4** (un trabajo o varios) para poder empezar la
fase 1 sin tener que rehacerla.
