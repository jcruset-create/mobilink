# SEC-068 · CRÍTICO · Vistas ejecutadas con privilegios del propietario

> **Vistas ejecutadas con privilegios del propietario exponen datos protegidos
> por RLS y, cuando son actualizables, permiten escritura indirecta sobre
> tablas base.**

## Los cuatro mecanismos, que son distintos entre sí

No es un solo fallo con cuatro síntomas: son cuatro caminos con condiciones
distintas, y una vista puede tener unos y no otros. Conviene enumerarlos
porque revisar solo uno deja los demás abiertos.

| # | Mecanismo | Condición para que ocurra | Demostrado en |
|---|---|---|---|
| 1 | **Bypass de `SELECT`** | La vista no es `security_invoker` y su dueño no pasa por la RLS de la tabla base | `adm_ot_estado`, `tc_modelos_aplicacion_sin_clasificar`, `tc_tipos_plano_descuadrado` |
| 2 | **Bypass parcial por `join`** | La tabla principal sí es legible por el llamante, pero **una columna viene de otra tabla que no lo es** | `movimientos_stock_detalle` (`clientes.nombre`), `stock_actual_detalle` (cliente y centro) |
| 3 | **`INSERT` sobre vista sin `CHECK OPTION`** | La vista es insertable y no lleva `with check option`: la fila entra aunque no cumpla el predicado | `tc_clientes_almacen`, `tc_productos_almacen` |
| 4 | **`UPDATE`/`DELETE` cuando el predicado devuelve filas** | La vista es actualizable y su `where` no excluye al llamante | `tc_marcas_contadores`, `tc_tipos_plano_descuadrado` |

El 2 es el que más fácilmente se escapa: mirar la tabla principal de la vista
no basta. **Hay que mirar cada `join`.** Una vista sobre una tabla abierta a
`anon` puede estar sirviendo, por una sola columna, datos de una tabla cerrada.

El 3 y el 4 se distinguen porque protegen cosas distintas: un predicado en el
`where` filtra lo que se lee, se actualiza y se borra —porque esas operaciones
parten de filas existentes—, pero **no filtra lo que se inserta**, porque un
`INSERT` no parte de ninguna fila.

## Severidad

**CRÍTICA**, y se mantiene mientras exista cualquiera de estas dos cosas:

- escritura anónima efectiva sobre alguna tabla base;
- exposición de credenciales o de datos sensibles por alguna de las vistas.

Hoy existen las dos. Cuando `005` y `008` estén aplicadas dejará de existir la
primera; la segunda sigue por `traspasos_auditoria_detalle` y su tabla.
**Estado (2026-09-27): ABIERTO.** *Escritura/bypass de las vistas contenidas
corregido; una superficie pendiente de decisión funcional.*

`005` y `008` aplicadas en producción: 13 de las 14 vistas sin acceso de `anon`
y sin escritura de `authenticated`. Quedan fuera:

- **`traspasos_auditoria_detalle`** · caso F. Expone `codigo_personal`, y
  cerrarla no bastaría: `traspasos_auditoria` lo expone también por su política
  `anon_read_auditoria`.
- **`adm_ot_estado`** · conserva el bypass **para `authenticated`**. Su
  `security_invoker` se revirtió con una restauración mínima porque la pantalla
  se quedó vacía, lo que demuestra que el usuario legítimo no pasa
  `adm_can_read()`: la pantalla venía funcionando gracias al salto de RLS.
  `anon` sí quedó fuera.
**Descubierto:** 2026-09-27, al contrastar el precheck con producción.

---

## 1. Por qué es hallazgo independiente y no parte de SEC-002

Se pidió justificarlo o encajarlo en SEC-002. **Es independiente**, y la razón
es que no comparten ni causa ni corrección:

