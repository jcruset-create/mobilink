# Proponer la sección a partir del ticket: gasolinera o taller

Prompt de trabajo. **No hay nada programado de esto todavía**: esto es lo que
habría que hacer y, sobre todo, lo que NO.

## 1. Lo que se pide

Con dos negocios en la misma caja, el error caro es teclear un cobro de
gasolinera con el taller puesto. La pantalla de Cobros ya lo sabe —por eso el
panel entero se pone rojo con la gasolinera seleccionada— pero **recuerda la
última sección usada** (`cash.ultima-seccion`), y esa memoria es justo lo que
crea el fallo: se registra un cobro de taller, el chip se queda en Taller, y el
siguiente ticket de gasoil entra en Taller por inercia.

Lo pedido, en las palabras del usuario:

> Todos los que tengan el mismo patrón tienen que ser de gasolinera, aunque lo
> escaneemos en cobros taller tiene que proponer cobro gasolinera
> automáticamente. También si en cobros gasolinera entramos una factura que no
> tiene este formato, es cobro de taller.

## 2. Los dos tickets de referencia

Reales, del 17/09/2026, del mismo surtidor. Sirven de caso de prueba con sus
cifras, igual que el cierre del 10/09 sirve para el cotejo con el ERP.

```
E.S CONFORTAUTO                     E.S CONFORTAUTO
c/ COURE 27                         c/ COURE 27
CP 43006 TARRAGONA                  CP 43006 TARRAGONA
A43044379                           A43044379

17/09/2026 11:40:29  TPV1           17/09/2026 18:05:37  TPV1
Factura Simplificada (1) T5-155     Factura Simplificada (1) T5-157
Unid   S/M   Descripción            Precio  Importe
27.55  02/1  GAS-OIL A DIESEL       1.815   50.00
                                    27.35  03/1  GAS-OIL A DIESEL  1.828  50.00
TIPO: IVA   Base      Cuota
21 %        41.32 €   8.68 €
SUBTOTAL:   50.00

TOTAL PAGAR:  50.00 €               TOTAL PAGAR:  50.00 €
Efectivo      50.00 €               BBVA          50.00 €
ENTREGADO:    50.00 €               ENTREGADO:    50.00 €
CAMBIO:        0.00 €               CAMBIO:        0.00 €

Le atendió:   JORDI.                Le atendió:   JORDI.
GRACIAS POR SU VISITA
[pie RGPD ... protecciondedatos@gruposoledad.net]
-- DUPLICADO --                     (sin DUPLICADO)
```

## 3. Qué hace de esto un ticket de gasolinera

De más fiable a menos. Lo importante no es la lista, es **que sean señales
independientes**: la fuerza de la propuesta sale de cuántas coinciden, no de
haber acertado con una.

| # | Señal | Fuerza | Por qué |
|---|---|---|---|
| 1 | CIF del emisor `A43044379` | fuerte | Identifica el establecimiento. No se parece a nada por casualidad |
| 2 | Nombre empieza por `E.S` | fuerte | «Estación de Servicio». El taller no se llama así |
| 3 | Columna `S/M` con patrón `NN/N` (`02/1`, `03/1`) | fuerte | Surtidor/manguera. Esto **solo lo imprime un surtidor** |
| 4 | Línea de producto de combustible (`GAS-OIL A DIESEL`) | fuerte | Contra catálogo configurable: GASOIL, GASÓLEO, DIESEL, GASOLINA, SP95, SP98, ADBLUE… |
| 5 | Precio unitario con **tres** decimales (`1.815`) | media | El combustible se cotiza a milésimas. Un recambio, no |
| 6 | Serie del documento `T5-` | media | Convención de este TPV, no una ley |
| 7 | Terminal `TPV1` | media | El taller factura por Genes (`B2_26/611`), no por TPV |
| 8 | Pie `Le atendió:` + `GRACIAS POR SU VISITA` | débil | Cualquiera puede imprimirlo |
| 9 | `Factura Simplificada` | **no vale** | El taller también las emite. Si esto contara, clasificaría mal a diario |

