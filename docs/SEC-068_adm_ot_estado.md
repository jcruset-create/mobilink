# `adm_ot_estado` · diagnóstico

Residuo activo de SEC-068 tras las contenciones del 2026-09-27. **Nada
modificado.** Diagnóstico y propuesta; la corrección se decide aparte.

---

## 1. `adm_can_read()`, completa

```sql
create or replace function adm_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select adm_rol_actual() in ('admin','administracion','recepcion','supervisor')
$$;

create or replace function adm_rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select rol::text from adm_usuarios where id = auth.uid() and activo), '')
$$;
```

| Propiedad | Valor |
|---|---|
| Seguridad | **`SECURITY DEFINER`**, las dos |
| `search_path` | `public` — **sin `pg_temp`**: son dos de las 132 de SEC-067 |
| Lenguaje | `sql`, `stable` |
| Grants de ejecución | Ninguno explícito en el repositorio → **`EXECUTE` a `PUBLIC` por defecto** |
| Qué usa | `adm_usuarios` (id, rol, activo) y `auth.uid()`. **Ningún claim del JWT** salvo el `sub` |

`adm_rol` es un enum de **cinco** valores:
`admin`, `administracion`, `recepcion`, `supervisor`, **`tecnico`**.

**`adm_can_read()` cubre cuatro. `tecnico` no está.**

---

## 2. Policies reales de las tablas base

```sql
create policy adm_customers_select   on adm_customers   for select using ( adm_can_read() );
create policy adm_customers_write    on adm_customers   for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );
create policy adm_work_orders_select on adm_work_orders for select using ( adm_can_read() );
create policy adm_work_orders_write  on adm_work_orders for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );
```

Coinciden exactamente con la fotografía de producción: `to public`, sin rol
nombrado, así que aplican a `anon` y a `authenticated` por igual.

**`adm_work_orders` no tiene columna de empresa.** Tiene `center`
(`tarragona`/`reus`) y `total_amount numeric(12,2)`. Este módulo **no es
multiempresa**: es la administración de Mobilink, con dos centros.

Eso responde a una de las preguntas antes de mirar más: *aquí no hay
aislamiento entre empresas que proteger, porque no hay empresas.* Lo que hay
que proteger es **qué columnas ve cada rol**.

---

## 3. Modelo de identidad real de la pantalla

| Capa | Qué hace |
|---|---|
| Ruta | `/administracion/estado-ots`, dentro de `<ProtectedRoute>` pero **fuera de todo `<RoleRoute>`** |
| Comentario en el propio código | `{/* Técnico: solo estado de OTs (sin importes) */}` |
| Cliente | `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` propio del módulo |
| Sesión | JWT de Supabase (`signInWithOtp`), compartido con el resto del panel |
| Lo que llega a Supabase | El `sub` del JWT → `auth.uid()`. **Nada más**: ni rol, ni empresa, ni centro |
| Dónde vive el rol | En la tabla `adm_usuarios`, espejo sincronizado desde `app_usuarios` por `app_sync_acceso()` |

---

## 4. La causa raíz · CORREGIDA el 2026-09-27

> **La explicación que di antes era falsa.** Dije que la pantalla se vaciaba
> porque a `adm_can_read()` le falta el rol `tecnico`. Producción **no tiene
> ningún `tecnico`**: en `adm_usuarios` hay 2 `admin` y 1 `recepcion`, y nada
> más. La hipótesis queda descartada.

La causa real está en
`src/modules/administracion/contexts/AdminAuthContext.tsx`, en `cargarPerfil()`:

```ts
// Un superadmin de la plataforma entra aunque no tenga ficha en
// adm_usuarios: se le da perfil de admin sintético para este módulo.
if (await esSuperadmin(userId)) {
  return { id: userId, nombre: "Superadmin", rol: "admin", activo: true };
}
```

> **El panel le fabrica al superadministrador de plataforma un perfil de
> «admin» en el navegador. La base de datos no sabe nada de eso.**

`adm_rol_actual()` solo mira `adm_usuarios`, donde ese usuario no tiene fila,
así que devuelve la cadena vacía y `adm_can_read()` es falso. Y
`esSuperadmin()` lee `app_usuarios.es_superadmin`, una tabla distinta que la
cadena de autorización del módulo no consulta nunca.

Encaja con todo lo observado: la interfaz decía «Admin» y la RLS decía que no.

### Reproducido en PostgreSQL 17.6

Con el esquema y las funciones reales:

