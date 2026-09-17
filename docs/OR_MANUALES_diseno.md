# OR Manuales — diseño

El control del **papel**. Cuando no hay sistema delante —una avería en ruta, un
corte de red, un cliente a pie de calle— el taller escribe la orden de
reparación en un bloc. Cada bloc trae 25 OR consecutivas y cada OR ocupa una
hoja.

Este módulo sabe qué blocs existen, quién se llevó cada uno, cuándo volvió, qué
hojas se han escaneado y —lo que de verdad importa— **cuáles faltan**.

**Lo que NO hace:** no gestiona reparaciones. Una OR de aquí es una hoja de
papel con un número, no un expediente de trabajo. Enlazarla con la reparación
real es una ampliación prevista (§8), no algo que haga hoy.

---

## 1. El principio rector

> **Archivar una hoja en la OR equivocada es el peor fallo posible del módulo.**

El papel de una reparación acabaría colgado de otra y nadie se enteraría hasta
que alguien lo buscara, meses después. Todo lo demás se subordina a eso:

- Ante la duda, el documento va a la bandeja de pendientes. **Nunca se adivina.**
- Un número que no cae en ningún bloc **no se archiva** por muy claro que se lea:
  leer bien un número que no existe no da dónde ponerlo.
- Dos candidatos empatados **no se archivan**: elegir uno sería tirar una moneda.
- Un duplicado **no sobrescribe** al que ya estaba. Sustituir es una acción
  aparte, explícita y con su traza.

---

## 2. El flujo

```
   ┌── alta ────────────────────────────────────────────────────────┐
   │  Crear bloc 010, OR inicial 2001  →  se generan 2001…2025      │
   │  (25 filas en orm_or, todas PENDIENTE)                         │
   └────────────────────────────────────────────────────────────────┘
                              ↓
   ┌── custodia ────────────────────────────────────────────────────┐
   │  Entregar a Juan (fecha)  →  ENTREGADO                          │
   │  Registrar devolución     →  PENDIENTE_ESCANEO / INCOMPLETO     │
   └────────────────────────────────────────────────────────────────┘
                              ↓
   ┌── escaneo ─────────────────────────────────────────────────────┐
   │  UPLOAD → VALIDACIÓN → SEPARAR PÁGINAS (1 página = 1 OR)        │
   │    → LEER Nº OR → CALCULAR CONFIANZA → ¿existe la OR?           │
   │    → LOCALIZAR BLOC → ¿DUPLICADO? → ARCHIVAR → ACTUALIZAR OR    │
   │    → RECALCULAR BLOC → AVISAR SI FALTA ALGO → RESULTADO         │
   └────────────────────────────────────────────────────────────────┘
                              ↓
   ┌── cierre ──────────────────────────────────────────────────────┐
   │  25/25 y nada que revisar  →  COMPLETO  →  una persona CIERRA   │
   └────────────────────────────────────────────────────────────────┘
```

---

## 3. Las decisiones que no se deducen del código

### 3.1 Las 25 OR se crean con el bloc, no al escanearlas

`orm_or` nace entera: 25 filas en `PENDIENTE`. Es lo que convierte «¿qué falta?»
en una consulta en vez de un cálculo: **lo que falta son las filas que nadie ha
tocado**. Si las OR nacieran al escanearlas, la pregunta no tendría respuesta en
la base, que es justamente para lo que existe el módulo.

### 3.2 El recuento se calcula, no se guarda

El progreso sale de agregar `orm_or` (25 filas por bloc; la base lo hace sin
despeinarse). Un contador guardado es un contador que algún día se desincroniza
sin que nadie se entere, y el dato que importa —«faltan la 1032 y la 1047»— hay
que sacarlo de las filas de todas formas.

### 3.3 Un bloc entregado no está «incompleto»

Mientras el taller lo tiene en la mano, que falten hojas es lo normal: lo están
rellenando. Sólo se marca `INCOMPLETO` si ya ha llegado algún documento suyo,
porque entonces sí se está escaneando a medias. Sin esta regla, todos los blocs
en circulación vivirían en rojo y el color dejaría de significar nada.

### 3.4 Un bloc CERRADO no se recalcula

Cerrar es una decisión de una persona, con su traza. Que un documento tardío lo
reabriera solo borraría esa decisión sin que nadie se enterara.

### 3.5 El histórico es inmutable

