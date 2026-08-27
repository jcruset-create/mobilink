# PROMPT — Modularización incremental de Mobilink

> Documento de encargo. **No es código.** Léelo entero antes de tocar nada.
>
> Responde a la pregunta: *"¿podemos rehacer todo el programa por módulos sin romper nada?"*
> La respuesta corta, con los datos medidos abajo: **rehacerlo entero, no. Modularizarlo por
> partes, sí — y de hecho ya está medio hecho.** Este documento define exactamente qué se toca,
> en qué orden y con qué red de seguridad.

---

## 0. Diagnóstico medido (28-07-2026)

No es opinión: son cifras del repositorio actual.

| Métrica | Valor |
|---|---|
| Código TS/TSX en `src/` | 96.326 líneas |
| Código TS en `server/` | 29.885 líneas |
| SQL en `supabase/` | 13.692 líneas |
| **Ficheros de test en todo el repo** | **3** (`liteRules.test.ts`, `caducidadHelpers.test.ts`, `agendaConfig.test.ts`) |
| `server/index.ts` | **14.329 líneas, 220 rutas** en un solo fichero |
| `src/SeaTarragonaV1.tsx` | **8.670 líneas**, un único componente React |
| Imports cruzados entre módulos de negocio | **0** |
| `lazy()` en `src/App.tsx` | **0** (todo en un bundle, aviso de chunk >1000 kB) |

### Lo que ya está bien (y por eso NO se rehace)

Los diez módulos de negocio (`administracion`, `almacen-neumaticos`, `tyrecontrol`, `connectpro`,
`sea-core`, `safety`, `presencia`, `toolcontrol`, `cobros`, `integraciones`) **no se importan
entre sí ni una sola vez**. Cada uno tiene sus `pages/`, `services/`, `types/`. Lo único que
comparten es UI transversal (`components/ui` — 67 usos, layouts, `components/informes`) y cuatro
helpers (`apiFetch`, `sessionHeaders`, `adminHeaders`, `types`). Ningún módulo importa
`SeaTarragonaV1`.

**Eso es exactamente la arquitectura modular que se quiere.** Ya existe. Rehacerla sería tirar
código sano y volver a introducir los bugs que ya se corrigieron.

### Lo que está mal (y es lo único que hay que atacar)

1. **`server/index.ts` — el monolito real.** 220 rutas de 30 dominios distintos en un fichero.
   Es el punto donde todo se acopla y donde cualquier cambio puede romper algo lejano.
2. **`src/SeaTarragonaV1.tsx` — el refactor va perdiendo la carrera.** El `REFACTOR_PLAN.md`
   existente ejecutó 3 de sus 9 pasos y lo bajó de 8.995 → 7.957 líneas. **Hoy vuelve a medir
   8.670.** Se le añaden funcionalidades más rápido de lo que se extrae. Sin una regla que lo
   impida, cualquier refactor se deshace solo.
3. **No hay red de seguridad.** 3 tests para 126.000 líneas. Hoy "no romper nada" se verifica
   a ojo. Esta es la razón número uno por la que un *rewrite* completo sería temerario.
4. **Identidad fragmentada** en cinco almacenes (ver `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md`).
5. **Sin carga diferida**: un usuario de Almacén descarga también TyreControl, Safety y el taller.
6. **Duplicación en las 8 apps Flutter**: `kBackendUrl` y las claves de Supabase copiadas
   literalmente en 7 ficheros `config.dart`; cinco semánticas distintas de PIN.

---

## 1. Veredicto y estrategia

**Prohibido el "big bang".** Reescribir la plataforma de cero, con 3 tests y un despliegue único
en Render que sirve producción, tiene una probabilidad muy alta de romper cosas que hoy funcionan
y que nadie recuerda que existen (la lógica de asignación, los estados de técnico, los flujos de
WhatsApp, las asistencias en carretera).

**Estrategia aprobada: estrangulamiento incremental** (*strangler pattern*). Se extraen dominios
del monolito uno a uno, dejando el monolito funcionando en todo momento. Cada paso es desplegable
y reversible por sí solo.

### Los tres invariantes innegociables

1. **Verde antes de avanzar.** `npx tsc --noEmit -p tsconfig.app.json` y `npm run build` en verde
   antes y después de cada paso. Si un paso no queda verde, se arregla o se revierte — no se avanza.