Las señales 3 y 5 son las que más me gustan: son **estructurales**. No dependen
de cómo se llame hoy la estación ni de qué serie use su TPV, así que sobreviven
a un cambio de rótulo o de numeración.

## 4. Las dos comprobaciones que hacen que esto se pueda usar

Lo que convierte una lectura por modelo en algo con lo que se puede contar no
es el prompt: son las cuentas que se pueden rehacer. Aquí hay dos, y una es
exacta:

| Comprobación | Tolerancia | Con los tickets |
|---|---|---|
| `base + cuota = total` | **exacta, en céntimos** | 41,32 + 8,68 = 50,00 ✓ |
| `litros × precio ≈ importe` | ±2 céntimos | 27,55 × 1,815 = 50,003 → 50,00 ✓ |

La primera es exacta porque el TPV la calcula él: si no cuadra al céntimo, algo
se ha leído mal. La segunda necesita margen porque el surtidor redondea.

**Si la primera falla, la lectura no vale** y no se propone nada — ni sección,
ni importe. Es lo mismo que el `Sum = 887,40` del cotejo con el ERP: no hace
falta saber qué se leyó mal, hace falta no seguir.

### La trampa: aquí el punto SÍ es decimal

`server/cash/domain/lecturaErp.ts` **rechaza** los importes con punto, y con
razón: en la pantalla de Genes «377.24» puede ser trescientos setenta y siete
con veinticuatro o trescientos setenta y siete mil doscientos cuarenta.

**Este ticket los imprime con punto**: `27.55`, `1.815`, `50.00`. Reutilizar
`importeAEnteros` tal cual rechazaría todos los tickets, uno por uno, sin que
nada explicara por qué.

Aquí el punto se acepta, y la ambigüedad la cierra la aritmética en vez de la
sintaxis: si alguien leyera `50.00` como cinco mil, `base + cuota` no daría.

## 5. La decisión

Tres salidas, y la tercera es la que hace que esto sea de fiar:

- **GASOLINERA** — coincide la señal 1, o coinciden **dos** de las fuertes
  (2, 3, 4), y las comprobaciones pasan.
- **TALLER** — no coincide ninguna señal fuerte, y las comprobaciones pasan.
- **No sé** — cualquier otra cosa: una sola señal fuerte suelta, o una lectura
  que no cuadra. **No se propone nada y se dice.** Se queda la sección que
  hubiera puesta.

Reglas explícitas y no una puntuación. Una puntuación de 0,73 no se le puede
explicar a quien está en el mostrador con cola; «pone E.S y hay una línea de
gasoil» sí.

### La asimetría que pide el usuario, y por qué la dejo a medias

«Si no tiene este formato, es cobro de taller» es verdad **cuando el ticket se
ha leído bien**. El problema es que no tener el formato y no haber podido leerlo
se parecen mucho: una foto de papel térmico arrugado, en ángulo y con la luz de
un fluorescente también «no tiene el formato».

Tratar eso como prueba de que es del taller mandaría ventas de gasoil reales al
taller cada vez que la foto saliera mal, y el descuadre por sección aparecería
al cierre sin nada que lo explicara.

Así que **en los dos sentidos se propone, no se afirma**, y la diferencia está
en la confianza: reconocer un patrón es una afirmación positiva y admite
confianza alta; no reconocerlo admite bastante menos.

## 6. Dónde encaja en lo que ya hay

Y es la mejor noticia del análisis: **esto no es un sistema nuevo**. Ya existe
todo el andamio, montado para la forma de cobro.

