# Prompt — La tarjeta del técnico enseña todo lo que trae el parte

> Documento previo a programar. Recoge lo que se pide, lo que ya existe, lo que
> hoy se pierde por el camino, las decisiones abiertas y el plan por fases.
> **No implementar nada hasta confirmar las decisiones del punto 5.**

## 1. Qué se pide

Que la tarjeta de la pantalla de técnicos enseñe **todo lo que viene del parte
de trabajo**: la **mano de obra** —que es lo imputable— y los **materiales**.

## 2. Lo que el parte ya trae y hoy se tira

De un parte como el `D2_26/62` se leen seis líneas. Esto es lo que pasa hoy con
cada dato:

| Dato del parte | Se lee | Se guarda | Llega a la tarjeta |
|---|---|---|---|
| Descripción de la línea | Sí | Solo la principal, en `quickEntryLabel` | Sí |
| Unidades | Sí | `jobs.quantity` (solo la principal) | No |
| Minutos por unidad | Calculado | `jobs.unitMinutes` | No |
| **Precio unitario y total** | **Sí** | **No** | **No** |
| Servicios secundarios | Sí | **No** (ver 3) | Solo mientras no se recargue |
| **Materiales** | Sí | **No**, solo como texto suelto dentro de `reason` | No |
| Nº de parte | Sí | `jobs.ptNumero` | No |

O sea: **el precio se lee y se descarta**, y **los materiales solo sobreviven
como una frase** al final del motivo del trabajo. Nada de eso es consultable ni
imputable.

## 3. El problema de fondo: `includedTasks` no se guarda

La tabla `jobs` no tiene columna para `includedTasks`, y el `INSERT` de
`POST /api/jobs` lleva lista explícita de columnas. Las tareas incluidas viven
**solo en memoria del navegador**.

Para los trabajos que vienen de la agenda se disimula, porque se recuperan de la
fila de `scheduled_jobs` (JSONB) y se vuelven a aplicar al trabajo en memoria.
Pero un trabajo creado desde un parte **no tiene fila en la agenda**: al primer
refresco, sus tareas incluidas desaparecen.

Es el mismo fallo que ya se corrigió con `quantity` y `unitMinutes`, que también
vivían solo en el navegador y hacían que un montaje de 4 ruedas volviera como si
fuera uno solo. **Este hay que arreglarlo sí o sí**: sin él, lo que se pide no
se sostiene después de recargar.

## 4. Qué hay ya construido

- **La tarjeta ya tiene un bloque "Tareas incluidas"**
  (`src/components/OperariosTVView.tsx`, ~línea 1207): lista cada tarea con sus
  minutos. Solo hay que llenarlo de verdad y añadir el resto.
- **El endpoint de la tablet hace `SELECT *`**
  (`GET /api/taller-operator/jobs`), así que **cualquier columna nueva llega
  sola a la APK**. El `GET /api/jobs` del panel, igual.
- `normalizeJobRow` es el único sitio donde hay que dar de alta el campo nuevo
  para que salga tipado hacia el cliente.
- La traducción del parte (`src/modules/parteTrabajoATrabajos.ts`) ya separa
  servicios de materiales y ya construye las tareas incluidas con su cantidad,
  minutos y precio unitario. **Los materiales ya están estructurados ahí**: hoy
  se aplanan a texto en la pantalla, pero el dato existe.

## 5. Decisiones que hay que tomar antes de programar

1. **¿Qué pantalla exactamente?** Hay dos "de técnicos":
   - **(a) `OperariosTVView`** — la pantalla de TV del taller, la que se abre
     desde "Pantalla técnicos" en WorkPlanner. Es la que tiene la tarjeta grande
     con "Tareas incluidas".
   - **(b) La tablet (`taller_app`)** — la APK que usa el técnico en el tajo.
   **Propuesta: las dos, empezando por (a)**, que es donde está la tarjeta que
   describes y no requiere publicar una versión nueva del APK. La (b) sale casi
   gratis después, porque su endpoint ya devuelve todas las columnas.

2. **¿El técnico ve los precios?** Esto no es un detalle de maquetación.
   - La mano de obra imputable lleva importe (`74,16 €`, `68,56 €`), y el
     material del parte de ejemplo son **2.400 €** de neumáticos.
   - **Propuesta: el técnico ve cantidades y minutos, NO importes.** Lo que
     necesita para trabajar es qué montar y cuánto se tarda. Los importes se
     guardan igual —hacen falta para imputar— y se enseñan en el panel de
     oficina, que es quien factura.
   → **Contéstala. Si quieres los importes también en la pantalla del taller,
   se hace, pero prefiero que sea una decisión tuya y no un descuido mío.**

3. **¿Qué es "imputable" exactamente?** En el parte hay dos columnas de dinero:
   `Precio T.` (74,16 €) y `PVP` (89,73 €).
   **Propuesta: guardar las dos** y llamarlas por su nombre. Adivinar cuál es la
   buena y quedarse solo con una es la clase de error que no se ve hasta que
   alguien cuadra una factura.

