# Lote de calibración de Therefore

Aquí viven los casos con los que se calibra y se prueba el parser: un correo de
Therefore, su PDF, y al lado **lo que el sistema tiene que sacar de ellos**.

---

## 1. La regla que gobierna todo esto

**El resultado esperado lo escribe una persona mirando el papel. Nunca el
parser.**

Si el esperado se generase ejecutando el parser, la prueba diría «el parser hace
lo que hace» y pasaría siempre, incluso el día que empiece a leer `77,56` donde
pone `77,50`. Un ground truth derivado del código que verifica no verifica nada.

Por eso `scripts/therefore-anonimizar.ts` deja el bloque `esperado` **vacío**:
es trabajo de quien abre el PDF.

---

## 2. Dos orígenes, y no se mezclan

| | `reales/` | `sinteticos/` |
|---|---|---|
| De dónde salen | correos de verdad, anonimizados | los fabricamos nosotros |
| Para qué sirven | **calibrar**: tienen la estructura que Therefore y los proveedores producen de verdad | probar **mecánica** y CI |
| ¿Se versionan? | **NO** | sí |

Un parser afinado contra ejemplos que nos hemos inventado acierta el 100 % y
falla con el primer correo real: nuestros ejemplos tienen las rarezas que se nos
ocurren, no las que tienen los documentos. De ahí la separación.

Los sintéticos **no calibran nada**. Sirven para fijar que el separador separa,
que `60% + 10%` no se colapsa en `64%` y que un albarán a caballo entre dos
páginas se lee entero. Eso es mecánica, y se prueba con documentos fabricados en
la propia prueba.

---

## 3. Por qué los reales NO se suben

**Este repositorio es público.**

Un albarán de proveedor lleva sus referencias, sus precios de compra y su escala
de descuentos. Quitarle el nombre al proveedor no cambia eso: publicar el lote
sería publicar las condiciones de compra, que es exactamente lo que la
competencia querría leer. Y el correo original lleva además direcciones,
matrículas y bastidores de clientes.

Así que:

```
originales/              los .eml tal y como llegaron        ignorado por git
originales/sustituciones.json  el mapa de anonimización      ignorado por git
reales/                  los casos anonimizados              ignorado por git
sinteticos/              casos fabricados                    SÍ se versiona
```

La calibración se hace en local, contra `reales/`. La CI corre contra
`sinteticos/`. Si algún día hiciera falta compartir el lote real, va a un sitio
privado, no aquí.

---

## 4. Cómo se prepara un lote

### 4.1 Exportar los correos

Del buzón donde llegan las notificaciones de Therefore, exportar como `.eml`
**con los adjuntos dentro** (en Outlook: *Guardar como → Formato de correo*; en
Thunderbird: *Guardar como → Archivo*; en Gmail: *Mostrar original → Descargar*).

Dejarlos en `server/therefore/fixtures/originales/`.

Interesan los del tipo «Incidencia en factura recibida. Empresa XXX» en los que
se pida **grabar, dar entrada o gestionar** uno o varios albaranes.

### 4.2 Revisar qué se va a sustituir

```bash
npx tsx scripts/therefore-anonimizar.ts --revisar
```

Busca lo que parece identificar a alguien —correos, teléfonos, NIF/CIF, IBAN,
matrículas, bastidores— y deja la propuesta en `originales/sustituciones.json`.
**No escribe ningún caso todavía.**

Hay que abrir ese fichero y añadir a mano lo que ningún patrón puede detectar,
que son los nombres:

```json
{
  "NEUMATICOS EJEMPLO, S.L.": "PROVEEDOR UNO, S.L.",
  "Daniel G": "Persona A"
}
```

**Lo que NO se pone ahí**: números de albarán, referencias de artículo,
cantidades, precios, descuentos, importes, números y fechas de factura. Son justo
lo que el lote tiene que conservar intacto; si se tocan, deja de servir.

### 4.3 Generar

```bash
npx tsx scripts/therefore-anonimizar.ts
```

Escribe un caso por correo en `reales/`. Antes de escribir nada vuelve a pasar
el detector sobre el resultado: si queda algo sin anonimizar, **ese caso no se
genera** y dice qué falta.

### 4.4 Rellenar el esperado

Abrir cada `caso.json` y completar el bloque `esperado` mirando el PDF. Es la
parte que no se puede automatizar, y la única que da valor al lote.

---

## 4.5 El lote que hay que reunir

Seis tipos de caso, dos o tres correos de cada uno: entre **12 y 20** en total.
Menos no enseña la variedad real entre proveedores; más no aporta hasta haber
mirado los primeros.

Todos del tipo «Incidencia en factura recibida. Empresa XXX» en los que se pida
**grabar, dar entrada o gestionar** albaranes.

### Tipo 1 — Un albarán pedido dentro de una factura con varios

**Buscar**: la incidencia pide un albarán y el PDF trae tres o más.

**Esperado**: una actuación; un `albaranes[]` con **sólo** las líneas de ese
albarán; `paginaInicio`/`paginaFin`; los totales de factura en `conceptosNoLinea`.

**Qué caza**: que se cuelen líneas del albarán anterior o del siguiente. Es el
fallo más caro del módulo, porque produce una entrada en el ERP que cuadra por
dentro y está mal.

### Tipo 2 — Varios albaranes en la misma incidencia

