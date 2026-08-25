# Fase 9 — Entrega: integridad y versión de las evidencias

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.33`

## Lo que ya estaba, y lo que faltaba

La auditoría de la fase 0 lo dejó dicho: el **bucket privado** y la **URL firmada de 15 minutos** ya
existían, y son la parte que más importa —con un bucket público, un enlace reenviado abriría la
facturación del día a quien lo reciba, sin sesión y para siempre—. Faltaban dos cosas concretas:
poder **demostrar** que el fichero de hoy es el que se adjuntó, y poder **sustituir** un escaneo
torcido sin perder el anterior.

## SHA-256: para qué sirve de verdad

La huella se calcula sobre el buffer recibido, **antes** de guardarlo. Si se calculara leyendo del
bucket se estaría certificando lo que hay allí, que es justo lo que se quiere poder comprobar.

Y se comprueba: `verificarDocumento` relee el fichero y compara. Sin esa comprobación la huella sería
un adorno. Cuatro estados, y los cuatro dicen algo distinto:

| Estado | Significa |
|---|---|
| `OK` | El fichero es el mismo que se adjuntó |
| `ALTERADO` | El del almacenamiento **no** coincide |
| `SIN_HUELLA` | Se subió antes de esta fase: **no se puede comprobar** |
| `NO_ENCONTRADO` | Ya no está en el almacenamiento |

`SIN_HUELLA` es un estado propio y no un fallo. Decir «correcto» sería mentir; decir «alterado»
sería alarmar sin motivo. «No se puede comprobar» es exacto.

Verificar va con **permiso de lectura, no de escritura**: comprobar la integridad de una evidencia es
justo lo que tiene que poder hacer quien la audita, que suele ser quien no puede tocarla.

## Sustituir no es anular

Un justificante **se sustituye, no se corrige**: el escaneo salió torcido y se vuelve a escanear. El
nuevo lleva `version = anterior + 1` y apunta a él; el anterior se marca `sustituido` y **se queda**.

Y `sustituido` no es `anulado`, aunque se parezcan: anular es lo que se hace cuando un justificante
no debía estar —con motivo y auditoría, y es permiso de responsable—; sustituir es que el mismo papel
se ha vuelto a escanear mejor. Distinguirlo importa el día que alguien pregunte por qué hay dos.

Dos facturas distintas del mismo pago **no** son dos versiones de nada: la versión solo sube cuando
se declara a quién se sustituye.

## Los duplicados se avisan, no se bloquean

Mismo contenido byte a byte dentro de la misma empresa. No se rechaza —a veces el mismo resguardo
respalda de verdad dos cosas— pero se avisa al adjuntar, que es lo que evita que el mismo taco de
facturas acabe subido cinco veces porque nadie recordaba si ya lo había hecho.

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1162 / 1162** en las dos |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | `server/central` sin ningún aviso; en `server/cash` solo los heredados |

Cinco pruebas: la huella se guarda y verifica; **un fichero cambiado por detrás se detecta**; uno sin
huella dice que no se puede comprobar y no que esté bien; sustituir sube la versión y conserva el
anterior sin anularlo; y el duplicado se detecta por contenido, no por nombre.

## Lo que queda

- **Verificación periódica**: hoy se comprueba cuando alguien lo pide. Un repaso automático que
  avisara por el Notification Hub sería el siguiente paso natural, y ya hay dónde enchufarlo.
- **Backfill de huellas**: los documentos anteriores no la tienen. Se puede calcular releyéndolos del
  bucket, pero conviene decidir antes si una huella calculada hoy significa algo — certifica el
  fichero actual, no el que se subió.
