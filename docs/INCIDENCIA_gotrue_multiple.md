# Incidencia · «Multiple GoTrueClient instances detected»

Registrada aparte, como se pidió. **No es ruido: es la explicación más
probable del token de sesión roto** que hizo fallar el smoke test del
2026-09-27.

---

## 1. El hecho

El panel crea **tres** clientes de Supabase independientes:

| Fichero |
|---|
| `src/modules/tyrecontrol/services/supabase.ts:10` |
| `src/modules/administracion/services/supabase.ts:10` |
| `src/modules/almacen-neumaticos/services/supabase.ts:14` |

Los tres con la misma forma:

```ts
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

**Ninguno pasa opciones de `auth`.** Ni `storageKey`, ni `persistSession`, ni
`autoRefreshToken`.

---

## 2. Por qué eso rompe la sesión

Sin `storageKey` propio, los tres usan el mismo por defecto
(`sb-<ref>-auth-token`) y escriben en el mismo `localStorage`. Y sin
`autoRefreshToken: false`, **los tres arrancan su propio temporizador de
refresco**.

El refresco de Supabase **rota** el token: al usarlo, el anterior queda
invalidado. Con tres clientes compitiendo:

1. El cliente A refresca y guarda el token nuevo.
2. El cliente B, que tenía el anterior en memoria, refresca con él.
3. Ese token ya no vale → **`Invalid Refresh Token / Refresh Token Not Found`**.
4. B borra la sesión del almacenamiento, y los tres se quedan sin ella.

Es exactamente el error que se observó, y explica por qué aparece de forma
intermitente: depende de que dos temporizadores coincidan.

---

## 3. Lo que provocó

Con la sesión caída, las peticiones salen sin JWT válido. Eso encadena las
tres cosas del 2026-09-27:

| Observación | Causa |
|---|---|
| `adm_ot_estado` vacía con `security_invoker` | `auth.uid()` nulo → `adm_can_read()` falso → 0 filas, **sin error** |
| `tc_informes_kpis` → HTTP 500 | Es `security invoker` y su `grant execute` es solo para `authenticated` |
| `Invalid Refresh Token` | Esto |

Y llevó a revertir un cambio de seguridad que probablemente estaba bien.

---

## 4. Por qué también es un problema de seguridad, y no solo de comodidad

Una sesión que se cae sola no es solo molesto:

- **Empuja a diagnósticos equivocados.** Ya ha pasado: dos hipótesis
  descartadas y una restauración mínima que reabrió un bypass.
- **Enmascara fallos de autorización.** Un «0 filas» por sesión rota es
  indistinguible de un «0 filas» por permiso denegado. Cualquier verificación
  de RLS hecha con una sesión inestable no es fiable.
- Y en una aplicación que acredita formación y firma documentos, perder la
  sesión a mitad de una operación no es inocuo.

---

## 5. La corrección propuesta · **no implementada**

Un solo cliente, compartido:

```ts
// src/modules/supabaseCliente.ts
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(url, anonKey);
```

Y que los tres módulos lo reexporten, en vez de crear el suyo:

```ts
// src/modules/administracion/services/supabase.ts
export { supabase } from "../../supabaseCliente";
```

Es un cambio de código, no de base de datos, así que entra en la Fase B y
necesita despliegue. **No lo he implementado**: no hay autorización para tocar
código ahora.

### Lo que NO hay que hacer

Dar a cada cliente un `storageKey` distinto. Eso quita el warning y **rompe el
SSO entre módulos**: cada uno tendría su propia sesión y habría que entrar tres
veces. El problema no es que compartan el almacenamiento; es que son tres.

---

## 6. Comprobación posterior

Cuando se despliegue el cliente único:

1. El warning desaparece de la consola.
2. Dejar el panel abierto más de una hora —el token caduca al cabo— y navegar
   entre los tres módulos. No debe aparecer `Invalid Refresh Token`.
3. `tc_informes_kpis` debe seguir respondiendo 200 después de ese rato.