| Ya existe | Qué se le añade |
|---|---|
| `PropuestaEscaneo.formaCobro: { formaPago, confianza, motivo, autoSeleccionar, reglaId }` | Un hermano `seccion` con la misma forma exacta |
| `cash_payment_rules` (`campo`, `patron`, `confianza`, `auto_seleccionar`, `prioridad`) | Una tabla gemela `cash_section_rules`, con `campo IN ('CIF_EMISOR','NOMBRE_EMISOR','SERIE','TERMINAL','PRODUCTO')` y `section_id` |
| `cash_invoice_scans` (lo que dijo el modelo, lo propuesto y con qué se quedó la persona) | Dos columnas más: sección propuesta y sección elegida |
| El panel de Cobros cambia de color por sección | Nada. **Ya hace visible el cambio automático** |
| `AutorizarDuplicado` + `cobroExistente` | Nada. La serie-número del ticket entra como `referencia` y el mecanismo de duplicados ya funciona |

Dos cosas que conviene no hacer:

- **No meter la sección en `cash_payment_rules`.** Se leen de sitios distintos
  del papel —la sección la dice quién emite, la forma la dice la línea de pago—
  y cambian por motivos distintos. Juntarlas hace que una edición mueva las dos.
- **No inventarse un `autoSeleccionar`.** Ya está, ya se entiende, y ya hay
  gente que sabe qué significa.

`autoSeleccionar` es exactamente la respuesta a «automáticamente»: con
confianza alta el chip **cambia solo**, y el panel poniéndose rojo lo hace
visible sin tener que leer nada. Con confianza baja, solo se sugiere.

## 7. Lo que es configuración y lo que es código

Nada de `CONFORTAUTO`, `A43044379`, `T5-` ni `TPV1` escrito en el código. El
día que la estación cambie de rótulo o de numeración, eso se arregla en
Configuración y no en un despliegue.

Sí va en código lo que es estructura y no es de nadie: el patrón `NN/N` de la
columna S/M, las tres decimales del precio, y las dos comprobaciones.

## 8. Lo que el ticket regala además de la sección

Sale de la misma lectura, así que no cuesta nada:

- **Forma de cobro.** La línea bajo `TOTAL PAGAR` la dice: `Efectivo` en uno,
  `BBVA` en el otro. Con la tabla de equivalencias ya existente, `BBVA` apunta
  a la forma de tarjeta que corresponda.
- **Importe, litros, precio, fecha y hora.**
- **Serie y número** (`T5-155`) como referencia, que es lo que activa el
  control de duplicados que ya hay.
- **`-- DUPLICADO --`.** El primer ticket lo lleva impreso. Merece su aviso:
  un duplicado reintroducido cuenta el cobro dos veces, y es el fallo más
  probable de todo esto.

## 9. Lo que NO se hace

- **No se registra nada solo.** Se propone y una persona confirma, igual que el
  cotejo con el ERP. Un botón que creara el cobro desde una foto sale mal el día
  que el modelo lea 50,00 donde había 60,00, y sale mal en silencio.
- **No se cambia la sección de un cobro ya registrado.** Eso es rectificar, y
  tiene su camino.
- **No se toca la memoria de la última sección.** Sigue siendo el valor de
  partida cuando no hay ticket que diga otra cosa.

## 10. Cómo se prueba

El clasificador es una función pura: entra la lectura, sale sección, confianza y
motivo. Sin base de datos y sin modelo, que es lo que permite probarlo — la
razón de que la aduana tenga que ser determinista es precisamente que el modelo
no lo es.

Casos con los dos tickets de verdad, y estas mutaciones tienen que ponerse en
rojo:

1. Contar `Factura Simplificada` como señal → un ticket de taller sale
   gasolinera.
2. Bastar una sola señal fuerte → una factura de taller del mismo grupo
   (mismo pie de RGPD) sale gasolinera.
3. Quitar la comprobación `base + cuota` → una lectura con el total mal leído
   se propone igual.
4. Tratar «no reconocido» como TALLER con confianza alta → la foto ilegible de
   un ticket de gasoil se va al taller.
5. Reutilizar `importeAEnteros` → no pasa ni un ticket.
6. Ignorar `-- DUPLICADO --` → se puede meter dos veces sin un aviso.

Y una de integración: guardar una regla por CIF, escanear el ticket entrando
por Taller, y comprobar que la propuesta sale GASOLINERA con `autoSeleccionar`.
