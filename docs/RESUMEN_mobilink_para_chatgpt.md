# Mobilink — resumen de la aplicación

> Documento de contexto para pegar en ChatGPT (u otro asistente) antes de
> pedirle que proponga o diseñe funcionalidades nuevas.
> Estado: `main` a 19/09/2026 · web `v2.21.2` · `package.json` 1.66.10.

---

## 1. Qué es

Mobilink es la plataforma interna de **Comercial Sea / El Gegant del Pneumàtic**
(Grupo Soledad), un negocio de **neumáticos y taller de vehículo industrial** con
centros en **Tarragona y Reus**. No es un producto genérico: cada módulo nació de
un problema concreto del taller y se usa a diario en producción.

Cubre cuatro mundos que se tocan entre sí:

1. **Taller** — qué se está haciendo ahora, quién lo hace y qué falta por hacer.
2. **Asistencias en carretera** — avisos, operarios en ruta, seguimiento del cliente.
3. **Neumáticos** — stock, montajes, revisiones de flota, recauchutados.
4. **Soporte** — RRHH, EPIs, herramientas, caja, fichajes, administración y cobros.

Se vende además **por módulos a otros talleres**: cada uno es licenciable por
separado (ver §6).

---

## 2. Arquitectura

### Monorepo único

```
mobilink/
├── src/                 Frontend React (web, todos los módulos)
├── server/              Backend Express/TypeScript
├── supabase/migrations/ SQL equivalente al que el servidor aplica solo
├── docs/                Prompts y análisis previos a programar
├── scripts/             Utilidades (check-versions.sh, sondas, backups)
└── *_app/               8 apps Flutter (Android)
```

### Stack

| Capa | Tecnología |
|---|---|
| Web | React 19 + Vite + TypeScript + TailwindCSS + React Router v6 |
| Backend | Express + TypeScript, ejecutado con `tsx` (sin paso de compilación) |
| Base de datos | PostgreSQL (Supabase) vía `pg` |
| Auth de plataforma | Supabase Auth (+ un login clásico propio del panel) |
| Móvil | Flutter (Android), Hive para la cola offline |
| Despliegue | **Render**, automático desde `main` |
| APKs | GitHub Actions → GitHub Releases (firmadas con el keystore de la casa) |
| IA | OpenAI vía una capa propia (`server/core/ai.ts`, `openaiService.ts`) |

### Números

- `server/index.ts`: **~19.600 líneas**, ~296 endpoints (`app.get/post/put/patch/delete`)
  más ~15 routers montados aparte (`/api/admin`, `/api/tyrecontrol`, `/api/dispatch`…).
- `src/SeaTarragonaV1.tsx`: **~8.600 líneas**, el panel de taller histórico.
- **~3.540 tests** (vitest) + tests de Flutter por app.
- 24 subsistemas bajo `server/` y 18 módulos bajo `src/modules/`.

**Esos dos ficheros gigantes son el mayor lastre del proyecto.** Cualquier
funcionalidad nueva debe ir en un módulo aparte, no dentro de ellos.

---

## 3. Los módulos

### WorkPlanner (`/workplanner`) — el taller, día a día
Es el módulo más activo. Secciones: **Operativo 2** (pantalla de oficina, oscura),
**Agenda** (calendario semanal), **Pantalla técnicos** (vista de TV), **Personal**
(fichas, PIN, alta/baja), **Partes de trabajo**, **Pedidos ERP**, **Plantillas**
(checklists), **Ausencias** (vacaciones y cupos).

Conceptos clave:

- **Trabajo (`job`)**: estados `espera → validacion → activo → parado → cerrado`,
  más `bloqueado`. `validacion` es una **propuesta**: la aplicación sugiere
  técnico y una persona lo autoriza.
- **Entrada rápida (`QuickTemplate`)**: catálogo de operaciones del taller, con
  área, minutos por unidad, técnicos permitidos y orden de prioridad.
- **Motor de asignación** (`src/modules/assignment.ts`): filtra por competencias
  y disponibilidad, ordena por el orden oficial del área, y prioriza a quien es
  **más rápido en esa operación** y a quien **lleva menos carga**.
- **Parte de trabajo**: se escanea el parte del ERP (PDF) o se pega una captura
  de la pantalla del ERP, se lee con IA, y de sus líneas sale **un trabajo** con
  su mano de obra y su material.
- **Ausencias**: vacaciones, baja, permiso y "otro taller" se programan **solo
  desde la agenda**, con fechas. Nunca a mano.

