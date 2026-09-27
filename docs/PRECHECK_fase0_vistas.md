# Vistas, roles y objetos · análisis de la segunda fotografía

Captura de solo lectura del **2026-09-27 02:18 UTC**, PostgreSQL 17.6.

Cierra los dos bloqueantes que quedaban de la Fase D, y destapa dos cosas
graves que no son de la Fase 0.

---

## 1. Resumen

| Pregunta pendiente | Resultado |
|---|---|
| ¿Alguna de las 42 tablas de la migración está bajo una vista? | **NO. Cero.** Condición 2 **resuelta a favor** |
| ¿Hay algún rol de aplicación propio que se quede fuera al activar RLS? | **NO.** Condición 4 **resuelta a favor** |
| ¿Las vistas se saltan la RLS? | **SÍ, las 14.** Hallazgo grave, pero **no afecta a la Fase 0** |
| ¿Qué son los tres objetos sin identificar? | Uno es vista; **dos no existen** |

---

## 2. Las vistas · confirmado y reproducido

**14 vistas en `public`. Las 14 idénticas en lo que importa:**

| Propiedad | Valor en las 14 |
|---|---|
| Dueño | `postgres` |
| `security_invoker` | **false** (ninguna lo declara) |
| Permisos de `anon` | **`disu`** — select, insert, update **y delete** |
| Permisos de `authenticated` | **`disu`** |

Una vista sin `security_invoker` se ejecuta con los privilegios de su dueño.
El dueño es `postgres`, que es también el dueño de las tablas, y **el dueño de
una tabla no pasa por su RLS**. Así que las 14 vistas leen sus tablas base sin
RLS y se lo sirven a quien tenga la clave publicable.

### 2.1 Reproducido en PostgreSQL 17.6

No es deducción: se ha montado un 17.6 con las definiciones exactas que
devolvió producción y se ha ejecutado como `anon`.

**Lectura.** `adm_ot_estado` es un `join` de órdenes de trabajo con clientes,
sin ninguna condición:

```
set role anon;
select count(*) from adm_ot_estado;   -->  1     (la ve)
select count(*) from clientes;        -->  ERROR: permission denied
```

La tabla directa está cerrada; la vista la sirve igual.

**Escritura, que es lo que no se esperaba.** De las cuatro vistas cuya
definición se pidió, **dos son escribibles**:

| Vista | `is_updatable` | `is_insertable_into` |
|---|---|---|
| `adm_ot_estado` | no | no |
| `traspasos_auditoria_detalle` | no | no |
| **`tc_clientes_almacen`** | **sí** | **sí** |
| **`tc_productos_almacen`** | **sí** | **sí** |

Las dos escribibles llevan `where tc_is_admin()`, que para `anon` es falso. Eso
protege la lectura —`anon` ve 0 filas— y el borrado —`delete` afecta a 0
filas—. **Pero no protege el INSERT**, porque la vista no tiene
`WITH CHECK OPTION`:

```
set role anon;
select count(*) from tc_clientes_almacen;              -->  0
delete from tc_clientes_almacen;                       -->  DELETE 0
insert into tc_clientes_almacen (codigo,nombre,nif)
  values ('HACK','Insertado por anon','X0000000X');    -->  INSERT 0 1
```

Y la fila aparece en `clientes`, que tiene RLS activa y ningún grant para
`anon`. **Es una escritura en una tabla protegida, con la clave que va dentro
de los APK.**

### 2.2 El arreglo, también comprobado

```sql
create or replace view tc_clientes_almacen with (security_invoker = true) as
  select ... from clientes where tc_is_admin()
  with cascaded check option;
```

Con eso, el mismo `insert` devuelve `ERROR: permission denied for table
clientes`. Las dos piezas hacen falta: `security_invoker` para que la vista
deje de prestar los privilegios del dueño, y `with check option` para que no
se pueda insertar lo que la vista no dejaría ver.

**No se ha escrito ninguna migración para esto.** Hay que revisar las 14 una a
una: poner `security_invoker` en una vista que hoy se apoya en los privilegios
del dueño puede dejar sin datos a quien la use legítimamente.

