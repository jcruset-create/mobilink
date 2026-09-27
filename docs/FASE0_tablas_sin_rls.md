# Las 146 tablas sin RLS que la Fase 0 no cubre

Clasificación pedida antes de decidir nada. **No se ha modificado ninguna
migración para incluirlas**, ni se propone aplicar nada todavía.

Origen de los datos: fotografía de producción del **2026-09-26**, cruzada con
el código del repositorio en la rama de seguridad.

---

## 0. Lo que es igual en las 146

Tres columnas de la tabla que siguen son idénticas en las 146 filas, así que
conviene decirlo una vez en lugar de repetirlo 146 veces:

| Dato | Valor en las 146 | Cómo se ha comprobado |
|---|---|---|
| `anon` | **CRUD completo** (select, insert, update, delete) | `has_table_privilege`, que resuelve la herencia |
| `authenticated` | **CRUD completo** | igual |
| Concedido vía `PUBLIC` | **Nada** | no hay ni un grant a `PUBLIC` sobre tablas |
| Lectura directa desde cliente | **Ninguna** | ninguna aparece en `src/` ni en las APKs |
| Uso desde el servidor | **145 de 146** | aparecen por nombre en `server/` o en las Edge Functions |

La única que **no** aparece usada por el servidor es **`traspaso_lineas`**. No
significa que esté muerta —puede llegarse a ella por una vista o por SQL
generado—, significa que no se ha localizado el consumidor y que hay que
confirmarlo antes de cerrarla.

Como ninguna se lee desde un cliente y el servidor entra con `service_role`
(que no pasa por RLS), **activar RLS sin políticas en estas tablas no tiene
consumidor conocido al que romper**. La reserva es la de siempre: un job o una
Edge Function que entrara con un rol distinto de `service_role`. La consulta de
`002_vistas_y_objetos.sql` lista los roles existentes precisamente para eso, y
hasta tenerla, esa condición está **NO VERIFICADA**.

---

## 1. CONTENCIÓN URGENTE

Credenciales, identidad, licencias y dinero. Son 37 tablas.

| Tabla | Tamaño | Sensible | Solo backend | Lectura cliente | `anon` CRUD | `authenticated` CRUD | Riesgo de RLS sin políticas | Fase |
|---|---|---|---|---|---|---|---|---|
| `cash_invoice_scans` | 432 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_expense_claim_lines` | 120 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_bank_accounts` | 80 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_expense_claims` | 80 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_expense_targets` | 80 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_lite_devices` | 80 kB | **Credencial** | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_users` | 80 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `licenses` | 80 kB | Licencia | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_banks` | 64 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_expense_concepts` | 64 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_payment_rules` | 64 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_clients` | 64 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_lite_users` | 64 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_partners` | 64 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `integration_connector_configs` | 64 kB | **Credencial** | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `payments` | 64 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_assistance_signatures` | 48 kB | **Credencial** | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_quotes` | 48 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_tariff_zone_members` | 48 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `license_history` | 48 kB | Licencia | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_deposit_swap_sessions` | 40 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_deposit_swaps` | 40 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_float_topups` | 40 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cobros` | 40 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_workshop_contacts` | 40 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `app_users` | 32 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `payment_counters` | 32 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `assist_panel_users` | 24 kB | Identidad | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_autoscan_activation_codes` | 24 kB | **Credencial** | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_expense_claim_duplicates` | 24 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `cash_expense_rules` | 24 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_api_keys` | 24 kB | **Credencial** | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_tariff_lines` | 24 kB | Económico | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `license_notifications` | 24 kB | Licencia | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `license_usage` | 24 kB | Licencia | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `connect_webhook_endpoints` | 16 kB | **Credencial** | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |
| `license_renewals` | 16 kB | Licencia | Sí | No | Completo | Completo | Ninguno conocido | **Contención urgente** |

### Por qué estas y en este orden

`connect_api_keys` es el caso extremo: son claves de API de clientes, y con la
clave publicable que va dentro de las APKs se pueden **leer y también
reescribir**. `connect_lite_devices` y `cash_autoscan_activation_codes` son
credenciales de dispositivo; `connect_users`, `connect_lite_users`,
`app_users` y `assist_panel_users` son cuentas.

`licenses` y su familia deciden a qué módulos tiene derecho cada empresa: quien
pueda escribirlas se concede módulos a sí mismo.

---

## 2. CONTENCIÓN · trazas y datos personales

18 tablas. No son credenciales, pero `integration_operation_logs`
(10 MB), `whatsapp_messages` (1,7 MB) y `whatsapp_capture_messages` (1,4 MB)
son contenido de conversaciones y trazas de integración, que suelen llevar
dentro identificadores, teléfonos y a veces credenciales de terceros.