**Buscar**: el bloque libre pide dos o más. Mejor aún si mezcla acciones
(«Grabar: 802316, 803008 / Modificar: 0804210»).

**Esperado**: N actuaciones con su acción cada una, y N entradas en
`albaranes[]`, cada una con sus propias líneas.

**Qué caza**: dar por hecho que un correo es un albarán, o que todos llevan la
misma acción.

### Tipo 3 — Con descuentos

**Buscar**: líneas con descuento encadenado (`60% + 10%`) y, si las hay, con uno
solo (`40%`).

**Esperado**: `descuentos[]` con su `orden` y su `raw` tal y como está impreso.

**Qué caza**: colapsarlos en uno solo. Y ojo: la aritmética **no** lo detecta,
porque `60 % + 10 %` da exactamente lo mismo que `64 %`. Lo único que lo caza es
que el esperado fije cuántos descuentos hay y cómo están escritos.

### Tipo 4 — Discrepancia entre el importe de la incidencia y el del PDF

**Buscar**: el importe que cita el correo no coincide con la suma de las líneas
del albarán.

**Esperado**: la suma, la diferencia **con signo**, `estadoAnalisis: "REVISAR"`
y la validación `IMPORTE` no conforme. El importe del correo se conserva: no se
corrige con el del PDF.

**Qué caza**: que el parser «arregle» la diferencia o se invente su causa
(portes, tasas). Se enseñan las dos cifras y se dice que hay que mirarlo.

### Tipo 5 — El número del correo con otro formato en el PDF

**Buscar**: el correo dice `0501234` y el PDF `ENT-770199-0501234`, o con
cualquier otro prefijo o sufijo. **Vale doble** si en esa misma factura hay un
albarán con el número contiguo.

**Esperado**: `numeroEnDocumento` con el formato del PDF y
`resultadoMatch: "MATCH"`.

**Qué caza**: las dos direcciones. Una comparación estricta no lo encuentra; una
laxa coge el vecino, que es peor.

### Tipo 6 — Ambiguo o problemático

**Buscar** cualquiera de éstos (uno por caso):

- el albarán pedido no está en el PDF;
- el número viene ilegible o hay dos candidatos;
- una línea con la referencia o la cantidad que no se leen con seguridad;
- un PDF escaneado, sin capa de texto;
- el bloque libre en prosa, sin la palabra de acción.

**Esperado**: `REVISAR` o `ERROR` **diciendo qué validación falla**, y los campos
que no se leen a `null`.

**Qué caza**: lo único que no se puede permitir, que es inventar. Un caso de
éstos que salga `OK` con datos plausibles es un fallo grave aunque los números
parezcan razonables.

---

## 5. Qué contiene un caso

```
reales/caso-01-.../
├── caso.json      el correo, los metadatos y el resultado esperado
└── factura-1.pdf  el adjunto, redibujado sin nada identificativo
```

El `caso.json` lo describe `tipos.ts`. Lo que más se mira:

- `correo.texto` — el cuerpo entero.
- `correo.informacionAdicional` — **sólo lo que escribió la persona**. Es la
  mitad del correo que no tiene plantilla, y donde está la petición concreta.
- `correo.messageId` — con el dominio sustituido y la parte local intacta, que
  es lo que permite probar que procesar dos veces el mismo correo no crea dos
  notificaciones.
- `esperado.correo.actuaciones` — qué acción sobre qué albarán.
- `esperado.albaranes[]` — por cada albarán pedido: dónde está en el documento,
  sus líneas con descuentos, la suma, la diferencia contra el importe de la
  incidencia, y si el análisis tiene que salir `OK`, `REVISAR` o `ERROR`.

Cuando se espera `REVISAR` hay que decir **qué validación falla**. Sin eso, un
caso pasaría aunque el parser lo mandara a revisión por el motivo equivocado, y
«REVISAR» se convertiría en un comodín que aprueba cualquier cosa.

---

## 6. El PDF no se copia: se vuelve a dibujar

`pdf.ts` lee la capa de texto con mupdf —cada línea con su posición y su
tamaño—, aplica las sustituciones y dibuja un PDF nuevo poniendo cada línea
donde estaba.

Así el fichero resultante **no contiene ni un byte del original**: ni logotipos,
ni metadatos del autor, ni texto oculto debajo de una imagen. Y conserva la
geometría, que es justo lo que el parser tiene que saber leer. Copiar el PDF y
tachar encima dejaría debajo todo lo que se quería quitar.

Un PDF escaneado no tiene capa de texto y no se puede anonimizar así: esos casos
se rechazan con un aviso en vez de generar una página en blanco que parecería un
caso válido.

---

## 7. Comprobar el lote

`cargar.ts` valida los casos y detecta los errores que de otro modo pasarían por
buenos:

- un albarán que se espera encontrar y no declara ninguna línea (pasaría aunque
  el parser no extrajera ninguna);
- una suma escrita a mano que no es la suma de las líneas;
- una diferencia que no es suma − importe de la incidencia;
- un `REVISAR` sin decir qué validación falla;
- descuentos sin numerar en orden.

Ojo con una cosa que sorprende: **encadenar 60 % y 10 % da exactamente lo mismo
que un 64 % único** (0,4 × 0,9 = 0,36 = 1 − 0,64). El motivo para conservarlos
por separado no es que salga otro importe —sale el mismo—, sino que el ERP los
pide como están impresos, lo pactado con el proveedor es «60 y 10», y guardar
otra cosa es perder el original.