| | SEC-002 | **SEC-068** |
|---|---|---|
| Causa | Falta de RLS y grants CRUD a roles publicables sobre **tablas** | La RLS **está puesta y se cumple**; lo que falla es que la vista se ejecuta como su dueño y no la aplica |
| Dónde vive | `pg_class.relrowsecurity` y los grants de tabla | `pg_class.reloptions` (`security_invoker`) y la actualizabilidad automática |
| Corrección | `enable row level security` + `revoke` | `security_invoker`, `with check option`, o retirar el privilegio |
| ¿La arregla la Fase 0? | Parcialmente (42 tablas) | **No, en absoluto** |
| Señal de detección | Tabla sin RLS | Vista sin `security_invoker` |

La prueba de que son distintos: **activar RLS en las tablas base no cierra
SEC-068**. `clientes` tiene RLS activa, se cumple para el acceso directo, y aun
así `anon` escribe en ella por la vista. Si fuera el mismo hallazgo, la
corrección de uno cerraría el otro, y no lo hace.

Tampoco es SEC-067: aquel es `search_path` y el esquema temporal; este es
privilegios del propietario en vistas. Ni causa ni corrección coinciden.

---

## 2. Evidencia

Reproducida contra **PostgreSQL 17.6**, con las definiciones de las vistas y
las políticas de las tablas base copiadas de producción. Reproducible:

```
bash scripts/probar-vistas-pg17.sh
```

Toda escritura va dentro de una transacción con `ROLLBACK`. **No se ha tocado
producción y no queda ninguna fila de prueba en ningún sitio.**

| # | Afirmación | Comprobado |
|---|---|---|
| 1 | `clientes` tiene RLS activa | sí, y ninguna política para `anon` |
| 2 | `anon` no accede directamente a `clientes` | `select` → 0 filas · `insert` → denegado |
| 3 | `anon` **inserta** por `tc_clientes_almacen` | `INSERT 0 1` |
| 4 | La vista no es `security_invoker` | `reloptions` vacío en las 14 |
| 5 | El predicado protege lectura y borrado, pero no el INSERT | `select` 0 filas, `delete` 0 filas, `insert` **escribe** |
| 6 | Con `security_invoker` + `with cascaded check option`, el INSERT se rechaza | `ERROR: permission denied for table clientes` |

El punto 5 es el mecanismo: `where tc_is_admin()` filtra lo que se lee y lo que
se actualiza, porque esas operaciones parten de filas existentes. Un `INSERT`
no parte de ninguna fila, y sin `WITH CHECK OPTION` PostgreSQL no comprueba que
lo insertado cumpla el predicado. La fila entra igual.

---

## 3. Matriz de privilegios efectivos

Ejercida, no leída del catálogo: un grant dice lo concedido; solo ejecutar dice
lo que ocurre, porque entre medias están la RLS, el predicado y la
actualizabilidad.

Escenario: sin ningún privilegio de aplicación. Es el atacante con la clave
publicable, y también el usuario autenticado de otra app del proyecto.

| Vista | Actualizable | `anon` SELECT | `anon` INSERT | `anon` UPDATE | `anon` DELETE |
|---|---|---|---|---|---|
| `adm_ot_estado` | no | **1 fila** | denegado | denegado | denegado |
| `tc_clientes_almacen` | sí | 0 filas | **ESCRIBE** | 0 filas | 0 filas |
| `tc_productos_almacen` | sí | 0 filas | **ESCRIBE** | 0 filas | 0 filas |
| `tc_marcas_contadores` | sí | **1 fila** | **ESCRIBE** | **ESCRIBE** | **ESCRIBE** |
| `traspasos_auditoria_detalle` | no | **1 fila** | denegado | denegado | denegado |
| las otras 9 | **NO VERIFICADO** | — | — | — | — |

`authenticated` obtiene exactamente lo mismo: las 14 vistas tienen `select,
insert, update, delete` concedidos a los dos roles por igual.

### 3.1 La comparación que lo demuestra

| | Por la vista | Directo a la tabla |
|---|---|---|
| `anon` lee órdenes de trabajo | **1 fila** (`adm_ot_estado`) | 0 filas (`adm_work_orders`) |
| `anon` escribe un cliente | **INSERT 0 1** (`tc_clientes_almacen`) | denegado (`clientes`) |