### 2.3 Qué pide comprobarse de las otras diez

Solo se pidieron las definiciones de cuatro. Falta saber cuáles de las diez
restantes son escribibles:

```sql
select table_name, is_updatable, is_insertable_into
  from information_schema.views where table_schema = 'public' order by 1;
```

### 2.4 Por qué NO bloquea la Fase 0

De las 15 tablas base de las 14 vistas, **ninguna está entre las 42 que la
migración cierra**. Las bases son `clientes`, `productos_neumaticos`,
`movimientos_stock`, `traspasos`, `traspaso_lineas`, `centros`, `adm_*`,
`tc_cat_*`… y las 42 son `cash_*`, `central_*`, `orm_*`, `rcp_*`, `tac_*`.

O sea: **activar RLS en las 42 no se lo salta ninguna vista, y ninguna vista se
queda sin datos por ello.** La condición 2 queda resuelta a favor.

Se anota como ampliación de alcance de **SEC-002**, no como hallazgo nuevo: es
la misma causa raíz —exposición de datos de backend a roles publicables— por la
superficie de las vistas.

### 2.5 De paso, se explica `traspaso_lineas`

Era la única de las 146 sin consumidor localizado en el servidor. Está debajo de
`traspasos_lineas_detalle` y `traspasos_resumen_lineas`. Ya no es una incógnita:
se consume por vista. `centros` igual, y las dos están sin RLS.

---

## 3. Los tres objetos · resueltos

| Nombre | Qué es | Consecuencia |
|---|---|---|
| `traspasos_auditoria_detalle` | **Vista**, dueño `postgres`, no invoker, `disu` para `anon` | Sirve la auditoría de traspasos —incluido `codigo_personal`— saltándose la RLS de `traspasos_auditoria` |
| `tc_webfleet_config` | **NO EXISTE** | Su migración nunca se aplicó. `server/tyrecontrol/webfleetCredenciales.ts` y el panel dependen de una tabla que no está: esa función está rota en producción |
| `backups_sistema` | **NO EXISTE** | `src/.../SistemaAlmacen.tsx` la lee. Código muerto que falla en silencio |

Ninguno de los dos que faltan es un problema de seguridad. Son dos defectos
funcionales que conviene mirar por separado.

---

## 4. Roles · condición 4 resuelta

| Rol | Login | BYPASSRLS |
|---|---|---|
| `service_role` | no | **sí** |
| `supabase_admin` | sí | sí (superusuario) |
| `supabase_etl_admin`, `supabase_read_only_user` | sí | sí |
| `authenticator`, `pgbouncer`, `cli_login_postgres` | sí | no |
| resto (`supabase_*`, `dashboard_user`) | — | no |

**No existe ningún rol de aplicación propio.** Todo lo que no es `anon` ni
`authenticated` es infraestructura de Supabase.

Y queda confirmado lo que se venía suponiendo: **`service_role` tiene
`BYPASSRLS`**, así que el servidor no se ve afectado al activar RLS.

Condición 4 resuelta: activar RLS sin políticas en las 42 no deja fuera a
ningún job.

---

## 5. Sobrecargas · para el barrido de SEC-067

| Función | Firmas |
|---|---|
| `tc_montar_neumatico` | **2** |
| `tc_sustituir_neumatico` | **3** |

Cinco firmas para dos nombres. `alter function ... set search_path` y
`revoke ... on function` actúan sobre **una firma**, así que el barrido de las
132 tiene que generarse leyendo `pg_proc`, no escribiendo nombres a mano.

Ninguna de las dos está entre las tres que toca la Fase 0: **sin impacto en la
Fase 0**, es una nota para la migración posterior.

---

## 6. Lo que `anon` puede leer hoy · y aquí está lo peor

### 6.1 `perfiles_usuario` (política `anon_read_activos`)

Columnas reales: `id, empresa_id, centro_id, nombre, email, telefono_movil,
codigo_operario, activo, created_at, user_id, rol, ubicacion`.

