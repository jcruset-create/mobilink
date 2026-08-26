# Plan de renombrado profundo — Mobilink (2026-07-19)

Continuación de [RENOMBRADO_MOBILINK.md](RENOMBRADO_MOBILINK.md) (rebrand visible, ya hecho).
Este plan cubre los **identificadores técnicos y datos** que quedaron fuera, clasificados por
coste/beneficio, con pasos exactos, riesgos y puntos de decisión.

Principio: **nada se ejecuta sin su fase de compatibilidad previa**. Cada elemento tiene
estado: `PREPARADO` (listo para ejecutar), `DECISIÓN` (necesita que elijas), `NO RECOMENDADO`.

---

## Tier A — Recomendado, ya preparado

### A1. Empresa "SEA Tarragona" en BD (dato visible) — `PREPARADO` ✅código
- **Qué**: la fila de `tc_empresas` (y `companies` del monolito si existe) con nombre
  "SEA Tarragona" pasa a "Mobilink Tarragona". Es un DATO visible en selectores.
- **Compat ya desplegada**: el lookup del server acepta ambos nombres priorizando el nuevo
  (`server/index.ts`, `.in(["Mobilink Tarragona","SEA Tarragona"])`).
- **Ejecutar**: `supabase/migrations/mobilink_rename_datos_fase1.sql` en el SQL Editor
  (manual, idempotente). Después no hay que tocar código: la compat sigue funcionando.
- **Riesgo**: mínimo. **Rollback**: UPDATE inverso.

### A2. `package.json` name `sea-tarragona` → `mobilink` — `HECHO` ✅
- Renombrado junto con `package-lock.json` (regenerado con `--package-lock-only`).
- Validado con `npm ci --dry-run` (es lo que ejecuta Render). Paquete privado: sin más impacto.

### A3. Repositorio GitHub `sea-tarragona` → `mobilink` — `HECHO` ✅ (2026-07-19)
- Renombrado vía API (`jcruset-create/mobilink`). GitHub redirige el nombre antiguo
  automáticamente y Render mantiene la conexión por id.
- Remote local actualizado a `https://github.com/jcruset-create/mobilink.git`.
- Verificado: fetch/push al nombre nuevo OK (este mismo commit llegó por el remote nuevo).
- Nota: la carpeta local sigue llamándose `Desktop/sea-tarragona` — renombrarla es opcional
  y solo local (cerrar editores/terminales antes si se hace).

### A4. Logos e iconos — `PREPARADO` (necesita diseño)
Assets con la marca antigua que requieren diseño gráfico nuevo:
- `public/logo_horizontal.png` (web + página de seguimiento de asistencias)
- Iconos de apps: `android*/app/src/main/res/mipmap-*`, `flutter_app|tyrecontrol_app|almacen_app/android/.../mipmap-*`, `ios/**/AppIcon*`, `*/web/icons/*`
- Cuando existan los ficheros nuevos, sustituir es mecánico (misma ruta y tamaño).

---

## Tier B — Recomendado, requiere decisión previa

### B1. URL pública → `api.mobilink-solutions.com` — `EJECUTADO EN CÓDIGO` ⏳ (2026-08-26)

**Decisión tomada el 2026-08-26: las APK apuntan a `api.mobilink-solutions.com`.**
Se elige el subdominio técnico —ya verificado en Render y resolviendo a `216.24.57.7`— y no el
dominio raíz, precisamente para conservar la separación que avisaba la revisión del 13-08:
`mobilink-solutions.com` sigue siendo **solo** el dominio de cara al cliente
(`CANONICAL_PUBLIC_URL`, enlaces de seguimiento por WhatsApp), y el host técnico va aparte.

- **Hecho en código**: `kBackendUrl` de las 7 APK, `vite.tecnicos.config.ts`, `.env.example`
  (`PUBLIC_APP_URL` = dominio de cliente) y `CANONICAL_PUBLIC_URL` pasa a ser configurable por
  variable de entorno. Versiones de `pubspec.yaml` subidas.
