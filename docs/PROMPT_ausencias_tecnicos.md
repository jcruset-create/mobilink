# Prompt — Pestaña de ausencias y vacaciones por técnico (Agenda 2)

> Documento previo a programar. Recoge lo que se pide, lo que ya existe en el
> repositorio, las decisiones que hay que tomar y el plan por fases.
> **No implementar nada hasta confirmar las decisiones abiertas.**

## 1. Qué se pide

Una pestaña nueva dentro de **Agenda 2** que cuente, por técnico y por días, sus
estados: cuántos días lleva de vacaciones, cuántos tiene programados en el
futuro, cuántos le quedan por disfrutar, cuántos días de baja, de permiso, etc.
Más una **configuración del cómputo de vacaciones**: 30 días naturales o 22
laborables de lunes a viernes.

## 2. Qué hay ya construido (no hay que inventarlo)

### Los datos ya existen
Los estados con fecha de inicio y fin ya se guardan. Cada barra de la franja
"Todo el día" de la agenda (`ANDRÉS · BAJA`, `ALBERT · VACACIONES`) es un par de
registros:

| Pieza | Dónde | Qué guarda |
|---|---|---|
| `ScheduledTechStatus` | tabla `scheduled_tech_statuses` | `id`, `techName`, `status`, `startDate`, `endDate`, `label`, `notes`, `createdAtMs`, `workshopId` |
| `DateReminder` (kind `tech_status`) | tabla `agenda_date_reminders` | la barra que se pinta, con `techStatusId` apuntando al anterior |

- Tipo: `src/modules/techStatusScheduleHelpers.ts`
- Estados disponibles (`TechStatus`, `src/modules/workshopTypes.ts`):
  `disponible`, `ocupado`, `refuerzo`, `nodisponible`, `supervisor`,
  `vacaciones`, `baja`, `permiso`, `otro_taller`.
  Los que se pueden programar por fechas (`SCHEDULED_TECH_STATUS_OPTIONS`):
  `vacaciones`, `baja`, `permiso`, `nodisponible`, `otro_taller`, `disponible`.
- API: `GET/PUT /api/scheduled-tech-statuses`, `DELETE /api/scheduled-tech-statuses/:id`
  (`src/modules/scheduledTechStatusApi.ts`). El PUT es un **upsert**, no un
  reemplazo.
- Fechas en `TEXT 'YYYY-MM-DD'`, comparación lexicográfica, como el resto de la
  agenda. **Sin horas y sin zona horaria**: un rango es de día completo.
- Se crean y ahora también se **editan** pulsando la barra en la agenda
  (`openEditDateReminder` en `src/components/AgendaView.tsx`).

### El calendario laboral ya existe
`AgendaConfig` (`src/modules/agendaConfig.ts`) ya sabe qué días abre el taller:
horario semanal de lunes a sábado con `closed` por día, `holidays` (con
`yearly`), `specialDays` y `closedSaturdaysInAugust`. **El cómputo de días
laborables debe apoyarse en esto, no en un calendario nuevo.**

### El plantel ya existe
`techs` con la columna `activo` (altas y bajas de personal, `PUT /api/techs/:name/activo`).
Los técnicos dados de baja no deben desaparecer del histórico del año en curso.

### Lo que NO existe todavía
- Ninguna noción de **derecho anual** de vacaciones por técnico (el cupo).
- Ninguna noción de **año natural / año de devengo**.
- Ninguna pantalla que agregue nada de esto.
- La tabla `scheduled_tech_statuses` **no está en `server/db.ts`**: se creó a
  mano en Supabase. Cualquier tabla nueva sí debe ir en `db.ts` con
  `CREATE TABLE IF NOT EXISTS` (y su fichero en `supabase/migrations/`).

## 3. Decisiones que hay que tomar antes de programar

Estas cambian el resultado, no son detalles de implementación.

1. **Dónde vive la pestaña.** Dicho "en la agenda2". Dos lecturas:
   - (a) Una vista más **dentro** de la pantalla de Agenda 2, junto a
     "Vista día" / "Semana anterior" (un botón "Ausencias").
   - (b) Una sección propia del menú de WorkPlanner, al lado de "Agenda".
   **Propuesta: (a)**, porque los datos son los de la agenda y se entra a
   consultarlos desde ahí; y desde ahí se llega en un clic al estado que hay que
   corregir.

