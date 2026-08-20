# Fase 7 — Entrega: motor de reglas jerárquico, alertas e incidencias

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.31`

## Qué hace

Central ya no solo enseña lo que pasa: **avisa**. Cinco cosas vigiladas —descuadre de arqueo, dinero
fuera del cajón, caja sin cerrar, cierres sin llevar al banco y poca calderilla— con umbral propio
por empresa, zona, taller o caja, y una bandeja de incidencias que se atiende.

## La jerarquía es la razón de ser del motor

**Gana la regla más específica.** La de la caja tapa la del taller, que tapa la de la zona, que tapa
la de la empresa. No se suman ni se promedian: manda una sola.

El caso que lo justifica: la empresa dice «avisad de descuadres de más de 20 €», pero la gasolinera
mueve diez veces más dinero y con ese umbral el aviso salta cada día hasta que nadie lo lee. Sin
jerarquía solo caben dos malas salidas — un umbral tan alto que no detecta nada, o uno tan bajo que
se ignora.

Y **una regla apagada abajo apaga el aviso**, aunque arriba esté encendida. Es la misma
especificidad, aplicada también para callar: si no valiera, la única forma de silenciar una caja
concreta sería apagar la regla para toda la empresa.

## El motor no toca la base de datos

`server/central/rules/engine.ts` recibe las reglas y el estado de una caja y devuelve incidencias.
Nada más. Es el mismo patrón que el motor de la caja, y por el mismo motivo: **una regla que decide
si alguien recibe un aviso tiene que poder probarse en un milisegundo y sin montar nada.** Sus
**12 pruebas corren en 350 ms sin PostgreSQL**.

Las reglas son de tipos cerrados a propósito. Una regla genérica con una expresión que hay que
interpretar es una regla que nadie sabe si está bien escrita hasta el día que no avisa.

## Las dos decisiones de la bandeja

**Lo que deja de pasar se cierra solo.** Un tránsito que vuelve, una caja que cierra, un ingreso que
se lleva al banco: la incidencia se marca resuelta con motivo `AUTO`. Si hubiera que cerrarlas a
mano, la bandeja acumularía avisos de problemas ya arreglados y en dos semanas no la abriría nadie.

**El descuadre NO se cierra solo.** Es un hecho que ocurrió: el dinero faltó ese día y sigue faltando
aunque hoy la caja cuadre. Lo cierra una persona, que es quien puede decir por qué. Cerrarlo
automáticamente sería borrar la única señal de que pasó. Hay una prueba para cada una de las dos
mitades.

**La deduplicación identifica el hecho, no la regla.** Dos descuadres de días distintos son dos
incidencias y hay que verlos los dos; un tránsito que lleva cinco días fuera es el mismo problema que
ayer, cuando llevaba cuatro. Si la clave cambiara con el valor, cada evaluación abriría un aviso
nuevo. Y la barrera es **un índice único parcial sobre las incidencias vivas**, no un `if`.

**Quien vigila no cambia el listón.** El rol `supervisor` atiende la bandeja pero no configura
umbrales: subir el listón hasta que la red deje de avisar no debería estar al alcance de quien
responde de esa red.

## Un fallo que cazó una prueba

`cambiarIncidencia` usaba el mismo parámetro como `bigint` suelto y dentro de un `CASE` con `NULL` en
la otra rama. PostgreSQL deduce entonces dos tipos para el mismo parámetro y **se niega a preparar la
consulta**. Es la segunda vez que aparece este patrón en el proyecto; ahora los tipos van escritos.

## Verificación

| Comprobación | Resultado |
|---|---|
| Motor de reglas (unitarias, sin BD) | **12 / 12** en 350 ms |
| Suite completa, base **migrada** y **recién creada** | **1154 / 1154** en las dos |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | **Backend sin ningún aviso**; el patrón conocido en la pantalla |

## Lo que queda

- **Notificar de verdad** (fase 8): hoy la incidencia está en la bandeja, pero nadie recibe un correo
  ni un aviso al móvil. El proyecto ya tiene dos sistemas de notificación; la fase 8 debería
  consolidarlos, no añadir un tercero.
- **Reglas por zona y caja desde la interfaz**: la API y el motor las admiten; la pantalla solo crea
  las de empresa.