### Assist — asistencias en carretera
Avisos, asignación de operario, seguimiento público por token (`/seguimiento/:token`),
informe al cliente, encuesta de satisfacción, fotos, y subcontratación a terceros.
Tiene APK propia (`flutter_app`) y una versión reducida para talleres
colaboradores (`lite_app`).

### Central Pro (`/connect`) — plataforma multiempresa
Recibe asistencias de partners externos (aseguradoras, renting, grúas) y las
enruta a la red de talleres. Acuerdos comerciales, tarifas, facturación, bandeja
de excepciones y de calidad.

### TyreControl — gestión de flota de neumáticos
Empresas cliente, delegaciones, vehículos, neumáticos, montajes, revisiones en
campo (APK `tyrecontrol_app`), catálogo, sonda TLGX, **telemática** (conectores
a proveedores GPS con conciliación de flota), kilometraje y etiquetas.

### Resto
**Almacén** (stock de neumáticos), **Core** (RRHH: empleados, centros,
competencias), **ToolControl** (herramientas y máquinas), **Safety** (EPIs,
documentos, formación), **Presencia** (fichajes), **Cash** (caja, arqueos,
cierres, ingresos bancarios), **Administración** (cobros, seguimiento de pagos,
recobros, usuarios), **TachoCert** (tacógrafos), **Therefore** (gestor documental),
**Recepciones**, **OR Manuales**.

---

## 4. Las 8 apps Flutter

| App | Para quién |
|---|---|
| `flutter_app` | Operarios de asistencias en carretera |
| `lite_app` | Talleres colaboradores de Central Pro |
| `taller_app` | **Técnicos del taller, en tablet** (WorkPlanner Taller) |
| `tyrecontrol_app` | Revisión de neumáticos en campo |
| `almacen_app` | Traspasos de neumáticos |
| `safety_app` | EPIs, documentos y formación |
| `toolcontrol_app` | Herramientas |
| `presencia_app` | Fichaje de empleados |

Todas van **firmadas con el mismo keystore**, así que cada actualización se
instala encima. Se publican como GitHub Release y se descargan desde el navegador
del dispositivo. **Cualquier cambio en una app exige publicar APK nueva**: no
llega con el despliegue web.

---

## 5. Autenticación — conviven cuatro modelos

Esto sorprende a quien llega nuevo. No hay un único login:

1. **Supabase Auth** — plataforma y módulos SaaS.
2. **Login clásico del panel** — roles `admin`, `supervisor`, `pantallas`, `tv75`,
   guardados en `localStorage` (`sea-role`), con permisos por pantalla.
3. **`x-admin-token`** — cabecera para las llamadas del panel al backend.
4. **Credenciales de operario** — `x-roadside-operator-name` / `-code` para
   carretera, `x-operator-name` / `x-operator-pin` para el taller.

Además, `x-idempotency-key` para las operaciones que llegan de la cola offline
de las tablets.

---

## 6. Licencias por módulo (SaaS)

- `app_empresas` — los tenants.
- `app_licencias` — qué módulos tiene contratados cada empresa, con vigencia.
- `app_usuario_modulos` — qué módulos ve cada usuario.
- RPC `app_mis_modulos` — cruza permiso de usuario × licencia vigente.

Claves de módulo: `assist`, `administracion`, `cash`, `central`, `tacografos`,
`therefore`, `recepciones`, `or-manuales`, `almacen`, `tyrecontrol`, `sea-core`,
`toolcontrol`, `safety`, `presencia`, `workplanner`.

Pantalla de SuperAdmin en `/admin/empresas`. **Toda funcionalidad nueva debe
declarar a qué módulo pertenece** y respetar su licencia.

---

## 7. Base de datos — cómo se cambia

