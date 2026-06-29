# REFACTOR_NOTES — refactor de `src/SeaTarragonaV1.tsx`

Registro de la baseline y de las decisiones/incidencias durante el refactor por pasos
(ver `REFACTOR_PLAN.md`). **Los bugs detectados se anotan aquí, no se arreglan en el commit de refactor.**

---

## Baseline (PASO 1 — antes de tocar nada)

Fecha: 2026-06-29. Rama: `refactor/paso1-helpers-puros`.

### Typecheck — `npx tsc --noEmit -p tsconfig.app.json`

```
EXIT: 0  (sin errores)
```

### Build — `npm run build`  (`tsc -b && vite build`)

```
✓ 2336 modules transformed.
✓ built in ~12s
EXIT: 0  (OK)
```

Avisos preexistentes (NO son errores, ya estaban antes del refactor):
- `RoadsideMap.tsx` importado dinámica y estáticamente → el dynamic import no se mueve a otro chunk.
- Chunk `index-*.js` > 1000 kB (aviso de tamaño).

### Lint — `npx eslint src/SeaTarragonaV1.tsx`

**No ejecutable en este entorno.** ESLint y sus plugins (`@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`) **no están instalados**
(no aparecen en `package.json` ni en `node_modules`). `npx` intenta instalar `eslint@10` global,
que es incompatible con `eslint.config.js` y falla con `ERR_MODULE_NOT_FOUND: '@eslint/js'`.

Como la baseline de lint no se puede ejecutar, **las puertas de verdad de este refactor son
typecheck y build**. Si se desea lint, hay que añadir las devDependencies de ESLint primero
(fuera del alcance de este paso, que es "sin cambios de comportamiento").

---

## Decisiones e incidencias

### PASO 1 — helpers puros

**Módulos creados** (todo verificado como puro: no usa `jobs/techs/set*/useState/useRef`):
- `src/modules/workshopAutoStandby.ts` — `AUTO_STANDBY_TIMES`, `AUTO_STANDBY_GRACE_MINUTES`,
  `formatLocalDateKey`, `getAutoStandbyTrigger`, `getAutoStandbyStorageKey`.
- `src/modules/assignmentMutations.ts` — `removeSupportFromPreviousJob`, `applyAssignmentToTechs`,
  `belongsToWorkshop`. (Reutiliza `getOperationLabel`, `normalizeWorkshopId` existentes.)
- `src/modules/workshopPureHelpers.ts` — `timeToMinutes`, `MANUAL_TECH_STATUS_KEY`,
  `normalizeTechNameKey`, `getManualTechStatusOverrides`, `applyManualTechStatusOverrides`.
  (Reutiliza `isManualUnavailableStatus` de `techSync`.)
- `src/modules/adminHeaders.ts` — `makeAdminHeaders(getToken)` (factory reutilizable/testeable) +
  `getAdminHeaders` por defecto ligado a `localStorage` (comportamiento idéntico al original).

**Decisiones:**
- `getAdminHeaders`: se decidió el patrón **factory** (`makeAdminHeaders`) + export por defecto
  `getAdminHeaders`. La app sigue importando `getAdminHeaders` (lee `localStorage` en cada llamada,
  igual que antes). El export es de nivel módulo, así que sigue disponible en el uso temprano
  (línea ~642, prop de `useMaintenanceAvailability`) sin problema de TDZ que sí habría con un `const`
  local. No se cambió ninguno de los ~16 call sites.
- Solo se importaron en el componente los símbolos realmente usados: `applyManualTechStatusOverrides`
  y `timeToMinutes`. `normalizeTechNameKey`, `getManualTechStatusOverrides` y `MANUAL_TECH_STATUS_KEY`
  solo se usaban dentro de `applyManualTechStatusOverrides`, así que no se importan al componente
  (habrían quedado sin usar).
- Imports `isManualUnavailableStatus`, `normalizeWorkshopId`, `getOperationLabel` se conservan: siguen
  usándose en otros puntos del componente.

**Resultado tras el refactor:**
- Typecheck: EXIT 0. Build: EXIT 0 (mismos avisos preexistentes). Lint: no ejecutable (ver baseline).
- `SeaTarragonaV1.tsx`: 8995 → 8863 líneas (−132 netas; 146 eliminadas, 14 de imports).

**Bugs detectados:** ninguno en este paso.

### PASO 2 — hook de Roadside (`useRoadside`)

**Módulo creado:** `src/modules/useRoadside.ts` (hook `useRoadside({ selectedWorkshopId, visibleTechs, appendLog })`).

**Movido al hook** (estado + lógica, sin cambios de comportamiento):
- Estado: `roadsideAssistances`, `roadsideVehicles`, `roadsideOperatorCodes`,
  `roadsideAssistancesLoading`, `roadsideAssistanceError`, `roadsideVehicleError`,
  `roadsideOperatorCodeError`.
