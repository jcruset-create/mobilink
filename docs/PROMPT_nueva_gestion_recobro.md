# PROMPT — Botón "Nueva gestión" en el expediente de recobro

> Prompt listo para usar en el repo `sea-tarragona`. Mejora del módulo `src/modules/administracion` (SEA Administración), pantalla de Recobros.

## Contexto

En el detalle de un expediente de recobro (`src/modules/administracion/pages/Recobros.tsx`, componente `ModalDetalleRecobro`, ya a pantalla completa) las gestiones se registran hoy con botones sueltos (Llamada, WhatsApp, avisos, nota, compromiso) repartidos entre el pie del modal y la columna "Gestionar". Funciona, pero el administrativo/a tiene que saber dónde está cada cosa y en qué orden usarla.

Se quiere un flujo único y guiado: un botón **"➕ Nueva gestión"** que abra un formulario claro donde registrar cualquier gestión en un solo sitio, siempre con los mismos pasos, **y con un campo explícito de quién realiza la gestión**.

## Qué construir

### 1. Botón "Nueva gestión"

- Botón primario grande (azul `sky-600`, icono `Plus` o `ClipboardPen`) arriba de la columna **Gestionar** del detalle del expediente.
- Los botones sueltos actuales del pie (Primer aviso, Segundo aviso, WhatsApp, Llamada) se mantienen como atajos, pero el camino principal es "Nueva gestión".

### 2. Modal "Nueva gestión" (sub-modal sobre el detalle)

Formulario en este orden:

**a) Tipo de gestión** — botones grandes tipo tarjeta con icono, seleccionables (no un select pequeño):
- 📞 Llamada
- 💬 WhatsApp
- ✉️ Email / aviso (con subtipo: primer aviso / segundo aviso / recordatorio)
- 🤝 Compromiso de pago
- 📝 Nota interna
- 💶 Pago recibido (parcial o total)

**b) Resultado** (solo para llamada/WhatsApp/email) — select con opciones rápidas:
- Contactado — promete pago
- Contactado — disputa la factura
- Contactado — pide más tiempo
- No contesta
- Teléfono/email erróneo
- Otro

**c) Campos según el tipo:**
- Compromiso de pago o resultado "promete pago" → **fecha comprometida** (obligatoria). Al guardarla, estado → "Compromiso de pago" y próxima acción = esa fecha.
- Email/aviso → al guardar abre el `mailto:` con la plantilla ya existente y estado → primer/segundo aviso según subtipo.
- WhatsApp → abre `wa.me` con el texto precargado (reutilizar la función actual).
- Pago → importe + forma de pago (reutilizar `registrarPagoVinculado`; el pago total cierra el expediente como ahora).
- Nota / todos los tipos → **comentario** (textarea) y **próxima acción** (fecha, opcional).

**d) Gestionado por** — select **obligatorio** con los usuarios activos de `adm_usuarios` (mostrar nombre), **por defecto el usuario logueado**. Es quien hizo la gestión, aunque otra persona la teclee (varias personas comparten puesto en administración).

**e) Botón "Guardar gestión"** — un solo clic registra todo:
- Inserta en `adm_recovery_actions` con `user_id` = el usuario seleccionado en "Gestionado por", `action_type` según el tipo, `notes` = resultado + comentario, `next_action_date` si se indicó.
- Actualiza el estado del expediente automáticamente según tipo/resultado (llamada → "Llamada realizada", compromiso → "Compromiso de pago", aviso → "Primer/Segundo aviso enviado", etc.). Sin preguntar: el estado se deduce.
- Refresca el historial sin cerrar el detalle del expediente.

### 3. Historial

- El historial ya muestra el nombre del usuario (`user:adm_usuarios(nombre)`); verificar que muestra el del "Gestionado por" seleccionado.
- Añadir al principio de la nota el resultado elegido, ej.: `[Contactado — promete pago] Ha dicho que paga el día 8`.

## Reglas técnicas

- **Sin migración de BD**: `adm_recovery_actions.user_id` ya existe y admite cualquier usuario de `adm_usuarios`; el resultado va dentro de `notes`. No crear columnas nuevas.
- Nuevo servicio en `data.ts`: `listUsuariosActivos()` → select de `adm_usuarios` (id, nombre) donde `activo = true`. Nota RLS: la política actual de `adm_usuarios` solo deja ver el propio perfil salvo admin — **añadir una migración mínima solo si es imprescindible** (política `select` para `adm_can_manage()`), y en ese caso crear `administracion_fase7_usuarios_visibles.sql` idempotente.
- Componente nuevo `ModalNuevaGestion` dentro de `Recobros.tsx` (o extraído a `components/` si supera ~200 líneas), estilo idéntico al resto (Modal, Field, botones del `ui.tsx` del módulo).
- Permisos: solo `admin` y `administracion` ven el botón (igual que `puedeGestionar`).
- Español en toda la interfaz, sin la palabra "moroso".
- Compilar con `npm run build`, subir versión en `src/version.ts` y desplegar (commit + push a main → Render).

## Resultado esperado

El administrativo abre el expediente → "Nueva gestión" → elige tipo con un clic → resultado → escribe una línea → confirma quién la hizo → Guardar. Una sola pantalla, un solo guardado, estado e historial actualizados solos.
