# PROMPT — Acceso de cliente de flota (caso tipo: ENCATRANS)

> Documento de diseño para implementar DESPUÉS de aprobarlo. No programar nada
> a partir de aquí sin leer primero "Qué existe ya": la mitad de lo que pide un
> acceso de cliente ya funciona, y duplicarlo crearía dos verdades.

## Objetivo

Que un cliente de la flota (ENCATRANS, Autocares Plana…) pueda entrar al panel
de TyreControl con su propio usuario y ver **solo su empresa**: el estado de su
flota, sus informes (incluido el ejecutivo con el "banco de goma"), sus
incidencias y el asistente. Sin ver jamás datos de otro cliente, precios de
compra, productividad de los técnicos ni nada interno de Mobilink.

La primera empresa en estrenarlo será ENCATRANS, pero **nada se programa "para
ENCATRANS"**: todo sale de `empresa_id` y de la configuración. Dar de alta al
siguiente cliente tiene que ser un trámite de 2 minutos, no un desarrollo.

---

## Qué existe ya (verificado en el código — NO rehacer)

| Pieza | Dónde | Estado |
|---|---|---|
| Rol `cliente` | `tc_usuarios.rol`, `types/index.ts` | Existe |
| Alta de usuario cliente (email+contraseña, empresa, panel/APK) | pantalla Usuarios + `auth.admin.createUser` en el server | Existe |
| Navegación propia del cliente (Mi empresa, Mis delegaciones, Mis vehículos, Mis neumáticos, Montajes, Operaciones, Informes, Ayuda, Perfil) | `config/navigation.ts` | Existe |
| Aislamiento por RLS (`tc_puede_ver_empresa`) en las tablas y en las RPC `security invoker` de informes | migraciones fase 1-3 + informes | Existe |
| Filtros de informes fijados a su empresa (sin selector de empresa) | `useFiltrosInformes.ts` (`esCliente`) | Existe |
| Gating por pantallas (`pantallas` por usuario, bloquea también URL directa) | `TyreLayout.tsx` + usuarios unificados | Existe |
| Asistente IA acotado: un cliente SIEMPRE pregunta por su empresa, decidido en servidor | `server/tyrecontrol/asistente.ts` (`resolverAlcance`) | Existe |
| Informe ejecutivo por empresa (RPC `tc_informe_ejecutivo`, invoker) | migración + pestaña Ejecutivo | Existe |

**Conclusión honesta**: hoy ya se puede crear un usuario ENCATRANS con rol
`cliente` y entrará viendo solo lo suyo. Lo que falta no es el acceso: es
pulir lo que ve, cómo se le da de alta y las garantías de que nada interno se
cuela. Eso es este prompt.

---

## Reglas que no se negocian

1. **El aislamiento lo decide el servidor, nunca el navegador.** La RLS cubre
   lo que va por Supabase directo; pero `server/supabase.ts` usa SERVICE ROLE
   (salta la RLS), así que **cada endpoint del Express que pueda tocar un
   cliente debe filtrar por su `empresa_id` resuelto de la sesión** — como ya
   hace el asistente. Prohibido aceptar `empresa_id` del body sin validar.
2. **Lo que el cliente no debe ver, no se le manda.** Ocultar una pestaña no
   basta: la ruta y el endpoint también se cierran. (El gating por URL ya
   existe; hay que decidir la lista, ver Fase 1.)
3. **Nada de datos económicos internos** (coste de compra, coste/km, ahorro de
   reparaciones) salvo decisión expresa por cliente. El informe Económico y
   Rankings usan costes: por defecto, fuera del rol cliente.
4. **Productividad de técnicos es interna.** Tiempos, pausas y ranking de
   operarios de Mobilink no son asunto del cliente. Fuera siempre.
5. **Ningún dato de otro cliente ni agregado que permita inferirlo.** Un
   cliente tampoco ve a los demás usuarios de su propia empresa: la política
   `tc_usuarios_select` le deja solo su propia fila (migración
   `tyrecontrol_cliente_solo_se_ve_a_si_mismo.sql`).
6. Todo reutiliza el rol `cliente` existente. **No se crea un rol nuevo** ni
   un panel paralelo.

---

## Huecos a cubrir

### Fase 1 — Curar lo que ve el cliente — HECHO

Hoy el cliente que entra en Informes ve las 12 pestañas, incluidas
**Productividad** (técnicos de Mobilink), **Económico** y **Rankings**
(costes). Eso es un escape de información interna, no una funcionalidad.

