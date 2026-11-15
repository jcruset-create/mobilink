# PROMPT — Usuarios de consulta para Autocares Plana (y cualquier cliente de flota)

> Decidido con Jordi el 15/11/2026. Sigue a
> `docs/PROMPT_acceso_cliente_flota.md` (fases 1-4 hechas) y corrige lo que esa
> auditoría dio por cerrado y no lo estaba.

## Objetivo

Que personas de **Empresa Plana S.L.** (807 vehículos, 6 delegaciones: Reus,
Vilanova, Tarragona, Calafell, Hospitalet de l'Infant y Barcelona) entren al panel
de TyreControl y **consulten** el estado de su flota, **sin poder cambiar nada** y
**sin ver nada interno de Mobilink**: costes, precios, proveedores, productividad
de técnicos, stock, otras empresas.

La garantía tiene que estar en la **base de datos y en el servidor**, no en la
interfaz. Un cliente que abra las herramientas del navegador y llame a la API
directamente tiene que encontrarse la misma pared que en pantalla.

## Reglas que no se negocian

1. Un usuario de cliente es SIEMPRE `rol = 'cliente'`. Nunca `administrador`:
   `tc_is_admin()` no mira la empresa, y varias políticas dejan a un
   administrador escribir en cualquier empresa.
2. Un usuario de cliente nunca tiene `acceso_apk = true` ni filas en
   `tc_operador_empresas`. La base de datos lo impide; no basta con no marcarlo.
3. Nada se aplica directamente en producción: rama, migraciones versionadas
   autoprobadas (bloque `do $migracion$` con suplantación de superadmin,
   administrador, operador **y cliente**), PR y merge con la CI en verde.
4. No se tocan `tc_montajes_actuales`, `tc_neumaticos`, `tc_vehiculo_ejes`,
   `config_ejes_id` ni `tc_vehiculos.km_actual` salvo en políticas de lectura.
5. Cada fase acaba con una prueba que **inicia sesión como cliente e intenta
   escribir y leer lo prohibido**. Si algo pasa, la fase no está hecha.

## Perfiles dentro del rol cliente

No se crea un rol nuevo en `tc_rol`. Se añade un perfil al usuario cliente:
`tc_usuarios.perfil_cliente` (`flota` | `delegacion` | `director`), y en el perfil
`delegacion` se usa `tc_usuarios.delegacion_id`, que ya existe y hoy no se lee.

| | Responsable de flota | Jefe de base | Director |
|---|---|---|---|
| Ámbito | Toda la empresa | Solo su delegación | Toda la empresa |
| Informes (ejecutivo, mensual, alertas, estado de flota, desgaste, previsión, presiones) | Sí | Sí, de su delegación | Sí |
| Mis vehículos y su ficha (plano, profundidades, km, ITV) | Sí | Sí, de su delegación | No |
| Neumáticos montados | Sí | Sí, de su delegación | No |
| Trabajos realizados y partes (PDF de cliente) | Sí, **sin costes** | Sí, de su delegación, sin costes | No |
| Revisiones: histórico, próxima, atrasadas | Sí | Sí, de su delegación | Resumen |
| Alertas de presión (Goodyear) | Ver | Ver | No |
| Exportar a Excel | Sí, sin costes | Sí, sin costes | Solo los informes |

**Ningún perfil ve:** costes, precios de compra, líneas de albarán, proveedor,
observaciones internas, productividad ni pausas de técnicos, GPS de las tablets,
stock y almacén, analítica interna, informes económico y rankings, ni otras
empresas.

**Decidido por Jordi (15/11/2026):**
- El cliente **ve el nombre del técnico** en partes y revisiones.
- El cliente **no puede dar por resuelto** un aviso de presión de Goodyear: solo
  lo ve.
- El tercer perfil es **Director**: solo informes, de toda la empresa.

**Sigue pendiente:**
- [ ] ¿El jefe de base ve los vehículos de otras bases que estén **de paso** en la
  suya?

## Fase 0 — Cerrar lo que está abierto hoy, haya clientes o no

Estado:
- [x] 0.1 Funciones — `supabase/migrations/tyrecontrol_seguridad_fase0_funciones.sql`
- [x] 0.2 Servidor: empresa por defecto, endpoints de ficha técnica y cierre de partes
- [x] 0.3 Fotos, paso 1: listar, subir y sobrescribir solo con sesión y sin rol cliente (`tyrecontrol_seguridad_fase0_fotos.sql`). Paso 2, buckets privados con enlaces firmados: después del piloto
- [x] 0.4 Tablas del almacén abiertas sin sesión (`almacen_seguridad_fase0_cerrar_anon.sql`). NO aplicar `saas_fase1c_almacen_cerrar_anon.sql`: aflojaría las reglas por cliente y ubicación
- [ ] Aparte, fuera de esta fase: Safety, Presencia y ToolControl siguen legibles sin sesión; cerrarlas exige darles login

Verificado en producción el 15/11/2026. Afecta ya, sin usuarios de cliente:

1. **Funciones ejecutables sin iniciar sesión** (`anon`) y por cualquier usuario,
   todas `SECURITY DEFINER` y sin comprobar permisos:
   - `tc_reenganchar_neumatico`: marca cualquier neumático como montado en
     cualquier vehículo de cualquier empresa.
   - `tc_agrupar_operaciones_sueltas`: agrupa operaciones de todas las empresas.
   - `tc_asignar_numero_intervencion` y los `tc_generar_numero_*`.
   - `tc_resolver_incidencia_parcial`: solo comprueba que se vea la empresa.
   - `tc_imp_*` (importación histórica): ejecutables por `authenticated`.

   Hay que hacer `revoke execute ... from public, anon, authenticated` y conceder
   solo a quien corresponda, más una comprobación de rol dentro de cada función.
   **Antes, comprobar quién las llama** (APK, panel, servidor con service role)
   para no romper la operativa.
2. **Servidor:** un usuario que solo existe en `tc_usuarios` recibe la empresa por
   defecto (SEA) en `server/core/auth.ts` y pasa `requireModule("administracion")`.
   Con el token de un cliente se llegaría a `/api/payments/*` (ver y borrar
   pagos) y a `/api/administracion/recobro-whatsapp`. Un usuario de TyreControl
   sin ficha unificada no puede heredar la licencia de SEA, salvo que sea
   superadmin.
3. **Endpoints de ficha técnica y documentos** (`/vehiculos/:id/ficha-tecnica`,
   `/documentos/nueva-ficha`, `/documentos/:id/ocr`, `/documentos/:id/aplicar`,
   `GET /vehiculos/:id/documentos`): comprueban que existe el vehículo, no que sea
   de la empresa del usuario ni que el usuario pueda escribir. También
   `POST /tipos/:id/generar-posiciones` y `POST /api/tyrecontrol/intervencion/cerrar`.
4. **Fotos:** los buckets `tc-revisiones-fotos` y `tc-operaciones` son públicos.
   Las fotos y firmas de todas las empresas se leen con el enlace, y en
   `tc-operaciones` cualquier usuario puede sobrescribirlas. Hay que pasar a
   privados con URL firmadas y escritura solo de quien opera.
5. Tablas del almacén con políticas para `anon` (`traspasos`,
   `solicitudes_reposicion`, `movimientos_stock`): leer y modificar sin sesión.
   Revisar con la app de almacén antes de cerrar.

## Fase 1 — Blindar el rol cliente

- **Alta:** el panel y el servidor no asignan empresas ni APK a un `cliente`.
  Hoy, guardar la ficha como superadmin con «todas las empresas», o un login en
  la APK, lo convierten en operador de TODAS las empresas, con escritura. Hacen
  falta un trigger que lo impida y que `login-operario` rechace `rol = 'cliente'`.
- **Escrituras que hoy se le permiten a un cliente dentro de su empresa:**
  - `tc_presiones_objetivo`: cambia las presiones objetivo, que mandan las alertas.
  - `tc_vehiculo_documentos`, `tc_vehiculo_atributos_tecnicos` y
    `tc_vehiculo_ficha_historial`.
  - `tc_resolver_incidencia_parcial`.
  - Tacógrafo: importar, deshacer y aceptar propuestas.
  - `autorizaciones_operaciones`.

  Todas pasan a `not tc_is_cliente()` en la base de datos y a una comprobación de
  rol en el servidor.
- **Costes y datos internos:**
  - La lectura de cliente de operaciones y partes va por una vista o RPC sin
    `coste*`, `proveedor` ni `observaciones` internas.
  - El Excel de «Trabajos realizados» usa la misma fuente.
  - `tc_precios_medida`, `tc_importacion_lineas`, `tc_pausas_trabajo` y las RPC
    `tc_informes_economico` y `tc_informes_productividad` rechazan a un cliente.
  - El PDF del parte en modo cliente no lleva datos internos.
- **Pantalla «Hacer revisión»** (`revision-vehiculo`): fuera del rol cliente.

## Fase 2 — Perfiles

- Migración: `perfil_cliente` con un check, más `delegacion_id` obligatorio
  cuando el perfil es `delegacion`.
- Función `tc_cliente_ve_vehiculo(vehiculo_id)` y uso en las políticas SELECT de
  vehículos y de todo lo que cuelga de ellos: montajes, revisiones, operaciones,
  intervenciones, incidencias y alertas. También en los filtros de informes del
  servidor (`empresaDelInforme`).
- Panel: selector de perfil y de delegación en la ficha del usuario; menú según
  el perfil.

## Fase 3 — Piloto con Plana

1. Un usuario **Responsable de flota** de Plana, invitado por enlace.
2. Una semana de uso. Revisar el registro de accesos (Fase 4 del documento
   anterior) y las preguntas que hagan.
3. Después, un **Jefe de base**, probablemente de Reus.

## Criterios de aceptación

Con un usuario cliente real de prueba de Plana, desde el navegador y desde la API:

1. Ve sus 807 vehículos y ninguno de otra empresa. El jefe de base solo ve los de
   su delegación.
2. Cualquier `insert`, `update`, `delete` o RPC de escritura devuelve error.
   Probado tabla por tabla con un script, no a mano.
3. Ninguna respuesta incluye coste, precio, proveedor ni pausas.
4. `/api/payments/recent` con su token devuelve 403.
5. Con su nombre y PIN no puede entrar a la APK.
6. Las fotos de otra empresa no se abren con su sesión.
