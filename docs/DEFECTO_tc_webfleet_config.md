# Defecto funcional · `tc_webfleet_config` no existe en producción

**No es un hallazgo de seguridad.** Se documenta aparte a propósito, para no
mezclarlo con la auditoría. Se ha comprobado además que el fallo no introduce
ningún problema de seguridad: ver §3.

---

## 1. Los hechos

| | |
|---|---|
| En el repositorio | `supabase/migrations/tyrecontrol_webfleet_config.sql` crea `public.tc_webfleet_config`, con RLS y una política |
| En producción | **La tabla no existe.** No aparece entre las 437 de `public` ni entre las vistas |
| Conclusión | Esa migración nunca se aplicó |

Comprobado el 2026-09-27 con la consulta `objetos_pendientes`, que buscaba el
nombre en `pg_class` sin filtrar por esquema ni por clase: no hay nada con ese
nombre en ninguna parte.

## 2. Qué depende de ella

| Fichero | Uso |
|---|---|
| `server/tyrecontrol/webfleetCredenciales.ts` | lee la configuración de Webfleet |
| `server/index.ts` | la usa a través del anterior |
| `src/modules/tyrecontrol/services/data.ts` | el panel |

La integración con Webfleet está rota en producción, y lo está desde que se
escribió ese código. No es una regresión reciente.

## 3. Por qué no es un problema de seguridad

Lo que importa aquí es qué hace el código cuando la tabla no está. El cliente de
Supabase devuelve error, no una fila vacía ni un valor por defecto, así que:

- **no hay fallback a credenciales embebidas ni a un valor por defecto**;
- **no hay apertura**: sin configuración, la integración no llama a ninguna parte;
- el fallo es hacia el lado cerrado.

Si el código hubiera tenido un `catch` que siguiera adelante con credenciales
por defecto, sería otra cosa. No es el caso.

## 4. Qué hacer

Dos opciones, y hay que elegir a la vista de si la integración se usa:

1. **Aplicar la migración** que está en el repositorio, si Webfleet se usa o se
   va a usar. Es `create table if not exists`: es inocua.
2. **Retirar el código** si la integración está abandonada. Hoy es código muerto
   que además confunde al leer el repositorio, porque parece una función viva.

No se propone ninguna de las dos sin saber cuál es el caso. La pregunta es de
producto, no técnica.

## 5. El otro, de paso

`backups_sistema` tampoco existe en producción, y
`src/modules/almacen-neumaticos/pages/SistemaAlmacen.tsx` la lee. Es el mismo
tipo de defecto: la pantalla falla en silencio. Mismo tratamiento.
