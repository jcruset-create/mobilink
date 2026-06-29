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
