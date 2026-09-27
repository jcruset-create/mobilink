# Incidencia · «Multiple GoTrueClient instances detected»

> **CORREGIDA EN CÓDIGO · 2026-09-27 · pendiente de despliegue (Fase B).**
> Hay un único cliente Supabase en `src/services/supabaseCliente.ts` y los tres
> módulos lo reexportan. 15 pruebas nuevas lo fijan. Ver §5 y §7.

Registrada aparte, como se pidió. **No es ruido: es la explicación más
probable del token de sesión roto** que hizo fallar el smoke test del
2026-09-27.

---

## 1. El hecho · situación ANTES de la corrección

Esta sección describe el estado del que se partió, que es el que sigue en
producción hasta que se despliegue la Fase B. El panel creaba **tres** clientes
de Supabase independientes:

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

| Observación | Causa | Estado tras medirlo |
|---|---|---|
| `adm_ot_estado` vacía con `security_invoker` | se atribuyó a `auth.uid()` nulo → `adm_can_read()` falso → 0 filas sin error | **DESCARTADO.** `015` midió la tabla: `adm_work_orders` tiene **0 filas**. La pantalla decía la verdad y la sesión no tenía nada que ver |
| `tc_informes_kpis` → HTTP 500 | Es `security invoker` y su `grant execute` es solo para `authenticated`: sin JWT, PostgREST atiende como `anon` | **Hipótesis en pie**, sin confirmar. Se comprueba en la ventana de observación de la Fase B |
| `Invalid Refresh Token` | Esto | **Confirmado** como defecto propio, con causa en el código |

**Corrección de esta ficha.** La versión anterior daba por hecho que la sesión
inestable explicaba las tres observaciones. Explicaba una. La de `adm_ot_estado`
se descartó contando filas, después de tres hipótesis fallidas —falta del rol
`tecnico`, superadmin sin fila en `adm_usuarios`, y esta—, y conviene que quede
escrito: encadenar síntomas a una causa plausible antes de medirla costó tres
vueltas. Ver `docs/MEDICION_estado_ots.md`.

Lo que sí es cierto es que **llevó a una restauración mínima que no hacía falta**
(`reset (security_invoker)`), luego revertida por `014`.

---

## 4. Por qué también es un problema de seguridad, y no solo de comodidad

Una sesión que se cae sola no es solo molesto:

- **Empuja a diagnósticos equivocados.** Ya ha pasado: tres hipótesis
  descartadas y una restauración mínima que reabrió el bypass de
  `authenticated` durante unas horas, sin arreglar nada.
- **Enmascara fallos de autorización.** Un «0 filas» por sesión rota es
  indistinguible de un «0 filas» por permiso denegado. Cualquier verificación
  de RLS hecha con una sesión inestable no es fiable.
- Y en una aplicación que acredita formación y firma documentos, perder la
  sesión a mitad de una operación no es inocuo.

---

## 5. La corrección · **implementada el 2026-09-27**

Un solo cliente, compartido. El único `createClient` del front web vive en
`src/services/supabaseCliente.ts`:

```ts
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

Y los tres módulos lo reexportan, en vez de crear el suyo:

```ts
// src/modules/administracion/services/supabase.ts  (y tyrecontrol, y almacen-neumaticos)
export { supabase } from "../../../services/supabaseCliente";
```

### Decisiones de la implementación, y por qué

| Decisión | Motivo |
|---|---|
| **Se conservan los tres ficheros** como reexportadores en vez de borrarlos | Apuntan 80 imports repartidos por todo el front. Reexportar no cambia el contrato público: `import { supabase } from ".../administracion/services/supabase"` sigue funcionando y devuelve la instancia única. Reescribir 80 imports es ruido en un despliegue de seguridad |
| **No se pasan opciones a `createClient`** | Las tres llamadas anteriores tampoco las pasaban. Así `persistSession`, `autoRefreshToken`, `flowType` y la `storageKey` derivada de la URL quedan **exactamente** como estaban: este cambio colapsa tres instancias en una y no toca el modelo de Auth |
| **El fichero nuevo va en `src/services/`, no en `src/modules/`** | No pertenece a ningún módulo; los tres dependen de él. Ponerlo dentro de uno crearía una dependencia de `tyrecontrol` hacia `administracion` sin motivo |
| **No hay ciclos de imports** | `supabaseCliente.ts` no importa nada del proyecto, sólo `@supabase/supabase-js`. Las flechas van módulo → servicio y nunca al revés |

Es un cambio de código, no de base de datos, así que **entra en la Fase B** y
necesita despliegue. En producción sigue habiendo tres instancias hasta que se
despliegue.

### Lo que NO hay que hacer

Dar a cada cliente un `storageKey` distinto. Eso quita el warning y **rompe el
SSO entre módulos**: cada uno tendría su propia sesión y habría que entrar tres
veces. El problema no es que compartan el almacenamiento; es que son tres.

---

## 6. Comprobación posterior al despliegue

Cuando se despliegue el cliente único, **en una pestaña nueva** (una pestaña ya
abierta conserva el bundle viejo y sus tres instancias):

1. El warning `Multiple GoTrueClient instances detected` desaparece de la consola.
2. Entrar en `/administracion` y navegar a `/tyrecontrol` y `/almacen` **sin
   volver a autenticarse**: el SSO tiene que seguir funcionando. Si alguno pide
   login otra vez, el cambio ha roto lo que venía a proteger.
3. En **Application → Local Storage**, una sola clave `sb-<ref>-auth-token`.
4. Dejar el panel abierto más de una hora —el token caduca al cabo— y navegar
   entre los tres módulos. No debe aparecer `Invalid Refresh Token`.
5. `tc_informes_kpis` debe seguir respondiendo 200 después de ese rato. Si el 500
   de §3 era la petición atendida como `anon`, aquí es donde se confirma.

Está recogido como smoke test 4 de la Fase B en
`docs/RUNBOOK_seguridad_fase0.md` §B.3.

---

## 7. Las pruebas que lo fijan

`src/services/supabaseCliente.test.ts` · **15 pruebas**, en dos grupos que no
conviene confundir:

**Guardas estáticas** (leen el fuente de `src/` con `import.meta.glob`, sin
comentarios). Detectan que alguien **vuelva a añadir** una instancia; no
demuestran comportamiento:

| Qué fija |
|---|
| Hay **exactamente un** fichero en `src/` que llama a `createClient`, y es `services/supabaseCliente.ts` |
| Lo llama **una sola vez** |
| Nadie más en `src/` importa `createClient` de `@supabase/supabase-js` |
| Los tres módulos reexportan la instancia y **no mencionan** `createClient` |
| Ningún fichero que hable con supabase-js introduce una `storageKey` propia |
| El cliente compartido **no pasa opciones** a `createClient` |

**Comportamiento** (montan la instancia real con `fetch` interceptado). La
identidad de objetos sola no bastaría: dos instancias sobre el mismo almacén
también «parecen» compartir sesión al leerla, y aun así se pisan al refrescar:

| Qué demuestra |
|---|
| Los tres módulos devuelven la **misma** instancia, y el mismo `auth` |
| Se ha construido **un solo `GoTrueClient`**: se lee el contador estático `GoTrueClient.nextInstanceID` de auth-js, que es el que dispara el warning. Antes valía 3; ahora `[1]`, con `instanceID === 0`. Es la medida directa del defecto, no un proxy |
| Hay **una sola clave de almacenamiento**, compartida |
| Hay **un solo temporizador de refresco** (`autoRefreshTicker`), no uno por módulo. Era la causa de la rotación cruzada |
| **Entrar por Administración deja sesión en TyreControl y Almacén** |
| Sólo se pide **un** token: no hay tres módulos autenticándose por separado |
| **Salir por TyreControl deja sin sesión a Administración y Almacén** |

Las guardas estáticas se limitan a los ficheros que importan de supabase-js a
propósito: `storageKey` es un nombre corriente y en `src/` ya se usa para cosas
que no son Auth (la clave de `localStorage` del standby automático, un campo de
los formularios de OR manuales). Mirar todo `src/` habría convertido la guarda en
una prohibición de esa palabra.
