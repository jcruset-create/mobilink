# En qué NO se parece staging a producción

**Staging no es una réplica de los permisos de producción, y no debe
presentarse como tal.** El esquema sí es el real —se restaura el DDL de
producción—, pero los *permisos* se construyen aquí a propósito, y en tres
sitios son **más estrictos** que los de producción. Este documento dice
cuáles son, por qué están, y **qué resultados de la validación dependen de
ellos y cuáles no**.

Nada de lo que hay aquí se lleva a producción con esta prueba. Cambiar
cualquiera de las tres cosas en producción es una **revisión aparte**, con su
propio análisis de impacto; ver «Qué habría que decidir», al final.

---

## Las tres diferencias

### 1. Permisos concedidos por nombre, solo en pruebas

| | Producción | Staging |
|---|---|---|
| De dónde salen | los *default privileges* del esquema `public` que configura Supabase al crear el proyecto | [`permisos-pruebas.sql`](permisos-pruebas.sql), objeto por objeto |
| Alcance | **todo** el esquema: las 470 relaciones y las 247 funciones (266 contando sobrecargas), a `anon`, `authenticated` y `service_role` | **97 tablas, 6 vistas y 124 funciones**, repartidas por rol según quién las use. Medido en la base, no supuesto |
| Objetos nuevos | heredan los permisos por *default privileges* (el arranque de Express crea tablas) | **no heredan nada**: los *default privileges* se retiran |
| `EXECUTE` de PUBLIC | PostgreSQL lo concede en cada función nueva; solo **35** de las 247 lo tienen retirado por una migración | retirado en **todas** |
| `anon` | recibe tablas y funciones por los *default privileges* | **ni una tabla ni una vista**; solo las **7** funciones que las migraciones le conceden expresamente (el quiosco del operario y el login por correo) |

Lo aplica el paso 4 y lo comprueba `10-comprobar-permisos.sh`.

### 2. Tres vistas pasadas a `security_invoker`

Una vista se ejecuta con los permisos de su **dueño** salvo que sea
`security_invoker`, así que se salta la RLS de las tablas que lee. Estas tres
las conceden las migraciones a `authenticated`, no son `security_invoker` y
**no filtran por empresa dentro**:

| Vista | Qué enseña de más con permisos del dueño | En staging |
|---|---|---|
| `tc_marcas_contadores` | recuentos de neumáticos y vehículos de **todas** las empresas | `security_invoker = true` → cuenta lo que la RLS del usuario deje ver |
| `tc_tipos_plano_descuadrado` | diagnóstico sobre `tc_tipos_vehiculo` | `security_invoker = true` |
| `adm_ot_estado` | órdenes de trabajo y nombres de cliente del módulo de Administración | `security_invoker = true`; como sus tablas no se conceden en esta prueba, **deja de responder** |

En producción **siguen como están**: con permisos del dueño.

### 3. `productos_neumaticos`, excepción de lectura declarada

Esta tabla **no tiene RLS** —viene del módulo Almacén, fuera de
`supabase/migrations`— y el panel de TyreControl la necesita: el embed
`producto_almacen:productos_neumaticos(...)` de la ficha del vehículo y
`profundidadDibujoPorProducto()`, que lee el catálogo entero sin filtrar por
empresa.

| | Producción | Staging |
|---|---|---|
| RLS | **no** | **no** (igual) |
| `authenticated` | `select, insert, update, delete` por los *default privileges* | **solo `select`** |
| Qué queda a la vista | marca, modelo, medida, dot y activo de **todas** las empresas de almacén | lo mismo |

Es decir: la **exposición de lectura entre empresas existe en los dos sitios**
y es un hallazgo real de producción, no un artefacto de staging. Lo que
staging cierra es solo la **escritura**.

---

## Qué resultados de la validación dependen de estas diferencias

La regla general: **staging es más estricto que producción en permisos**, así
que

- lo que **funciona** en staging funcionará en producción (producción concede
  más), y
- lo que **sale cerrado** en staging **no demuestra** que esté cerrado en
  producción.

Con una excepción importante: lo que cierran las **migraciones** sí viaja,
porque las migraciones se aplican igual en los dos sitios.

### Resultados que NO dependen de las diferencias

Estos valen igual en producción, porque salen de las migraciones y de los
datos, no de los permisos del entorno:

| Resultado | Por qué viaja |
|---|---|
| Todo lo de la importación: recuentos, posiciones, 2+4, los 25 bloqueados, OR como evidencia complementaria | lógica de los RPC y de los datos |
| Kilómetros, intervalos, las dos puertas (km y continuidad), los motivos de exclusión, la cobertura | lógica de la migración de la fase 3 |
| Que deshacer conserve las revisiones humanas y que el contador no vuelva atrás | lógica de los RPC |
| **La auditoría de revisiones no admite escritura directa** | el `revoke insert, update, delete, truncate on tc_reconstruccion_revisiones from authenticated, anon, service_role` está **en la migración de la fase 3**, no en `permisos-pruebas.sql` |
| **Los nueve auxiliares de la importación no los ejecuta `anon` ni PUBLIC** | sus `revoke ... from public, anon` están **en las migraciones** de la fase 1 y la fase 3 |
| **Aislamiento entre empresas** (0 de 580 vehículos, 0 intervalos para un usuario de otra empresa) | lo hacen las **políticas RLS**, que están en las migraciones. Comprobado con `set local role authenticated`, que es como entra el panel |
| Que el servidor arranque y el PDF del parte responda | ahí manda `service_role`, que en producción tiene al menos tantos permisos |

### Resultados que SÍ dependen de las diferencias (no extrapolar)

| Resultado de staging | Qué pasa en producción |
|---|---|
| «**0** funciones del esquema ejecutables por `PUBLIC`» | **falso en producción**: solo 35 de las 247 tienen el `revoke` en una migración; las otras **212** siguen siendo ejecutables por cualquiera que se conecte. Es un hallazgo, no una garantía |
| «`authenticated` no lee `clientes`» (403) | en producción **sí la lee**, por los *default privileges*, y `clientes` no tiene RLS |
| «`authenticated` no escribe en `productos_neumaticos`» (403) | en producción **sí puede** escribir |
| «`anon` no lee ninguna tabla ni vista» (401/403) | en producción `anon` recibe el esquema por los *default privileges* |
| «`tc_marcas_contadores` solo cuenta lo de mi empresa» | en producción cuenta **todas** las empresas |
| «`adm_ot_estado` no responde» | artefacto puro de staging: en producción responde, y sin filtrar por empresa |
| «Las páginas de Seguridad, Presencia, Caja, Asistencia y Administración dan 403» | artefacto de staging: ahí no se les conceden permisos porque no entran en esta prueba |
| Cualquier otro **403 o 401** que aparezca navegando | mirar primero si es una tabla que esta prueba no concede, antes de darlo por un fallo del PR |

### Cómo registrarlo en la validación

En el registro de la prueba, cada resultado de permisos lleva una marca:

- **`[migración]`** — lo cierra una migración: vale también para producción.
- **`[staging]`** — lo cierra `permisos-pruebas.sql` o uno de los dos ajustes
  de vistas/excepción: **no se puede afirmar de producción**.

Y los criterios de aceptación 1 a 14 (importación, kilómetros, lo que no se
toca) son **`[migración]`**; el 15 y el 16 son del entorno y no dicen nada
sobre producción.

---

## Qué habría que decidir, en una revisión aparte

Ninguna de estas tres cosas se toca en producción con este PR. Quedan
anotadas para que se decidan por separado, con su propio análisis:

1. **`productos_neumaticos` sin RLS.** El catálogo de neumáticos de todas las
   empresas de almacén está a la vista de cualquier usuario autenticado, y
   además es escribible. Si se le pone RLS hay que mirar antes qué rompe:
   `profundidadDibujoPorProducto()` lee el catálogo entero sin filtrar, y las
   vistas `tc_productos_almacen` y `tc_clientes_almacen` dependen de ella.
2. **Las tres vistas sin `security_invoker`.** Pasarlas a invoker en
   producción cambia lo que ve cada usuario: `tc_marcas_contadores` dejaría de
   contar las demás empresas, y `adm_ot_estado` necesitaría que sus tablas
   estén concedidas. No es un cambio neutro y no se hace de pasada.
3. **Las 212 funciones ejecutables por `PUBLIC`.** Retirarlo en producción
   es un `revoke` amplio: hay que comprobar antes qué funciones usan las
   políticas RLS, los valores por defecto y los disparadores, exactamente
   como se hizo aquí (la comprobación 10.g de `permisos-pruebas.sql` sirve de
   guion). No se improvisa en caliente.

**Mientras tanto: staging no demuestra nada sobre estos tres puntos en
producción.**
