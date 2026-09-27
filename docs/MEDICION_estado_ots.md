# `adm_ot_estado` vacía · cómo medirlo

Estado: `014` aplicada, postcheck 5/5, sesión válida, y la pantalla sigue
vacía. **No revertir `014`.**

---

## 0. Lo primero, porque no lo he comprobado nunca

La pantalla dice literalmente **«No hay órdenes de trabajo»**. Y `EstadoOts.tsx`
distingue error de vacío:

```ts
if (err) setError(err.message);
else setOts((data ?? []) as OtEstado[]);
```

O sea: **cero filas, sin error**. Con los permisos ya descartados por el
postcheck de 014, un cero sin error lo producen dos cosas: la RLS filtrando, o
que **no haya ninguna orden de trabajo**.

Nunca hemos comprobado que esa tabla tenga datos. En todo el hilo se ha dado por
hecho que la pantalla «funcionaba antes», pero revisando lo que está escrito, lo
que se registró el 27 fue *«después queda mantenido el acceso funcional
previo»* — que no dice que aparecieran OTs.

**Por eso añado un caso E a tu lista**, y va primero por ser el más barato:

| | |
|---|---|
| A | `adm_can_read()` falso para la sesión |
| B | `adm_can_read()` cierto pero 0 filas visibles en `adm_work_orders` |
| C | Hay filas, pero el INNER JOIN con `adm_customers` las elimina |
| D | Otra política o filtro adicional |
| **E** | **`adm_work_orders` está vacía y no hay nada que ver** |

Si es E, no hay ningún fallo de autorización que investigar, `014` se queda
puesta —cierra el bypass igual— y llevamos tres rondas persiguiendo un fantasma.

---

## 1. Medición desde el editor SQL · resuelve C, D y E

`supabase/migraciones-preparadas/015_medir_estado_ots.sql`, solo lectura.

El editor entra como `postgres`, que es el dueño de las tablas y **no pasa por
la RLS**, así que sus recuentos son los totales reales. Devuelve:

| Campo | Para qué |
|---|---|
| `totales_reales` | Filas reales de `adm_work_orders`, `adm_customers` y de la vista → **resuelve E** |
| `integridad_del_join` | OTs con cliente existente, con `customer_id` nulo, y huérfanas → **resuelve C** |
| `politicas` y `politicas_restrictivas` | Todas las políticas de las dos tablas. Una `RESTRICTIVE` se combina con AND y puede anular a las demás → **resuelve D** |
| `force_rls` | Si estuviera activo, ni el dueño se salta la RLS |
| `evaluacion_por_usuario` | El predicado de `adm_can_read()` evaluado con cada id como literal → **acota A** |
| `veredicto` | La conclusión, donde se puede dar sin la sesión |

Probada contra 17.6 en los dos escenarios: con datos dice «A o B, hace falta la
medición del navegador»; con la tabla vacía dice «E».

---

## 2. Medición desde el navegador · resuelve A y B

Solo hace falta **si el editor dice «A o B»**. Se ejecuta en la consola del
navegador, con el panel abierto y la sesión activa.

Todo son lecturas. **No imprime el token ni ninguna credencial.**

```js
// Pegar en la consola con /administracion/estado-ots abierta.
// Reutiliza el cliente del módulo a través de su import dinámico.
const { supabase } = await import('/src/modules/administracion/services/supabase.ts');

const r = {};
r.can_read   = (await supabase.rpc('adm_can_read')).data;
r.rol_actual = (await supabase.rpc('adm_rol_actual')).data;
r.mi_uuid    = (await supabase.auth.getUser()).data.user?.id ?? '(sin sesión)';
r.work_orders = (await supabase.from('adm_work_orders').select('*', { count: 'exact', head: true })).count;
r.customers   = (await supabase.from('adm_customers').select('*', { count: 'exact', head: true })).count;
r.ot_estado   = (await supabase.from('adm_ot_estado').select('*', { count: 'exact', head: true })).count;
console.table(r);
```

**Si el import dinámico no funciona** —en producción el bundle está compilado y
esa ruta no existe—, la alternativa sin código es la pestaña **Red**:

1. Abrir `/administracion/estado-ots` con la pestaña Red abierta.
2. Buscar la petición a `.../rest/v1/adm_ot_estado?select=*...`
3. Mirar **el código de estado** y **el cuerpo de la respuesta**.

| Lo que se vea | Qué significa |
|---|---|
| **200** con `[]` | Cero filas sin error → B o E |
| **401 / 403** | La sesión no llega como se cree → volvemos a A |
| **500** con mensaje de permiso | Falta un grant, no una política |

Y en la misma pestaña, repetir con `.../rest/v1/adm_work_orders?select=id&limit=1`
escrito a mano en la barra de direcciones **no sirve**: sin la cabecera
`Authorization` iría como `anon`. Tiene que ser la petición que hace la
aplicación.

---

## 3. Cómo se lee el resultado

| Editor SQL dice | Navegador dice | Conclusión |
|---|---|---|
| `adm_work_orders = 0` | — | **E.** No hay fallo. `014` se queda, y se cierra el asunto |
| Hay OTs, `ots_con_cliente_existente = 0` | — | **C.** El INNER JOIN las elimina. Se corrige el JOIN o los datos |
| Hay `politicas_restrictivas` | — | **D.** Esa política es la que filtra |
| Hay datos y el JOIN es sano | `can_read = false` | **A.** La sesión no resuelve a un usuario autorizado. Comparar `mi_uuid` con los tres de `adm_usuarios` |
| Hay datos y el JOIN es sano | `can_read = true`, `work_orders = 0` | **B.** La política deja pasar pero no hay filas visibles. Caso raro: habría que mirar `qual` con lupa |
| Hay datos y el JOIN es sano | `can_read = true`, `work_orders > 0`, `ot_estado = 0` | **C por RLS**: `adm_work_orders` visible pero `adm_customers` no, y el JOIN las elimina |

Esa última fila es la que tu intuición apuntaba —que `adm_customers` carga y el
problema esté en `adm_work_orders`—, y se distingue de las demás porque
`work_orders > 0` y `ot_estado = 0` a la vez.

---

## 4. Lo que NO voy a hacer

Proponer otra corrección. Llevo dos hipótesis falsas, las dos por explicar el
síntoma desde el código antes de medir. Esta vez el orden es: medir, y después
proponer.
