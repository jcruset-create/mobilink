# Plan de refactor — `src/SeaTarragonaV1.tsx` (8.995 líneas)

> **Cómo usar este documento.** Cada sección "CHAT N" es un *brief autocontenido*. Abre un
> chat nuevo de Claude Code, copia el bloque entero de ese CHAT y pégalo como primer mensaje.
> **Ejecútalos en orden** (1 → 9). Cada uno asume que el anterior ya está terminado y commiteado.
>
> Regla de oro entre chats: **el build y el typecheck deben quedar en verde antes de pasar al
> siguiente**. Si un chat no logra dejarlo verde, no avances: arréglalo o revierte.

---

## Contexto compartido (válido para todos los chats)

- Proyecto: app React + TypeScript + Vite. Raíz: `C:\Users\Jordi\Desktop\sea-tarragona`.
- El archivo `src/SeaTarragonaV1.tsx` es un **único componente** `SeaTarragonaV1()` (línea 340)
  con ~80 piezas de `useState`, ~30 `useMemo` y ~60 funciones internas que **comparten estado por
  closure** (usan `jobs`, `techs`, `setJobs`, `setTechs`, `appendLog`, etc. directamente).
- Por eso la estrategia es: extraer **custom hooks** (estado + lógica de un dominio) y, al final,
  **componentes de vista** (el JSX). No se pueden mover funciones sin más: hay que decidir qué
  recibe cada hook por parámetro y qué devuelve.
- Convenciones del repo (respétalas):
  - Hooks y helpers de dominio viven en `src/modules/` como `useXxx.ts` / `xxxHelpers.ts`.
  - Componentes de vista viven en `src/components/` como `XxxView.tsx`.
  - Ya existen muchos helpers puros (`scheduledJobHelpers.ts`, `roadsideAssistanceApi.ts`,
    `jobHelpers.ts`, `techStatus.ts`, `workshopConstants.ts`…). **Reutilízalos, no los dupliques.**
- Comandos de verificación (ejecutar desde la raíz):
  - Typecheck: `npx tsc --noEmit -p tsconfig.app.json`
  - Build: `npm run build`
  - Lint: `npx eslint src/SeaTarragonaV1.tsx`
- **Regla de seguridad:** este es un refactor **sin cambios de comportamiento**. No cambies lógica,
  textos, ni el orden de efectos. Solo mover código y cablear. Si encuentras un bug, anótalo en
  `REFACTOR_NOTES.md` pero no lo arregles en el mismo commit.

---

## CHAT 1 — Baseline + helpers puros de nivel de módulo

**Objetivo:** establecer un punto de partida verificable y extraer las funciones puras que ya están
fuera del componente (líneas 1–339) y las puras que están atrapadas dentro pero no usan estado.

**Pasos:**
1. Crea `REFACTOR_NOTES.md` en la raíz. Registra ahí el resultado base de typecheck y build
   ANTES de tocar nada (copia/pega la salida). Esto es la referencia para "no romper".
2. Extrae a `src/modules/workshopAutoStandby.ts` estas funciones de nivel de módulo
   (líneas ~306–339): `AUTO_STANDBY_TIMES`, `AUTO_STANDBY_GRACE_MINUTES`, `formatLocalDateKey`,
   `getAutoStandbyTrigger`, `getAutoStandbyStorageKey`.
3. Extrae a `src/modules/assignmentMutations.ts` (líneas ~249–305):
   `removeSupportFromPreviousJob`, `applyAssignmentToTechs`, `belongsToWorkshop`.
4. Extrae las funciones **puras internas** que NO dependen de estado del componente a
   `src/modules/workshopPureHelpers.ts`: `timeToMinutes` (~1979), `normalizeTechNameKey` (~4356),
   `getManualTechStatusOverrides` (~4364), `applyManualTechStatusOverrides` (~4373) y la constante
   `MANUAL_TECH_STATUS_KEY` (~4354). Verifica una a una que no usan `jobs`/`techs`/`set*` antes de
   moverlas; si alguna sí los usa, déjala donde está y anótalo.
5. En `SeaTarragonaV1.tsx`, sustituye las definiciones movidas por `import`.

**Verificación / Definition of done:**
- Typecheck, build y lint en verde (mismo resultado que la baseline).
- `SeaTarragonaV1.tsx` ha reducido líneas y solo añade imports.
- Commit: `refactor(taller): extrae helpers puros de SeaTarragonaV1 a modules/`.

---

## CHAT 2 — Hook de Roadside (asistencia en carretera)

**Objetivo:** sacar todo el dominio de asistencia en carretera a `src/modules/useRoadside.ts`.

