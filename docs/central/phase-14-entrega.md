# Fase 14 — Entrega: conciliación bancaria asistida

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.38`

## Norma 43, no CSV

El extracto se lee en **Norma 43** (cuaderno 43 del CSB/AEB), que es el formato en el que **todos**
los bancos españoles entregan el extracto: Santander, BBVA, CaixaBank, Sabadell y las cajas rurales
exportan el mismo fichero.

Elegir CSV habría significado un lector distinto por banco, y encima cambiándolo cada vez que uno de
ellos moviera una columna. Sin dependencias: el formato es de ancho fijo y las librerías que hay
añaden más superficie de la que ahorran.

**Los importes se leen como enteros.** El campo trae doce dígitos de céntimos sin coma —`000000012345`
son 123,45 €— así que la coma flotante no llega a tocar el dinero en ningún momento.

## Por qué «asistida» y no automática

El casador **propone, no concilia**. Un ingreso de 1.500 € el día 3 y un apunte de 1.500 € el día 3
casi siempre son lo mismo… salvo cuando ese día se hicieron **dos** ingresos de 1.500 €. Conciliar
automáticamente ahí es equivocarse la mitad de las veces sin que nadie lo sepa.

| Situación | Resultado |
|---|---|
| El número del ingreso aparece en el concepto del banco | **ALTA** — no es coincidencia, es identificación |
| Importe igual y fecha cercana, sin competencia | **ALTA** |
| Varias candidatas igual de buenas | **AMBIGUA**, y se enseñan todas |
| Importe igual pero fecha lejos | **BAJA** |

La referencia manda **incluso si el importe no cuadra al céntimo**: una comisión descontada es más
probable que dos números iguales por azar.

Confirmar es siempre de una persona. Lo que hace el casador es que confirmar cueste un clic en vez de
media mañana con dos pantallas abiertas.

## Decisiones

**Un extracto que no cuadra consigo mismo no se guarda.** Saldo inicial + movimientos tiene que dar
el saldo final que declara el banco. Si no, el fichero está incompleto, y conciliar contra medio
extracto da por descuadrado lo que en realidad estaba bien — deshacerlo después cuesta más que volver
a pedirle el fichero al banco.

**Las salidas de dinero ni se miran.** Un ingreso de caja siempre entra en la cuenta; mirar las
salidas solo produciría propuestas absurdas contra comisiones y recibos domiciliados.

**Un ingreso ya conciliado deja de ofrecerse**, y lo garantiza un índice único parcial: ofrecer uno
ya casado es invitar a contarlo dos veces.

**Los apuntes ajenos se descartan con motivo.** Sin eso, la lista de pendientes se llena de
comisiones y nóminas que nunca van a casar con nada, y deja de servir para ver lo que de verdad falta.

## El fallo que cazó una prueba

`node-postgres` entrega las columnas `DATE` como un `Date` en la zona del proceso, así que
`String(fecha).slice(0, 10)` daba **«Fri May 03»** en vez de una fecha. El módulo de caja ya había
tropezado con esto en las jornadas.

Aquí habría sido peor: una fecha ilegible no casa con nada, así que el casador se habría limitado a
decir que no hay pareja — **sin error, sin aviso y sin que nadie sospechara del formato**.

## Verificación

| Comprobación | Resultado |
|---|---|
| Lector de Norma 43 y casador (unitarias, sin BD) | **21 / 21** |
| Suite completa, base **migrada** y **recién creada** | **1227 / 1227** en las dos |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | `server/central` y `server/cash/erp` sin ningún aviso |

Cuatro pruebas de integración además de las puras: importar y proponer; **un extracto que no cuadra
no se guarda**; descartar un apunte ajeno; y un apunte ya conciliado no se puede volver a conciliar.

## Lo que queda

- **Pantalla de conciliación**: la API está (`/statements`, `/matches`, `/reconcile`, `/discard`);
  falta la vista de dos columnas con el botón de confirmar.
- **Confirmar en bloque** todas las de confianza alta, que es lo que ahorra la mañana entera.
- **Varias cuentas por fichero**: hoy se importa la primera. Los ficheros con varias cuentas existen,
  pero conviene ver uno real antes de decidir cómo se presentan.
