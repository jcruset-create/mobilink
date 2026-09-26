# Resultado del PRECHECK de la Fase 0

Ejecutado el 26-09-2026 desde la sesión de trabajo, en modo solo lectura.

**Resultado: NO-GO.** No por un defecto encontrado, sino porque **ninguna de las
comprobaciones que condicionan el GO se ha podido ejecutar**: este entorno no
tiene acceso a Supabase ni a Twilio. Lo que falta es acceso de verificación, no
código.

---

## 1. Por qué no se han podido ejecutar

Tres comprobaciones independientes, todas hechas antes de concluir:

| Qué se comprobó | Resultado |
|---|---|
| Variables de entorno del contenedor (`SUPABASE*`, `DATABASE_URL`, `TWILIO*`, `PG*`) | ninguna definida |
| Ficheros de credenciales (`.env`, `~/.pgpass`, `~/.config/supabase`), CLI de Supabase | no existen |
| Conectores MCP instalados en la organización | ninguno |
| Alcance de red | el proxy del entorno **deniega la conexión** a `qhbtpebfkckzmtdcutvv.supabase.co:443`, `api.supabase.com:443`, `api.twilio.com:443` y `app.mobilink.es:443`, con 403 de política. Solo `sea-tarragona.onrender.com:443` está permitido |

No se ha intentado sortear ninguna de las tres cosas.

### Qué haría falta

Para las comprobaciones de base de datos, **una de estas dos**:

- ejecutar `supabase/migraciones-preparadas/verificacion-previa.sql` desde un
  entorno que ya tenga acceso —el editor SQL del dashboard de Supabase sirve— y
  traer la salida; o
- añadir a este entorno una cadena de conexión **de solo lectura**
  (`DATABASE_URL_RO` con un rol sin permisos de escritura) y permitir el host de
  Supabase en la política de red del entorno.

Para Twilio: leer la configuración del webhook en la consola, o una credencial de
solo lectura de la API más el host `api.twilio.com` permitido.

La política de red se cambia en los ajustes del entorno, desde el menú del
entorno en la barra de título de la sesión. Los niveles de acceso están
documentados en https://code.claude.com/docs/en/claude-code-on-the-web. Las
credenciales se añaden en los mismos ajustes, como variable de entorno; no hay que
pegarlas en la conversación.

---

## 2. Tabla de comprobaciones

| # | Comprobación | Esperado | Real | GO/NO-GO | Acción necesaria |
|---|---|---|---|---|---|
| 1 | Estado real de RLS por tabla | La lista real de `public` sin RLS, para compararla con las 88 del repositorio | **NO VERIFICADO** | **NO-GO de la migración SQL** | Ejecutar la consulta 1 y 8 de `verificacion-previa.sql` |
| 2 | Grants efectivos de `anon`, `authenticated` y `PUBLIC` | Saber qué puede hacer hoy la clave pública, incluido lo heredado de `PUBLIC` | **NO VERIFICADO** | **NO-GO de la migración SQL** | Consultas 2 y 9 |
| 3 | Funciones ejecutables por esos roles | Recuento antes, para comparar después | **NO VERIFICADO** | **NO-GO de la migración SQL** | Consulta 10 |
| 4 | Inventario de `SECURITY DEFINER` | Cuántas hay y cuántas sin `pg_temp` | **NO VERIFICADO** | **NO-GO de la migración SQL** | Consultas 10 y 11 |
| 5 | `search_path` de las funciones sensibles | `app_es_admin`, `app_empresa_actual`, `app_login_email` con su configuración actual | **NO VERIFICADO** | **NO-GO de la migración SQL** | Consulta 11 |
| 6 | Políticas permisivas (`USING (true)`) | El tamaño real del trabajo de la Fase 3 | **NO VERIFICADO** | **NO-GO de la migración SQL** | Consultas 3 y 4 |
| 7 | Diferencias esquema real ↔ migraciones | Qué tablas existen en producción y no en el repositorio | **PARCIAL**: el lado del repositorio sí está medido (ver §3) | **NO-GO de la migración SQL** | Comando de comparación de `COMPROBACIONES-ENTORNO.md` §1 |
| 8 | Configuración de Supabase Auth | TTL, firma, JWKS, MFA | **NO VERIFICADO** | **NO-GO de Fase 1A/1C** (no bloquea la Fase 0) | Dashboard → Authentication |
| 9 | Signup público | Saber si está activo: cambia la prioridad de SEC-008 | **NO VERIFICADO** | **NO-GO de Fase 1A/1C** (no bloquea la Fase 0) | Dashboard → Authentication → Providers |
| 10 | Política de contraseñas y rate limits | Mínimo actual y límites de Auth | **NO VERIFICADO** | **NO-GO de Fase 1A/1C** (no bloquea la Fase 0) | Dashboard → Authentication → Policies / Rate limits |
| 11 | TTL y configuración JWT/JWKS | Decide el diseño de la Fase 1A | **NO VERIFICADO** | **NO-GO de Fase 1A/1C** (no bloquea la Fase 0) | Dashboard, y decodificar un token propio |
| 12 | Visibilidad de buckets | Qué buckets son públicos | **NO VERIFICADO** | **NO-GO de Fase 1A/1C** (no bloquea la Fase 0) | Consulta 12, o el panel de Storage |
| 13 | Configuración del webhook de Twilio | URL exacta configurada | **NO VERIFICADO** | **NO-GO, bloqueante de SEC-007** | Consola de Twilio → Messaging → Senders |
| 14 | Comparación literal de la URL de Twilio | Los seis campos, uno a uno | **PARCIAL**: el lado del servidor está determinado exactamente (ver §4); el de Twilio, no | **NO-GO, bloqueante de SEC-007** | Rellenar la columna «configurado» de §4 |