**No hay framework de migraciones.** `server/db.ts` ejecuta al arrancar un bloque
de `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, así
que **el esquema se actualiza solo al desplegar**. En `supabase/migrations/` se
deja el SQL equivalente para poder aplicarlo a mano.

Reglas que han costado caras:

- **Upsert fila a fila, nunca reemplazar la colección entera.** Un `PUT` que
  reescribe toda una tabla hace que una pestaña con datos viejos borre lo que
  otra acaba de crear. Ha provocado **tres pérdidas de datos** (recordatorios de
  agenda, estados de técnico y citas).
- **`COALESCE` en el `ON CONFLICT`** para los campos que no todos los llamantes
  conocen: sin eso, el primero que guarde sin ese campo lo borra.
- **`pg` serializa `BIGINT` como cadena.** Todo parseo debe tolerarlo; un
  `as num?` directo en Dart tumbó la APK de los técnicos.
- **Las fechas de agenda son `TEXT 'YYYY-MM-DD'`** y se comparan
  lexicográficamente. Día completo, sin zona horaria.

---

## 8. Convenciones de trabajo

De `CLAUDE.md`, y no son decorativas — se trabaja con **varias sesiones en
paralelo sobre el mismo repositorio**:

1. `git pull` **antes de empezar**, e integrar `main` antes de programar.
2. `bash scripts/check-versions.sh` **antes de cada commit**: compara la versión
   de cada `pubspec.yaml` y del `package.json` con `origin/main`.
3. En conflicto de versiones: se toma **la más alta y se sube una**.
4. Al terminar: PR y merge en cuanto la CI esté verde, sin preguntar.

Validación obligatoria:

```bash
npx tsc -b        # NO "tsc -p tsconfig.json": ese fichero es solo una
                  # solución con references, no compila nada y pasa en silencio
npx vite build
npx vitest run
```

En Flutter: `flutter analyze` y `flutter test` en la app tocada.

---

## 9. Trampas conocidas (léelas antes de proponer nada)

- **`src/components/OperariosTVView.tsx` lleva `// @ts-nocheck`**: TypeScript no
  comprueba ese fichero. Un import que falta no lo detecta el compilador.
- **`server/db.ts` lanza al importarse** si falta `DATABASE_URL`. Cualquier test
  que lo importe estáticamente **falla siempre en CI**. Ya ha pasado tres veces;
  la solución es sacar la lógica pura a un módulo sin dependencias.
  *(Hoy mismo hay dos ficheros así en `main`: `server/therefore/buzon.test.ts` y
  `server/therefore/erp/hub.test.ts`.)*
- **React Router reutiliza el componente** si es del mismo tipo en la misma
  posición del árbol: hay que forzar `key` para que se remonte.
- **`vh` no sirve en móvil** (ignora la barra del navegador): usar `dvh`.
- **`.gitignore` tiene `*/android/`**, así que el `android/` de una app Flutter
  nueva se ignora en silencio. Hay que añadir la excepción.
- **`npm ci` falla** por entradas de `@esbuild/*` en el lockfile; `npm install` sí
  funciona.
- Muchos campos V2 (`quantity`, `unitMinutes`, `includedTasks`…) **vivieron solo
  en memoria del navegador** hasta que alguien los persistió. Antes de enseñar un
  dato en pantalla, comprobar que sobrevive a un refresco.

---

## 10. Qué tener en cuenta al proponer funcionalidades

Lo que funciona bien en este proyecto:

- **Lógica pura en un módulo aparte, con tests** (`src/modules/*.ts`), y la
  pantalla encima. Sin React ni red en el módulo. Así se prueban los casos límite
  de verdad: rango de un día, año bisiesto, cambio de hora, BIGINT como cadena.
- **No descartar nada en silencio.** Si una línea de un parte no se sabe
  clasificar, se enseña para que alguien decida; no se tira.
- **La aplicación propone, una persona decide.** El estado `validacion` y el
  motor de asignación son el patrón: sugerir con el motivo escrito, y que se
  autorice de un clic.
- **Enseñar el porqué.** Un nombre sin explicación se acepta a ciegas o se
  cambia a ojo.
- **Escribir un prompt antes de programar.** Hay una docena en `docs/PROMPT_*.md`:
  qué se pide, qué existe ya, qué decisiones están abiertas y el plan por fases.

Lo que hay que evitar:

- Añadir a `server/index.ts` o a `SeaTarragonaV1.tsx`. Módulo nuevo.
- Un `PUT` que reescriba una colección entera.
- Enseñar importes al técnico: ve cantidades y tiempos; lo que se factura se ve
  en oficina.
- Estados que nadie revierte: si algo tiene principio, necesita final.

---

## 11. Huecos evidentes (candidatos a funcionalidad nueva)

- **Análisis y estadísticas** de WorkPlanner: está en el menú como "próximamente".
- **Configuración** de WorkPlanner: igual.
- **Consumo de material**: el técnico ve lo que tiene que montar, pero no puede
  confirmar que lo ha montado; eso conecta con Almacén.
- **Prorrateo y arrastre de vacaciones**: el cupo anual no prorratea por fecha de
  alta ni arrastra días al año siguiente.
- **Bajas médicas sin fecha de fin**: hoy hay que inventarse una.
- **Ordenar la cola por la hora del parte** en vez de por la de volcarlo.
- **Quitar el `@ts-nocheck`** de la pantalla de TV.
