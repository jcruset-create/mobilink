# Runbook · aplicación de las tres contenciones urgentes

**Autorizado el 2026-09-27.** Secuencial, con parada obligatoria entre cada
una. Nada de esto está aplicado en el momento de escribir este documento.

---

## 0. Quién ejecuta

**Yo no puedo.** Este contenedor no alcanza Supabase: el proxy devuelve 403 a
`*.supabase.co`, y así ha sido toda la intervención. Las tres migraciones, la
fotografía previa y los postchecks los ejecutas tú en el editor SQL, igual que
las consultas de lectura anteriores.

Lo que aporto es que cada paso sea mecánico: qué pegar, qué tiene que salir, y
cuándo parar.

---

## 1. PASO 0 · Fotografía previa, en lectura

Antes de tocar nada:

```
supabase/migraciones-preparadas/009_fotografia_previa.sql
```

Una sola sentencia. **Guarda la salida con fecha y hora**: es la fuente de
verdad de la vuelta atrás.

### Por qué no basta el rollback ya escrito

Tu punto 7 destapó un hueco real. Los rollbacks de 005, 007 y 008 devuelven
`select, insert, update, delete`. Pero las migraciones hacen `revoke all`, y
«all» incluye además **`TRUNCATE`, `REFERENCES`, `TRIGGER` y `MAINTAIN`**.

Las fotografías del 26 y del 27 solo capturaron las cuatro primeras, así que
**no se sabía** si `anon` tenía alguna de las otras. En el laboratorio, con los
privilegios por defecto de Supabase reproducidos, **sí las tiene**: una vista
creada después de `alter default privileges ... grant all` nace con las siete.

Por eso `009` no solo mide: **genera el SQL de restauración exacto**, línea a
línea, a partir de lo que hay de verdad. Esos campos son:

| Campo de la salida | Para qué |
|---|---|
| `rollback_generado_grants` | Los `grant` exactos, con todos los tipos de privilegio |
| `rollback_generado_politicas` | Las diez políticas de Safety recreadas idénticas, con su predicado |
| `rollback_generado_reloptions` | El estado de `security_invoker` de `adm_ot_estado` |

**Usa ese texto generado, no el rollback escrito en los ficheros.** El de los
ficheros queda como referencia de intención; el generado es el que no concede
ni de más ni de menos.

---

## 2. PASO 1 · Aplicar 007 · Safety

```
supabase/migraciones-preparadas/007_contencion_safety.sql
```

Cierra la capacidad anónima de **modificar y borrar** personal, formación,
certificaciones, competencias y autorizaciones para trabajos de riesgo.
Conserva las lecturas que hoy necesitan el portal y SeaHub.

### Postcheck

Bloque «POSTCHECK DE 007» de `010_postchecks.sql`. **Diez filas, las diez OK.**
Un solo FALLO y se para.

| # | Qué comprueba | Esperado |
|---|---|---|
| 1 | Policies de escritura de `anon` sobre `sea_*` | 0 |
| 2 | Policies de `anon` con `WITH CHECK` | 0 |
| 3-5 | Tablas donde `anon` puede INSERT / UPDATE / DELETE | 0, 0, 0 |
| 6-8 | Lectura conservada en `sea_employees`, `sea_companies`, `sea_work_centers` | true |
| 9 | Policies de `authenticated` intactas | 10 |
| 10 | `authenticated` conserva la escritura | 10 |

### Smoke tests · funcionales, sin DML artificial

| Pantalla | Qué mirar |
|---|---|
| `/portal` | La lista de empleados carga y el código de operario valida |
| `/portal/mi-ficha` | **La ficha carga entera**: competencias, certificaciones, autorizaciones, formación, vestuario. Y el bloque de empresa y centro de trabajo, que es el embebido de PostgREST |
| `/sea` (SeaHub) | Los tres listados cargan |
| Safety autenticada | Documentos, entregas, formación, inspecciones |
| Presencia autenticada | Fichajes y panel |
| **Escritura legítima** | Editar un empleado desde `sea-core`, y guardar |