Ninguna comprobación se ha intentado por vías no autorizadas. No se ha hecho
ninguna petición artificial al webhook de producción.

### 2.1 Las tres categorías de bloqueante, separadas

El NO-GO global lo es **por falta de evidencia del entorno, no por un fallo del
código de Fase 0**. Los bloqueantes no son intercambiables y no se mezclan:

| Categoría | Filas | Qué bloquea exactamente | Qué lo desbloquea |
|---|---|---|---|
| **Bloqueante de SEC-007** | 13, 14 | El despliegue de los commits `a8a9a03` y `f823973` (firma del webhook de WhatsApp). No bloquea el resto del código de Fase 0 por sí mismo, pero no se cherry-pickea un subconjunto: sin este dato no se despliega Fase 0. | URL y método configurados hoy en la consola de Twilio, comparados campo a campo en §4 con resultado COMPATIBLE. |
| **Bloqueante de la migración SQL** | 1 a 7 | Únicamente la aplicación de `001_seguridad_fase0.sql` (Fase D del runbook). No bloquea el despliegue del código. | La fotografía real de Supabase: salida de `verificacion-previa.sql` (tablas, RLS, grants efectivos incluido `PUBLIC`, funciones, `SECURITY DEFINER`, `search_path`, políticas y objetos fuera de las migraciones). |
| **No bloqueante de Fase 0** | 8 a 12 | La autorización de la **Fase 1A/1C** (TTL de JWT, JWKS, claims de MFA, política de contraseñas, signup, buckets). Estos datos **no entran en el GO/NO-GO de los cambios de código de Fase 0**. | Datos del dashboard, cuando se aborde la Fase 1A. |

Consecuencia práctica: el GO/NO-GO del código de Fase 0 depende solo de la
primera categoría; el de la migración, solo de la segunda; la tercera no
participa en ninguno de los dos.

---

## 3. Diferencias producción ↔ repositorio: el lado que sí se puede medir

Medido sobre el repositorio, en el commit de la rama:

| Dato | Valor |
|---|---|
| Tablas creadas en migraciones | 242 |
| Con `enable row level security` explícito | 154 |
| **Sin RLS según el repositorio** | **88** |
| Tablas que algún cliente lee y que **no existen en ninguna migración** | **22** |
| Tablas sin RLS que además lea algún cliente | **ninguna** |

Las 22 sin migración: `adm_ot_estado`, `auditoria_acciones`, `backups_sistema`,
`cliente_contactos`, `clientes`, `empresas`, `incidencias`, `inventario_lineas`,
`inventarios`, `movimientos_stock`, `perfiles_usuario`, `productos_neumaticos`,
`solicitudes_reposicion`, `stock_minimos`, `tc_clientes_almacen`,
`tc_marcas_contadores`, `tc_productos_almacen`, `traspasos`,
`traspasos_auditoria`, `traspasos_auditoria_detalle`, `usuario_clientes`,
`vehiculos`.

Son tablas creadas a mano en el dashboard. **Su estado de RLS no se puede saber
leyendo el repositorio**, y la migración no las menciona. Esto ya estaba dicho
como advertencia; ahora está cuantificado: 22 tablas, de las cuales al menos
`perfiles_usuario`, `movimientos_stock`, `traspasos*` y `solicitudes_reposicion`
sí pasaron por `saas_fase1c_almacen_cerrar_anon.sql`, que les activó RLS
dinámicamente. De las otras 17 no hay constancia de nada.

**Consecuencia para el GO:** el número real de tablas sin RLS puede ser mayor que
88. La cifra 88 es un suelo, no el dato.

---

## 4. Twilio: el lado del servidor, exacto

Esto sí está determinado, leyendo el código que se desplegaría. El servidor
construye las URLs candidatas así, y valida la firma contra todas ellas:

| Campo | Lo que usará el servidor | Configurado en Twilio |
|---|---|---|
| Protocolo | **`https`** siempre. Se construye con el literal `https://`, nunca a partir del esquema de la petición | (pendiente) |
| Host | el de `x-forwarded-host`, o si no el de `host`; más `PUBLIC_APP_URL`, `app.mobilink.es` y `sea-tarragona.onrender.com` como candidatos | (pendiente) |
| Puerto | ninguno. No se añade puerto a ninguna candidata | (pendiente) |
| Path | **`/api/whatsapp/inbound`**, con las barras finales del host recortadas (`replace(/\/+$/, "")`) | (pendiente) |
| Query string | **ninguna**. La cadena firmada nunca lleva `?…` | (pendiente) |
| Método | **POST**, con cuerpo `application/x-www-form-urlencoded` | (pendiente) |

Que una candidata se derive del host de la petición quita casi todo el riesgo de
que falle por el nombre. **El riesgo que queda es la cadena de consulta**: Twilio
firma la URL completa incluyendo el `?…`, y aquí no se incluye. Si la URL
configurada lleva cualquier parámetro, la firma no cuadrará y el webhook
responderá 403 a Twilio.

Dato accesorio, y **no concluyente**: `app.mobilink.es` resuelve a una IP distinta
de la de Render y no respondió al health check desde aquí, pero desde aquí también
está denegado por política, así que eso no dice nada de si Twilio llega a ese
nombre. La configuración se lee en Twilio.

---

## 5. SEC-064: lo determinable sin el dashboard

| Hecho | Estado | Fuente |
|---|---|---|
| A toda contraseña del hub se le añade el sufijo fijo `#SEA` antes de enviarla a Auth | **Confirmado** | `src/modules/administracion/services/authClave.ts:9` |
| El email de Auth es sintético y derivable del nombre de usuario (`<usuario>@usuarios.sea`) | **Confirmado** | mismo fichero y `server/index.ts` |
| El servidor exige 6 caracteres al crear o restablecer la contraseña interna | **Confirmado**: y con el sufijo, un PIN de 2 caracteres ya los cumple | `server/index.ts` |
| El código de operario de TyreControl admite 4 caracteres | **Confirmado** | `server/index.ts` |
| ¿Hay algún superadministrador con clave corta heredada? | **NO VERIFICADO** | Necesita la consulta 6 más saber quién ha cambiado la contraseña |
| Signup público activo | **NO VERIFICADO** | Dashboard |
| Política mínima de contraseña de Auth | **NO VERIFICADO** | Dashboard |
| Protección contra contraseñas filtradas | **NO VERIFICADO** | Dashboard |
| Rate limits de Auth | **NO VERIFICADO** | Dashboard |

Lo confirmado basta para sostener el hallazgo: la entropía efectiva de una
contraseña del hub es la de lo que el usuario teclea, y el login va directo a
GoTrue, así que el freno del servidor no lo ve. Lo que falta es saber **cuánto**
margen queda antes de la Fase 1A.

---

## 6. ¿Sigue siendo válida la migración preparada?

**Sí, sin modificaciones**, con una condición: su lista de 88 tablas es un suelo.
El bucle salta con un aviso las tablas que no existan, y no toca las que no estén
en la lista. Así que aplicarla tal cual **no rompe nada**, pero **tampoco cierra**
las 22 tablas que no están en migraciones si alguna de ellas está sin RLS.

No he adaptado ni ejecutado nada. Lo que propondría, cuando haya salida de la
consulta 1:

- si aparecen tablas sin RLS fuera de la lista, **añadirlas a la lista** de la
  sección 1 de la migración —no cambiar la lógica, solo la lista—, y volver a
  ejecutar la prueba de integración;
- si alguna de esas tablas la lee un cliente con la clave pública, entonces no
  vale activar RLS sin política: hay que decidir la política antes, y eso ya no es
  Fase 0.

---

## 7. Supuestos del plan que han resultado falsos

Ninguno nuevo en este precheck. El único supuesto que se ha podido poner a prueba
es «las 88 tablas son la lista completa», y ya estaba marcado como suelo: ahora
está cuantificado el hueco (22 tablas).

## 8. Hallazgos de seguridad nuevos en este precheck

Ninguno. Las comprobaciones que podrían haber revelado alguno son precisamente
las que no se han podido ejecutar.

## 9. Acciones externas necesarias después del despliegue

Sin cambios respecto al runbook: aplicar la migración tras la ventana de
observación, desplegar las tres Edge Functions con `ALERTAS_CRON_SECRET`, y —ya
fuera de la Fase 0— la rotación de secretos, que va después de la Fase 1A.

## 10. Veredicto

**NO-GO para el despliegue de código.**

Bloqueantes, en orden:

1. **Twilio sin verificar** (comprobaciones 13 y 14). Es el bloqueante del
   criterio A.1 del runbook y afecta a dos commits: `a8a9a03` (firma obligatoria)
   y `f823973` (su prueba). El resto de los 26 commits no depende de Twilio.
2. **Estado real de la base sin verificar** (1 a 6). No bloquea técnicamente el
   despliegue del código —ningún commit de código depende de la base—, pero sí
   bloquea la Fase D, y el runbook exige guardar la foto del «antes» antes de
   empezar.

Los dos se resuelven con acceso de lectura, no con cambios de código.
