# Fase 0 · Análisis de la fotografía real de Supabase

Fecha de la captura: **2026-09-26 21:44 UTC**. Origen: consulta de solo lectura
`verificacion-minima.sql` ejecutada por el usuario en el editor SQL del
proyecto, rol `postgres`, base `postgres`.

Este documento **no modifica la migración**. Donde el estado real contradice un
supuesto, se describe la diferencia y se propone el cambio, para decidirlo
aparte.

---

## 1. Lo primero: la versión de PostgreSQL

| | |
|---|---|
| Producción | **PostgreSQL 17.6** (aarch64) |
| Donde se probó la migración | PostgreSQL 16.13 (x86-64) |

Las cuatro pegas que encontré al probar la migración, lo de `PUBLIC`, lo de
`pg_temp` y lo del renombrado de parámetros son comportamientos antiguos y
estables, y no espero diferencias. Pero **es un supuesto sin verificar**: las
pruebas hay que repetirlas contra un 17.6 antes de aplicar nada. No cambia el
GO/NO-GO de hoy; entra como precondición de la Fase D.

---

## 2. El hallazgo que cambia el tamaño del problema

La auditoría dijo «88 tablas sin RLS». El estado real:

| Dato | Valor |
|---|---|
| Tablas en `public` | **437** |
| Con RLS | 249 |
| **Sin RLS** | **188** |
| Datos en tablas sin RLS | ~152 MB |

**La migración cubre 42 de esas 188.** La lista de 88 era, como estaba
advertido en su cabecera, un suelo y no un techo — pero la distancia es mayor
de lo que el aviso sugería.

### 2.1 Clasificación de las 88 de la lista

| Vía | Nº | Qué significa |
|---|---|---|
| **A** · en la lista y **no existe** | **0** | Ninguna. El supuesto de «~22 ausentes» del precheck anterior era **erróneo**: salía de comparar el repositorio consigo mismo, no con producción. Queda corregido. |
| **B** · en la lista y **sin RLS** | **42** | Lo que la migración cierra de verdad. |
| **C** · en la lista y **ya con RLS** | **46** | Ya estaban cerradas. Las 46 tienen RLS **y cero políticas**, que es el cierre completo. Para ellas la sección 1 es inocua: reactiva RLS ya activa y añade el `revoke`, que sí aporta. |

### 2.2 Las 146 que quedan fuera

Tablas sin RLS que **la migración no toca**. Todas con `anon` y
`authenticated` en CRUD completo. Las más graves:

| Tabla | Tamaño | RLS | Permisos |
|---|---|---|---|
| `connect_api_keys` | 24 kB | sin RLS | `anon` CRUD completo |
| `connect_lite_devices` | 80 kB | sin RLS | `anon` CRUD completo |
| `connect_lite_users` | 64 kB | sin RLS | `anon` CRUD completo |
| `connect_users` | 80 kB | sin RLS | `anon` CRUD completo |
| `app_users` | 32 kB | sin RLS | `anon` CRUD completo |
| `assist_panel_users` | 24 kB | sin RLS | `anon` CRUD completo |
| `licenses` | 80 kB | sin RLS | `anon` CRUD completo |
| `license_usage` | 24 kB | sin RLS | `anon` CRUD completo |
| `payments` | 64 kB | sin RLS | `anon` CRUD completo |
| `cobros` | 40 kB | sin RLS | `anon` CRUD completo |
| `cash_bank_accounts` | 80 kB | sin RLS | `anon` CRUD completo |
| `connect_audit_logs` | 144 kB | sin RLS | `anon` CRUD completo |
| `whatsapp_messages` | 1728 kB | sin RLS | `anon` CRUD completo |
| `connect_webhook_endpoints` | 16 kB | sin RLS | `anon` CRUD completo |
| `connect_quotes` | 48 kB | sin RLS | `anon` CRUD completo |
| `connect_tariff_lines` | 24 kB | sin RLS | `anon` CRUD completo |
| `survey_responses` | 24 kB | sin RLS | `anon` CRUD completo |
| `quality_cases` | 64 kB | sin RLS | `anon` CRUD completo |

Y el resto:

- `assigned_maintenance_tasks`, `assist_talleres`, `assistance_documents`, `assistance_drafts`, `assistance_events`, `assistance_messages`
- `assistance_reminders`, `cash_autoscan_activation_codes`, `cash_autoscan_devices`, `cash_autoscan_inbox`, `cash_banks`, `cash_deposit_swap_sessions`
- `cash_deposit_swaps`, `cash_duplicate_overrides`, `cash_erp_payment_map`, `cash_erp_reconciliations`, `cash_expense_claim_duplicates`, `cash_expense_claim_lines`
- `cash_expense_claims`, `cash_expense_concepts`, `cash_expense_rules`, `cash_expense_targets`, `cash_float_topups`, `cash_invoice_scans`
- `cash_payment_rules`, `cash_section_rules`, `cash_sections`, `cash_settings`, `centros`, `checklist_plantillas`
- `companies`, `connect_alerts`, `connect_assignments`, `connect_assistance_backoffice`, `connect_assistance_files`, `connect_assistance_signatures`
- `connect_assistance_tracks`, `connect_assistances`, `connect_branches`, `connect_calendar_days`, `connect_clients`, `connect_communications`
- `connect_control_centers`, `connect_counters`, `connect_incident_events`, `connect_incidents`, `connect_kpi_definitions`, `connect_kpi_values`
- `connect_lite_actions`, `connect_manufacturer_tire_prices`, `connect_mobile_unit_events`, `connect_mobile_unit_photos`, `connect_mobile_units`, `connect_partners`
- `connect_predictions`, `connect_provider_authorizations`, `connect_provider_companies`, `connect_recommendations`, `connect_rejection_reasons`, `connect_rejections`
- `connect_routing_decisions`, `connect_routing_rules`, `connect_service_types`, `connect_status_history`, `connect_tariff_zone_members`, `connect_tenant_companies`
- `connect_tire_brand_group_members`, `connect_vehicle_types`, `connect_webhook_deliveries`, `connect_workshop_contacts`, `connect_workshop_photos`, `connect_workshop_scores`
- `connect_workshops`, `external_destination_checks`, `external_destinations`, `external_dispatch_events`, `external_dispatches`, `external_product_references`
- `integration_checklist_runs`, `integration_connector_configs`, `integration_connectors`, `integration_correlation_counters`, `integration_document_counters`, `integration_document_links`
- `integration_ignored_externals`, `integration_mappings`, `integration_operation_logs`, `integration_operations`, `integration_sync_state`, `integration_vehicle_monthly_mileage`
- `job_checklists`, `job_files`, `license_history`, `license_notifications`, `license_renewals`, `maintenance_tasks`
- `otf`, `otf_plantillas`, `otf_trabajo_files`, `otf_trabajos`, `payment_counters`, `processed_actions`
- `quality_case_events`, `roadside_assistance_events`, `roadside_assistances`, `roadside_backoffice`, `roadside_known_places`, `roadside_operator_track`
- `roadside_vehicles`, `satisfaction_client_config`, `supplier_offers`, `survey_answers`, `survey_deliveries`, `survey_instances`
- `survey_templates`, `taller_idempotencia`, `thf_actuaciones`, `thf_config`, `thf_contadores`, `thf_eventos`
- `thf_expedientes`, `traspaso_lineas`, `whatsapp_capture_messages`, `whatsapp_capture_sessions`, `workshop_config`, `wp_catalog`
- `wp_order_lines`, `wp_orders`

`connect_api_keys` es material de credencial: legible **y escribible** con la
clave publicable que va embebida en las APKs.

---

## 3. RLS y permisos son dos controles, y aquí solo hay uno en pie

Resultado tajante: **las 437 tablas de `public`, sin una sola excepción,
conceden `select, insert, update, delete` a `anon` y a `authenticated`.** Es el
defecto de Supabase, que nunca se ha corregido en este proyecto.

O sea: **la RLS es el único control que separa la clave pública de los datos.**
No hay segunda cerradura en ninguna parte. Donde la RLS falta (188 tablas) o
tiene una política permisiva, no hay nada más detrás.

Esto confirma que el `revoke` de la migración no es redundante con la RLS, que
es exactamente lo que decía su comentario.

### 3.1 La herencia de `PUBLIC`: en tablas no se materializa; en funciones, sí