2. **Un paso = un commit = un dominio.** Nunca dos dominios en el mismo commit. Nunca mezclar
   "mover código" con "cambiar comportamiento": si aparece un bug, se anota en `REFACTOR_NOTES.md`
   y se arregla en un commit aparte.
3. **Regla del techo (nueva, y es la que salva el refactor).** Ni `server/index.ts` ni
   `src/SeaTarragonaV1.tsx` pueden crecer. Toda funcionalidad nueva va en un módulo o router
   nuevo. Se añade un check automático que falla si alguno de los dos supera su marca actual.
   **Sin esta regla, los pasos 2 y 3 se deshacen solos, como ya ha pasado.**

---

## 2. Tarea A — Red de seguridad (PRIMERO, antes de mover una sola línea)

No se toca arquitectura hasta tener con qué comprobar que no se rompe nada.

1. **Instalar ESLint.** Hoy no es ejecutable (`REFACTOR_NOTES.md` lo documenta: faltan
   `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`). Añadir las
   devDependencies y dejar `npm run lint` funcionando.
2. **Test de contrato de rutas.** Un test que arranca el Express y comprueba que las 220 rutas
   siguen respondiendo (status, no el cuerpo). Es la red que permite trocear `server/index.ts`
   sin miedo: si una ruta desaparece al mover un dominio, el test lo canta.
3. **Tests de los helpers puros críticos**, en este orden de prioridad:
   `assignment.ts` (la lógica de asignación es el corazón del taller y hoy tiene reglas por nombre),
   `jobValidation.ts`, `workV2Calculations.ts`, `techStatus.ts`, `permissions.ts`.
4. **Script `npm run check`** = typecheck + lint + test + regla del techo. Es la única puerta que
   hay que pasar. Añadirlo también como hook de CI si el repo lo permite.

**Entregable A:** `npm run check` en verde y capaz de detectar una regresión introducida a
propósito (demuéstralo rompiendo algo y enseñando el fallo).

---

## 3. Tarea B — Trocear `server/index.ts` (el monolito real)

Destino: `server/routes/<dominio>.ts`, cada uno exportando un `express.Router()`, montado desde
un `server/index.ts` que quede como arranque + middlewares + montaje de routers.

**Orden de extracción — de menos a más acoplado.** Los primeros son casi copiar y pegar; sirven
para validar el patrón antes de tocar lo delicado:

| # | Dominio | Rutas aprox. | Riesgo |
|---|---|---|---|
| 1 | `recordatorios-caducidad` | 8 | bajo — aislado |
| 2 | `payments` / `cobros` | 5 | bajo |
| 3 | `webfleet` | 4 | bajo |
| 4 | `tyrecontrol` | 9 | medio — toca auth de Supabase |
| 5 | `safety-operator`, `presencia-operator` | 13 | medio — APKs en producción |
| 6 | `taller-operator`, `workshop-operator` | 9 | medio — APKs en producción |
| 7 | `roadside-*` (assistances, vehicles, operator, known-places, report) | 28 | alto — dominio grande |
| 8 | `otf`, `scheduled-jobs`, `agenda-config` | 16 | alto |
| 9 | `jobs`, `techs`, `users`, `quick-templates`, `maintenance` | 20+ | **el último** — núcleo |

**Reglas del troceado:**
- Las URLs **no cambian**. Ni una. Hay APKs desplegadas en la calle llamándolas.
- `server/db.ts` no se toca en esta tarea (es el esquema; se aborda con la unificación de identidad).
- El estado compartido en memoria (si lo hay) se localiza y se documenta **antes** de mover el
  dominio que lo usa.
- Tras cada dominio: `npm run check` + el test de contrato de rutas + commit.

**Entregable B:** `server/index.ts` por debajo de 1.500 líneas, un router por dominio, las 220
rutas respondiendo igual.

---

## 4. Tarea C — Terminar `SeaTarragonaV1.tsx`

**No se reescribe el plan: se retoma el `REFACTOR_PLAN.md` existente**, que está bien hecho y
detallado paso a paso. Van 3 de 9 pasos. Quedan:

- CHAT 4 — plantillas rápidas (`useQuickTemplates`)
- CHAT 5 — mantenimiento (`useMaintenanceTasks`)
- CHAT 6 — técnicos (`useTechManagement`) ← aquí se resuelven las deudas anotadas en los pasos
  2 y 3 (`pendingRoadsideCapableRef`, `scheduledTechStatuses`)
- CHAT 7 — ciclo de trabajos (`useJobLifecycle`) ← el más grande
- CHAT 8 — auth y permisos (`useAuth`)
- CHAT 9 — vistas a componentes