La política es `for select to anon using (activo = true)`, sin restricción de
columnas. Con la clave publicable se leen **nombre, email, teléfono móvil, rol,
ubicación y el código de operario** de todo el personal activo.

El código de operario es la credencial con la que `almacen_app` autoriza los
traspasos. Queda confirmado lo que ya se había señalado.

### 6.2 `sea_employees` (política `portal_anon_employees`) · esto es más grave

Columnas reales, las 28. Entre ellas:

| Columna | Qué es |
|---|---|
| `dni_nie` | **Documento de identidad** |
| `num_seguridad_social` | **Número de la Seguridad Social** |
| `direccion`, `codigo_postal`, `poblacion`, `provincia` | **Domicilio particular** |
| `telefono`, `email` | Contacto personal |
| `pin_hash` | **Hash del PIN** |
| `codigo_operario` | **La credencial del portal** |
| `fecha_alta`, `fecha_baja`, `cargo`, `departamento`, `observaciones` | Datos laborales |

La política es `for select to anon using (activo = true)`. **Con la clave
publicable se puede descargar el fichero completo de personal: DNI, número de
la Seguridad Social y domicilio de cada empleado activo.**

No hace falta explotar nada: es una consulta.

**Esto cambia la naturaleza del hallazgo.** Hasta ahora se había descrito como
«una credencial validada en el cliente». Sigue siéndolo, y la causa raíz es la
misma —las políticas de `anon` que sostienen el portal del empleado—, pero el
impacto no es solo escalada: **es una brecha de datos personales de categoría
alta**, con obligaciones de notificación.

Se mantiene como **un solo hallazgo**, no se desdobla, pero con la severidad
subida y los dos impactos escritos:

1. enumeración de credenciales (`codigo_operario` en las dos tablas);
2. **exposición del fichero de personal** (DNI, NSS, domicilio).

No se toca en la Fase 0 —ninguna de las dos tablas está en la migración—, y
retirar esas políticas hoy deja sin servicio el portal y `almacen_app`. Pero
deja de ser algo que pueda esperar a la Fase 3 por orden de prioridad: es lo
más grave encontrado en toda la auditoría, por encima de SEC-002.

Recomendación, para decidir: tratarlo como **contención urgente**, antes que
las tablas del otro documento. La contención mínima que no rompe el portal
sería restringir por columnas —una vista `security_invoker` con solo lo que el
portal necesita, y retirar el `select` directo sobre la tabla—, pero eso hay
que diseñarlo y probarlo, no improvisarlo.

---

## 7. GO/NO-GO actualizado

| Fase | Estado | Qué queda |
|---|---|---|
| **B · Código** | **NO-GO** | Solo Twilio. Sin cambios |
| **D · Migración** | **Sin bloqueantes técnicos pendientes** | Las cuatro condiciones de las 42 tablas están confirmadas. Falta la autorización, y que la Fase B vaya delante |
| **1A / 1C** | No autorizadas | Sin cambios |

Sobre la Fase D, dicho con precisión: **no queda ninguna comprobación
pendiente**, la migración corregida pasa 30 pruebas contra un 17.6 real, y las
cuatro condiciones de las 42 tablas están verificadas:

| # | Condición | Estado |
|---|---|---|
| 1 | Ninguna aparece en los clientes | Confirmada |
| 2 | Ninguna dependencia vía vista | **Confirmada ahora** (cero de 42) |
| 3 | El backend entra con `service_role` | **Confirmada ahora** (`BYPASSRLS` = sí) |
| 4 | No rompe jobs con otro rol | **Confirmada ahora** (no hay rol propio) |

Lo que ya no es una comprobación sino una decisión: **la Fase D no debe ir
antes que la Fase B**, porque la sección 6 cierra `app_login_email` a la clave
pública y el login del hub necesita el código nuevo para resolver el usuario
por su cuenta. Ese orden está en el runbook y en el rollback.

Y una advertencia sobre el alcance: aplicar la Fase D cierra 42 tablas de 188.
**Las vistas y las dos tablas de personal siguen abiertas después.** Terminar
la Fase D no es terminar SEC-002.

Nada aplicado, nada desplegado, nada mergeado.
