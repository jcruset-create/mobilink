# Centro de Inteligencia Operacional

Módulo de Mobilink Connect Pro que supervisa, analiza y optimiza la actividad de
asistencia en carretera combinando Business Intelligence (KPIs, tendencias,
comparativas) e Inteligencia Artificial (predicción, detección de riesgo,
optimización de recursos y recomendaciones explicables).

Ruta en la aplicación: **Connect Pro → Centro de Inteligencia** (`/connect/inteligencia`).
API: **`/api/operational-intelligence`**.

---

## 1. Análisis previo: qué se reutiliza y qué falta

El módulo **no duplica** entidades ni procesos. Todo el dato operacional sigue
viviendo en las tablas de Connect Pro:

| Necesidad del diseño | Fuente existente reutilizada |
|---|---|
| Asistencias, estados y tiempos | `connect_assistances`, `connect_status_history` |
| Ofertas, aceptación y rechazos | `connect_assignments`, `connect_rejections` |
| Proveedores, talleres y score | `connect_provider_companies`, `connect_workshops`, `connect_workshop_scores` |
| Unidades móviles y GPS | `connect_mobile_units` (deriva de `roadside_vehicles` + Webfleet) |
| Calidad e incidencias | `connect_incidents` |
| Economía y tarifas | `connect_assistances.estimatedCost/finalCost`, `connect_tariff_lines` |
| Clientes, SLA y prioridades | `connect_clients`, `connect_provider_authorizations` |
| Usuarios, roles y auditoría | `connect_users`, `rbac.ts`, `connect_audit_logs` |

### Datos que hoy NO existen

Estos KPIs del diseño funcional se publican en el catálogo, pero con semáforo
gris y el motivo explícito, en lugar de calcularse con datos inventados
(`GET /data-inventory` y pantalla de Configuración los listan):

- **Satisfacción del cliente y NPS** — no hay encuesta post-servicio. Es el
  primer dato a capturar para cerrar el bloque de calidad.
- **Kilómetros con y sin carga, coste por km, consumo** — solo se guarda la
  última posición de la unidad, no la traza del recorrido.
- **KPIs de conductor** (servicios, puntualidad, horas activas) — Connect
  guarda el nombre del técnico, no una entidad conductor con turnos.
- **Margen bruto** — se registra un único importe por asistencia; falta separar
  precio de venta al cliente y coste del proveedor.

---

## 2. Arquitectura

```
server/connect/oi/
  schema.ts        Tablas analíticas (migraciones idempotentes)
  catalog.ts       Catálogo de KPIs: definición, objetivo, umbrales, disponibilidad
  kpi.ts           Motor de cálculo, semáforo, fotos periódicas y tendencias
  predictions.ts   Demanda, ETA, riesgo de retraso, zonas y precisión de modelos
  recommendations.ts  Motor de reglas → recomendaciones explicadas
  alerts.ts        Alertas inteligentes con escalado y ciclo de vida
  assistant.ts     Asistente conversacional (intenciones cerradas y seguras)
  reports.ts       Informes, CSV y envíos programados
  scope.ts         Ámbito de datos por rol/empresa
  router.ts        API REST
  worker.ts        Procesamiento programado

src/modules/connectpro/pages/inteligencia/   11 subsecciones + layout
src/modules/connectpro/components/oi/        Tarjetas de KPI, gráficas, asistente
```

Se integra en el monolito con tres puntos de enganche en `server/connect/`:
`initOperationalIntelligence()` en el arranque, el router montado en
`mountConnect()` y `runIntelligenceCycle()` dentro del worker existente.

### Tablas nuevas

`operational_kpi_definition`, `operational_kpi_value`, `ai_prediction`,
`ai_recommendation`, `operational_alert`, `ai_model_registry`, `ai_feedback`,
`ai_assistant_query`, `operational_report_schedule`.

Todas son analíticas. `tenant` del diseño se materializa como
`controlCenterId` (`connect_control_centers`), coherente con el resto de Connect.

---

## 3. Motor de KPIs

- 50 KPIs en 6 categorías (operacionales, proveedores, flota, conductores,
  económicos y calidad).
- Cada indicador expone: valor, objetivo, variación diaria y semanal, tendencia,
  semáforo y tamaño de muestra.
- **Semáforo**: verde dentro del objetivo, ámbar en riesgo, rojo incumplimiento
  y **gris con datos insuficientes** — nunca un verde por falta de muestra.
- Umbrales configurables por centro de control (`POST /kpis/configuration`).
- KPIs "en vivo" (pendientes, en desplazamiento, disponibilidad de flota…)
  retratan el estado actual; su comparativa sale de las fotos que guarda el
  worker en `operational_kpi_value`, no de un recálculo a pasado imposible.

## 4. Modelos de IA (v1, explicables)

| Modelo | Método | Salida |
|---|---|---|
| `demand-seasonal-naive` | Media estacional por zona, día de la semana y franja sobre 90 días | Demanda prevista, IC 80 %, variación vs media, unidades recomendadas |
| `eta-historical-blend` | Distancia por carretera + tráfico horario + tipo de vía + histórico real del taller | ETA con intervalo, factores y explicación |
| `delay-risk-rules` | 7 factores ponderados (margen de SLA, tiempo sin asignar, sin salida, GPS, proveedor, saturación, prioridad) | Riesgo 0..1 → bajo/medio/alto/crítico + motivos |
| `anomaly-zscore` | Reglas estadísticas sobre la media móvil | Degradación de proveedor, desviaciones de coste |
| `assistant-intent` | Clasificación sobre intenciones cerradas | Respuesta con datos del ámbito del usuario |

