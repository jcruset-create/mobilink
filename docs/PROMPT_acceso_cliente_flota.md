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
5. **Ningún dato de otro cliente ni agregado que permita inferirlo.**
6. Todo reutiliza el rol `cliente` existente. **No se crea un rol nuevo** ni
   un panel paralelo.

---

## Huecos a cubrir

### Fase 1 — Curar lo que ve el cliente (la más importante y la más barata)

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

### Fase 2 — Alta digna: invitación en vez de contraseña dictada

Hoy el alta pide que el administrador escriba la contraseña del cliente (y por
tanto la conoce). Para un usuario interno vale; para el director de flota de un
cliente, no.

- Botón "Invitar cliente" en Usuarios: pide email + empresa, crea el usuario
  con `inviteUserByEmail` (o enlace de recuperación como invitación) y el
  cliente fija su contraseña en su primer acceso.
- Reenviar invitación y desactivar acceso desde la misma ficha.
- Varios usuarios por empresa cliente (ENCATRANS puede querer 2-3).

### Fase 3 — Bienvenida y a prueba de directores de flota

- Al entrar un cliente, aterrizar directamente en **Informes → Ejecutivo** (su
  pantalla de valor), no en un dashboard genérico.
- El asistente ya le funciona; añadir sus sugerencias orientadas a cliente
  ("¿cuál es el estado general de mi flota?" ya está).
- Revisión de textos: nada de jerga interna ("intervención", "lote") sin
  explicar.
- Usable en móvil: el director de flota lo abrirá desde el teléfono.

### Fase 4 — Auditoría y control (cuando haya varios clientes activos)

- Registro de últimos accesos por usuario cliente (ya existe `last_sign_in` en
  auth; superficiarlo en la ficha).
- Página en Usuarios filtrable por "solo clientes" con su empresa y estado.
- Opcional por cliente: activar/desactivar módulos (p. ej. mostrar Económico a
  un cliente concreto que paga por ello) usando el gating `pantallas` que ya
  existe — sin código nuevo, solo UI para configurarlo.

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
| 1 Curar visibilidad | Medio día | Cliente ve costes y productividad interna |
| 2 Invitación | Medio día | Contraseñas conocidas por el admin |
| 3 Aterrizaje | Horas | Primera impresión pobre |
| 4 Auditoría | 1 día | Solo importa con varios clientes |

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
