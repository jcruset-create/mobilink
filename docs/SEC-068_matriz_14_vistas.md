# SEC-068 · matriz definitiva de las 14 vistas

Inventario **14/14**. Datos de producción (`006`, 2026-09-27) más la matriz de
privilegios ejercida en un PostgreSQL 17.6 de laboratorio que reproduce las
definiciones reales y las políticas reales de las 15 tablas base.

**Ninguna prueba se ha ejecutado contra producción.** SEC-068 sigue **ABIERTO**.

---

## 1. Lo que comparten las 14

| Propiedad | Valor en las 14 |
|---|---|
| Dueño | `postgres` |
| `security_invoker` | **false** — ninguna lo declara |
| `check_option` | **NONE** — ninguna |
| Grants de `anon` | `select, insert, update, delete` |
| Grants de `authenticated` | `select, insert, update, delete` |
| Dueño de las 15 tablas base | `postgres`, las 15 |

Dueño de la vista = dueño de la tabla, y el dueño de una tabla no pasa por su
RLS. El salto es total en las catorce.

**Fidelidad del laboratorio:** las 14 reproducen `is_updatable` e
`is_insertable_into` exactamente igual que producción, **14/14**.

---

## 2. Matriz definitiva

`anon` y `authenticated` sin ningún privilegio de aplicación: el atacante con la
clave publicable, y el usuario autenticado de otra app del proyecto.

| # | Vista | Actlz. | Consumidor | ¿Necesita `anon`? | ¿Necesita escribir? | anon SEL | anon INS/UPD/DEL | Bypass |
|---|---|---|---|---|---|---|---|---|
| 1 | `adm_ot_estado` | no | `EstadoOts.tsx` (auth) | no | no | **1** | denegado | **SÍ** |
| 2 | `tc_clientes_almacen` | **sí** | `data.ts:74` (auth) | no | no | 0 | **INSERT escribe** | **SÍ** |
| 3 | `tc_productos_almacen` | **sí** | `data.ts:87` (auth) | no | no | 0 | **INSERT escribe** | **SÍ** |
| 4 | `tc_marcas_contadores` | **sí** | `data.ts:1567` (auth) | no | no | **1** | **los tres escriben** | **SÍ** |
| 5 | `tc_tipos_plano_descuadrado` | **sí** | **ninguno** | no | no | **1** | **los tres escriben** | **SÍ** |
| 6 | `traspasos_auditoria_detalle` | no | panel ×2 + **`almacen_app` (`anon`)** | **sí, hoy** | no | **1** | denegado | no* |
| 7 | `movimientos_stock_detalle` | no | ninguno | no | no | **1** | denegado | **SÍ (parcial)** |
| 8 | `stock_actual_detalle` | no | ninguno | no | no | **1** | denegado | **SÍ (parcial)** |
| 9 | `tc_modelos_aplicacion_sin_clasificar` | no | ninguno | no | no | **1** | denegado | **SÍ** |
| 10 | `kpis_traspasos` | no | ninguno | no | no | **1** | denegado | no |
| 11 | `stock_actual` | no | ninguno | no | no | **1** | denegado | no |
| 12 | `traspasos_detalle` | no | ninguno | no | no | **1** | denegado | no |
| 13 | `traspasos_lineas_detalle` | no | ninguno | no | no | **1** | denegado | no |
| 14 | `traspasos_resumen_lineas` | no | ninguno | no | no | **1** | denegado | no |

\* En `traspasos_auditoria_detalle` no hay bypass porque la tabla base ya está
abierta a `anon` por su propia política. Es peor, no mejor: el dato sale por los
dos sitios.

**Nueve de las catorce no tienen ningún consumidor** en el panel, en las ocho
APK, en el servidor ni en las Edge Functions.

> **Corrección.** El 2026-09-27 atribuí `stock_actual` a `SafetyDashboard.tsx`.
> Era falso: esa pantalla usa la COLUMNA `stock_actual` de `sm_epis`, que no
> tiene relación. `stock_actual` no tiene consumidor.

---

## 3. La prueba del bypass · vista frente a acceso directo

Es la evidencia pedida: el mismo dato, el mismo rol, los dos caminos.

| Dato | Por la vista | Directo a la tabla |
|---|---|---|
| Nombre de cliente de una OT | `adm_ot_estado` → **«Cliente OT»** | `adm_customers` → **cero filas** |
| Nombre de cliente de un movimiento | `movimientos_stock_detalle` → **«Cliente Real»** | `clientes` → **cero filas** |
| Nombre de cliente y centro del stock | `stock_actual_detalle` → **«Cliente Real / Tarragona»** | `clientes` → **cero filas** |
| Tipo de vehículo | `tc_tipos_plano_descuadrado` → **«Rigido»** | `tc_tipos_vehiculo` → **cero filas** |
| Modelos de neumático | `tc_modelos_aplicacion_sin_clasificar` → **1 fila** | `tc_cat_modelos_neumatico` → **cero filas** |

Las cuatro tablas de la derecha tienen RLS activa y la están cumpliendo. Las
vistas la rodean.

### 3.1 El bypass parcial, que es el caso que se escapa al mirar por encima

