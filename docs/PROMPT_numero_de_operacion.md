# PROMPT — Número de registro para las operaciones

> Documento de diseño para aprobar ANTES de programar. Hay tres decisiones que
> tomar; el resto es aprovechar algo que ya existe a medias.

## El problema, tal y como se ve

En el "Histórico de operaciones" de un vehículo, esto son cuatro líneas
sueltas:

```
2026-08-10 · 16:04   Montaje      NT-2026-000089   E1_IZQ
2026-08-10 · 16:04   Montaje      NT-2026-000088   E1_DER
2026-08-10 · 16:04   Desmontaje   NT-2026-000040   E1_DER   Desgaste
2026-08-10 · 16:03   Desmontaje   NT-2026-000039   E1_IZQ   Desgaste
```

Y no lo son: es **una sola visita al taller** en la que se cambiaron las dos
ruedas del eje 1. Lo mismo con las cuatro del 04-08 a las 18:22.

Hoy no hay forma de decir "el parte 143" por teléfono ni de enseñarle al
cliente qué se hizo en una intervención concreta. El único identificador es un
UUID interno que no se puede ni leer en voz alta.

---

## Lo que ya existe (y es más de lo que parece)

**`tc_intervenciones` ya está creada**, y `operaciones_neumaticos` ya tiene
`intervencion_id`. Cuando el técnico pulsa *Finalizar* en la pantalla de
Cambios, el servidor crea una intervención con bastante información:

| Ya se guarda | |
|---|---|
| Vehículo, técnico, fecha | |
| `resumen` y `resumen_ia` | lo que se hizo, en texto |
| `n_operaciones`, `n_neumaticos`, `tipo_principal` | |
| `inicio_at`, `fin_at`, `duracion_seg`, `trabajo_seg`, `pausa_seg`, `n_pausas` | productividad |
| `montaje_antes` / `montaje_despues` | el plano antes y después |

Y al cerrarla, las operaciones de esa sesión se enlazan con
`update operaciones_neumaticos set intervencion_id = …`.

**Lo que falta es solo el número.** Ni la intervención ni la operación tienen
uno legible. La pieza para generarlo también existe: `tc_generar_numero_interno()`
ya produce `NT-2026-000089` para los neumáticos, con su contador por año en
`tc_contadores_numero_interno`.

---

## Decisión 1 — ¿qué lleva número?

**Recomendación: la INTERVENCIÓN, no cada línea.**

Es lo que pediste ("guardarlas por número de registro y fecha con lo que se ha
hecho en cada operación") y es lo que entiende un cliente por parte de
trabajo. Con las cuatro líneas del ejemplo:

```
OP-2026-000143 · 10/08/2026 · 16:03-16:04 · David
  Cambiadas 2 ruedas del eje 1 por desgaste
  ├─ Desmontaje  NT-2026-000039  E1_IZQ  Desgaste
  ├─ Desmontaje  NT-2026-000040  E1_DER  Desgaste
  ├─ Montaje     NT-2026-000088  E1_DER
  └─ Montaje     NT-2026-000089  E1_IZQ
```

Numerar cada línea suelta daría cuatro números para un mismo trabajo, que es
justo la confusión que hay ahora.

**Pero hay un matiz que no se puede ignorar**: hoy solo tienen intervención las
operaciones que pasan por *Finalizar* en la pantalla de Cambios. Las que se
hacen **desde el panel**, y las que salen de **resolver una incidencia**, se
quedan con `intervencion_id` a null. Si el número vive solo en la intervención,
esas operaciones se quedan sin número — y son las que más rabia dará no poder
citar.

Eso lleva a la decisión siguiente.

## Decisión 2 — ¿qué pasa con las operaciones sueltas?

Tres caminos:

1. **Intervención automática de una sola operación.** Todo lo que se registre
   sin sesión de Cambios crea su propia intervención con una línea dentro. Así
   **todo** tiene número y el histórico es homogéneo: siempre se navega por
   intervenciones. Es más trabajo, pero deja el modelo limpio.
2. **Número también en la operación.** Cada línea lleva su `OP-…` y además, si
   pertenece a una intervención, el número de ésta. Dos numeraciones que
   convivir y explicar.
3. **Solo las intervenciones llevan número**, y lo suelto se queda como está.
   Es lo más barato y lo que menos resuelve.

**Recomendación: la 1.** Es la única que cumple "todas las operaciones tienen
que tener asociado un número" sin inventar dos sistemas de numeración.

## Decisión 3 — el formato

Siguiendo lo que ya hacen los neumáticos (`NT-2026-000089`):

```
OP-2026-000143
```

Prefijo `OP`, año, y seis dígitos con un contador propio por año. Conviene que
el contador sea **de la intervención y no del neumático**: si comparten
contador, los números saltan y parece que faltan partes.

Queda por decidir si el contador es **global** o **por empresa**. Global es más
simple y no delata volumen entre clientes; por empresa hace que cada cliente
vea su serie sin huecos. Recomiendo **global**, como el de los neumáticos, por
coherencia.

---

## Qué habría que tocar

**Base de datos**
- `tc_intervenciones`: columna `numero` única + contador y función
  `tc_generar_numero_intervencion()`, calcada de la de neumáticos.
- Rellenar las intervenciones que ya existen, por orden de `created_at`, para
  que la numeración respete el orden real de los hechos.
- Envolver las operaciones huérfanas en su propia intervención (decisión 2.1),
  también en orden cronológico.

**Servidor**
- `cerrarIntervencion` pide el número al crear la intervención.
- Donde hoy se registran operaciones sueltas, crear su intervención de una
  línea.

**Panel**
- El "Histórico de operaciones" pasa a listar **intervenciones** con su número,
  fecha, técnico y resumen; al abrir una, sus líneas.
- El número, buscable: escribir `OP-2026-000143` y llegar a esa intervención.

**APK**
- La pantalla de histórico, igual: intervenciones con número.
- Al finalizar una operación, enseñar el número asignado. Es el momento en que
  el técnico puede apuntarlo en el albarán.

---

## Qué NO cambia

- Los números de neumático (`NT-…`) siguen igual.
- Nada de lo que ya se guarda en `tc_intervenciones` se toca ni se pierde.
- Las operaciones no se borran ni se fusionan: solo se agrupan.

---

## Lo que hay que vigilar

**El número no se puede repetir ni reutilizar.** Si se genera con un `select
max(numero)+1` habrá duplicados en cuanto dos técnicos finalicen a la vez. Hay
que usar el mismo mecanismo que los neumáticos: una tabla contador con
`insert … on conflict do update … returning`, que es atómica.

**Una intervención que falla a medias no debe quemar un número**, o aparecerán
huecos en la serie y el cliente preguntará por el parte que falta.

**El relleno de lo viejo es la parte delicada.** Hay operaciones desde julio.
Numerarlas por `created_at` es lo correcto, pero conviene hacerlo en una
migración que se pueda ejecutar dos veces sin volver a numerar lo ya numerado.

---

## Criterios de aceptación

1. Toda operación registrada desde hoy pertenece a una intervención con número
   `OP-AAAA-NNNNNN`.
2. Las cuatro líneas del 10-08 de R1234ABC salen bajo un solo número.
3. El histórico del panel y el de la APK listan intervenciones con número,
   fecha, técnico y resumen, y al abrir una se ven sus operaciones.
4. Se puede buscar por número y llegar a la intervención.
5. Las operaciones anteriores tienen número, asignado por orden cronológico.
6. Dos técnicos finalizando a la vez obtienen números distintos.
7. Volver a ejecutar la migración no renumera nada.