Las zonas se derivan del taller más cercano: no hay que mantener un catálogo
geográfico nuevo y las recomendaciones hablan en términos que el operador ya usa.

### Aprendizaje continuo

Cada predicción guarda las variables usadas y, cuando se conoce el desenlace, su
valor real y su error (`actualValue`, `errorValue`). De ahí salen MAE, MAPE y
sesgo por modelo, visibles en Configuración y consumidos por
`refreshModelAccuracy()` para el registro de modelos.

## 5. Recomendaciones

Ocho reglas activas: pico de demanda, déficit de cobertura, concentración de
riesgo de SLA, reasignación con mejor ETA, degradación de proveedor, tendencia
por tipo de servicio, cola de pendientes y servicios sin facturar.

Cada recomendación incluye descripción, prioridad, motivo, **datos utilizados**,
factores, confianza, alternativas, acción propuesta con enlace e impacto
estimado. Aceptar o rechazar queda registrado en `ai_feedback`, y la tasa de
aceptación e impacto acumulado por tipo son los indicadores que deben gobernar
cuándo automatizar (fase 6).

> **La IA recomienda, la persona decide.** Ninguna regla ejecuta cambios
> operativos por su cuenta: aceptar registra la decisión y abre la pantalla
> donde confirmarla.

## 6. Alertas inteligentes

Operacionales (sin asignar, proveedor sin respuesta, GPS perdido, riesgo y
superación de SLA, ETA excedido, zona saturada), de calidad (aumento de
reclamaciones, documentación incompleta, incidencia crítica sin responsable) y
económicas (sobrecoste, tarifa no configurada).

Ciclo completo: abierta → reconocida → resuelta, con responsable, fecha límite,
comentarios, **escalado automático** al vencer el plazo y cierre automático
cuando la causa desaparece. Las críticas se replican en la campana del
backoffice para no partir la atención del operador.

## 7. Asistente operacional

Traduce lenguaje natural a un conjunto **cerrado** de consultas seguras: nunca
genera SQL. La clasificación es determinista por patrones y, si hay
`OPENAI_API_KEY`, un modelo puede elegir entre las mismas intenciones (solo
recibe la pregunta, nunca datos operativos). Toda consulta se registra en
`ai_assistant_query` con el ámbito aplicado.

## 8. Seguridad y ámbito

- Autenticación y roles de Connect Pro (sesión unificada + `connect_users`).
- El ámbito **no viaja en la petición**: se deriva del usuario, así que un
  parámetro manipulado no puede ampliarlo. `provider_user` solo ve la actividad
  de su empresa.
- Acciones auditadas en `connect_audit_logs` (`oi.*`), decisiones sobre
  recomendaciones en `ai_feedback` y consultas del asistente en su propia tabla.
- Las decisiones automáticas son explicables y trazables por diseño.

## 9. Frecuencias del worker

| Proceso | Frecuencia |
|---|---|
| Riesgo de retraso y alertas | 1 min |
| Foto de KPIs en vivo | 5 min |
| Recomendaciones | 10 min |
| Evaluación de predicciones | 15 min |
| Cierre diario de KPIs, previsión de demanda, precisión e informes programados | 1 h |

## 10. API

```
GET  /dashboard                         Panel principal (KPIs, tendencia, cobertura, riesgo)
GET  /kpis            /kpis/catalog     /kpis/:code
POST /kpis/configuration                Objetivos y umbrales por centro
GET  /trend

GET  /live-operation  /critical-services  /resource-availability

GET  /predictions/demand
GET  /predictions/eta/:serviceId
GET  /predictions/delay-risk/:serviceId
GET  /predictions/accuracy

GET  /recommendations                   /recommendations/:id
POST /recommendations/:id/accept        /recommendations/:id/reject
POST /recommendations/refresh

POST /assignment/recommend              Recurso óptimo con ETA, coste y motivo
POST /resources/optimize                Propuestas de cobertura por zona

GET  /alerts
POST /alerts/:id/acknowledge  /resolve  /comment  /assign

GET  /reports
POST /reports/generate                  (format: json | csv)
POST /reports/schedule                  DELETE /reports/schedule/:id

POST /assistant/query                   GET /assistant/suggestions  /assistant/history

GET  /models          PATCH /models/:id
GET  /data-inventory
```

## 11. Verificación

```bash
DATABASE_URL=postgres://usuario@localhost:5432/mi_base npx tsx scripts/oi-smoke.ts
```

Crea el esquema, siembra actividad sintética y ejecuta los 57 controles del
módulo (KPIs, predicciones, recomendaciones, alertas, los diez informes, las
consultas propias de la API y el asistente). Debe ejecutarse **solo contra una
base de datos de pruebas**, nunca en producción.

## 12. Estado por fases del diseño

| Fase | Estado |
|---|---|
| 1. BI básico (panel, KPIs, filtros, tendencias, informes, exportación) | Completa |
| 2. Supervisión en tiempo real (mapa, críticos, recursos, alertas, SLA, ETA) | Completa |
| 3. Inteligencia predictiva (demanda, ETA, riesgo, anomalías) | Completa (modelos v1 estadísticos) |
| 4. Optimización (recomendación de recursos, reasignación, cobertura) | Completa como propuesta |
| 5. Asistente operacional | Completa sobre intenciones cerradas |
| 6. Automatización controlada | **No habilitada** por diseño: requiere precisión demostrada, y ese histórico se está acumulando ya en `ai_feedback` y `ai_prediction` |
