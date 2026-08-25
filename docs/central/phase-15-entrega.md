# Fase 15 — Entrega: observabilidad, respaldo y recuperación

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.39`

## El hallazgo: el respaldo no guardaba nada del dinero

`server/backup-postgres.ts` existe, se ejecuta y termina bien. Vuelca seis tablas —`techs`, `jobs`,
`logs`, `rules`, `quick_templates`, `job_assignments`— a un JSON.

**Ninguna de ellas tiene dinero.** En la base hay **42 tablas `cash_*` y `central_*`** y el respaldo
cubría **cero**: ni una jornada, ni un arqueo, ni un movimiento del libro mayor, ni una línea de
auditoría.

No era un descuido evidente, y por eso costó verlo: la copia existe y no da error. Simplemente no
guarda lo que hoy importa.

## Por qué `pg_dump` y no ampliar la lista de tablas

Se pueden añadir cuarenta y dos nombres a un array. Lo que no se arregla así:

- **Un volcado por filas no guarda el esquema.** Restaurar sobre una base vacía no reconstruye
  tablas, índices ni CHECK — y este módulo apoya invariantes en ellos: la ecuación del ingreso
  bancario, el índice único de la forma de pago en efectivo, la inmutabilidad de la auditoría.
  Restaurar sin eso da una base que **parece** la misma y no lo es.
- **Insertar fila a fila respeta el orden de las claves ajenas o falla**, y ese orden ya no cabe en
  la cabeza de nadie con este esquema.
- **Las secuencias no vuelven a su sitio**, así que el primer documento emitido después de restaurar
  chocaría con uno que ya existe.

`pg_dump --format=custom` guarda esquema, datos, índices y secuencias, y viene con PostgreSQL.
`npm run db:dump` y `npm run db:restore`.

## El ensayo de restauración, hecho de verdad

Una copia sin ensayo es una copia que no se sabe si sirve. Se hizo el ensayo completo — copia de una
base con datos, restauración en una base nueva y comparación:

| Comprobación | Original | Restaurada |
|---|---|---|
| `cash_sessions` | 6.110 | **6.110** |
| `cash_operations` | 11.624 | **11.624** |
| `cash_denomination_movements` | 55.240 | **55.240** |
| `app_auditoria` | 5.373 | **5.373** |
| Suma del libro mayor | 2.888.585,77 € | **2.888.585,77 €** |

Y lo que demuestra el argumento de arriba: en la base restaurada **la auditoría sigue siendo
inmutable** (el `UPDATE` se rechaza), **el CHECK de la ecuación del ingreso bancario sigue ahí**, y
**las secuencias no arrancan de cero**. Nada de eso habría sobrevivido a un volcado por filas.

**Restaurar exige una base vacía**, y no es una limitación: `pg_restore --clean` borraría lo que hay
antes de escribir, y con una copia incompleta el resultado sería una base a medias sin original al
que volver. Se restaura en una nueva y se cambia el destino cuando se ha comprobado.

## Observabilidad: medir el atasco, no el pulso

`GET /api/central/health` no contesta `ok: true`. Un servicio que dice «ok» con ocho mil eventos sin
enviar miente con la verdad: el proceso vive, pero el sistema no funciona.

Las cuatro colas —eventos hacia Central, avisos, webhooks y sincronización con la ERP— fallan de la
misma manera: **en silencio y creciendo**. La caja sigue cobrando y las pantallas siguen pintando;
lo único que pasa es que Central se queda atrás.

**El retraso se mide en tiempo, no en filas.** Cien pendientes de hace treinta segundos es una tarde
normal; tres desde hace dos días es una integración rota, y el número de filas solo no distingue una
cosa de la otra. Y **una fila en error terminal es atasco desde el minuto uno**, por muy reciente y
por muy poquitas que sean: no se resuelve sola.

La consulta **nunca revienta**: si una cola no responde, sale como atascada y las demás se siguen
midiendo. Es la pantalla a la que se va cuando algo va mal, y que se caiga entera justo entonces es
lo contrario de lo que hace falta.

Va con permiso de lectura, no de administración: quien atiende la bandeja tiene que poder ver si lo
que falla es una caja o es que la cola lleva dos días parada.

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1230 / 1230** en las dos |
| Ensayo de copia y restauración | Recuentos e importes idénticos; invariantes vivos |
| `npx tsc` | Correcto |
| ESLint | Sin avisos |

Una prueba de la suite tuvo que reescribirse: afirmaba que el estado global era `OK`, y eso depende
de lo que hayan dejado las demás pruebas en las colas. Era **un verde que se rompía según el orden de
ejecución**, así que ahora comprueba la forma del informe y deja el veredicto a las dos pruebas que
sí controlan su cola.

## Lo que esto NO es, y hay que decirlo

**No es una política de respaldo.** Ejecutar `db:dump` a mano de vez en cuando no protege de nada.
Hace falta que corra solo, que la copia **salga de la máquina** —el disco de Render es efímero— y que
el ensayo se repita cada cierto tiempo. Lo que esta fase aporta es la herramienta y la prueba de que
funciona; la política es una decisión que no me corresponde tomar.

RPO y RTO propuestos, para cuando se decida: **RPO ≤ 24 h** con copia diaria fuera de la máquina, y
**RTO ≤ 1 h**, que es lo que tarda el ensayo que se ha hecho aquí. Para MC Local el RPO real es 0 en
lo asentado: la verdad está en el libro mayor y Central es derivable.

## Lo que queda

- **Que la copia salga de la máquina** (Supabase Storage o similar) y corra sola.
- **Pantalla de estado** en Central: la API está, falta enseñarla.
- **Una regla de atasco** en el motor de la fase 7, para que la cola parada abra incidencia y avise
  sola en vez de esperar a que alguien mire.