- Memos: `visibleRoadsideAssistances`, `visibleRoadsideVehicles`, `roadsideEligibleTechNames`,
  `visibleRoadsideTechs`.
- Funciones: `reloadRoadside{Assistances,Vehicles,OperatorCodes}FromBackend`,
  `createRoadsideVehicle`, `updateRoadsideVehicle`, `deactivateRoadsideVehicle`,
  `updateRoadsideOperatorCode`, `deleteRoadsideOperatorCode`, `createRoadsideAssistance`,
  `updateRoadsideAssistance`, `sendRoadsideTrackingWhatsapp`, `updateRoadsideAssistanceStatus`,
  `enCaminoRoadsideAssistance`. (Cuerpos copiados literalmente; reutilizan
  `roadsideAssistanceApi.ts`, `roadsideAssistanceTypes.ts` y `belongsToWorkshop` de PASO 1.)

**Decisiones:**
- **`pendingRoadsideCapable` / `setPendingRoadsideCapable` / `pendingRoadsideCapableRef` se quedan
  en el componente** (NO se movieron al hook), pese a que el brief los listaba como ejemplo. No son
  exclusivos de roadside: `pendingRoadsideCapable` lo consume el memo `effectiveTechs` (dominio
  *técnicos*) que se declara **antes** de `visibleTechs`, y el hook necesita `visibleTechs` como
  input (para `visibleRoadsideTechs`), por lo que `useRoadside` debe llamarse **después** de
  `visibleTechs`. Moverlos crearía una dependencia circular / uso-antes-de-declaración. Además
  `pendingRoadsideCapableRef` solo lo leen funciones de carga de técnicos (`loadTechs`,
  `reloadTechsFromBackend` y el mapeo de reasignación). Este "puente" roadside↔técnicos se reubicará
  en el CHAT 6 (`useTechManagement`).
- El hook recibe solo `{ selectedWorkshopId, visibleTechs, appendLog }` (las únicas dependencias del
  closure que usaban las funciones). `appendLog` es `function` hoisted, así que la llamada al hook
  (situada tras `visibleTechs`, ~línea 600) puede referenciarlo sin problema.
- Se eliminaron del componente los imports de la API roadside (ahora solo en el hook); se conservó
  `loadWebfleetVehiclesFromBackend` (sigue usándose en el componente) y se quitó el import de tipos
  `roadsideAssistanceTypes` (ya no se referencian en el componente; la vista WhatsApp usa un
  `import("...")` inline que no cambia).
- Las recargas dentro de `useAutoSync.onSync` (`reloadRoadsideAssistancesFromBackend`) y del efecto
  de carga inicial (`[isAuthenticated, isSupervisor]`) se mantienen con el mismo timing/orden,
  ahora vía `roadside.reload*`.

**Resultado tras el refactor:**
- Typecheck: EXIT 0. Build: EXIT 0 (mismos avisos preexistentes: dynamic import de `RoadsideMap`,
  chunk > 1000 kB). Lint: no ejecutable (ver baseline).
- `SeaTarragonaV1.tsx`: 7728 → 7438 líneas (−290 netas; git: 380 borrados / 44 inserciones).
- `src/modules/useRoadside.ts`: 338 líneas nuevas.

**Bugs detectados:**
- `pendingRoadsideCapableRef` (decl. en `SeaTarragonaV1.tsx`, ~línea 332) **nunca recibe `.set()`
  ni `.delete()`**: su `Map` está siempre vacío, por lo que las ramas
  `pendingRoadsideCapableRef.current.has(baseTech.name)` en `loadTechs`, `reloadTechsFromBackend`
  y el mapeo de reasignación (~896, ~1513, ~4484 en numeración previa) nunca se cumplen y siempre
  cae el `else`. El toggle `onToggleRoadsideCapable` solo actualiza el `setState`, no el ref.
  Probablemente intención perdida (el override "en vuelo" se apoya solo en el state). **No se arregla
  en este paso** (refactor sin cambios de comportamiento); se preserva tal cual para CHAT 6.

### PASO 3 — hook de Agenda / trabajos programados (`useScheduledJobs`)

**Módulo creado:** `src/modules/useScheduledJobs.ts` (hook `useScheduledJobs(deps)`).

**Movido al hook** (estado + memos + funciones, cuerpos copiados literalmente):
- Estado: `scheduledJobs` (+ setter interno), `scheduledJobsLoaded`, y los refs
  `scheduledJobsLoadedRef`, `scheduledJobsDirtyRef`, `scheduledJobsSaveVersionRef`.