- `InformesLayout.tsx`: lista de pestañas según `esCliente`. Cliente ve:
  **Ejecutivo, Alertas, Estado de flota, Neumáticos controlados, Desgaste,
  Presiones, Historial vehículo**. No ve: Económico, Rankings, Productividad,
  Operaciones (formato interno), Historial neumático (códigos internos —
  revisar si se deja).
- Cerrar también las rutas (`TyreControlApp.tsx`) para el rol cliente, no solo
  las pestañas.
- Revisar el Dashboard con ojos de cliente: cada tarjeta, ¿es suya o interna?
- **Prueba de aceptación**: entrar como usuario ENCATRANS e intentar abrir por
  URL directa `/tyrecontrol/informes/productividad` → bloqueado.

### Fase 2 — Alta digna: invitación en vez de contraseña dictada — HECHO

Corrección sobre lo que suponía este documento: **el panel no usa contraseña**.
Se entra con enlace mágico por email (`signInWithOtp` en `Login.tsx`). La
contraseña que pedía el alta solo sirve como PIN de la APK, así que para un
cliente era una credencial que nadie iba a usar y que el admin conocía.

Implementado:

- El alta **solo pide contraseña si se marca acceso APK** (allí es el PIN). Sin
  APK, el servidor genera una aleatoria que nadie conoce: a la cuenta solo se
  entra por enlace.
- Ficha de usuario con bloque "Acceso al panel": botón que genera un **enlace
  de acceso de un solo uso** (`POST /usuarios/:id/enlace-acceso`) para pasárselo
  al cliente por el canal habitual. El bloque del PIN solo sale si usa APK.
- Se usa `generateLink` y **no** `inviteUserByEmail`: el envío de correo de
  Supabase en el plan por defecto está muy limitado y fallaría en silencio.
  Quien manda el enlace es el administrador.
- Un admin de empresa solo genera enlaces de usuarios de SU empresa; el
  super-admin, de cualquiera. El enlace nunca se escribe en los logs.
- Desactivar acceso ya existía (botón Activo/Inactivo) y varios usuarios por
  empresa también: no hay restricción que lo impida.

### Fase 2b — Ficha de vehículo en solo lectura — HECHO

Hoy "Mis vehículos" es una tabla plana sin enlace: el cliente no puede abrir
ningún vehículo. La ficha (`VehiculoDetalle`: plano del chasis con los
recuadros coloreados, profundidades y presiones por posición, historial) es de
lo más valioso que se le puede enseñar — y su ruta está en el bloque de
administrador.

- Cada fila de "Mis vehículos" enlaza a una ficha de SOLO lectura del
  vehículo: mismo plano y mismas mediciones, **sin ningún botón de acción**
  (ni editar, ni revisión, ni cambio de neumático, ni notas).
- Reutilizar `VehiculoDetalle` con un modo `soloLectura` que oculte las
  acciones, no duplicar la pantalla: dos fichas divergen en un mes.
- La garantía de "no puede modificar nada" NO es la interfaz: son las
  políticas RLS de escritura, que ya exigen admin (`tc_is_admin()`), y que
  cualquier endpoint Express con service role valide el rol. La interfaz solo
  evita frustración; la base de datos evita el problema.
- **Prueba de aceptación**: como cliente, abrir la ficha, comprobar que no hay
  botones de escritura, y forzar un `update` de vehículo por consola con su
  sesión → rechazado por RLS.

Al implementarlo resultó que `VehiculoDetalle` **ya estaba preparado**: calcula
`esCliente` y pasa `puedeEditar={!esCliente}` a ficha técnica, ITV y plan de
mantenimiento, oculta Webfleet y limita la calibración al super-admin. Lo que
faltaba era solo acceso y navegación:

- La ruta `vehiculos/:id` sale del bloque de administrador a uno propio con
  `roles={["administrador", "cliente"]}`. Se listan los dos a propósito:
  dejarla abierta a todos habría dado al OPERADOR permiso de edición sobre
  ficha técnica, ITV y plan, que hoy no tiene desde el panel.
- Las filas de "Mis vehículos" enlazan a la ficha.
- Dentro de la ficha, "← Vehículos" lleva a "Mis vehículos" si es cliente (esa
  lista es de administrador), y el enlace a la ficha del neumático no se
  ofrece: `/neumaticos/:id` es pantalla de administrador y el botón "Ver ficha"
  del plano habría quedado muerto.

### Fase 3 — Bienvenida y a prueba de directores de flota — HECHO

- Al entrar un cliente, aterrizar directamente en **Informes → Ejecutivo**. Se
  redirige en dos sitios a propósito: al iniciar sesión y dentro del propio
  Dashboard, porque el enlace del email aterriza en `/dashboard` y si no el
  cliente vería el panel del taller cada vez que entrase desde su correo.