**Estado a mover** (búscalo cerca de las líneas 600–720 y donde se declaren): `roadsideAssistances`,
`roadsideVehicles`, `roadsideOperatorCodes`, `pendingRoadsideCapable`, y cualquier `useState`
exclusivo de roadside.

**Funciones a mover** (todas en el rango ~1649–1903):
`reloadRoadsideAssistancesFromBackend`, `reloadRoadsideVehiclesFromBackend`,
`reloadRoadsideOperatorCodesFromBackend`, `createRoadsideVehicle`, `updateRoadsideVehicle`,
`deactivateRoadsideVehicle`, `updateRoadsideOperatorCode`, `deleteRoadsideOperatorCode`,
`createRoadsideAssistance`, `updateRoadsideAssistance`, `sendRoadsideTrackingWhatsapp`,
`updateRoadsideAssistanceStatus`, `enCaminoRoadsideAssistance`. Y los memos `visibleRoadsideAssistances`
(~658), `visibleRoadsideVehicles` (~666), `roadsideEligibleTechNames` (~687), `visibleRoadsideTechs` (~697).

**Interfaz del hook:** define `useRoadside({ selectedWorkshopId, techs, getAdminHeaders, appendLog })`
y devuelve `{ roadsideAssistances, roadsideVehicles, roadsideOperatorCodes, visibleRoadsideAssistances,
visibleRoadsideVehicles, visibleRoadsideTechs, pendingRoadsideCapable, setPendingRoadsideCapable,
createRoadsideAssistance, updateRoadsideAssistance, ... }`. Pasa por parámetro lo que el hook necesite
del componente (techs, workshop, headers, logger) y devuelve estado + acciones.

**Wiring:** en `SeaTarragonaV1`, reemplaza el estado/funciones por
`const roadside = useRoadside({...})` y actualiza los usos (incluida la vista `asistencias`).
Reutiliza `modules/roadsideAssistanceApi.ts`, `roadsideOperatorApi.ts`, `roadsideAssistanceTypes.ts`.

**Definition of done:** typecheck/build/lint verde; la vista `asistencias` funciona igual;
commit `refactor(roadside): extrae estado y lógica a useRoadside`.

---

## CHAT 3 — Hook de Agenda / trabajos programados (OTF)

**Objetivo:** `src/modules/useScheduledJobs.ts`.

**Estado:** `scheduledJobs` (y su setter especial), `scheduledTechStatuses`,
`scheduledTechStatusesLoaded`, y estado relacionado con la agenda.

**Funciones a mover** (rangos ~1010–2106): `loadScheduledJobs`, `reloadScheduledJobsFromBackend`,
`saveScheduledJobsToBackend`, `setScheduledJobsAndSave`, `getScheduledJobByRelatedJobId`,
`getScheduledEstimatedMinutesForJob`, `shouldCloseScheduledJobForFinishedJob`,
`updateScheduledJobStatusByJobId`, `updateScheduledJobField`, `updateScheduledJobTemplate`,
`cancelScheduledJob`, `deleteArrivedScheduledJob`, `confirmScheduledArrival`. Y los memos
`visibleScheduledJobs` (~650), `dueScheduledJobs` (~1380), `arrivedPendingValidationScheduledJobs` (~1415).

**Dependencias cruzadas:** `confirmScheduledArrival` y similares usan `allocateJob`/creación de trabajos.
Para no acoplar con el ciclo de trabajos (CHAT 7, posterior), **recibe esas funciones por parámetro**
(callbacks) en la firma del hook. Documenta en el brief de tu commit qué callbacks recibe.

**Reutiliza:** `scheduledJobHelpers.ts`, `scheduledJobV2Helpers.ts`,
`scheduledJobToWorkV2Adapter.ts`, `scheduledTechStatusApi.ts`.

**Definition of done:** typecheck/build/lint verde; vista `agenda` igual;
commit `refactor(agenda): extrae trabajos programados a useScheduledJobs`.

---

## CHAT 4 — Hook de plantillas rápidas

**Objetivo:** `src/modules/useQuickTemplates.ts`.

**Estado:** `quickTemplates`, `linkedTemplates`, `linkedTemplateDraft`, `customExtraTasks`,
`newCustomExtraTask`, `newQuickTemplate`, `editingQuickTemplateKey`, `quickDraft`,
`quickSelectedArea`, `quickSelectedMode`.