| Tabla | Tamaño | Sensible | Solo backend | Lectura cliente | `anon` CRUD | `authenticated` CRUD | Riesgo de RLS sin políticas | Fase |
|---|---|---|---|---|---|---|---|---|
| `integration_operation_logs` | 10336 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `whatsapp_messages` | 1728 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `whatsapp_capture_messages` | 1384 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `assistance_events` | 544 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `connect_mobile_unit_events` | 360 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `roadside_assistance_events` | 184 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `connect_audit_logs` | 144 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `connect_assistance_tracks` | 112 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `roadside_operator_track` | 96 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `connect_status_history` | 88 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `quality_cases` | 64 kB | Datos personales | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `assistance_messages` | 56 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `satisfaction_client_config` | 32 kB | Datos personales | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `survey_answers` | 32 kB | Datos personales | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `external_dispatch_events` | 24 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `quality_case_events` | 24 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `survey_responses` | 24 kB | Datos personales | Sí | No | Completo | Completo | Ninguno conocido | Contención |
| `connect_incident_events` | 16 kB | Traza/log | Sí | No | Completo | Completo | Ninguno conocido | Contención |

---

## 3. RESTO

91 tablas de negocio y catálogos. Mismo perfil de permisos, menor
impacto directo. Van a la Fase 3 con el resto del barrido.

| Tabla | Tamaño | Sensible | Solo backend | Lectura cliente | `anon` CRUD | `authenticated` CRUD | Riesgo de RLS sin políticas | Fase |
|---|---|---|---|---|---|---|---|---|
| `connect_workshop_scores` | 108928 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_operations` | 10448 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_vehicle_monthly_mileage` | 3952 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_mappings` | 3088 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `assistance_documents` | 480 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_predictions` | 408 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `roadside_assistances` | 408 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_assistances` | 256 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `whatsapp_capture_sessions` | 248 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `thf_eventos` | 224 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_kpi_values` | 192 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `thf_expedientes` | 192 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_sync_state` | 176 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `assistance_drafts` | 168 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_lite_actions` | 152 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_workshops` | 144 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `processed_actions` | 144 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_tenant_companies` | 104 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `wp_catalog` | 104 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `assistance_reminders` | 96 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_assistance_files` | 96 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_mobile_units` | 88 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `survey_instances` | 88 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_sections` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_provider_authorizations` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_checklist_runs` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_document_links` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `roadside_backoffice` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `roadside_vehicles` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `thf_actuaciones` | 80 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `assigned_maintenance_tasks` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `assist_talleres` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_erp_payment_map` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_assignments` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_calendar_days` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_provider_companies` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `external_dispatches` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_correlation_counters` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_ignored_externals` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `otf` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `roadside_known_places` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `supplier_offers` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `survey_templates` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `taller_idempotencia` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `wp_order_lines` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `wp_orders` | 64 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `survey_deliveries` | 56 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_erp_reconciliations` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `centros` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_alerts` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_assistance_backoffice` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_communications` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_control_centers` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_kpi_definitions` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_rejection_reasons` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_service_types` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_vehicle_types` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `job_files` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `otf_trabajo_files` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `otf_trabajos` | 48 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_autoscan_inbox` | 40 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_routing_decisions` | 40 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_tire_brand_group_members` | 40 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `external_destinations` | 40 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_autoscan_devices` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_duplicate_overrides` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_section_rules` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `cash_settings` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `companies` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_branches` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_counters` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_routing_rules` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `external_product_references` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_document_counters` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `maintenance_tasks` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `thf_config` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `thf_contadores` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `workshop_config` | 32 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_incidents` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_manufacturer_tire_prices` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_mobile_unit_photos` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_recommendations` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_webhook_deliveries` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_workshop_photos` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `external_destination_checks` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `integration_connectors` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `otf_plantillas` | 24 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `traspaso_lineas` | 24 kB | No | **No consta** | No | Completo | Completo | Sin uso localizado: confirmar antes | Fase 3 |
| `checklist_plantillas` | 16 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `connect_rejections` | 16 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |
| `job_checklists` | 16 kB | No | Sí | No | Completo | Completo | Ninguno conocido | Fase 3 |

---

## 4. Migración de contención propuesta (NO ESCRITA)

Según lo acordado, no se escribe hasta que esta clasificación esté aprobada. La
forma que tendría:

```
para cada tabla del grupo 1 y 2:
  alter table public.<t> enable row level security;
  revoke all on public.<t> from public;      -- primero PUBLIC
  revoke all on public.<t> from anon;
  revoke all on public.<t> from authenticated;
```

Sin políticas, igual que la sección 1 de la Fase 0: a estas tablas solo llega el
servidor con `service_role`, que no pasa por RLS.

**Dos condiciones antes de escribirla:**

1. El inventario de vistas (`002_vistas_y_objetos.sql`). Una vista sin
   `security_invoker` concedida a `anon` sobre una de estas tablas se salta la
   RLS que acabamos de activar, y la contención sería aparente.
2. La lista de roles. Si algún job corre con un rol propio distinto de
   `service_role`, se queda fuera al activar RLS.

**No se propone incluirlas en la migración de Fase 0.** Van en una migración
separada, con su propio postcheck y su propia ventana, para que un fallo en la
contención no obligue a revertir también SEC-004, SEC-005 y SEC-065.
