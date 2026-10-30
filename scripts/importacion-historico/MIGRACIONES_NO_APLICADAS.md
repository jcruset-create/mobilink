# Migraciones que no se aplican al reconstruir el esquema de pruebas

`construir-esquema.sh` aplica las 267 migraciones de `supabase/migrations/` en
el orden de su primer commit sobre un Postgres vacío con stubs (auth, storage,
cron, net y las tablas del almacén). Se aplican 255; estas 12 fallan. Ninguna
crea ni cambia una tabla, función o permiso del que dependa la importación del
histórico (`tc_intervenciones`, `operaciones_neumaticos`,
`tc_intervencion_servicios`, `tc_importacion_*`, `tc_operacion_auditoria`,
`tc_reservas_neumatico`, `tc_vehiculos`, `tc_tipos_vehiculo`,
`tc_posiciones_vehiculo`, `tc_is_admin`/`tc_is_superadmin`/`tc_auth_empresa_id`,
`tc_anular_operacion` y las tablas con FK a operaciones que mira deshacer).

| Migración | Error en local | Qué toca | Por qué no afecta |
|---|---|---|---|
| `004_alertas_cron.sql` | `relation "cron.job" does not exist` (pg_cron no instalado; el stub solo crea el esquema) | Un job de pg_cron que llama por pg_net al envío de alertas | No crea objetos de datos; la importación no usa cron ni alertas. |
| `tyrecontrol_fase12_unificar_producto_almacen.sql` | `cannot change name of input parameter "p_ficha_generica"` (en local la versión previa de la función se creó con otro nombre de parámetro y `create or replace` no puede renombrarlo; en producción se ejecutó tras un `drop`) | `tc_montar_desde_almacen`, `tc_sustituir_neumatico` (RPC de montaje del taller) | La importación no llama a ninguna RPC de montaje por diseño (no toca montajes, stock ni neumáticos). Las pruebas e2e no las ejercitan. |
| `almacen_fase5_sincronizar_catalogo_completo.sql` | `relation "empresas" does not exist` (tabla del módulo Almacén, no stubbeada) | `tc_autoenlazar_productos_almacen` y datos de productos de almacén | Sincroniza catálogo con almacén. La importación no crea artículos ni productos. |
| `tyrecontrol_fase25_sync_bidireccional_empresas_clientes.sql` | `relation "empresas" does not exist` | Triggers de sincronización `clientes` ⇄ `tc_empresas` | Solo copia nombre/CIF entre tablas de clientes. La importación lee `tc_empresas.id`, que existe desde su migración base. |
| `administracion_fase3_unificar_clientes.sql` | `relation "empresas" does not exist` | `adm_customers`, `adm_guardar_cliente`, `adm_sync_cliente` | Módulo Administración. Sin relación con TyreControl. |
| `administracion_fase11_usuarios_unificados.sql` | `relation "perfiles_usuario" does not exist` | `app_usuarios`, `app_usuario_modulos`, `app_login_email`… | Login unificado de la app. La importación exige admin con `tc_is_admin()` sobre `tc_usuarios`, que sí está aplicada y se prueba (anon → 42501). |
| `mobilink_rename_datos_fase1.sql` | `relation "companies" does not exist` | Renombrado de datos visibles (textos) en tablas de otros módulos | Migración de datos manual; no crea esquema. |
| `connect_publicar_seas2026.sql` | `relation "connect_clients" does not exist` | Tarifarios y contratos de Mobilink Connect | Otro módulo, migración de datos. |
| `connect_activar_espejo_assist.sql` | `relation "connect_control_centers" does not exist` | Espejo económico Assist → Connect | Otro módulo. |
| `connect_intercambiar_posicion_talleres.sql` | `relation "connect_workshops" does not exist` | Corrige lat/lng de dos talleres | Otro módulo, migración de datos. |
| `010_techs_employee_id.sql` | `column "employee_id" ... does not exist` (el stub de `techs` no tiene la columna que una migración anterior del módulo Taller añade) | FK `techs.employee_id` → Core | Módulo Taller/usuarios. La importación no usa `techs`. |
| `tyrecontrol_bases_geozona_plana.sql` | `La empresa a51c9662-… no existe en tc_empresas` (comprobación propia de la migración: es una carga de datos de producción) | Geo-zonas de las delegaciones de Plana | Carga de datos; no crea esquema. La importación no usa delegaciones ni geozonas. |

Comprobación independiente del fallo de fase 12: tras la reconstrucción se
verificó que `tc_is_admin`, `tc_is_superadmin`, `tc_auth_empresa_id`, los 4
triggers de `operaciones_neumaticos` y las 20 FK que revisa deshacer existen
con la definición de las migraciones, que `tc_anular_operacion` queda con la
versión de esta migración (lectura `FOR UPDATE`), y
`concurrencia.sh esquema_completo` ejercita anular contra deshacer con la RPC
real.

Lo que esta lista NO cubre: diferencias entre el esquema reconstruido y
producción que vengan de cambios hechos a mano en el SQL Editor y no
reflejados en `supabase/migrations/`. Por eso, antes de aplicar la migración en
producción hay que comprobar el esquema real y tener backup (ver PR).