**Funciones a mover:** `reloadQuickTemplatesFromBackend` (~2106), `createTemplateEntry` (~2854),
`addLinkedTemplate` (~2808), `removeLinkedTemplate` (~2843), `addCustomExtraTask` (~3092),
`removeCustomExtraTask` (~3113), `addQuickTemplate` (~3122), `removeQuickTemplate` (~3212),
`updateQuickTemplate` (~4292). Memos `visibleQuickTemplates` (~702), `visibleLinkedTemplates` (~710).

**Reutiliza:** `quickEntryV2Builder.ts`, `quickEntryV2State.ts`, `quickTaskSelector.ts`,
`quickTemplateV2Helpers.ts`, `customExtraTaskV2Helpers.ts`.

**Definition of done:** typecheck/build/lint verde; vista `entradas` igual;
commit `refactor(plantillas): extrae a useQuickTemplates`.

---

## CHAT 5 — Hook de mantenimiento

**Objetivo:** `src/modules/useMaintenanceTasks.ts`.

**Estado:** `maintenanceTasks`, `maintTaskForm`, `maintTaskEditing`, `maintTaskSaving`,
`maintenanceDraft`.

**Funciones a mover:** `saveMaintTask` (~3005), `deleteMaintTask` (~3038),
`assignQuickMaintenanceTask` (~3048). Memo `maintenanceTechCandidates` (~718).

**Reutiliza:** `maintenanceApi.ts`, `useMaintenanceAvailability.ts`.

**Definition of done:** typecheck/build/lint verde; commit `refactor(mantenimiento): extrae a useMaintenanceTasks`.

---

## CHAT 6 — Hook de técnicos (carga, estado, apoyos, avatar)

> ⚠️ Módulo grande y acoplado con el ciclo de trabajos. Lee bien la sección de dependencias.

**Objetivo:** `src/modules/useTechManagement.ts`.

**Estado:** `techs` (y setter), `scheduledTechStatuses` si no se movió en CHAT 3, overrides manuales,
`workshopPinModal/Input/Saving/Error`, estado de avatar si lo hay.

**Funciones a mover:** `loadTechs` (~929), `reloadTechsFromBackend` (~1555), `setTechManual` (~4390),
`uploadTechAvatar` (~2128), `handleTechImageUpload` (~2171), `removeTech` (~5009),
`reassignJob` (~4634), `addSupportToJob` (~4776), `addExtraSupportToJob` (~4875),
`removeSupportByNameFromJob` (~4926), `removeSupportFromActiveJob` (~4956). Memos:
`visibleTechs` (~674), `effectiveTechs` (~442), `techLoadStats` (~1229), `techHoursReport` (~1306),
`techOperationStats` (~1322), `techClosureStats` (~1326), `availableTechsSummary` (~1178).

**Dependencias cruzadas (clave):** las funciones de apoyos/reasignación mutan `jobs` además de `techs`.
Opciones, en orden de preferencia:
1. El hook recibe `{ jobs, setJobs, saveJobToBackend, appendLog, ... }` por parámetro y devuelve las
   acciones. (Recomendado: menos cambios.)
2. Si el acoplamiento es excesivo, deja `reassignJob`/`addSupportToJob`/etc. en CHAT 7 (ciclo de
   trabajos) y mueve aquí solo carga + estado + avatar. **Documenta la decisión** en el commit.

**Reutiliza:** `techStatus.ts`, `techSync.ts`, `techAvatar.ts`, `techConfig.ts`,
`techStatusScheduleHelpers.ts`, `assignmentMutations.ts` (de CHAT 1), `workshopReports.ts`,
`workshopInsights.ts`.

**Definition of done:** typecheck/build/lint verde; vistas `tecnicos`/`operativo` igual;
commit `refactor(tecnicos): extrae a useTechManagement`.

---

## CHAT 7 — Hook del ciclo de trabajos (allocate / create / finish / validación)

> ⚠️ El módulo más grande y central. Hazlo después de técnicos.

**Objetivo:** `src/modules/useJobLifecycle.ts`.

**Estado:** `jobs` (y setter), `log` + `appendLog`, `validationJobs` y estado de validación,
`tick`, lo relacionado con el ciclo de vida del trabajo.

**Funciones a mover:** `allocateJob` (~2180), `recalcWaitingQueue` (~2383), `createJob` (~2741),
`finishJob` (~4092), `pauseJob` (~3341), `reactivatePausedJob` (~3400),
`pauseActiveJobsForStandby` (~3268), `deleteWaitingJob` (~3240),
`authorizeProposedJob` (~3562), `rejectProposedJob` (~3670),
`assignWaitingJobManually` (~3698), `assignOrReserveWaitingJobManually` (~3878),
`startReservedJobsForFreedTechs` (~3783), `deleteValidationJob` (~3945),
`sendValidationJobToQueue` (~4001), `updateValidationResponsible` (~3451),
`addValidationExtraSupport` (~3507), `removeValidationSupportByName` (~3544),
`appendFinishedWhatsappLog` (~4059), `getDisplayMinutesForJob` (~2015). Memos: `visibleJobs` (~645),
`activeJobs` (~1069), `validationJobs` (~1081), `pausedJobs` (~1195), `blockedJobs` (~1212),
`aiRanking`/`aiSuggestions`/`recommendedTechByJobId` (~1331–1346), `jobsForScreens` (~1357).