La RLS funciona. La vista la rodea.

### 3.2 La peor: `tc_marcas_contadores`

Es la única sin predicado y actualizable a la vez. `anon` puede **leer,
insertar, modificar y borrar** el catálogo de marcas de neumático, que tiene
RLS y cuya política exige `auth.uid() is not null`.

Con la clave que va dentro de los APK se puede vaciar el catálogo.

---

## 4. Vistas que se saltan la RLS

Las **14**, sin excepción: dueño `postgres`, `security_invoker` no declarado.
El dueño de una tabla no pasa por su RLS, y el dueño de las tablas también es
`postgres`, así que el salto es total.

De las 14 tablas base, 13 tienen RLS y **2 no** (`centros`, `traspaso_lineas`).
Para esas dos la vista no añade nada: ya estaban abiertas.

---

## 5. Consumidores reales

| Vista | Consumidor | Identidad | Escribe |
|---|---|---|---|
| `adm_ot_estado` | `src/modules/administracion/pages/EstadoOts.tsx` | autenticada | no |
| `tc_clientes_almacen` | `src/modules/tyrecontrol/services/data.ts:74` | autenticada | no (`.select("*")`) |
| `tc_productos_almacen` | `src/modules/tyrecontrol/services/data.ts:87` | autenticada | no |
| `tc_marcas_contadores` | `src/modules/tyrecontrol/services/data.ts:1567` | autenticada | no |
| `traspasos_auditoria_detalle` | panel ×2 **y `almacen_app`** | **`anon`** en la APK | no |
| `kpis_traspasos` | **ninguno localizado** | — | — |
| `movimientos_stock_detalle` | **ninguno localizado** | — | — |
| `stock_actual` | `src/modules/safety/pages/SafetyDashboard.tsx` | autenticada | no |
| `stock_actual_detalle` | **ninguno localizado** | — | — |
| `tc_modelos_aplicacion_sin_clasificar` | **ninguno localizado** | — | — |
| `tc_tipos_plano_descuadrado` | **ninguno localizado** | — | — |
| `traspasos_detalle` | **ninguno localizado** | — | — |
| `traspasos_lineas_detalle` | **ninguno localizado** | — | — |
| `traspasos_resumen_lineas` | **ninguno localizado** | — | — |

«Ninguno localizado» no es «ninguno»: puede consumirse desde SQL generado o
desde otra vista. Pero **ninguna de las 14 la usa el servidor**, así que ninguna
necesita estar abierta a `anon` salvo `traspasos_auditoria_detalle`.

---

## 6. Sensibilidad de lo expuesto

| Vista | Qué expone | Clasificación |
|---|---|---|
| `traspasos_auditoria_detalle` | **`codigo_personal`** | **Credencial** (ver §7) |
| `adm_ot_estado` | Matrículas, estado y centro de cada OT, nombre de cliente | Datos de negocio y de cliente |
| `tc_clientes_almacen` | Nombre, **NIF**, teléfono y email de cliente | Datos de cliente, identificador fiscal |
| `tc_productos_almacen` | Marca, modelo, medida, DOT | Negocio |
| `tc_marcas_contadores` | Recuentos de catálogo | Bajo, pero **escritura destructiva** |
| las otras 9 | **NO VERIFICADO** | — |

---

## 7. `codigo_personal` · clasificación

**Es una credencial reutilizable.** No es un identificador.

Rastro completo:

1. `almacen_app` pide el código al operario;
2. lo valida contra `perfiles_usuario.codigo_operario`
   (`traspaso_detalle_screen.dart:115`);
3. si coincide, autoriza la operación de traspaso;
4. y lo escribe en la traza:
   `traspasos_auditoria.codigo_personal = codigo.toUpperCase()`
   (`traspaso_detalle_screen.dart:201` y `:300`).

Es el mismo valor que autoriza y el que queda registrado. Quien lo lee puede
suplantar al operario: no caduca, no es de un solo uso y no hay segundo factor.

