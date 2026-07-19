# Renombrado a Mobilink — entrega Tarea A (2026-07-19)

Alcance ejecutado: **todo lo visible** (plataforma + familia de productos + nombres de apps).
Los identificadores técnicos publicados y los datos de BD quedan **intactos**.

## Renombrado (marca visible)

### Plataforma web
| Dónde | Antes | Ahora |
|---|---|---|
| `index.html` `<title>` | sea-tarragona | Mobilink |
| `index-tecnicos.html` `<title>` | SEA Técnicos | Mobilink Técnicos |
| `src/pages/AccesoPage.tsx`, `InicioPage.tsx`, `WorkshopOperatorPage.tsx`, `PaymentResult.tsx`, `SeaTarragonaV1.tsx` (cabecera y acceso) | SEA Tarragona | Mobilink |
| `src/WorkshopWallScreen.tsx` | Taller SEA Tarragona | Taller Mobilink Tarragona |
| `src/modules/workshops.ts` (nombres de taller) | SEA Tarragona / SEA Reus | Mobilink Tarragona / Mobilink Reus |
| `src/components/RoadsideMap.tsx` (label por defecto) | Taller SEA | Taller Mobilink |
| `src/pages/RoadsideTrackingPage.tsx` (alt del logo) | SEA Assist | Mobilink Assist |
| `src/pages/QrScan.tsx` | SEA Platform · ToolControl | Mobilink Platform · ToolControl |
| `README.md` | SEA Tarragona | Mobilink |

### Familia de productos (web)
`SEA Core → Mobilink Core`, `SEA ToolControl → Mobilink ToolControl`, `SEA Safety Manager → Mobilink Safety Manager`, `SEA Presencia → Mobilink Presencia`, `SEA TyreControl → Mobilink TyreControl`, `SEA Almacén → Mobilink Almacén`, `SEA Administración → Mobilink Administración` en: SeaHub, layouts (Core/Tyre/Almacén/Admin), dashboards (Safety/ToolControl/TyreControl), menús, Ayuda, Configuración, UsuariosApp, modulosApp, Login admin, y plantillas de mensajes de Recobros/Seguimiento ("Administración Mobilink").

### Mensajes/documentos a cliente (server/index.ts)
- WhatsApp asistencia: "Tu asistencia de Mobilink…"
- PDFs: "Mobilink – Informe de Asistencia", "Mobilink – Seguimiento de furgoneta", "Mobilink – Orden de Trabajo de Flota"
- Email: asunto "Informe de asistencia Mobilink #id" y cuerpo
- Recordatorios de pago: "Administración Mobilink"

### Apps móviles (nombres visibles; ids intactos)
| App | Cambios | Versión |
|---|---|---|
| Capacitor Almacén (`android/`, `ios/`) | appName/strings/CFBundleDisplayName → "Mobilink Almacén" | n/a (build web) |
| Capacitor Técnicos (`android-tecnicos/`) | appName/strings → "Mobilink Técnicos" | n/a |
| `flutter_app` (Asistencia) | label Android "Mobilink Assist", iOS "Mobilink Asistencia" (+textos de permisos), title, web manifest | 1.5.0+17 → **1.6.0+18** |
| `tyrecontrol_app` | label/título/iOS → "Mobilink TyreControl", login ("Mobilink Assist"), descripción pubspec | 0.15.0+41 → **0.16.0+42** |
| `almacen_app` | label/título/login/traspasos → "Mobilink Almacén", descripción pubspec | 1.0.0+1 → **1.1.0+2** |

> Las APK se compilan en otra sesión (pauta del proyecto) y van al Escritorio con nombre versionado.

## Pendiente de renombrar (deuda técnica — NO tocar sin plan de migración)

| Elemento | Motivo |
|---|---|
| Bundle ids `com.seatarragona.*` (Capacitor y Flutter) | Cambiar el applicationId = app nueva en los dispositivos/stores |
| `package.json` name `sea-tarragona`, nombres de paquete pubspec (`tyrecontrol_app`, `almacen_app`, `sea_tarragona_operario`) | Identificadores técnicos; renombrarlos toca imports/builds |
| Rutas web `/sea-core/*` | Bookmarks/enlaces existentes; requiere redirects |
| Esquema BD: tablas `sea_*` (sea_employees, etc.) | Migración de datos coordinada |
| `server/index.ts:11115` lookup `.eq("nombre", "SEA Tarragona")` | Compara contra un DATO de la BD (fila de empresa); renombrar exige actualizar la fila y el código a la vez |
| `src/modules/administracion/services/authClave.ts` sufijo `"#SEA"` | Es sal de claves: cambiarlo invalida todas las claves guardadas |
| Servicio Render `sea-tarragona` y URL | Renombrar puede cambiar la URL pública del servicio |
| Repo GitHub `sea-tarragona`, ficheros `.db` (`sea-tarragona.db`) | Operativa; sin impacto de usuario |
| Logos (`logo_horizontal.png`, iconos de apps) | Son imágenes: requieren nuevo diseño gráfico Mobilink |
| "Tarragona"/"Reus" como geografía (almacenes, centros) | No es marca: son ubicaciones físicas |

## Verificación
- `npm run build` (tsc + vite) ✓
- Vista previa dev: la página de acceso muestra cabecera y pestaña **"Mobilink"** ✓