| Superficie | Concedido a `PUBLIC` |
|---|---|
| Tablas | **0** |
| Funciones | **180 de 187** |

El defecto que corregí (`revoke ... from anon` no basta si hay un grant a
`PUBLIC`) **es inocuo para las tablas de este proyecto**: no hay ningún grant a
`PUBLIC` sobre tablas. La corrección se queda porque no cuesta nada y protege
de que aparezca uno.

Donde sí se materializa es en las **funciones**: 180 son ejecutables por
`PUBLIC`, y por eso `anon` puede ejecutar esas mismas 180. El `revoke ... from
public` sobre `app_login_email` era imprescindible, no una precaución.

---

## 4. Tres supuestos de la migración que el estado real contradice

Ninguno se ha corregido automáticamente, según lo acordado.

### 4.1 `perfiles_usuario`: la migración la dejaría **peor** que hoy

La migración supone una única política `almacen_solo_autenticados` con
`using (true)`, y la sustituye por tres.

El estado real es otro: **esa política ya no existe.** SEC-003 ya está
corregido en producción, y mejor de lo que la migración propone:

| Política real | Cmd | Rol | Predicado |
|---|---|---|---|
| `perfiles_usuario_select_propio_o_admin` | SELECT | authenticated | `usuario_actual_es_admin() OR user_id = ...` |
| `perfiles_usuario_insert_admin` | INSERT | authenticated | `usuario_actual_es_admin()` |
| `perfiles_usuario_update_admin` | UPDATE | authenticated | `usuario_actual_es_admin()` |
| `perfiles_usuario_delete_admin` | DELETE | authenticated | `usuario_actual_es_admin()` |
| `anon_read_activos` | SELECT | **anon** | `activo = true` |

La migración crearía `perfiles_lectura` como
`for select to authenticated using (true)`. **Las políticas se combinan con OR**,
así que esa política nueva anularía la restricción de
`perfiles_usuario_select_propio_o_admin` y devolvería la lectura de todos los
perfiles a cualquier autenticado. Es una regresión introducida por el arreglo.

Además, `anon_read_activos` deja a `anon` leer los perfiles activos, y la
migración no la toca.

**Propuesta (no aplicada):** quitar entera la sección 3 de la migración, porque
su objetivo ya está cumplido, y tratar `anon_read_activos` como hallazgo aparte.

### 4.2 `sm_document_acknowledgements`: los `drop policy` no aciertan el nombre

| La migración borra | Nombre real |
|---|---|
| `sm_ack_anon_select` | `portal_anon_acks_select` |
| `sm_ack_anon_insert` | `portal_anon_acks_insert` |
| `sm_ack_anon_update` | `portal_anon_acks_update` |

Los tres `drop policy if exists` no encuentran nada y no fallan: se quedan en
nada, en silencio. El `revoke all ... from anon` de la línea siguiente sí cierra
el acceso, así que el efecto práctico se consigue; pero quedan tres políticas
permisivas vivas que reabrirían el agujero en cuanto alguien devolviera un
grant.

**Propuesta (no aplicada):** usar los nombres reales.

Los de `pres_records` sí son correctos (`pres_anon_select/insert/update`).

### 4.3 SEC-010 se cierra solo a medias

Las dos tablas tienen, además de las políticas de `anon`, una política para
**cualquier autenticado**:

| Tabla | Política | Cmd | Predicado |
|---|---|---|---|
| `pres_records` | `pres_auth_all` | ALL | `using (true)` / `with check (true)` |
| `sm_document_acknowledgements` | `sm_auth_all` | ALL | `using (true)` / `with check (true)` |

La migración solo retira el lado de `anon`. Cualquier usuario autenticado del
proyecto —un operario de cualquier app, porque el proyecto de Supabase es uno—
sigue pudiendo leer todos los fichajes, cambiar una hora de entrada y marcar
documentos como firmados por otro.

**Propuesta (no aplicada):** SEC-010 no puede darse por cerrado retirando solo
`anon`. Decidir si entra en Fase 0 o pasa a la Fase 3.

---

## 5. Lo que el estado real confirma

