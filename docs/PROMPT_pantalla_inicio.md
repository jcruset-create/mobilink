# PROMPT — Pantalla de inicio con los módulos de cada usuario

> Prompt listo para usar en el repo `sea-tarragona`. Crea el "hub" al que llega cada usuario tras el login unificado, mostrando solo los módulos y pantallas que tiene permitidos.

## Contexto (ya construido)

- Login unificado en `/acceso` por usuario + contraseña (fase 11). Hoy, tras entrar, redirige directamente al primer módulo permitido (`src/pages/AccesoPage.tsx`, lista `DESTINOS`).
- Los permisos viven en `app_usuario_modulos` (modulo, rol, pantallas; RLS permite a cada usuario leer sus propias filas) y el catálogo de etiquetas/iconos en `src/modules/administracion/config/modulosApp.ts` (MODULOS_APP: administracion, almacen, tyrecontrol con sus pantallas).
- El gating por pantallas ya se aplica dentro de los tres módulos; esta pantalla es la puerta de entrada, no un control de seguridad adicional.
- Existe un `/sea` (SeaHub) antiguo NO ligado a permisos: no tocarlo.

## Qué construir

### Pantalla `/inicio` (`src/pages/InicioPage.tsx`)

- Estilo oscuro slate + acento sky, como el login y el módulo Administración.
- **Topbar**: logo/nombre "SEA Tarragona", saludo con el nombre del usuario (de `app_usuarios`, fallback a `adm_usuarios`/metadata) y botón "Salir" (signOut + volver a `/acceso`).
- **Rejilla de tarjetas de módulo**, una por cada fila de `app_usuario_modulos` del usuario (el **superadmin ve los tres módulos siempre**):
  - Icono y nombre del módulo (de MODULOS_APP; icono lucide: Wallet=Administración, Warehouse=Almacén, Truck=TyreControl).
  - Píldora con el **rol** en ese módulo.
  - **Accesos directos a pantallas**: chips clicables con las pantallas permitidas (si `pantallas` es null → las del catálogo), máximo ~6 visibles y "+N más"; cada chip navega directo a esa pantalla del módulo.
  - Botón grande **"Entrar"** que lleva a la ruta principal del módulo (administracion → `/administracion/dashboard`, almacen → `/almacen-neumaticos`, tyrecontrol → `/tyrecontrol/dashboard`).
- **Tarjeta fija "Panel de taller"** (SeaTarragonaV1, ruta `/`): visible para todos los usuarios logueados, sin chips (tiene su propio login interno). Se puede quitar fácilmente si molesta (flag en el código).
- **Sin módulos**: si el usuario no tiene ninguna fila, mensaje claro "Tu usuario no tiene módulos asignados. Contacta con un administrador" + botón Salir.
- Responsive: rejilla `sm:grid-cols-2 lg:grid-cols-3`; tarjetas con hover.

### Cambios de flujo

1. `AccesoPage`: tras login correcto (y si ya hay sesión al entrar en `/acceso`) → `navigate("/inicio")` en lugar de la redirección por DESTINOS. Mantener el aviso "sin módulos" ahora dentro de `/inicio`.
2. Ruta en `App.tsx`: `/inicio` → `InicioPage` (requiere sesión: si no hay, redirigir a `/acceso`).
3. En los tres módulos, añadir un enlace discreto **"Inicio"** en la topbar (icono Home a la izquierda del botón Salir) que vuelve a `/inicio`, para poder saltar de un módulo a otro sin tocar la URL.

### Datos

- Cargar en paralelo: `app_usuarios` propio (nombre, es_superadmin) y `app_usuario_modulos` propios. Un solo componente, sin contexto nuevo.
- Usuarios antiguos aún sin fila en `app_usuarios` (login por email de un módulo): fallback → mostrar las tarjetas según sus perfiles de módulo (`adm_usuarios`/`tc_usuarios` propios legibles por RLS) o, si nada responde, la de Panel de taller. No romper nunca.

## Entregables

1. `src/pages/InicioPage.tsx` + ruta `/inicio` + redirecciones desde `AccesoPage`.
2. Enlace "Inicio" en las topbars de AdminLayout, TyreLayout y (si es viable con un cambio pequeño) el header del almacén.
3. `npm run build` limpio, versión en `src/version.ts`, commit + push.

## Restricciones

- No es un control de seguridad: solo muestra/oculta; el gating real sigue en cada módulo.
- No tocar `/sea` (SeaHub antiguo) ni el login interno del Panel de taller.
- Español, mismo estilo visual, sin la palabra "moroso".