El embebido de `/portal/mi-ficha` es el punto más delicado: las dos políticas
nuevas de `sea_companies` y `sea_work_centers` existen exactamente para eso.

### Si falla

**No ejecutes el rollback completo.** El orden es:

1. Identificar qué permiso legítimo falta: qué pantalla, qué operación, qué
   tabla. El error de PostgREST nombra la tabla.
2. Restaurar solo ese acceso mínimo. Casi siempre:
   `create policy <nombre>_lectura on <tabla> for select to anon using (<el predicado que tenía>);`
   o `grant select on public.<tabla> to anon;`
3. Anotarlo. Un permiso que hizo falta restaurar es un consumidor que el
   barrido estático no encontró, y hay que entender por qué.

El rollback completo solo si hay indisponibilidad grave sin corrección mínima
inmediata, y usando el texto generado por `009`.

### PARADA OBLIGATORIA

No se sigue a 005 sin confirmar 007.

---

## 3. PASO 2 · Aplicar 005 · las cuatro vistas demostradas

```
supabase/migraciones-preparadas/005_contencion_vistas.sql
```

### Postcheck

Bloque «POSTCHECK DE 005». **Cuatro filas, las cuatro OK.**

### Smoke tests

| Pantalla | Vista |
|---|---|
| Estado de OTs (`administracion`) | `adm_ot_estado` |
| TyreControl · clientes | `tc_clientes_almacen` |
| TyreControl · productos | `tc_productos_almacen` |
| TyreControl · marcas | `tc_marcas_contadores` |

### Atención especial a `adm_ot_estado`

Es la única de las tres migraciones que **cambia el modelo de autorización de
lectura**, no solo los permisos. Al pasar a `security_invoker`, la vista deja
de correr como `postgres` y queda sujeta a las políticas de `adm_work_orders` y
`adm_customers`, que son `to public using (adm_can_read())`.

En el laboratorio, un usuario que pasa `adm_can_read()` sigue viendo la misma
fila. **Pero `adm_can_read()` es una función real cuyo cuerpo no he leído**: si
en producción devuelve algo distinto de lo que supone el laboratorio, la
pantalla puede quedarse vacía.

Si eso ocurre: **para antes de 008** y restaura solo eso:

```sql
alter view public.adm_ot_estado reset (security_invoker);
```

Eso deshace el cambio de modelo **sin devolverle el acceso a `anon`**, que es
la mitad que sí interesa conservar. El resto de 005 se queda puesto.

### PARADA OBLIGATORIA

---

## 4. PASO 3 · Aplicar 008 · las nueve sin consumidor

```
supabase/migraciones-preparadas/008_contencion_vistas_resto.sql
```

### Postcheck

Bloque «POSTCHECK DE 008». **Cinco filas, las cinco OK**, incluida la que
confirma que `traspasos_auditoria_detalle` **no** se ha tocado.

### Observación de logs

Estas nueve no tienen consumidor localizado, y «no localizado» no es
«inexistente». Durante un rato, en los logs de PostgREST y del servidor, buscar:

```
permission denied for view kpis_traspasos
permission denied for view movimientos_stock_detalle
permission denied for view stock_actual
permission denied for view stock_actual_detalle
permission denied for view tc_modelos_aplicacion_sin_clasificar
permission denied for view tc_tipos_plano_descuadrado
permission denied for view traspasos_detalle
permission denied for view traspasos_lineas_detalle
permission denied for view traspasos_resumen_lineas
```

y cualquier 401/403 asociado a esos nombres. Si aparece alguno, la restauración
mínima es una línea: `grant select on public.<vista> to authenticated;`

---

## 5. Estado de los hallazgos al terminar

Ninguno se marca cerrado.

**SEC-008 — escritura anónima contenida; exposición de lectura todavía abierta.**