`orm_eventos` tiene un trigger que rechaza `UPDATE` y `DELETE`, como
`rcp_eventos`, `thf_eventos` y `app_auditoria`. Y eliminar un documento es
**lógico**: la relación se suelta, el fichero se queda. «Qué había aquí antes»
es justo lo que se pregunta cuando algo no cuadra.

### 3.6 La ruta del fichero es su hash, no su sitio en el archivo

El encargo describe una estructura `OR_MANUALES/BLOC_002_1026_1050/OR_1026.pdf`.
Esa jerarquía es **lógica** y vive en la base (bloc → OR → documento). En el
almacenamiento, la ruta es el SHA-256 del contenido:

- el mismo fichero subido dos veces se guarda una sola vez;
- una hoja puede cambiar de OR al reasignarla, y mover objetos de sitio en el
  bucket para eso sería pedir un fallo.

El nombre bonito vive en `nombre_archivo` (`OR_1043.pdf`) y es el que se ve y con
el que se descarga.

---

## 4. La detección del número

Cascada, de más fiable a menos (`server/or-manuales/ocr.ts`):

| # | Paso | Método |
|---|---|---|
| 1 | Texto del PDF dentro de la zona configurada | `TEXTO_ZONA` |
| 2 | Texto del PDF en el resto de la página | `TEXTO_PAGINA` |
| 3 | La página rasterizada, leída por visión, en la zona | `OCR_ZONA` |
| 4 | Lo mismo en la página entera | `OCR_PAGINA` |

**Un PDF digital nunca se degrada a imagen.** Un PDF con texto DICE el número;
un OCR lo interpreta. Rasterizar un PDF que ya trae su texto es cambiar un dato
exacto por una lectura aproximada (misma regla que sigue Therefore).

**Código de barras y QR no están implementados**, aunque el encargo los pone por
delante: las OR de papel de este taller no llevan ninguno, y un lector para algo
que no existe en el documento sería código muerto con mantenimiento. El
vocabulario (`METODOS_DETECCION`) ya los admite y la cascada es una lista de
pasos: el día que se impriman blocs con código, se añade un paso al principio.

### 4.1 Los pesos de la confianza

`server/or-manuales/domain/deteccion.ts`, puro y probado con páginas escritas a
mano. Suman **exactamente 100** en el caso perfecto, y eso no es cosmética: si
sumaran más, el tope de 100 se comería las penalizaciones y una lectura de imagen
puntuaría igual que el texto exacto de un PDF.

| Factor | Peso |
|---|---|
| Base (un número suelto) | 35 |
| Está en la zona del número | +25 |
| Viene detrás de un rótulo (`OR`, `Nº`, `Orden`…) | +20 |
| Cae dentro de un bloc que existe | +15 |
| Era el único número plausible de la página | +5 |
| Leído de una imagen, no del texto del PDF | −10 |
| Hay otro candidato que empata | −35 |

La penalización por empate es lo bastante grande para dejar al ganador **por
debajo** de la banda de revisión: un empate no se archiva marcado, va a la
bandeja.

Las fechas y los años (`2026`) se descartan antes de competir.

### 4.2 Los umbrales — configurables, no mágicos

| Confianza | Qué pasa |
|---|---|
| ≥ 90 % | Se archiva sin preguntar |
| 70–89 % | Se archiva, marcado para que alguien lo confirme |
| < 70 % | No se archiva: va a documentos pendientes |

Viven en `orm_config` por empresa, se editan desde la pantalla de Configuración y
**no aparecen como números sueltos en el código**. La zona de OCR, igual: se
guarda en fracciones de 0 a 1 (relativas, no en milímetros: las hojas se escanean
a tamaños distintos y una caja en puntos absolutos deja de valer al cambiar de
escáner). Por defecto, el cuarto superior derecho.

---

## 5. El procesamiento no bloquea la petición

Un PDF de 200 páginas con OCR tarda minutos: el navegador cortaría la conexión
mucho antes. Así que `POST /documentos` guarda los ficheros, crea la fila de
`orm_procesamientos` y contesta **202** con su id; el panel pregunta por ese id y
va enseñando el avance.