- El asistente ya le funciona; añadir sus sugerencias orientadas a cliente
  ("¿cuál es el estado general de mi flota?" ya está).
- Revisión de textos: nada de jerga interna ("intervención", "lote") sin
  explicar.
- Usable en móvil: comprobado a 390 px. La página no desborda en horizontal
  (las tablas anchas scrollean dentro de su contenedor, que es lo correcto) y
  se corrigieron dos cortes de lectura: en "Evolución" el valor y la tendencia
  compartían línea y "sin comparativa" se partía encima de la cifra, y en la
  estadística "10,0 mm" se rompía en dos renglones.
- Menú del cliente en su idioma: "Montajes actuales" → "Neumáticos montados" y
  "Operaciones" → "Trabajos realizados". Son entradas propias del rol, así que
  el vocabulario del taller no cambia.

### Fase 4 — Auditoría y control — HECHO

- Columna **Último acceso** en Usuarios ("hoy", "hace 12 días", "nunca"), en
  gris apagado si hace más de dos semanas. `last_sign_in_at` vive en
  auth.users, así que va por un endpoint con service role
  (`GET /usuarios/ultimos-accesos`) cuyo alcance decide el servidor: un admin
  de empresa solo ve los suyos. Si esa llamada falla, la pantalla sigue
  funcionando: el dato es informativo.
- Filtros por rol (Todos / Clientes / Técnicos / Administradores) con su
  recuento, más buscador por nombre, email o empresa.
- Editor de **pantallas permitidas** en la ficha: "todas las de su rol" o una
  selección. La lista se deriva del propio menú (`NAV`), así que una pantalla
  nueva aparece sola sin mantener una lista paralela.

Dos correcciones al diseño original:

- Se usa `tc_permisos_cliente` y **no** `app_usuario_modulos`: esta última
  referencia `app_usuarios`, y un cliente creado desde este panel solo existe
  en `tc_usuarios` — el guardado habría fallado por clave ajena. La tabla
  nativa ya traía las políticas necesarias (admin gestiona los de su empresa,
  cada usuario lee los suyos), así que no hizo falta endpoint ni migración.
- **Perfil** pasa a la lista de pantallas que nunca se filtran, junto a
  Dashboard y Ayuda: restringir pantallas dejaba a la persona sin su propia
  ficha. Y un cliente al que se le quite Informes ya no es redirigido allí al
  entrar, que le habría dejado en "no tienes acceso".

---

## Qué NO entra en este trabajo

- Portal con dominio/branding propio por cliente (subdominios, logos): otro
  proyecto.
- App móvil para clientes: el panel responsive cubre el caso.
- Notificaciones por email/WhatsApp al cliente: ya especificado en el prompt
  del asistente (fase 5) y en incidencias; no duplicar aquí.
- Facturación o permisos de escritura del cliente: el acceso es de LECTURA.
  Un cliente no edita nada de su flota en esta fase.

## Orden recomendado y esfuerzo

| Fase | Esfuerzo | Riesgo si no se hace |
|---|---|---|
| ~~1 Curar visibilidad~~ | HECHO | ~~Cliente ve costes y productividad interna~~ |
| ~~2 Invitación~~ | HECHO | ~~Contraseñas conocidas por el admin~~ |
| ~~2b Ficha vehículo solo lectura~~ | HECHO | ~~El cliente ve la lista pero no puede abrir nada~~ |
| ~~3 Aterrizaje~~ | HECHO | ~~Primera impresión pobre~~ |
| ~~4 Auditoría~~ | HECHO | ~~Solo importa con varios clientes~~ |

La Fase 1 es la única **bloqueante** antes de dar el primer acceso real a
ENCATRANS: con lo demás se puede convivir unos días; con un cliente viendo la
productividad de los técnicos, no.

## Criterios de aceptación (con usuario real de ENCATRANS)

1. Entra y ve SOLO vehículos, neumáticos e informes de ENCATRANS.
2. `/tyrecontrol/informes/productividad` y `/economico` por URL → bloqueado.
3. El informe Ejecutivo y el banco de goma cargan con sus datos y sus umbrales.
4. El asistente responde por ENCATRANS aunque le pida otra empresa.
5. En Usuarios, un admin ve cuándo entró por última vez.
6. Crear el acceso del siguiente cliente no requiere tocar código.
7. Abre la ficha de un vehículo suyo (plano + mediciones) y no encuentra
   ningún botón de escritura; un `update` forzado con su sesión lo rechaza
   la RLS.