**Dependencias:** usa técnicos (CHAT 6). Decide la interfaz: este hook puede recibir
`techManagement` (lo devuelto por `useTechManagement`) o callbacks concretos. Mantén la dirección de
dependencia: trabajos → técnicos. Reutiliza `assignment.ts`, `jobHelpers.ts`, `jobValidation.ts`,
`linkedJobs.ts`, `jobV2PayloadHelpers.ts`, `workV2Calculations.ts`, `workshopApi.ts`,
`workshopConstants.ts`, `agendaWhatsappV2Helpers.ts`.

**Definition of done:** typecheck/build/lint verde; flujo operativo igual;
commit `refactor(trabajos): extrae ciclo de vida a useJobLifecycle`.

---

## CHAT 8 — Hook de autenticación y permisos

**Objetivo:** `src/modules/useAuth.ts`.

**Estado:** `loginPassword`, `loginError`, `loginLoading`, `userRole`, `isAuthenticated`,
`selectedWorkshopId`, `view` (si decides que el routing vive aquí; si no, déjalo en el componente).

**Funciones a mover:** `handleLogin` (~1487), `getAdminHeaders` (~1527), `resetAllSystem` (~4561),
`askExternalAIWorkshop` (~1440) si está acoplado al login/headers (si no, déjalo en su dominio).

**Reutiliza:** `modules/permissions.ts`, `modules/workshops.ts`.

**Nota:** `getAdminHeaders` la usan casi todos los hooks anteriores. Como este chat va al final,
no muevas su definición si rompería los imports de CHATs previos; en su lugar, valora dejar
`getAdminHeaders` en un helper neutral (`modules/adminHeaders.ts`) y que todos lo importen.
**Si haces esto, hazlo en el CHAT 1** y anótalo. Revisa esto antes de empezar el CHAT 2.

**Definition of done:** typecheck/build/lint verde; login/logout/roles igual;
commit `refactor(auth): extrae login y permisos a useAuth`.

---

## CHAT 9 — Vistas (JSX) → componentes por pantalla

> Hazlo el último: las vistas consumen los hooks ya extraídos.

**Objetivo:** trocear el render (líneas ~5021–8995) en componentes de `src/components/`.
Una vista por archivo. Candidatas (por los `if (view === ...)` / bloques del JSX):

- `WorkshopOperativoView.tsx` — `operativo` y `operativo2` (el bloque más grande, ~5683–8995).
- `EntradasView.tsx` — bloques `view === "entradas"` (~5985–6800).
- `AjustesView.tsx` — bloques `view === "ajustes"` (~6863–8383).
- `AsistenciasConfigView.tsx` — `asistencias_config` (~5237).
- (Las vistas `pantalla`, `tecnicos`, `operarios`, `workshop_tv_75`, `agenda`, `asistencias`,
  `whatsapp_inbox`, `ranking`, `historico` ya delegan en componentes existentes; solo limpia su wiring.)

**Estrategia:** una vista por commit. Cada componente recibe por props lo que hoy usa del closure
(estado de los hooks + acciones). Empieza por la más aislada (`AsistenciasConfigView`) para validar el
patrón antes de atacar `operativo`. **No mezcles dos vistas en un commit.**

**Definition of done por vista:** typecheck/build/lint verde; la pantalla se ve y opera idéntica;
commit `refactor(vistas): extrae <Vista> de SeaTarragonaV1`.

---

## Orden recomendado y meta final

1. Helpers puros → 2. Roadside → 3. Agenda → 4. Plantillas → 5. Mantenimiento →
6. Técnicos → 7. Trabajos → 8. Auth → 9. Vistas.

**Meta:** `SeaTarragonaV1.tsx` queda como un *orquestador* delgado: instancia los hooks, conecta sus
salidas y decide qué vista renderizar. Objetivo orientativo: < 800 líneas.

**Invariante entre chats:** sin cambios de comportamiento + build verde en cada paso.
Cualquier bug detectado se anota en `REFACTOR_NOTES.md`, no se arregla en el commit de refactor.