**No hay cola ni worker aparte**, y es deliberado: este proyecto no tiene
ninguna, y estrenar Redis o BullMQ para un módulo sería añadir una pieza de
infraestructura que hay que desplegar, vigilar y pagar. Se hace como Therefore y
Recepciones: la tarea arranca en el propio proceso y `startOrManualesWorker()`
—un `setInterval` cada 5 minutos— saca de «procesando» los lotes que murieron con
un reinicio. **El estado vive en la tabla, no en memoria**, que es lo que hace
que eso funcione.

**Una página mala no tira el lote.** Cada página va en su propio `try`: la que
falle suma un error, queda en la bandeja con su fichero guardado, y las otras 199
se archivan igual.

---

## 6. Tablas (prefijo `orm_`)

| Tabla | Qué guarda |
|---|---|
| `orm_blocs` | El taco de papel: rango, custodia, estado |
| `orm_or` | Una fila por número, **siempre**, desde que nace el bloc |
| `orm_documentos` | Una fila por **página** escaneada, con su hash y su lectura |
| `orm_entregas` | El histórico de salidas y vueltas |
| `orm_procesamientos` | Cada lote subido, con su avance y su recuento |
| `orm_avisos` | Blocs incompletos. Uno vivo por bloc y tipo |
| `orm_eventos` | El diario del módulo, inmutable por trigger |
| `orm_config` | Zona de OCR y umbrales, por empresa |

Las garantías que viven en la **base** y no en una comprobación previa:

- `UNIQUE (empresa_id, numero_or)` — una OR pertenece a un solo bloc. Dos altas
  simultáneas con rangos que se pisan pasarían cualquier comprobación previa;
  sólo el índice puede pararlas.
- Índice parcial único en `orm_entregas (bloc_id) WHERE fecha_devolucion IS NULL`
  — un bloc no se entrega dos veces sin volver primero.
- Índice parcial único en `orm_avisos (bloc_id, tipo) WHERE estado <> 'RESUELTO'`
  — sin él, cada recálculo dejaría una fila y la pantalla de Avisos sería un
  historial de ruido en vez de una lista de cosas por hacer.

Migraciones gemelas para el SQL Editor: `supabase/migrations/or_manuales_fase1.sql`
y `supabase/migrations/saas_modulo_or_manuales.sql`.

---

## 7. Permisos

Se apoya en `app_usuario_modulos` (módulo `or-manuales`). **No se estrena un
segundo sistema de roles.**

| Rol | Puede |
|---|---|
| `consulta` | Ver, buscar y abrir documentos |
| `operario` | Además, subir escaneos y gestionar la bandeja de pendientes |
| `gestor` | Además, crear blocs, entregar, devolver, cerrar y avisar |
| `admin` | Todo, incluida la configuración de OCR |

`operario` no estaba en el encargo y se añadió porque el taller lo necesita:
quien está delante del escáner no tiene por qué poder crear ni cerrar blocs.

---

## 8. Preparado para, sin implementar

El diseño deja sitio a lo que el encargo pide poder añadir después:

- **Matrícula, cliente, vehículo, importe, texto completo del OCR** — el
  documento ya guarda `ocr_texto`; los campos nuevos son columnas en
  `orm_documentos`, no un rediseño.
- **Vinculación con la reparación real** — una columna en `orm_or` y su evento.
- **Código de barras y QR** — un paso más al principio de la cascada de `ocr.ts`;
  el vocabulario ya los admite.
- **Notificaciones externas** — `orm_avisos.canal` ya contempla
  `EMAIL`/`WHATSAPP`/`SMS`/`PUSH`; hoy sólo se escribe `INTERNO` porque el
  encargo pide no estrenar integraciones externas todavía. Añadir WhatsApp es
  escribir el emisor, no migrar la tabla.
- **Firma digital y búsqueda por contenido** — el hash por documento ya está.

---

## 9. Cómo se prueba

- **Dominio puro** (`domain/blocs.test.ts`, `domain/deteccion.test.ts`): rangos,
  recuento, estados, cierre, confianza y decisión. Sin base de datos.
- **Integración** (`or-manuales.integration.test.ts`): el escenario completo del
  encargo por HTTP contra PostgreSQL de verdad, más duplicados, permisos,
  aislamiento entre empresas e inmutabilidad del histórico. Sólo con
  `RUN_DB_TESTS=1` y `DATABASE_URL` a una base **desechable**.

Los PDF de prueba se generan en el propio test con `pdf-lib`, con el número
arriba a la derecha: así se recorre el camino bueno —texto del PDF, zona— sin
depender de que haya clave de OpenAI ni salida a internet.