**Severidad elevada en consecuencia.** Y el agravante: la propia
`almacen_app` lee `traspasos_auditoria_detalle` con la clave `anon`
(`auditoria_screen.dart:46`), de modo que la app que valida por código permite
leer los códigos de todos.

**Aviso importante sobre la corrección:** `traspasos_auditoria` tiene su propia
política `anon_read_auditoria` (`SELECT using (true)`). **Cerrar la vista no
cierra esta exposición**: se leería igual por la tabla. La corrección es del
hallazgo del portal y las credenciales, no de SEC-068.

---

## 8. Propuesta de corrección, vista por vista

Sin aplicar `security_invoker` mecánicamente, como se pidió. Para cada una se
ha mirado quién la consume y qué políticas se ejecutarían al hacerla invoker.

| Vista | Decisión | Por qué |
|---|---|---|
| `adm_ot_estado` | **A + D** · invoker y fuera `anon` | Las políticas de las bases usan `adm_can_read()`, que es **la misma puerta** por la que ya entra la pantalla. Invoker no cambia nada para el usuario legítimo y cierra a `anon` |
| `tc_clientes_almacen` | **C + D** · fuera escritura y fuera `anon`. **Invoker NO** | La vista se cierra con `tc_is_admin()` (TyreControl) y la tabla con `usuario_actual_es_admin()` (Almacén): **dos modelos de administrador distintos**. Con invoker, un admin de TyreControl sin ficha de Almacén vería la pantalla vacía sin ningún error. Conciliarlos es decisión de producto |
| `tc_productos_almacen` | **C + D** · igual. **Invoker NO** | Misma colisión: la tabla exige `usuario_actual_perfil_id() is not null` |
| `tc_marcas_contadores` | **C + D**, urgente | Único consumidor `.select("*")`. Hoy `anon` puede borrar el catálogo |
| `traspasos_auditoria_detalle` | **E** · rediseño por servidor | La consume una APK con `anon` y sin identidad. Y la tabla ya expone lo mismo por su cuenta: cerrar la vista sería cosmético |
| las otras 9 | **pendiente** | Sin definición no se puede decidir. `006_vistas_pendientes.sql` |

`B` (`WITH CASCADED CHECK OPTION`) no se usa en ninguna: ninguna vista necesita
seguir siendo escribible, así que retirar el privilegio es más simple y más
seguro que acotarlo.

---

## 9. La contención preparada

`supabase/migraciones-preparadas/005_contencion_vistas.sql`. **Sin aplicar.**

Cubre las 4 decididas. Resultado medido antes y después, en 17.6:

| Vista | Antes (`anon`) | Después (`anon`) | Panel autenticado |
|---|---|---|---|
| `adm_ot_estado` | lee 1 fila | **denegado** | sigue leyendo |
| `tc_clientes_almacen` | **escribe** | **denegado** | sigue leyendo |
| `tc_productos_almacen` | **escribe** | **denegado** | sigue leyendo |
| `tc_marcas_contadores` | lee y **borra** | **denegado** | sigue leyendo |

Lleva postcheck y vuelta atrás. No toca `traspasos_auditoria_detalle` ni las 9
sin definición.

---

## 10. Qué falta

1. **Las 9 definiciones.** `006_vistas_pendientes.sql`, solo lectura: devuelve
   definición, `is_updatable`, `is_insertable_into`, `check_option`, columnas y
   dueños de las tablas base, de las 14 de una vez.
2. Con eso, completar la matriz y decidir las 9 restantes.

Hasta entonces el inventario está **al 36 %** (5 de 14).

---

## 11. Orden de despliegue

La contención de vistas **no depende de la Fase 0 ni al revés**: ninguna tabla
base de vista está entre las 42 que cierra la Fase D, y ninguna de las 4 vistas
contenidas lee ninguna de esas 42.

Se pueden aplicar en cualquier orden. Y siendo `tc_marcas_contadores` borrable
por `anon` hoy mismo, la recomendación es que **005 vaya antes**: no depende del
despliegue de código de la Fase B, a diferencia de la Fase D.