- **`render.yaml` NO se toca**: se respeta lo aprendido el 13-08 — es un Blueprint y Render
  identifica los servicios por nombre; el `name: sea-tarragona` se deja en paz. Solo se ha
  añadido la variable opcional `CANONICAL_PUBLIC_URL`.
- **Pendiente antes de repartir APK:**
  1. Confirmar que `https://api.mobilink-solutions.com` responde desde la red de la oficina
     (el 13-08 el dominio raíz daba `ERR_CERT_AUTHORITY_INVALID` desde ese PC; el 26-08 carga
     bien desde el móvil, así que probablemente estaba resuelto, pero hay que verificarlo).
  2. `PUBLIC_APP_URL=https://mobilink-solutions.com` en Render y redesplegar.
  3. Twilio: revisar la URL del webhook. La validación de firma ya prueba varios hosts, así
     que no rompe, pero conviene dejarla al día.
  4. Recompilar y repartir los APK. `sea-tarragona.onrender.com` sigue vivo, así que las
     tablets sin actualizar siguen funcionando y la migración va a su ritmo.
- **Rollback**: volver `kBackendUrl` al `.onrender.com` y recompilar.

<details>
<summary>Análisis previo del 2026-08-13 (se conserva: sigue siendo válido)</summary>

### B1. URL pública `sea-tarragona.onrender.com` → dominio propio — `DECISIÓN` ⚠️ (rev. 2026-08-13)
- **Estado**: analizado y sin ejecutar. El cambio de las 7 APKs se revirtió para no
  bloquear despliegues; se rehace cuando se elija destino y el DNS esté listo.
- **Lo que se descubrió el 2026-08-13 mirando Render** (invalida parte de lo de arriba):
  - El servicio **ya se llama `mobilink`** (`srv-d7or6d8g4nts7384og40`), plan Starter.
    Renombrarlo, por tanto, ya no está pendiente.
  - Tiene **tres dominios propios verificados y con certificado emitido**:
    `mobilink-solutions.com`, `www.` (redirige) y `api.mobilink-solutions.com`.
    Se han gastado los **2/2 dominios** que incluye el plan del workspace: añadir
    `app.mobilink.es` costaría subir de plan.
  - **Render Subdomain sigue activo**: `sea-tarragona.onrender.com` es este mismo
    servicio. No hay dos servidores, y el host viejo no se cae solo.
  - Pendiente de aclarar: `mobilink-solutions.com` da `ERR_CERT_AUTHORITY_INVALID`
    desde el PC de la oficina pese a constar el certificado como emitido. Probarlo
    desde otra red antes de apuntar nada ahí.
- **Candidato más barato**: apuntar las APKs a `mobilink-solutions.com`, que ya
  funciona y no consume dominio nuevo ni requiere DNS. Sólo si se resuelve lo del
  certificado.
- **Dominio alternativo**: `app.mobilink.es` (subdominio, **no** el raíz).
- **Por qué subdominio y no `mobilink.es`**: el dominio raíz no está en Render, apunta a
  otro hosting (`134.0.10.115`) y además tiene comodín (`*.mobilink.es` resuelve ahí).
  Repuntar el registro A del raíz tumbaría lo que hoy sirve `mobilink.es`. Con un CNAME
  concreto para `app` la web actual y el correo quedan intactos (el registro específico
  gana al comodín).
- **`mobilink-solutions.com` es hoy el dominio de cara al cliente final**
  (`CANONICAL_PUBLIC_URL` en `server/index.ts`, enlaces de seguimiento por WhatsApp).
  Si además pasa a ser el host técnico de las APKs, deja de haber esa separación —
  decidir si importa antes de hacerlo.
- **Por qué NO tocar `render.yaml`**: es un Blueprint y Render identifica los servicios
  **por el nombre**. Cambiar `name:` no renombra: crea un servicio nuevo y abandona el
  viejo, arrancando sin ninguna de las ~30 variables `sync: false`. El servicio ya se
  llama `mobilink` en el dashboard; el `name: sea-tarragona` del fichero se deja en paz.
- **URL incrustada en 7 APKs** (no 2): `flutter_app`, `lite_app`, `taller_app`,
  `safety_app`, `presencia_app`, `tyrecontrol_app` (`lib/config.dart`) y `almacen_app`
  (`lib/main.dart`). Todas siguen en `sea-tarragona.onrender.com`.