2. **Qué significa "cuántos días le quedan".** Necesita un cupo anual por
   técnico. ¿De dónde sale?
   - Un valor **por defecto para todo el taller** (30 naturales o 22 laborables)
     configurable, con posibilidad de **sobrescribirlo por técnico** (antigüedad,
     jornada parcial, incorporación a mitad de año).
   **Propuesta: por defecto de taller + override por técnico**, que es lo que
   pasa en la práctica.

3. **Prorrateo del primer año.** Un técnico que entra en septiembre no tiene 30
   días ese año. ¿Se prorratea automáticamente por fecha de alta, o se ajusta a
   mano en el override por técnico?
   **Propuesta: a mano** en la primera versión — no hay fecha de alta fiable en
   `techs` y adivinarla haría números falsos.

4. **Días naturales vs laborables: qué cuenta exactamente.**
   - *Naturales (30)*: cuentan todos los días del rango, sábados, domingos y
     festivos incluidos.
   - *Laborables (22, L-V)*: cuentan solo lunes a viernes, **descontando los
     festivos** de `AgendaConfig`. ¿Se descuentan también los sábados que el
     taller sí abre? En el modo L-V, no: el sábado no cuenta nunca.
   **Propuesta: esa. Y el modo elegido afecta solo a `vacaciones`**; baja,
   permiso y el resto se cuentan siempre en días naturales, que es como se
   cuentan de verdad una baja médica o un permiso.
   → **Confirmar este último punto**, es el que más puede chocar.

5. **Arrastre de año.** ¿Los días no disfrutados de 2026 pasan a 2027?
   **Propuesta: no en la primera versión.** Cada año natural es independiente y
   la pestaña muestra un selector de año.

6. **Bajas de larga duración.** Una baja abierta sin fecha de fin conocida hoy
   se guarda con un `endDate` inventado. ¿Se quiere un estado "sin fecha de
   fin"? **Propuesta: dejarlo fuera de esta fase** y anotarlo como pendiente.

## 4. Qué debería enseñar la pantalla

Tabla por técnico, con el año seleccionable (por defecto el año en curso):

| Técnico | Vacaciones disfrutadas | Programadas | Pendientes | Cupo | Baja | Permiso | No disp. | Otro taller |
|---|---|---|---|---|---|---|---|---|
| Ramón | 12 | 8 | 10 | 30 | 0 | 2 | 0 | 1 |

Con estas definiciones, que deben quedar escritas en la propia pantalla:

- **Disfrutadas**: días del rango que ya han pasado (`fecha <= hoy`).
- **Programadas**: días del rango que aún no han llegado (`fecha > hoy`). Un
  rango a caballo de hoy se **reparte** entre las dos columnas; no se asigna
  entero a ninguna.
- **Pendientes** = `cupo − disfrutadas − programadas`. En rojo si sale negativo
  (se han pasado del cupo) y en ámbar si quedan muchos días sin programar
  entrando en el último trimestre.
- El resto de estados: total de días del año, sin cupo.

Además:
- Fila de **totales del taller** (cuánta gente hay fuera a la vez es lo que de
  verdad duele al planificar).
- Al pulsar una celda, **el desglose de los rangos** que la componen, con enlace
  para abrir el estado en la agenda y corregirlo.
- **Aviso de solapes**: dos estados del mismo técnico que pisan las mismas
  fechas. Hoy nada lo impide y falsearía el recuento — hay que enseñarlo, no
  sumarlo dos veces.
- Botón de **exportar a CSV**, que es lo que acabará pidiendo la gestoría.

## 5. Reglas de cálculo (para escribirlas como módulo puro y probarlas)

Módulo nuevo `src/modules/ausenciasTecnicos.ts`, **sin React ni red**, como
`agendaConfig.ts`. Es la parte que hay que probar a fondo:

- `diasDelRango(startDate, endDate, modo, agendaConfig)` → número de días.
  - `modo: "naturales" | "laborables"`.
  - En `laborables`: excluye sábado y domingo, y excluye los festivos de
    `AgendaConfig` (incluidos los `yearly`, comparando día y mes).