4. **¿El material se marca como entregado?** Un técnico que ve "4 × SAILUN
   315/70" puede querer confirmar que los ha montado.
   **Propuesta: no en esta fase.** Primero que se vea; marcar consumo toca
   almacén y es otra conversación.

5. **Trabajos que no vienen de un parte.** La mayoría de entradas rápidas no
   tienen materiales.
   **Propuesta: el bloque de materiales solo aparece si hay materiales.** Nada
   de secciones vacías ocupando la tarjeta de TV, que se ve desde lejos.

## 6. Qué debería enseñar la tarjeta

```
┌────────────────────────────────────────────────┐
│ CAMIÓN   #412                  Parte D2_26/62  │
│                                                │
│ 8072MNC                                        │
│ Montaje camión mayor 19.5"  ×4 · 100 min       │
│                                                │
│ Tiempo trabajando: 42 min                      │
│                                                │
│ MANO DE OBRA                      140 min      │
│  ✓ Montaje camión mayor 19.5"   ×4   100 min   │
│  ✓ Montaje fijación (quit/poner) ×4    40 min  │
│                                                │
│ MATERIAL                                       │
│  · 315/70X22.5 SAILUN SDL1 154L        ×4      │
│  · Alargadera plástico 170             ×2      │
│  · Alargadera acodada 50º camión       ×2      │
│  · Robles                              ×1      │
└────────────────────────────────────────────────┘
```

- **Mano de obra**: la operación principal **y** las incluidas en la misma
  lista, cada una con cantidad y minutos, más el total. Hoy la principal está
  fuera del bloque y las incluidas dentro, lo que hace parecer que la principal
  no cuenta.
- **Material**: solo descripción y cantidad. Sin importes (ver decisión 2).
- **Nº de parte** visible, para poder cotejar con el papel.

## 7. Cambios de datos

Una columna nueva en `jobs`, con `ADD COLUMN IF NOT EXISTS` en `server/db.ts` y
su fichero en `supabase/migrations/`:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "includedTasks" JSONB DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materiales      JSONB DEFAULT NULL;
```

- `includedTasks`: lo que ya existe como tipo `IncludedTask`, con `quantity`,
  `unitMinutes`, `unitPrice`.
- `materiales`: `[{ descripcion, unidades, precioUnitario, precioTotal, pvp }]`.

En el `INSERT` de `POST /api/jobs` las dos van con **`COALESCE`** en el
`ON CONFLICT`, como ya se hizo con `quantity` y `ptNumero`: el operativo guarda
el trabajo muchas veces al día desde sitios que no conocen estos campos, y sin
`COALESCE` el primero que pase los borra.

Y darlas de alta en `normalizeJobRow`, que es donde se decide qué sale hacia el
cliente.

## 8. Qué hay que probar

Módulo puro, sin React ni red:

- Mano de obra: principal + incluidas, con el total en minutos.
- Un trabajo sin tareas incluidas: la mano de obra es solo la principal.
- Un trabajo sin materiales: el bloque no aparece.
- Cantidades no válidas (0, negativas, texto) no se pintan ni suman.
- `includedTasks` o `materiales` a `null`, a `[]` o con basura: la tarjeta se
  dibuja igual, sin reventar. Vienen de JSONB y de una lectura por IA.
- El total de minutos coincide con el `estimatedMinutes` del trabajo.
- **Ida y vuelta por la base**: un trabajo guardado y releído conserva tareas
  incluidas y materiales. Es la prueba que demuestra que el fallo del punto 3
  está cerrado.

## 9. Plan por fases

**Fase 1 — que deje de perderse.** Columnas `includedTasks` y `materiales`,
`INSERT` con `COALESCE`, `normalizeJobRow`, y que la pantalla de partes las
mande al crear el trabajo. Sin tocar la tarjeta todavía.

**Fase 2 — la tarjeta.** Bloques de mano de obra y material en
`OperariosTVView`, con el nº de parte. Módulo puro para armar los bloques, con
sus tests.

**Fase 3 — la tablet.** Lo mismo en `taller_app`. Su endpoint ya devuelve las
columnas nuevas; hay que leerlas en el modelo Dart y pintarlas. Requiere APK
nueva, así que va aparte.

## 10. Restricciones del repositorio

- `git pull` antes de empezar; `bash scripts/check-versions.sh` antes de cada
  commit (ver `CLAUDE.md`).
- Validar con **`npx tsc -b`**, no con `tsc -p tsconfig.json`: ese fichero es
  solo una solución con `references`, no compila nada y pasa en silencio.
  Más `npx vite build` y `npx vitest run`.
- Subir `APP_VERSION` y `package.json` en cada entrega.
- Los campos JSONB nuevos no deben romper a quien guarde un trabajo sin
  conocerlos: de ahí el `COALESCE`.

## 11. Lo que este documento NO decide

Las cinco decisiones del punto 5. Bloquean de verdad la **2** (si el técnico ve
importes) y la **1** (qué pantalla). Con esas dos contestadas se puede empezar
por la fase 1 sin riesgo de rehacerla.