- **Orden obligatorio** — el DNS y el certificado van **antes** que el código, no después.
  Compilar las APKs contra un host que aún no responde es fabricar tablets rotas:
  1. DNS: CNAME `app` → `sea-tarragona.onrender.com` (TTL bajo, 300, mientras se prueba).
  2. Render → Settings → Custom Domains → añadir `app.mobilink.es`, esperar a *Verified*
     y a que emita el certificado.
  3. Render → Environment → `PUBLIC_APP_URL = https://app.mobilink.es`.
  4. Twilio: actualizar la URL del webhook de WhatsApp entrante. La validación de firma
     ya prueba varios hosts (`/api/whatsapp/inbound`), así que no rompe, pero conviene.
  5. Mergear y recompilar las APKs. `sea-tarragona.onrender.com` sigue vivo, así que las
     tablets sin actualizar siguen funcionando: la migración puede ir a su ritmo.
- **Rollback**: volver `kBackendUrl` al `.onrender.com` y recompilar. El host viejo nunca
  se apaga, así que no hay ventana de caída.

</details>

### B2. Rutas web `/sea-core/*` → `/core/*` — `HECHO` ✅ (2026-07-19)
- Rutas renombradas a `/core/*` y enlaces internos actualizados (SeaHub, CoreLayout,
  InicioPage, CoreDashboard, Empleados, EmpleadoDetalle).
- `/sea-core` y `/sea-core/*` quedan como redirect (`RedirectSeaCore` en App.tsx):
  los marcadores antiguos siguen funcionando.
- Verificado en navegador: `/core` y `/sea-core/empleados` resuelven (login), ruta
  inexistente da 404. El directorio `src/modules/sea-core/` (imports) se queda (Tier C).

### B3. Bundle ids `com.seatarragona.*` y `com.example.sea_tarragona_operario` — `DECISIÓN`
- Cambiar el `applicationId` = **app nueva** en Android: no actualiza la existente, aparece
  duplicada y hay que desinstalar la vieja a mano en cada dispositivo.
- **Recomendación**: NO cambiarlos mientras la distribución sea por APK directa. Solo tiene
  sentido si algún día se publica en Play Store (ahí sí conviene `com.mobilink.*` desde el
  primer release, porque el id es inmutable una vez publicado).

---

## Tier C — No recomendado (coste > beneficio)

| Elemento | Motivo |
|---|---|
| Tablas `sea_*` de Supabase (sea_employees, etc.) | Solo lo ven desarrolladores. Renombrar exige migración coordinada de tablas+RLS+código en 3 superficies. Riesgo alto, beneficio nulo. Si algún día se hace: `ALTER TABLE ... RENAME` + vistas puente con el nombre viejo. |
| Nombres de paquete pubspec/Dart (`tyrecontrol_app`, `sea_tarragona_operario`...) | Internos; renombrar toca todos los imports `package:` sin valor de usuario. |
| Salt `"#SEA"` de `authClave.ts` | **NUNCA**: es sal criptográfica, no marca. Cambiarla invalida todas las claves guardadas. |
| `server/sea-tarragona.db` + `db.sqlite.ts` + `scripts/backup.cjs` | SQLite legacy (el monolito usa Postgres). Mejor candidato a ARCHIVAR/eliminar que a renombrar — verificar antes que nada lo importa en runtime. |
| Rutas `/almacen-neumaticos`, claves localStorage (`sea-admin-token`) | Identificadores funcionales; localStorage renombrado = logout forzado de todos. |

---

## Orden de ejecución sugerido

1. **Ya** (sin dependencias): A1 (ejecutas el SQL), A3 (renombras el repo).
2. **Cuando haya diseño**: A4 (logos).
3. **Cuando decidas dominio**: B1 → después recompilar apps con la URL nueva (las APK del
   rebrand ya están; sería otra ronda de versiones).
4. **Algún día tranquilo**: B2 (rutas /core).
5. **Nunca / solo con Play Store**: Tier C / B3.