| Caso | Resultado |
|---|---|
| Superadmin sin ficha, estado de hoy | **ve 1 OT** por la vista |
| Superadmin, `adm_rol_actual()` | **`''`**, y `adm_can_read()` → **false** |
| Superadmin, acceso **directo** a `adm_work_orders` | **0 filas** |
| Superadmin, con `security_invoker` | **0 filas** ← la pantalla vacía |
| `admin` **con ficha**, con `security_invoker` | **1 fila** |

### Lo que implica, y es más grande que esta vista

**El superadministrador no puede leer ninguna tabla del módulo**: ni OTs, ni
clientes, ni facturas, ni cobros. La interfaz le abre la puerta y la base le
devuelve cero filas en todo.

`estado-ots` es la única pantalla que le funciona, y le funciona **precisamente
por el salto de privilegios de esta vista**. Sin saberlo, ese bypass estaba
tapando una incoherencia del modelo de autorización.

### Clasificación del defecto

Tu lista era A / B / C / D. Con el dato real, la respuesta cambia:

| | |
|---|---|
| **A · `adm_can_read()`** | No está mal para lo que cubre. Le falta una dimensión: no contempla al superadministrador de plataforma |
| **B · las policies** | Correctas |
| **C · la identidad/contexto** | **Aquí está el defecto.** El panel resuelve el rol por una vía (`app_usuarios.es_superadmin`, en el cliente) y la base por otra (`adm_usuarios`, en el servidor), y las dos no coinciden |
| **D · combinación** | Sí, pero el eje es C. Y el salto de privilegios de la vista era lo que lo ocultaba |

## 5. Matriz: quién debería ver qué, y quién ve qué

`adm_rol_actual()` devuelve `''` para quien no tenga fila activa en
`adm_usuarios`, y `adm_can_read()` es falso con `''`.

| Caso | Debería ver | `adm_can_read()` | Policy | Resultado real hoy (vista owner) |
|---|---|---|---|---|
| **superadmin** de plataforma | Sí, si tiene acceso al módulo | Depende de su fila en `adm_usuarios`; **no hay excepción de superadmin** | permite si `adm_can_read()` | **Lo ve todo** por la vista |
| **`admin`** | Todo, con importes | **true** | permite | Lo ve todo ✅ |
| **`administracion`** | Todo, con importes | **true** | permite | Lo ve todo ✅ |
| **`recepcion`** / **`supervisor`** | Según diseño | **true** | permite | Lo ven ✅ |
| **`tecnico`** | Estado sin importes | **false** ❌ | deniega | No aplica: **no existe ninguno en producción** |
| **Superadmin de plataforma** sin ficha | Según decisión | **false** ❌ | deniega | **Lo ve por la vista** — y así es como funciona la pantalla |
| Usuario de **otra empresa** | Nada | No aplica: el módulo no es multiempresa | — | **Lo ve todo** por la vista ⚠️ |
| **Operario autenticado** (sin fila en `adm_usuarios`) | Nada | **false** | deniega | **Lo ve todo** por la vista ⚠️ |
| **Autenticado de otra app** del proyecto | Nada | **false** | deniega | **Lo ve todo** por la vista ⚠️ |
| **`anon`** | Nada | false | deniega | **Sin acceso** ✅ (lo cerró 005) |

Las tres filas con ⚠️ son SEC-068 vivo. La fila de `tecnico` es la funcional
que hay que preservar.

### Confirmarlo en producción, en lectura

No he podido comprobar qué rol tiene quien abrió la pantalla. Una consulta lo
resuelve:

```sql
select rol, activo, count(*) from adm_usuarios group by rol, activo order by 1;
```

Si aparecen usuarios con `rol = 'tecnico'` y activos, la hipótesis queda
confirmada. Si el que abrió la pantalla resulta ser `admin`, entonces el
problema es otro —su fila en `adm_usuarios` falta o está inactiva— y habría que
mirar la sincronización.

---

## 6. Propuesta mínima · y un requisito que no se puede cumplir a la vez

Pediste cuatro cosas simultáneas. **Tres se pueden; la cuarta no, en esta
arquitectura.** Conviene decirlo antes de proponer nada:

| Requisito | ¿Alcanzable? |
|---|---|
| El usuario legítimo sigue viendo las OTs que le corresponden | Sí |
| Un `authenticated` de otra app o empresa no puede verlas | Sí |
| `anon` sigue sin acceso | Ya está |
| **La vista no depende de privilegios del dueño** | **No, sin más cambios** |