Siguen accesibles anónimamente, entre otros: DNI/NIE, número de Seguridad
Social, domicilio y `pin_hash`. La corrección siguiente reduce las columnas
accesibles y después retira el modelo de descargar la credencial al cliente.

**SEC-068 — escritura/bypass de las vistas contenidas corregido; una superficie
pendiente de decisión funcional.**

13 de 14 contenidas. `traspasos_auditoria_detalle` sigue fuera y mantiene la
exposición de `codigo_personal`, que además sale también por la política
`anon_read_auditoria` de la tabla.

---

## 6. Evidencia de la intervención · 2026-09-27

| Migración | Aplicada | Postcheck | Smoke test | Incidencias |
|---|---|---|---|---|
| `009` fotografía previa | **Sí**, solo lectura, antes de 005 | n/a | n/a | Detectó `TRUNCATE`, `REFERENCES` y `TRIGGER` en las cuatro vistas |
| **`007`** Safety | **Sí** | 3 de 5 OK al inicio → **todas OK** tras corregir el postcheck | pendiente de reporte | 9 tablas `sea_*` adicionales, sin escritura efectiva |
| **`005`** vistas | **Sí**, con restauración mínima posterior | **4 de 4 OK** | Regresión en `adm_ot_estado` | Ver §6.2 |
| **`008`** vistas resto | **Sí** | **5 filas, 5 OK** | Sin incidencias | — |
| **`014`** `adm_ot_estado` a `security_invoker` | **Sí** | **5 de 5 OK** | La pantalla seguía vacía → se midió con `015` | Causa real: tabla vacía. Ver §6.4 |
| `015` medición de `adm_work_orders` | **Sí**, solo lectura | n/a | n/a | **VEREDICTO E**: `adm_work_orders` está VACÍA |
| `007b` resto de Safety | **No · PENDIENTE** | — | — | Defensa en profundidad, no explotable hoy |
| `011` corrección de `adm_ot_estado` | **No · DESCARTADA** | — | — | Corregía una autorización que no estaba mal |
| `001` migración de Fase 0 | **No · PENDIENTE** | — | — | Es la Fase D |

### 6.0 Secuencia exacta, para poder reproducirla

El orden importa y **la restauración mínima temporal forma parte de la historia**.
Quien reproduzca esto en otro entorno tiene que pasar por los mismos estados, o
no estará reproduciendo lo mismo:

| # | Qué se ejecutó | Efecto sobre `public.adm_ot_estado` |
|---|---|---|
| 1 | `009_fotografia_previa.sql` (solo lectura) | ninguno · es la fuente de verdad del rollback |
| 2 | `007_contencion_safety.sql` | ninguno · es Safety |
| 3 | **`005_contencion_vistas.sql`** | `security_invoker = true`; `anon` revocado; `authenticated` sin `i/u/d` |
| 4 | Regresión observada: `/administracion/estado-ots` vacía | — |
| 5 | **Restauración mínima temporal** · `alter view public.adm_ot_estado reset (security_invoker);` | vuelve a privilegios del propietario. **Los `revoke` de `anon` NO se tocaron** |
| 6 | `008_contencion_vistas_resto.sql` | ninguno |
| 7 | `012`, `013` (solo lectura) | ninguno · descartan dos hipótesis de autorización |
| 8 | **`014_adm_ot_estado_invoker.sql`** | **revierte el paso 5**: `security_invoker = true` otra vez. Postcheck 5/5 OK |
| 9 | La pantalla **seguía vacía** tras `014` | — |
| 10 | `015_medir_estado_ots.sql` (solo lectura) | ninguno · **VEREDICTO E**: la tabla está vacía |

O sea: el estado de la vista fue **`invoker` → `reset` → `invoker`**. La
restauración del paso 5 **no arregló nada** —la pantalla no se llenó— porque la
causa nunca fue un permiso. Se hizo porque era el procedimiento previsto ante una
regresión, y se deshizo en cuanto se descartaron las hipótesis de autorización.

**Estado actual, que es el estado con el que se entra en la Fase B:**

