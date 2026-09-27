# Fase 0 · Correcciones tras la fotografía de producción

Revisión 2 de la migración. Nada aplicado, nada desplegado, nada mergeado.

Base: la salida de solo lectura del **2026-09-26 21:44 UTC** sobre el proyecto
real (PostgreSQL 17.6), cruzada con el código de la rama.

---

## 1. Inventario: cifras de producción frente a cifras del repositorio

Las cifras antiguas **no se borran de la auditoría**: se conservan como lo que
eran, una medición del repositorio. Pero dejan de ser la referencia operativa.

| Magnitud | Auditoría (repositorio) | **Producción (2026-09-26)** |
|---|---|---|
| Tablas en `public` | no medido | **437** |
| Con RLS | no medido | **249** |
| Sin RLS | «88» | **188** |
| Funciones `SECURITY DEFINER` | «~170» | **132** |
| De ellas sin `pg_temp` | no medido | **132 (todas)** |
| Funciones totales en `public` | no medido | **187** |
| Ejecutables por `PUBLIC` | no medido | **180** |
| Ejecutables por `anon` | no medido | **180** |
| Grants a `PUBLIC` sobre tablas | supuesto «los hay» | **0** |
| Tablas que conceden CRUD a `anon` | no medido | **437, todas** |

De dónde venía el «88»: de contar los `create table` de `supabase/migrations/`
sin un `enable row level security` al lado. Era una medición del repositorio
presentada como si fuera del sistema. Es el error metodológico que este
precheck ha corregido.

El «~170» venía de contar `security definer` en los ficheros `.sql`, contando
varias veces las funciones redefinidas por migraciones sucesivas.

---

## 2. Lo que se ha quitado de la migración, y por qué

### 2.1 SEC-003 · `perfiles_usuario` — sección retirada entera

La sección suponía una política `almacen_solo_autenticados`
(`for all to authenticated using (true)`) y la sustituía por tres.

Esa política **ya no existe**. SEC-003 está corregido en producción, con estas:

| Política | Cmd | Rol | Predicado |
|---|---|---|---|
| `perfiles_usuario_select_propio_o_admin` | SELECT | authenticated | `usuario_actual_es_admin() OR user_id = auth.uid()` |
| `perfiles_usuario_insert_admin` | INSERT | authenticated | `usuario_actual_es_admin()` |
| `perfiles_usuario_update_admin` | UPDATE | authenticated | `usuario_actual_es_admin()` |
| `perfiles_usuario_delete_admin` | DELETE | authenticated | `usuario_actual_es_admin()` |
| `anon_read_activos` | SELECT | **anon** | `activo = true` |

La migración creaba `perfiles_lectura` como
`for select to authenticated using (true)`. **Las políticas permisivas se
combinan con OR**, así que esa política sola habría bastado para que cualquier
autenticado leyera todos los perfiles, anulando
`perfiles_usuario_select_propio_o_admin`. El arreglo reabría el agujero.

Hay una prueba automática que lo fija: *«la migración NO crea perfiles_lectura
(anularía las de arriba por OR)»*.

---

## 3. `anon_read_activos` · quién la usa y qué expone

Se pidió no retirarla sin identificar consumidores. Identificado:

**`almacen_app`** (Flutter, arranca con `Supabase.initialize(anonKey: ...)`, sin
login), en `lib/screens/traspaso_detalle_screen.dart`:

```dart
final res = await _db
    .from('perfiles_usuario')
    .select('id, nombre, rol, ubicacion, activo')
    .eq('codigo_operario', codigo.toUpperCase())
    .eq('activo', true)
    .maybeSingle();
```

**Para qué flujo se creó:** validar el código personal del operario antes de
confirmar un traspaso. El código es el único factor de autorización.

**Qué columnas puede leer `anon` con esa política: todas.** El `select(...)` de
la app limita lo que la app pide, no lo que la política permite. La política es
`for select to anon using (activo = true)`, sin restricción de columnas, así
que la clave publicable puede hacer `select *` sobre todas las filas activas.

La lista exacta de columnas queda **NO VERIFICADA** hasta ejecutar
`002_vistas_y_objetos.sql`, que la devuelve. Lo que sí se sabe por el código es
que la tabla contiene `codigo_operario`, y ahí está el problema:

> **La política permite enumerar los códigos de operario de todo el almacén.**
> El código es la credencial, y la credencial es legible con la clave que va
> dentro del APK.