| Supuesto | Estado real | |
|---|---|---|
| Ningún cliente lee directamente las tablas sin RLS | **Confirmado.** De las 188, **cero** aparecen en el panel ni en las APKs. Los clientes leen 144 nombres, y las 137 que son tablas reales **ya tienen RLS** | ✅ |
| `app_bajas_auth` y `app_auth_intentos` no existen | Confirmado: las crea la migración sin pisar nada | ✅ |
| Sin choque de nombres de disparador | Confirmado. `app_usuarios` tiene `trg_app_touch_usuario` (BEFORE UPDATE) y `trg_app_sync_usuario` (AFTER INSERT/UPDATE) | ✅ |
| El guardia actúa antes de los efectos | **Confirmado por el orden de disparo.** Los BEFORE van antes que los AFTER, así que el guardia lanza la excepción antes de que `trg_app_sync_usuario` propague nada a `adm_usuarios`, `tc_usuarios` y `perfiles_usuario`. Y `trg_app_touch_usuario` va antes alfabéticamente, pero solo escribe `updated_at` | ✅ |
| Las cinco funciones clave son `security definer` con `search_path = public` | Confirmado en las cinco, sin `pg_temp` en ninguna | ✅ |
| `app_login_email` es ejecutable por la clave pública | Confirmado: `anon`, `authenticated` y `PUBLIC` | ✅ |
| Se puede crear tabla temporal | Confirmado: `anon` y `authenticated`, los dos | ✅ |

### 5.1 Dos supuestos de fases posteriores que quedan resueltos

- **Superadministradores: 2**, y **los dos con email de recuperación**. La
  recuperación con doble aprobación de la Fase 1C **es viable**; no hace falta
  el procedimiento de rotura de cristal que se había previsto por si solo había
  uno.
- **Colisiones de nombre de usuario con la normalización fuerte: 0.** La
  normalización de la Fase 1A (plegado de acentos y ñ) **no rompe ninguna
  cuenta**. Se puede aplicar sin renombrados.

### 5.2 Una cifra de la auditoría que hay que corregir a la baja

| | Auditoría | Real |
|---|---|---|
| Funciones `SECURITY DEFINER` | ~170 | **132** |
| De ellas, sin `pg_temp` | — | **132, todas** |

El inventario de SEC-067 son 132 firmas, no 170. Se corrige a la baja: no se
infla, tampoco se desinfla.

---

## 6. Lo que sigue sin verificarse

| # | Qué | Por qué importa |
|---|---|---|
| 1 | **Vistas.** La consulta solo miró tablas (`relkind = 'r'`) | Los clientes leen 7 nombres que no son tablas; al menos 4 son vistas (`adm_ot_estado`, `tc_clientes_almacen`, `tc_marcas_contadores`, `tc_productos_almacen`). Una vista sin `security_invoker` se ejecuta con los privilegios de su dueño y **se salta la RLS de las tablas que lee**. Es una vía de escape que la migración no contempla |
| 2 | `backups_sistema`, `tc_webfleet_config`, `traspasos_auditoria_detalle` | Los lee el panel y no son tablas de `public`. Hay que saber qué son |
| 3 | Configuración de Twilio | Bloqueante de SEC-007, sin cambios |
| 4 | Auth: TTL, JWKS, MFA, signup, contraseñas, buckets | Fase 1A/1C, no bloquea la Fase 0 |

---

## 7. GO/NO-GO actualizado

| Fase | Bloqueante | Antes | Ahora |
|---|---|---|---|
| **B · Despliegue del código** | Twilio (A.1) | NO-GO | **NO-GO**, sin cambio. Nada de lo aparecido aquí afecta al código de Fase 0 |
| **D · Migración SQL** | Fotografía de Supabase | NO-GO por falta de evidencia | **NO-GO por contenido.** La evidencia ya está; lo que bloquea ahora son los tres puntos del apartado 4, y en particular que la sección 3 introduce una regresión |
| **1A / 1C** | Configuración de Auth | No aplica a Fase 0 | No aplica. Dos supuestos resueltos a favor (§5.1) |

El motivo del NO-GO de la migración **ha cambiado de naturaleza**: ya no es
falta de datos, es que los datos han destapado defectos. Eso es exactamente
para lo que servía el precheck.

Ninguna de las correcciones propuestas en el apartado 4 se ha aplicado.