```
public.adm_ot_estado · security_invoker = true
                     · anon: ningún privilegio
                     · authenticated: select; sin insert/update/delete
```

Una lección que conviene no perder: entre los pasos 4 y 10 se propusieron tres
correcciones distintas (falta del rol `tecnico`, superadmin sin fila en
`adm_usuarios`, sesión rota) y **las tres se descartaron con datos de
producción**. La cuarta medición, la que nadie había hecho, era contar las filas
de la tabla. Explicar un síntoma leyendo el código antes de medirlo costó tres
vueltas.

### 6.1 `007` · lo que consiguió, y el error de mi postcheck

**Escritura anónima efectiva sobre Safety: de 10 tablas a 0.**

El postcheck original marcó FALLO en cinco filas por dos errores míos:

1. Las filas 9 y 10 asumían **10** tablas `sea_*`; producción tiene **19**.
2. Las filas 3-5 medían `has_table_privilege` —**el grant**— y lo presentaban
   como capacidad de escribir.

Las nueve adicionales tienen RLS y ninguna política de `anon`: el `INSERT` lo
rechaza la RLS y el `UPDATE`/`DELETE` afectan a cero filas. Reproducido en 17.6.
Postcheck reescrito en `010`, sin números fijos y separando GRANT de EFECTIVO.

### 6.2 `005` · `adm_ot_estado` y lo que su regresión demuestra

La pantalla se quedó vacía con `security_invoker = true`, y se aplicó la
restauración mínima correcta:

```sql
alter view public.adm_ot_estado reset (security_invoker);
```

Los `revoke` de `anon` se conservaron. Pero ese resultado **no es solo un
contratiempo operativo: es un hallazgo**.

> Que la pantalla se vaciara demuestra que **el usuario legítimo del panel no
> pasa `adm_can_read()`**. Es decir: esa pantalla llevaba funcionando gracias
> al salto de RLS, no a pesar de él.

Y la consecuencia de la restauración, dicha sin rodeos:

| Rol | Antes de 005 | Ahora |
|---|---|---|
| `anon` | lee saltándose la RLS | **sin acceso** ✅ |
| `authenticated` | lee saltándose la RLS | **sigue leyendo saltándose la RLS** ⚠️ |

**`adm_ot_estado` conserva el bypass de SEC-068 para cualquier usuario
autenticado del proyecto** —de cualquiera de las ocho apps, porque el proyecto
de Supabase es uno—, que obtiene todas las órdenes de trabajo y los nombres de
cliente sin pasar por `adm_can_read()`.

Cerrarlo necesita una decisión funcional previa, no un `alter view`: o la
política de `adm_work_orders` está mal y hay que corregirla, o la pantalla no
debería mostrar esos datos a ese usuario. **Resuelto el 2026-09-27.** No había fallo de autorización: `adm_work_orders`
está vacía (11 clientes, 0 órdenes de trabajo), así que la pantalla decía la
verdad. `014` reactivó `security_invoker` y **cerró el bypass de
`authenticated`**. Ver `docs/SEC-068_adm_ot_estado.md`.

### 6.3 Las dos incidencias de consola

Registradas aparte, como se pidió. Y comprobado en el código antes de darlas
por no relacionadas:

| Incidencia | Relación con 005/008 |
|---|---|
| `Invalid Refresh Token / Refresh Token Not Found` | Ninguna. Es de Supabase Auth |
| `tc_informes_kpis` → HTTP 500 | **Ninguna**: la función no lee ninguna de las 13 vistas contenidas. Lee `tc_neumaticos`, `tc_posiciones_vehiculo`, `tc_config_umbrales*`, `operaciones_neumaticos` y `revisiones_*` |

**Hipótesis que explica las dos como un solo incidente:**
`tc_informes_kpis` es `security invoker` y su `grant execute` es **solo para
`authenticated`**. Con el refresh token inválido, PostgREST se queda sin JWT y
atiende la petición como `anon`, que no tiene ese `execute`. El error de
permiso puede aflorar como 500.