Es la misma causa raíz que el portal del empleado (§4): **una credencial
validada en el cliente contra una tabla legible con la clave pública.** No son
dos hallazgos, es uno con dos superficies.

**Por eso SEC-003 no puede marcarse cerrado.** Lo que estaba mal en la parte de
escritura ya está corregido; la lectura anónima sigue abierta y permite
enumerar credenciales. Retirar la política hoy deja a `almacen_app` sin poder
validar a nadie: hace falta antes mover esa validación al servidor.

---

## 4. SEC-010 · por qué no se cierra, y qué haría falta

### 4.1 El supuesto que era falso

La migración decía: *«Las apps de Presencia y Safety no se quedan sin nada:
entran por `/api/presencia-operator/*`»*. Cierto para las APKs, **falso para la
web**:

| Fichero | Qué hace con la clave `anon` |
|---|---|
| `src/pages/PortalLogin.tsx` | lee `sea_employees` y **se descarga `codigo_operario` al navegador** para compararlo en JavaScript |
| `src/pages/PortalFicha.tsx` | lee `pres_records`, lo actualiza al fichar la salida, y crea y modifica `sm_document_acknowledgements` |

Aplicar el `revoke` de la revisión 1 habría dejado sin servicio el portal del
empleado. No es una regresión hipotética: es la pantalla con la que la gente
ficha.

### 4.2 Y por el otro lado tampoco cerraba

`pres_auth_all` y `sm_auth_all` son `ALL to authenticated using (true)`. El
panel (`src/modules/presencia/pages/Fichajes.tsx`) depende de ellas: inserta,
edita, valida y **borra** fichajes directamente contra Supabase.

Retirando solo `anon`, cualquier usuario autenticado del proyecto —un operario
de cualquiera de las ocho apps, porque el proyecto de Supabase es uno— seguía
pudiendo leer todos los fichajes y cambiar una hora de entrada.

### 4.3 Las preguntas que se pidieron, respondidas

**`pres_records`**

| Pregunta | Respuesta |
|---|---|
| Quién debe insertar | El empleado, su propio fichaje. Y un administrador, los de su empresa |
| Quién lee lo suyo | El empleado, sus propias filas |
| Qué administradores leen | Los de la empresa del empleado, no los de otra |
| Quién corrige un fichaje | **Solo el administrador.** Que el interesado pueda reescribir su hora de entrada anula el valor probatorio del registro de jornada |
| Cómo se obtiene empresa/empleado desde la identidad | **Hoy no se puede: no hay identidad.** La sesión del portal es un JSON en `localStorage` que escribe el propio navegador. No hay `auth.uid()`, no hay JWT, no hay nada contra lo que escribir una política |

**`sm_document_acknowledgements`**

| Pregunta | Respuesta |
|---|---|
| Quién crea un acuse | Solo el interesado: firmar es un acto personal |
| Quién lo modifica | Nadie una vez firmado. Por eso la propuesta no lleva política de UPDATE sobre firmados |
| Quién consulta | El empleado los suyos; el administrador los de su empresa |
| Qué restringe cada operación | Empleado para crear; empleado + empresa para consultar |

### 4.4 Conclusión

**SEC-010 se desplaza a la Fase 3.** La corrección correcta necesita antes un
cambio de código (que el portal deje de hablar con Supabase con la clave
pública), y ese cambio está fuera del alcance de la Fase 0.

Y hay que decirlo con precisión: en la Fase 0 SEC-010 queda **ABIERTO**, no
«mitigado». No existe ninguna restricción que se pueda aplicar hoy sin tirar el
portal del empleado. Llamarlo mitigado sería apuntarse un avance que no existe.

El SQL corregido —con los nombres **reales** (`portal_anon_acks_*`, que es la
corrección pedida), con la retirada de las políticas transversales y con las
políticas acotadas por empleado y empresa— está escrito y preparado en
`supabase/migraciones-preparadas/003_sec010_presencia_acuses.sql`, con su
postcheck. No se aplica.

---

## 5. Vistas · nuevo bloqueante, y lo que ya se sabe

El inventario de producción está preparado en `002_vistas_y_objetos.sql` (solo
lectura, validado contra 17.6). Pendiente de ejecutar.

Lo que ya se puede afirmar leyendo el repositorio:

| Vista | Tablas base | RLS de las bases | `security_invoker` | Concedida a |
|---|---|---|---|---|
| `adm_ot_estado` | `adm_work_orders`, `adm_customers` | ambas **con RLS** | **no declarado** | `authenticated` |
| `tc_clientes_almacen` | `clientes` | **con RLS** | **no declarado** | `authenticated` |
| `tc_productos_almacen` | `productos_neumaticos` | **con RLS** | **no declarado** | `authenticated` |
| `tc_marcas_contadores` | `tc_cat_marcas_neumatico`, `tc_neumaticos`, … | con RLS | **no declarado** | `authenticated` |

Ninguna declara `security_invoker`. En PostgreSQL el defecto es lo contrario:
la vista se ejecuta con los privilegios de su **dueño**, y **se salta la RLS de
las tablas que lee**.

Consecuencia concreta, pendiente de confirmar con el dueño real:

- `tc_clientes_almacen` y `tc_productos_almacen` llevan `where tc_is_admin()`
  dentro, así que tienen una puerta propia. No dependen de la RLS, pero
  tampoco la respetan: quien pase ese `tc_is_admin()` lo ve todo.
- **`adm_ot_estado` no lleva ninguna puerta.** Es un `join` directo de órdenes
  de trabajo con clientes, concedido a `authenticated`. Si la vista corre como
  su dueño, **cualquier autenticado del proyecto obtiene todas las órdenes de
  trabajo y los nombres de cliente, saltándose la RLS de las dos tablas.**

Esto **no se cuenta como hallazgo nuevo**: es la misma causa raíz de SEC-002
—exposición de datos de backend a roles publicables— por la superficie de las
vistas. Se anota como ampliación de alcance de SEC-002, según lo acordado sobre
no inflar el recuento.

**Regla que queda fijada:** una tabla no está protegida por tener RLS. Hay que
mirar qué vistas la leen y con qué privilegios.

### 5.1 Los tres objetos sin identificar

| Nombre | Qué se sabe | Qué falta |
|---|---|---|
| `tc_webfleet_config` | Está creada **con RLS** en `supabase/migrations/tyrecontrol_webfleet_config.sql`, y la usan `server/tyrecontrol/webfleetCredenciales.ts` y el panel. **Pero NO aparece entre las 437 tablas de producción.** | Confirmar que esa migración nunca se aplicó. Si es así, hay código en producción que depende de una tabla que no existe |
| `traspasos_auditoria_detalle` | Aparece en `saas_fase1c_almacen_cerrar_anon.sql` dentro de una lista de nombres. La leen el panel y `almacen_app` | Si es una vista, puede estar saltándose la RLS de `traspasos` y `traspasos_auditoria` |
| `backups_sistema` | Solo aparece en `src/.../SistemaAlmacen.tsx`. No está en ninguna migración ni entre las 437 tablas | Puede ser una vista creada a mano, o código muerto que falla en silencio |

Los tres los resuelve la consulta `objetos_pendientes` de
`002_vistas_y_objetos.sql`.

---

## 6. SEC-067 · inventario actualizado

| | Antes | Ahora |
|---|---|---|
| Funciones `SECURITY DEFINER` | ~170 | **132** |
| Sin `pg_temp` | no medido | **132, todas** |

La Fase 0 sigue tocando **solo tres**: `app_es_admin`, `app_empresa_actual` y
`app_login_email`. El barrido de las 132 se mantiene como migración
independiente posterior. **No entran 132 cambios en la Fase 0.**

La consulta `sobrecargas` de `002_vistas_y_objetos.sql` es para ese barrido:
`revoke ... on function f(args)` alcanza **una sola firma**, así que una
sobrecarga olvidada deja la puerta abierta. Hay una prueba que lo fija.

---

## 7. Las 42 tablas · postchecks pedidos

Condiciones a confirmar antes de aplicar, y cómo se comprueba cada una:

| # | Condición | Estado | Comprobación |
|---|---|---|---|
| 1 | Ninguna aparece en los clientes | **CONFIRMADO** | Barrido de `.from('<tabla>')` en `src/` y en los ocho `*_app/lib`: 0 coincidencias de las 188 sin RLS. Los clientes leen 144 nombres, y las 137 que son tablas ya tienen RLS |
| 2 | Ninguna dependencia vía vista pública | **CONFIRMADO (2026-09-27)** | Cero de las 42 está bajo alguna de las 14 vistas |
| 3 | El backend entra con `service_role` | **CONFIRMADO en el catálogo (2026-09-27)** | `service_role` tiene `BYPASSRLS = true` |
| 4 | Activar RLS sin políticas no rompe jobs con otro rol | **CONFIRMADO (2026-09-27)** | No existe ningún rol de aplicación propio: todo lo demás es infraestructura de Supabase. Y `service_role` tiene `BYPASSRLS` |

Las cuatro condiciones están confirmadas. **La Fase D ya no tiene comprobaciones pendientes.**

Postcheck de la propia migración, para después de aplicarla:

```sql
-- Las 88 de la lista tienen que quedar todas con RLS y sin políticas.
select count(*) filter (where c.relrowsecurity) as con_rls,
       count(*) filter (where not c.relrowsecurity) as sin_rls,
       count(*) filter (where exists (select 1 from pg_policies p
                        where p.schemaname='public' and p.tablename=c.relname)) as con_politicas
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname in (/* las 88 */);
-- Esperado: con_rls = 88, sin_rls = 0, con_politicas = 0

-- Y anon no puede nada sobre ellas.
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname in (/* las 88 */)
   and (has_table_privilege('anon',c.oid,'select') or has_table_privilege('anon',c.oid,'insert')
     or has_table_privilege('anon',c.oid,'update') or has_table_privilege('anon',c.oid,'delete'));
-- Esperado: 0
```

---

## 8. SEC-002 · reformulado

**Formulación anterior:** «88 tablas de `public` sin RLS».

**Formulación nueva:**

> Exposición de tablas de backend por falta de RLS y por privilegios CRUD
> globales concedidos a roles publicables (`anon`, `authenticated`).

Es la causa raíz, y explica los tres síntomas a la vez: las 188 tablas sin RLS,
el CRUD completo en las 437, y las vistas que se saltan la RLS.

**Estado tras la Fase 0: PARCIAL, no cerrado.** La Fase 0 cubre un subconjunto
validado de 42 tablas. SEC-002 no podrá cerrarse mientras queden tablas
sensibles sin RLS y con grants a roles publicables — hoy, 146.

La auditoría original **no se reescribe**. Se le añade esta nota de validación:

> **Nota de validación contra producción (2026-09-26).** El alcance real de
> SEC-002 resultó mayor que el medido sobre el repositorio: 188 tablas sin RLS
> de 437, no 88. La cifra original era una medición del repositorio, no del
> sistema.

---

## 9. PostgreSQL 17.6 · resultado de las pruebas

Producción va en **17.6**; la revisión 1 se probó contra 16.13. Se ha compilado
PostgreSQL 17.6 desde el código fuente oficial (tag `REL_17_6`) y se ha montado
un banco de pruebas: `scripts/probar-migracion-pg17.sh`.

El estado de partida (`scripts/pg17-estado-produccion.sql`) reproduce lo que la
fotografía dice que hay, **no lo que el repositorio suponía**. Es la corrección
de un error anterior: un stub que no es fiel hace pasar pruebas que no prueban
nada.

| Paso | Resultado |
|---|---|
| 1ª aplicación | OK |
| 2ª aplicación seguida (idempotencia) | OK, sin error |
| Fichero de rollback | SQL válido — y **no revierte nada**, porque sus secciones van comentadas a propósito. Hay una comprobación que lo fija |
| Rollback **real** de los disparadores | OK: se quitan, las funciones del proyecto quedan intactas, el alta de usuarios vuelve a funcionar y `app_bajas_auth` no se borra |
| Reaplicación tras el rollback real | OK, los disparadores vuelven |
| Pruebas negativas | **30 de 30** |

Cubierto explícitamente: `PUBLIC` (tablas y funciones), `search_path` con
`pg_temp`, disparadores y **orden de disparo** (el guardia BEFORE antes que el
sync AFTER), RLS, **semántica OR de las políticas**, `CREATE OR REPLACE` (la
firma con `p_accesos` intacta), `ALTER DEFAULT PRIVILEGES` (una tabla creada
después no nace abierta) y **funciones sobrecargadas**.

Ninguna diferencia de comportamiento entre 16.13 y 17.6 en lo que esta
migración toca.

---

## 10. Estado de cada hallazgo de Fase 0

