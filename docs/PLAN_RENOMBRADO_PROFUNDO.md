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

### B1. URL pública `sea-tarragona.onrender.com` — `CÓDIGO LISTO` ⏳ (2026-08-05)
**Decidido: opción A — dominio propio `mobilink-solutions.com`.** El servicio de Render NO se
renombra: con dominio propio el nombre interno da igual y la URL `onrender.com` sigue viva en
paralelo, así que las apps ya instaladas no se rompen.

- **Código ya cambiado** (commit del 2026-08-05): `kBackendUrl` en las 7 apps Flutter,
  `vite.tecnicos.config.ts`, los *fallback* de `server/index.ts`, `.env.example` y la función
  `alertas-email` de Supabase. Versiones de `pubspec.yaml` subidas.
- **Pendiente de infraestructura (lo hace el usuario, en este orden):**
  1. Render → servicio → *Settings → Custom Domains* → añadir `mobilink-solutions.com` y
     `www.mobilink-solutions.com`.
  2. DNS en el registrador: `A` del dominio raíz → `216.24.57.1` (o ALIAS/ANAME) y `CNAME` de
     `www` al host `.onrender.com` que indique Render. **Ahora mismo el dominio resuelve a
     `216.198.79.1`, que no es Render** — hay que corregirlo.
  3. Esperar verificación + certificado TLS automático.
  4. `PUBLIC_APP_URL=https://mobilink-solutions.com` en Render y redesplegar.
  5. Solo entonces: recompilar los APK y redistribuirlos.
- **Ojo — enlaces de cliente ya afectados:** `getPublicAppBaseUrl` descarta como interno
  cualquier host `onrender.com`, así que los enlaces de seguimiento y los *callbacks* de estado
  de Twilio **ya apuntan a `mobilink-solutions.com`**. Mientras el DNS no apunte a Render, esos
  enlaces están rotos y los WhatsApp no marcan entregado/leído. El paso 2 lo arregla.
- **Opción B descartada — renombrar el servicio Render**: crea `mobilink-XXXX.onrender.com` y
  **mata la antigua al instante**. Solo aceptable coordinando reinstalación inmediata de todas
  las apps. No recomendada.

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