El motivo: **todos los usuarios del panel son el mismo rol de base de datos,
`authenticated`.** La RLS filtra filas, no columnas, y los grants por columna
son por rol. Así que no hay forma de que la base distinga «técnico ve las
columnas sin importe» de «admin ve todas» sin que alguien ejecute con más
privilegios que el llamante. El salto de privilegios **es** el mecanismo de
restricción por columnas aquí.

### Opción 1 · mínima, y la que recomiendo ahora

Que la vista siga corriendo como su dueño, pero **comprobando ella misma quién
llama**:

```sql
create or replace view adm_ot_estado as
  select wo.id, wo.ot_number, wo.vehicle_plate, wo.status, wo.center,
         wo.created_at, c.name as customer_name
    from adm_work_orders wo
    join adm_customers c on c.id = wo.customer_id
   where adm_can_read() or adm_rol_actual() = 'tecnico';
```

| | |
|---|---|
| Qué arregla | El salto deja de ser incondicional: quien no está en `adm_usuarios` no ve nada. Las tres filas ⚠️ se cierran |
| Qué conserva | El técnico sigue viendo el estado sin importes, y nadie gana acceso a `total_amount` |
| Qué **no** arregla | La vista sigue dependiendo de los privilegios del dueño |
| Precedente | Es exactamente el patrón de `tc_clientes_almacen` y `tc_productos_almacen`, que llevan `where tc_is_admin()` dentro |
| Riesgo | Bajo. Si el rol real no fuera `tecnico`, la pantalla volvería a vaciarse — por eso hay que confirmar §5 antes |

Mejor aún, en vez de escribir `'tecnico'` suelto dentro de la vista, una
función con nombre propio que diga qué autoriza:

```sql
create or replace function adm_puede_ver_estado_ot()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select adm_rol_actual() in ('admin','administracion','recepcion','supervisor','tecnico')
$$;
```

Y la vista con `where adm_puede_ver_estado_ot()`. Así el permiso queda
declarado en un sitio con nombre, en lugar de escondido en un `where`. Y de
paso lleva `pg_temp`, que `adm_can_read()` no tiene.

### Opción 2 · cumple los cuatro requisitos, pero es Fase 3

Mover `/administracion/estado-ots` a un endpoint del servidor, que entra con
`service_role` y hace su propia autorización, y retirar la vista a
`authenticated`. Es el mismo rediseño que ya está previsto para el portal del
empleado: la autorización deja de estar en la base y pasa al servidor, donde sí
se puede distinguir por columnas y por rol.

No es para ahora: implica endpoint nuevo y tocar la pantalla.

### Opción 3 · descartada

Añadir `tecnico` a `adm_can_read()` y poner `security_invoker`. Cumpliría el
cuarto requisito y **rompería el propósito de la vista**: el técnico pasaría a
leer `adm_work_orders` directamente, `total_amount` incluido.

---

## 7. Tests que demostrarían el aislamiento

Reproducibles en el PostgreSQL 17.6 de laboratorio, sin tocar producción. Se
añadirían a `scripts/probar-contenciones-pg17.sh`:

| # | Escenario | Esperado con la opción 1 |
|---|---|---|
| 1 | `authenticated` con `adm_usuarios.rol = 'tecnico'` activo | **ve las OTs** |
| 2 | `authenticated` con `rol = 'admin'` | ve las OTs |
| 3 | `authenticated` **sin fila** en `adm_usuarios` (operario, otra app) | **0 filas** |
| 4 | `authenticated` con fila **inactiva** | **0 filas** |
| 5 | `anon` | **denegado** (grant retirado por 005) |
| 6 | El técnico intenta leer `adm_work_orders` directamente | **0 filas** — no gana acceso a `total_amount` |
| 7 | La vista no expone `total_amount` en ningún caso | La columna no existe en la vista |
| 8 | `adm_ot_estado` sigue **sin** `security_invoker` | `reloptions` vacío |

El 3 y el 6 son los que importan: el 3 cierra SEC-068 y el 6 demuestra que la
corrección no abre una puerta nueva.

---

## 8. Lo que hace falta antes de escribir el SQL

1. **La consulta de §5**, en lectura: confirmar que existen usuarios `tecnico`
   activos y, si se puede, qué rol tiene quien abrió la pantalla.
2. **Una decisión funcional:** ¿el técnico debe ver las OTs de los dos centros,
   o solo del suyo? La tabla tiene `center` y la vista no filtra por él. Hoy los
   ve todos. No lo cambio por iniciativa propia, pero conviene decidirlo en el
   mismo sitio.