Los tres estados acordados: **cerrado en laboratorio** (el código está hecho y
probado, no ha llegado a producción), **preparado** (escrito, sin aplicar),
**cerrado en producción** (verificado allí). Ninguno está en el tercero.

| Hallazgo | Antes de la fotografía | **Ahora** | Por qué |
|---|---|---|---|
| SEC-001 · `AUTH_MODE` inerte | Cerrado en laboratorio | Cerrado en laboratorio | Sin cambios |
| SEC-002 · Tablas sin RLS | Preparado (88 tablas) | **Preparado, PARCIAL (42 de 188)** | Reformulado. No se cerrará con la Fase 0 |
| SEC-003 · `perfiles_usuario` | Preparado | **Ya corregido en producción para escritura; ABIERTO para lectura anónima** | La sección se retira. `anon_read_activos` permite enumerar códigos de operario |
| SEC-004 · Escalada a superadmin | Preparado | **Preparado**, probado en 17.6 | Sin cambios; la prueba de orden de disparo lo refuerza |
| SEC-005 · Borrado de usuarios | Preparado | **Preparado**, probado en 17.6 | Sin cambios |
| SEC-007 · Firma del webhook | Cerrado en laboratorio | Cerrado en laboratorio | Bloqueado por el dato de Twilio |
| SEC-010 · Fichajes y acuses | Preparado | **ABIERTO, desplazado a Fase 3** | No se puede cerrar sin cambiar el portal. No es «mitigado» |
| SEC-064 | Congelado | Congelado | Sin datos nuevos |
| SEC-065 · `app_login_email` | Preparado | **Preparado**, probado en 17.6 | Confirmado que `PUBLIC` la expone |
| SEC-067 · `search_path` | Preparado (3 de ~170) | **Preparado (3 de 132)** | Inventario corregido |
| **SEC-008** (ampliado) · Safety abierto a `anon` | Congelado | **ABIERTO · escritura contenida EN PRODUCCIÓN (2026-09-27); lectura sensible abierta** | Ampliado con evidencia de producción, sin abrir un SEC nuevo: es la misma superficie. Diez tablas con `ALL to anon using (true)`: se puede **modificar y borrar** el fichero de personal y la evidencia de habilitación. **Contención de escritura preparada y probada** (`007`). La **lectura** de DNI, NSS, domicilio y `pin_hash` queda **expresamente abierta** hasta migrar el login. Ver `docs/SEC-008_safety.md` |
| **Deuda · credencial validada en cliente** | — | **ABIERTA** | Patrón `anon key → SELECT credencial → comparación en JavaScript`, en cuatro sitios. No se arregla con una política. Fase 1/3. Ver `docs/DEUDA_credencial_en_cliente.md` |
| **SEC-068** · Vistas con privilegios del propietario | — | **ABIERTO · 13/14 contenidas EN PRODUCCIÓN (2026-09-27)**; `traspasos_auditoria_detalle` fuera por decisión funcional, y `adm_ot_estado` conserva el bypass para `authenticated` tras la restauración mínima | Hallazgo **independiente**, no ampliación de SEC-002: activar RLS no lo cierra (`clientes` tiene RLS y `anon` escribe igual por la vista). Las 14 corren como `postgres`; probado en 17.6 que `anon` lee lo que la tabla le niega, **inserta** en `clientes` y **borra** el catálogo de marcas por `tc_marcas_contadores`. Ver `docs/SEC-068_vistas.md`. No afecta a las 42 |

---

## 11. GO/NO-GO

| Fase | Estado | Qué lo bloquea |
|---|---|---|
| **0 · Contenciones urgentes** | **APLICADAS EN PRODUCCIÓN el 2026-09-27**: `007`, `005` y `008`. `007b` preparada | Ver `docs/RUNBOOK_contenciones_urgentes.md` §6 |
| **B · Código** | **NO-GO** | Twilio. Y ahora va detrás de las contenciones |
| **D · Migración** | **Sin bloqueantes técnicos**, pero **no es lo primero** | Las cuatro condiciones de §7 están verificadas. El orden lo decide ahora SEC-068 y la deuda de credenciales, más graves y más fáciles de contener |
| **1A / 1C** | No autorizadas | Sin cambios. Dos supuestos resueltos a favor: 2 superadmins con email de recuperación, 0 colisiones de username |

Nada aplicado, nada desplegado, nada mergeado.
