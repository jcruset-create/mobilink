# Fases 21 y 22 — Entrega: traslados entre cajas y las pantallas que faltaban

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.43`
- Incluye la integración de `origin/main` (arreglo del arqueo con bolsas y `taller_app` 0.6.0+62).

---

## Fase 21 — Traslado de efectivo entre cajas

La fase 19 sabía **proponer** el traslado y no podía ejecutarlo. El motivo era concreto y quedó
escrito entonces: **en medio del viaje el dinero no está en ninguna de las dos cajas**, y sin un
documento que lo represente se contaría dos veces o ninguna — el doble conteo que cerró la fase 4.
Este es ese documento.

### La regla que lo sostiene

La misma que ya rige los pedidos al banco y las entregas: **los asientos se hacen cuando el dinero se
mueve, no cuando se planea.** Al crear el traslado sale del cajón de origen con su detalle de piezas;
al recibirlo entra en el de destino; en medio, ninguna de las dos lo tiene y el tránsito dice dónde
está y quién lo lleva.

La prueba que lo demuestra es la que importa: origen con 100 €, destino con 50 €, se mandan 40 €.
Durante el viaje **la suma de los dos cajones es 110 €, no 150**. Los 40 € están en tránsito,
contados una sola vez y en un sitio.

Y trae una consecuencia buena: durante el viaje ese dinero no está en el stock teórico de nadie, así
que **el arqueo de la tarde en el taller de origen cuadra sin trucos**.

### Cuatro decisiones

- **Se exige portador.** Es lo primero que se pregunta si el dinero no llega, y un traslado sin
  responsable es un tránsito que nadie reclama.
- **Si llega menos de lo que salió, no se bloquea**: el dinero ya está donde está y negarse a
  registrarlo solo esconde el problema. Se exige motivo y queda auditado con el nombre de quien lo
  llevaba. Misma decisión que el módulo ya tomó con el banco.
- **Se recibe en la caja de destino y en ninguna otra.** Sin esa comprobación, el dinero podría
  entrar en una tercera caja y el traslado quedaría diciendo que llegó a un sitio donde no está.
- **Una caja no se manda dinero a sí misma**, y lo impide un `CHECK` de la tabla: sería un asiento de
  ida y otro de vuelta por el mismo importe, o sea, ruido en el libro mayor.

**El ingest de Central no se tocó**: la proyección de tránsitos ya era agnóstica de la clase, así que
`TRANSFER` encaja junto a los pedidos al banco y las entregas sin una línea nueva.

---

## Fase 22 — Las pantallas que faltaban

Diez fases entregaron API sin sitio donde pulsarla. Tres pantallas nuevas:

**Previsión** reúne tres cosas que se miran juntas: qué caja se queda sin cambio y cuándo hay que ir
al banco, la nota de salud de la red con **lo que le resta a cada caja** —no solo el número—, y los
traslados que ahorrarían un viaje. La explicación de cada predicción va **en la tabla y no escondida
en un icono**: una propuesta que no se entiende no se corrige, se ignora.

**Informes** con el selector de fechas, los cinco indicadores y la descarga del CSV. La descarga es un
enlace normal y no un `fetch`: el navegador se encarga del nombre del fichero y la petición va firmada
por la sesión como cualquier otra.

**Estado** enseña el atasco, no el pulso. Las cuatro colas con su retraso **en tiempo, no en filas**.

### Un detalle de reutilización

Escribí las tarjetas de resumen a mano y el `tsc` avisó: `Card` ya existe en el proyecto con su propia
forma (`title`, `value`, `hint`, `accent`). Se reescribieron para usarla. Es lo correcto, y además es
lo que mantiene las tres pantallas nuevas idénticas a las siete que ya había.

---

## Integración de `main`

`main` traía el arreglo del arqueo con bolsas y `taller_app` en 0.6.0+62, por delante de la rama.
Integrado antes de commitear, como pide `CLAUDE.md`. Dos conflictos:

- **`package.json`**: se toma la versión más alta y se sube — 1.8.43.
- **`cash.integration.test.ts`**: los dos lados añadieron pruebas al final. **Se conservan las dos**:
  159 mías + 2 de `main` = 161, comprobado contando.

---

## Verificación

| Comprobación | Resultado |
|---|---|
| Motor de reparto (unitarias) | 8 / 8 |
| Suite completa, base **migrada** y **recién creada** | **1278 / 1278** en las dos |
| Migración de traslados aplicada dos veces | Sin error |
| `npx tsc` servidor y app | **0 errores** |
| `npm run build` | Correcto |
| ESLint | `server/cash/transfers.ts` sin avisos |

**Sobre ESLint en las pantallas:** las tres nuevas añaden tres avisos de `react-hooks/set-state-in-effect`,
el patrón que usan las 1.027 instancias del resto de `src/`. No son de una clase nueva; seguir el
patrón del proyecto y arreglarlo todo a la vez me parece mejor que dejar tres pantallas distintas de
las demás.

## Lo que queda

- **Pantalla del traslado en la caja**: la API está (`/transfers`), pero enviarlo y recibirlo se hace
  hoy por API. Es la pieza que cierra el circuito con la pantalla de Previsión.
- **Cancelar un traslado**: el estado existe en la tabla; el camino de vuelta no está escrito.
- **Fases 23 a 25**, con la 25 (app móvil) todavía cruzada con **R1**.