`movimientos_stock_detalle` y `stock_actual_detalle` parecen inocuas si solo se
mira su tabla principal: `movimientos_stock` ya deja leer a `anon` por su
política `anon_read_movimientos`. Pero **cada una hace un `join` con `clientes`**,
que `anon` no puede leer, y sirve `cliente_nombre` igualmente.

O sea: una vista puede ser bypass **por unas columnas y no por otras**. Mirar
solo la tabla principal no basta; hay que mirar cada `join`.

`movimientos_stock_detalle` expone además `observaciones` y
`documento_referencia`, que son texto libre interno.

---

## 4. `tc_tipos_plano_descuadrado` · prueba completa

Pedida explícitamente. Las ocho operaciones, laboratorio 17.6:

| Rol | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `anon` | **1 fila** | **escribe** | **escribe** | **escribe** |
| `authenticated` | **1 fila** | **escribe** | **escribe** | **escribe** |
| — directo a `tc_tipos_vehiculo` (`anon`) | **0 filas** | **denegado** | — | — |

**Consumidor real: ninguno.** No aparece en el panel, ni en las ocho APK, ni en
el servidor, ni en las Edge Functions.

**¿Necesita escritura legítima? No.** Por su definición es una vista de
diagnóstico: lista los tipos de vehículo cuyo número de ruedas según la
etiqueta no coincide con las posiciones dibujadas en el plano. Devuelve un
descuadre para que alguien lo mire; escribir en ella no tiene ningún sentido
funcional. Es actualizable por accidente de la actualizabilidad automática de
PostgreSQL —un `select` sobre una sola tabla con un `where`—, no por diseño.

**Es peor que `tc_clientes_almacen`:** allí el `where tc_is_admin()` deja
`update` y `delete` en cero filas y solo el `insert` escribe. Aquí el `where`
sí devuelve filas a `anon`, así que **las tres operaciones escriben**, y
`delete` borra tipos de vehículo del catálogo.

**Propuesta:** de solo lectura y sin `anon`, exactamente como pedías.

---

## 5. Clasificación A–F

| Cat. | Vistas | |
|---|---|---|
| **A · segura tal como está** | *ninguna* | Las 14 tienen dueño `postgres` sin `security_invoker` y CRUD para `anon` |
| **B · exposición de lectura** | `kpis_traspasos`, `stock_actual`, `traspasos_detalle`, `traspasos_lineas_detalle`, `traspasos_resumen_lineas` | Sirven datos a `anon` sin necesidad, pero sus tablas base ya están abiertas: no añaden bypass. Sin consumidor |
| **C · bypass de RLS** | `adm_ot_estado`, `movimientos_stock_detalle`, `stock_actual_detalle`, `tc_modelos_aplicacion_sin_clasificar` | Demostrado: la vista da lo que la tabla niega |
| **D · escritura indirecta** | `tc_clientes_almacen`, `tc_productos_almacen`, `tc_marcas_contadores`, **`tc_tipos_plano_descuadrado`** | Las cuatro actualizables. `anon` escribe en tablas con RLS |
| **E · sin consumidor aparente** | Nueve: las cinco de B, `tc_tipos_plano_descuadrado`, `movimientos_stock_detalle`, `stock_actual_detalle`, `tc_modelos_aplicacion_sin_clasificar` | No aparecen en ningún cliente. «Sin consumidor localizado» no es «sin consumidor»: puede haber SQL a mano |
| **F · necesita decisión funcional** | `traspasos_auditoria_detalle` | La consume una APK con `anon` y sin identidad, y la tabla expone `codigo_personal` por su cuenta. No se corrige sin rediseñar el portal |

Las categorías se solapan a propósito: `tc_tipos_plano_descuadrado` es D y E a
la vez, y eso es justo lo que la hace fácil de cerrar — escribe cualquiera y no
la usa nadie.

---

## 6. Propuesta, sin aplicar

`005_contencion_vistas.sql` **sigue congelada** con sus cuatro vistas. No se
amplía.

Lo nuevo va en `008_contencion_vistas_resto.sql`, **preparado y sin aplicar**,
sobre las nueve sin consumidor:

```
revoke all on <vista> from anon;
revoke insert, update, delete on <vista> from authenticated;
```

Se conserva el `select` de `authenticated` porque son vistas de diagnóstico y
de listado que alguien puede estar consultando a mano; quitarlo no cierra
ningún agujero y sí puede romper un uso que el barrido no ve. La escritura no
la necesita ninguna.

`traspasos_auditoria_detalle` (caso F) no entra en ningún fichero: va con el
rediseño del portal.

### 6.1 Lo que queda abierto incluso con 005 y 008 aplicadas

| | |
|---|---|
| `traspasos_auditoria` expone `codigo_personal` a `anon` por su propia política | **ABIERTO** · deuda de credenciales |
| `productos_neumaticos`, `movimientos_stock` y `traspasos` siguen abiertos a `anon` por sus políticas | **ABIERTO** · SEC-002 / SEC-010 |
| Las 14 vistas siguen sin `security_invoker` | **Mitigado, no corregido**: se les quita el acceso, pero el mecanismo sigue ahí para la próxima vista que se cree |

Ese último punto es el que convierte esto en deuda: mientras las vistas se
creen sin `security_invoker`, cada vista nueva nace con el mismo agujero. La
corrección de fondo es una convención, y va con la Fase 3.
