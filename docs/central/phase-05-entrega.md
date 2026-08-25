# Fase 5 — Entrega: ciclo de ingresos bancarios y asignación de origen

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.29`

## La pregunta que ahora tiene respuesta

**Cuando el banco apunta un abono de 3.480 €, ¿de qué días y de qué caja salió ese dinero?**

Un ingreso bancario no es un importe suelto: agrupa los cierres de varios días de una caja. Central
recibe ahora ese desglose —qué jornada puso cuánto y de qué fecha era— y lo guarda en
`central_deposit_sources`. **Sin el desglose, conciliar con el extracto es adivinar.**

Y la otra cara, que es la que se mira a diario: **qué hay cerrado y todavía no ha ido al banco**, por
caja y desde cuándo. 400 € esperando desde ayer es la operativa normal; los mismos 400 € desde hace
tres semanas son dinero en el cajón de una tienda, y eso ya es otra cosa. La pantalla pone lo
pendiente arriba por ese motivo: un listado de ingresos es historia, lo pendiente es hoy.

## Decisiones

**El origen va en su propia tabla, no como JSON dentro del ingreso.** La pregunta que de verdad se
hace es la inversa —«esta jornada, ¿en qué ingreso acabó?»— y esa no se contesta con un campo JSON.

**Los anulados salen, marcados.** Aquí no se borra nada, misma regla que en la caja: un ingreso que
existió y se anuló es justo lo que alguien va a buscar el día que el extracto no cuadre. Deja de
sumar, pero consta, y su desglose de origen se queda.

**Compatibilidad con los eventos ya emitidos.** Los eventos de alta de ingreso escritos en las fases
3 y 4 llevan solo la lista de ids de cierre, sin importes ni fechas — y **siguen en la cola**. La
ingesta acepta las dos formas: si viene el desglose lo usa, y si no, registra las jornadas sin
importe. Un evento es un hecho del pasado: el formato puede crecer, pero lo ya escrito no se
reescribe. Hay una prueba con el formato viejo, para que nadie lo rompa sin enterarse.

## Qué se tocó

| Fichero | Qué |
|---|---|
| `supabase/migrations/central_fase5_ingresos.sql` | Nuevo: `central_bank_deposits` y `central_deposit_sources` |
| `server/cash/bankdeposits.ts` | El alta y la anulación llevan el origen desglosado y los remanentes |
| `server/central/schema.ts`, `ingest.ts` | Tablas y proyección, con las dos formas del evento |
| `server/central/queries.ts` | `ingresosEnRed` y `pendienteDeIngresar` |
| `server/central/router.ts` | `GET /deposits` |
| `src/modules/central/**` | Pantalla «Ingresos» |
| `server/central/central.integration.test.ts` | Dos pruebas |

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** | **1137 / 1137** |
| Suite completa, base **recién creada** | **1137 / 1137** |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA (1.8.29) |
| ESLint sobre lo nuevo | Backend **sin avisos**; un aviso más en `CentralApp.tsx`, el patrón de siempre |

La prueba que recorre el ciclo entero: un día que cobra 40 €, los aparta al cerrar, aparecen como
pendientes, se registra el ingreso con su referencia y **llegan a Central sabiendo de qué jornada
salieron y cuánto puso** — y dejan de contarse como pendientes.

## Lo que queda

- **Conciliación con el extracto** (fase 14): esto deja el origen preparado, pero nadie compara
  todavía contra lo que dice el banco.
- **Alertas de retraso** (fase 7): la pantalla enseña los días de espera; avisar es otra fase.