**Condición previa:** la regla del techo activa (§1.3) y los tests de `assignment.ts` escritos
(§2.3). Sin ellos, CHAT 6 y 7 —que tocan asignación de trabajos— se hacen a ciegas.

**Bug ya detectado y pendiente** (`REFACTOR_NOTES.md`): `pendingRoadsideCapableRef` nunca recibe
`.set()`, su `Map` está siempre vacío y tres ramas de código nunca se ejecutan. Se arregla en
CHAT 6, en **commit separado** del refactor.

**Entregable C:** `SeaTarragonaV1.tsx` como orquestador delgado, objetivo < 800 líneas.

---

## 5. Tarea D — Carga diferida por módulo

Con `src/App.tsx` importando estáticamente los ~60 componentes de todos los módulos, cada usuario
descarga la plataforma entera.

- `React.lazy()` + `Suspense` por módulo en `App.tsx` (no por página: por módulo, que es la
  frontera real).
- Verificar en el build que aparece un chunk por módulo y que desaparece el aviso de >1000 kB.

Es la tarea de menor riesgo y mayor efecto visible para el usuario. **Puede hacerse en paralelo**
a las demás, no depende de nada.

**Entregable D:** un chunk por módulo; medir y reportar el peso inicial antes/después.

---

## 6. Tarea E — Unificar identidad (ya estudiada)

Ejecutar el plan de `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md` — pendiente de aprobación aparte.
Es prerrequisito del punto 9 de la Tarea B (las rutas `techs`/`users` no se deben trocear dos
veces: primero se decide el modelo de identidad, luego se mueven).

---

## 7. Tarea F — Apps Flutter: paquete compartido

Las 8 apps duplican `kBackendUrl`, las credenciales de Supabase y el modelo de operario, con
cinco semánticas distintas de PIN.

- Crear `mobilink_shared/` (paquete Dart local) con: configuración de endpoints, cliente HTTP con
  cabeceras, modelo `Employee`/`Operario` y el flujo de login unificado.
- Migrar **una app cada vez**, empezando por la más pequeña (`presencia_app`, 710 líneas) para
  validar el patrón; `tyrecontrol_app` (13.630 líneas) la última.
- Subir versión en `pubspec.yaml` de cada app migrada. **Los APK los compila el usuario en otra
  sesión** — aquí no se ejecuta `flutter build apk`.

---

## 8. Orden de ejecución

```
A (red de seguridad)  ──►  B (routers backend)  ──►  E (identidad)  ──►  C (SeaTarragonaV1)
        │
        └──►  D (lazy loading, en paralelo)        F (Flutter, al final)
```

A es bloqueante para todo lo demás. D es independiente. F va al final porque depende de que la
identidad (E) esté unificada.

---

## 9. Cómo ejecutar este encargo

1. **Nada de reescrituras completas.** Si una tarea propone "reescribir X de cero", se rechaza.
2. **Un dominio por commit**, con `npm run check` en verde antes y después.
3. **Las URLs de API no cambian nunca** — hay APKs en producción.
4. **Refactor ≠ arreglo de bugs.** Bug encontrado → `REFACTOR_NOTES.md` → commit aparte.
5. **Migraciones SQL = scripts para ejecución manual del usuario** (pauta del proyecto).
6. **Presentar el alcance y esperar confirmación antes de empezar cada tarea (A–F).**
7. Al cierre de cada tarea: qué se movió, qué quedó pendiente y las cifras antes/después.

---

## 10. Respuesta directa a la pregunta

**¿Se puede rehacer todo el programa por módulos sin romper nada?** Todo de golpe, no: con 3
tests para 126.000 líneas y un despliegue único en producción, un *rewrite* rompería cosas y no
habría forma de detectarlo hasta que un operario se quedara tirado en el taller.

**Pero el trabajo que imaginas ya está hecho en un 70%**: los diez módulos de negocio están
limpiamente separados, sin una sola dependencia cruzada. Lo que falta no es rehacer la
plataforma, es (a) ponerle una red de tests, (b) partir los dos monolitos que quedan
—`server/index.ts` y `SeaTarragonaV1.tsx`— y (c) poner un techo que impida que vuelvan a crecer,
porque ya se demostró que crecen más rápido de lo que se refactorizan.

Eso sí se puede hacer sin romper nada, dominio a dominio, con la plataforma en producción todo
el tiempo.