Se confirma en dos minutos: volver a entrar y repetir la pantalla de informes.
Si desaparece, eran lo mismo. No es un bloqueante.

### 6.4 `014` · qué cerró y qué no

`014` es una sola sentencia y su postcheck salió 5 de 5. Lo que consiguió:

| Rol | Antes de `005` | Tras el paso 5 (restauración) | Tras `014` · hoy |
|---|---|---|---|
| `anon` | lee saltándose la RLS | **sin acceso** | **sin acceso** ✅ |
| `authenticated` | lee saltándose la RLS | sigue saltándose la RLS ⚠️ | **sujeto a la RLS de las tablas base** ✅ |

Lo que **no** consiguió, y no era su trabajo: llenar la pantalla. Eso no tenía
arreglo en SQL porque `adm_work_orders` tiene 0 filas (11 clientes, 0 órdenes).
La pantalla decía la verdad. Detalle en `docs/MEDICION_estado_ots.md` y
`docs/SEC-068_adm_ot_estado.md`.

### 6.5 Twilio · SEC-007 · COMPATIBLE · 2026-09-27

No es una contención SQL, pero se registra aquí porque era el último bloqueante
que quedaba por delante de la Fase B y esta era la lista de la que salía.

Configuración leída en la consola de Twilio (**Messaging → Senders → número de
WhatsApp → «A message comes in»**):

| Campo | Valor |
|---|---|
| URL | `https://sea-tarragona.onrender.com/api/whatsapp/inbound` |
| Método | `POST` |
| Protocolo | HTTPS |
| Query string | ninguna |
| Barra final | no |
| Fallback URL | **vacío** |

Los seis campos coinciden con la URL que el backend reconstruye →
**VEREDICTO: COMPATIBLE**. La firma de Twilio valida y el webhook procesa; el
riesgo de que el endurecimiento a `403` dejara el WhatsApp mudo queda descartado
**por comparación de campos**, no desplegando a ver qué pasa. Comparación
completa en `docs/TWILIO_comparacion.md` §5.

**Observación futura, no bloqueante:** la validación es tolerante por lista
(cuatro orígenes candidatos, uno derivado de `x-forwarded-host`). Cuando el
dominio definitivo esté decidido, lo correcto es firmar contra una sola URL de
configuración y dejar de derivarla de una cabecera. Queda como deuda, con su
propio despliegue, porque equivocarse ahí deja el WhatsApp mudo exactamente igual
que el fallo que esta comprobación descartó. **No entra en la Fase B.**

### 6.6 `Invalid Refresh Token` · resuelto en código, pendiente de despliegue

La primera incidencia de §6.3 tenía causa propia y ya está corregida: el front
web construía **tres** clientes Supabase (`tyrecontrol`, `administracion`,
`almacen-neumaticos`) sobre el mismo proyecto y la misma clave de
almacenamiento, o sea tres `GoTrueClient` con tres temporizadores de refresco
rotando el mismo refresh token. Ahora hay **una sola instancia compartida**.

No es una contención de base de datos: es código, y por tanto **entra con la
Fase B**. Detalle en `docs/INCIDENCIA_gotrue_multiple.md`.

Esto refuerza la hipótesis de §6.3: si el 500 de `tc_informes_kpis` era la
petición atendida como `anon` por falta de JWT, debería desaparecer al desplegar.
Se comprueba en la ventana de observación; **no se da por cerrado antes**.

## 7. Lo que sigue sin autorizar

`001_seguridad_fase0.sql` (Fase D) · `007b` · merge · deploy · cambios en Twilio ·
Render · Auth · Edge Functions · rotaciones · APKs · Fase 1A/1C.

La Fase B queda en **GO técnico** desde el 2026-09-27 (ver
`docs/RUNBOOK_seguridad_fase0.md` §B.0), pero **el merge y el despliegue siguen
requiriendo autorización explícita**.