- `recortaAlAño(rango, año)` → un rango puede empezar en diciembre y acabar en
  enero: cada año se queda con su parte.
- `parteHastaHoy(rango, hoy)` / `partePosteriorAHoy(rango, hoy)`.
- `resumenPorTecnico(estados, año, config, hoy)` → la tabla completa.
- `detectaSolapes(estados)` → pares de rangos del mismo técnico que se pisan.

Casos que deben tener test, porque son los que rompen:
- Rango de un solo día (`startDate === endDate`) — debe contar **1**, no 0.
- Rango que cruza el fin de año.
- Rango que contiene hoy (reparto disfrutadas/programadas).
- Modo laborable con un festivo dentro y con un festivo `yearly` de otro año.
- Año bisiesto (29 de febrero).
- Técnico dado de baja a mitad de año: sigue apareciendo en el año en curso.
- Estado creado en un taller distinto (`workshopId`) — decidir si se filtra por
  taller. **Propuesta: sí, coherente con el resto de la agenda.**

## 6. Persistencia nueva

Una sola tabla, y su `CREATE TABLE IF NOT EXISTS` en `server/db.ts` más el
fichero en `supabase/migrations/`:

```sql
CREATE TABLE IF NOT EXISTS vacaciones_config (
  id            BIGSERIAL PRIMARY KEY,
  "workshopId"  TEXT,
  anio          INT  NOT NULL,
  modo          TEXT NOT NULL DEFAULT 'naturales',  -- 'naturales' | 'laborables'
  dias_por_defecto INT NOT NULL DEFAULT 30,
  "techName"    TEXT,          -- NULL = valor por defecto del taller
  dias          INT,           -- override para ese técnico
  "createdAtMs" BIGINT NOT NULL,
  "updatedAtMs" BIGINT NOT NULL,
  UNIQUE ("workshopId", anio, "techName")
);
```

Endpoints `GET` / `PUT` `/api/vacaciones-config`, con la misma protección que el
resto del panel (`protectWhenStrict(requirePanelRole)` para leer,
`requireSupervisorRole` para escribir). **Upsert por fila, nunca reemplazo de la
colección entera**: es el error que ya ha costado dos pérdidas de datos en este
repositorio (recordatorios de agenda y estados de técnico).

## 7. Plan por fases

**Fase 1 — el cálculo.** `src/modules/ausenciasTecnicos.ts` y sus tests. Sin
pantalla, sin backend. Se entrega con la suite en verde y los casos límite de
arriba cubiertos.

**Fase 2 — la pantalla.** La pestaña dentro de Agenda 2, con la paleta oscura de
Agenda 2, leyendo los estados que ya se cargan. El cupo, de momento, del valor
por defecto en memoria. Tabla, totales, desglose al pulsar, aviso de solapes y
export CSV.

**Fase 3 — la configuración.** Tabla `vacaciones_config`, endpoints, y el
formulario: modo (30 naturales / 22 laborables L-V), días por defecto y
override por técnico. Selector de año.

**Fase 4 (opcional, a confirmar).** Prorrateo por fecha de alta, arrastre de
días entre años, bajas sin fecha de fin, y un aviso al crear un estado que se
solapa con otro.

## 8. Restricciones del repositorio que hay que respetar

- Antes de empezar y antes de cada commit: `git pull` y
  `bash scripts/check-versions.sh` (ver `CLAUDE.md`).
- Validar siempre con **`npx tsc -b`**, no con `tsc -p tsconfig.json`: ese
  fichero es solo una solución con `references` y no compila nada, así que pasa
  en silencio. Es lo que dejó pasar un build roto a Render.
- Además: `npx vite build` y `npx vitest run`.
- Subir `APP_VERSION` (`src/version.ts`) y `package.json` en cada entrega.
- El módulo `workplanner` es licenciable de forma independiente: la pestaña
  nueva va dentro de ese módulo y no debe abrir puertas a quien no lo tenga.

## 9. Lo que este documento NO decide

Las seis decisiones del punto 3. Hace falta respuesta al menos a la **2**
(de dónde sale el cupo), la **4** (si el modo laborable aplica solo a
vacaciones) y la **1** (dónde vive la pestaña) para poder empezar la fase 1 sin
tener que rehacerla.