- Memos: `visibleScheduledJobs`, `dueScheduledJobs`, `arrivedPendingValidationScheduledJobs`.
- Funciones: `loadScheduledJobs`, `reloadScheduledJobsFromBackend`, `saveScheduledJobsToBackend`,
  `setScheduledJobsAndSave`, `getScheduledJobByRelatedJobId`, `getScheduledEstimatedMinutesForJob`,
  `shouldCloseScheduledJobForFinishedJob`, `updateScheduledJobStatusByJobId`, `updateScheduledJobField`,
  `updateScheduledJobTemplate`, `cancelScheduledJob`, `deleteArrivedScheduledJob`,
  `confirmScheduledArrival`. (Reutilizan `scheduledJobHelpers.ts`, `scheduledJobV2PayloadHelpers.ts`,
  `scheduledJobToWorkV2Adapter.ts`, `v2DataNormalizeHelpers.ts`, `workshopApi.ts`, `adminHeaders.ts`,
  `workshopPureHelpers.ts`, etc., importados directamente en el hook.)

**Interfaz del hook.** `useScheduledJobs({ selectedWorkshopId, visibleJobs, jobs, quickTemplates,
effectiveTechs, nextJobId, appendLog, allocateJob, setJobs, setTechs, setNextJobId,
reloadJobsFromBackend })`.

**Callbacks del ciclo de trabajos (PASO 7) recibidos por parámetro** (para NO acoplar el hook con el
ciclo de trabajos; **no se mueve aquí `allocateJob` ni `createJob`**): `allocateJob`, `setJobs`,
`setTechs`, `setNextJobId`, `reloadJobsFromBackend`. Más los valores `jobs`, `effectiveTechs`,
`quickTemplates`, `nextJobId` que `confirmScheduledArrival` necesita para construir los trabajos.
`saveJobToBackend` / `saveTechToBackend` son imports de módulo, no hace falta inyectarlos.

**Decisiones:**
- **`scheduledTechStatuses` / `scheduledTechStatusesLoaded` NO se movieron** (se dejan en el componente
  para CHAT 6 `useTechManagement`), pese a que el brief los listaba. Los consume `effectiveTechs`
  (memo de *técnicos*, ~línea 328) que se declara **antes** del call-site del hook (este necesita
  `visibleJobs`/`effectiveTechs`/`jobs`/`quickTemplates`/`nextJobId` como entradas, así que se llama
  en ~línea 520). Moverlos provocaría uso-antes-de-declaración, exactamente el mismo caso que
  `pendingRoadsideCapable` en el PASO 2. Además `applyScheduledStatusesToTechs` (memo técnicos) y
  `getScheduledStatusForTech` (JSX técnicos) los usan. El plan ya lo contemplaba (CHAT 6:
  *"scheduledTechStatuses si no se movió en CHAT 3"*).
- **Los `useEffect` de agenda se quedan en el componente** llamando a funciones/estado del hook
  (`agenda.loadScheduledJobs()`, `agenda.reloadScheduledJobsFromBackend()`, lectura de
  `agenda.scheduledJobs` / `agenda.scheduledJobsLoaded`), igual que se hizo con `roadside.reload*` en
  el PASO 2, para **no alterar el orden de registro de efectos**. Afectados: carga inicial, integridad
  V2, reload por auth, guardado PUT por cambio de `scheduledJobs`. `useAutoSync` **no** recarga agenda
  (estaba comentado y se conserva).
- La variable que recibe el hook se llama **`agenda`** (no `scheduled`) para evitar el shadowing con la
  variable de iteración `scheduled` (un `ScheduledJob`) usada en el `.map` del JSX operativo.
- `getDisplayMinutesForJob` (dominio trabajos, CHAT 7) **se queda** en el componente y pasa a llamar
  `agenda.getScheduledEstimatedMinutesForJob`.
- Imports eliminados del componente al quedar huérfanos (`noUnusedLocals`): `addMinutesToTime`,
  `isBuiltInTemplateKey`, `timeToMinutes`, `normalizeScheduledJobsV2Fields`,
  `applyScheduledJobV2FieldsToJob`, `loadScheduledJobsFromBackend`,
  `shouldCloseScheduledJobForFinishedJob` (alias helper), `SetStateAction`, tipo `ScheduledJob`.
  Se conservan `applyScheduledJobV2PayloadFields` (efecto de guardado PUT que sigue en el componente)
  y `deleteScheduledJobFromBackend` (se pasa como prop a `AgendaView`).

**Resultado tras el refactor:**
- Typecheck: EXIT 0. Build: EXIT 0 (mismos avisos preexistentes: dynamic import de `RoadsideMap`,
  chunk > 1000 kB). Lint: no ejecutable (ver baseline).
- `SeaTarragonaV1.tsx`: 8527 → 7957 líneas (−570 netas; git: 624 borradas / 54 insertadas).
- `src/modules/useScheduledJobs.ts`: 673 líneas nuevas.

**Bugs detectados:** ninguno nuevo en este paso. (Se mantiene el doble guardado preexistente de la
agenda —efecto PUT en `[scheduledJobs]` + `saveScheduledJobsToBackend` dentro de `setScheduledJobsAndSave`—
sin cambios; no es objeto de este refactor.)
