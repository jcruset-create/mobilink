# Análisis del Excel de documentación de tacógrafos y versión mejorada

> Original analizado: `JUSTIFICANTE_TRANSFERENCIA_DE_DATOS_TACOGRAFOS_VDO.xlsx` (2 hojas).
> Resultado: [`plantillas/TACOGRAFOS_documentacion.xlsx`](./plantillas/TACOGRAFOS_documentacion.xlsx) (6 hojas).
> Alcance: certificados de transferibilidad e intransferibilidad. El anexo II del
> RD 125/2017 lo emite la extranet de VDO y queda fuera.
> Norma aplicada: **UNE 66102:2025** — *Sistema de gestión de los centros técnicos de tacógrafos*.

---

## 1. Análisis del original

### 1.1 Hoja `Justificante` (23 filas)

| Zona | Contenido |
|---|---|
| `B1:H23` | Documento imprimible (área de impresión definida, A4 vertical). |
| `J1:M13` | Bloque de **entrada manual**, fuera del área de impresión. |

Entradas reales: `K3` nombre · `M3` NIF · `K4` empresa · `K5` matrícula · `K6` marca ·
`K7` modelo · `K8` nº serie · `K9` fecha · `L10:L13` las cuatro marcas de modalidad.

Fórmulas: `C3=K3`, `C4=M3`, `F5=K4`, `E6=K5`, `G8=K6`, `C9=K7`, `G9=K8`,
`H14:H17 = L10:L13`, `G19 = IF(K9=0,J1,K9)`, `J1 = NOW()`.

### 1.2 Hoja `Intransferibilidad` (148 filas)

No es una hoja: son **cuatro bloques apilados** en la misma.

| Filas | Bloque |
|---|---|
| 1–10 (col. H/I) | Entrada manual: cliente, nº informe, fecha, matrícula, modelo, nº serie, entrega SI/NO, nombre, DNI. |
| 14–29 (col. A) | Texto en catalán para el trámite de la Generalitat (*Assumpte / Exposo / Sol·licito*). |
| 51–98 | Acuse de recibo para el cliente. **Único bloque con área de impresión** (`A51:G98`). |
| 99–127 | Comunicación a la Direcció General de Transports i Mobilitat. |
| 13–29 (col. H) | Enlaces al trámite, rutas locales y email, sin etiquetar. |

Dependencias: todo cuelga de `I1:I10`; `I7=I3`; `D74=A82=I3`; `B76/B78 = IF(G8="x",I9/I10,"")`;
`A89 = IF(I8="SI",K8,IF(I8="NO",K9,""))`; `H18 = CONCATENATE(I2," Certificat de Intransferibilitat")`.

### 1.3 Problemas detectados

**Graves**

1. **Campos vacíos imprimen `0`.** Con `K3`/`M3` vacíos, el justificante sale
   *"Yo, 0 — con N.I.F. nº: 0"*. Lo mismo en el acuse (`B76`/`B78`): el ejemplo entregado
   imprime literalmente *"Nombre: 0 / DNI: 0"*.
2. **Rutas locales `C:\Users\Jordi\...`** en `H15`, `H22` y `H27`. No funcionan en otro equipo.
   Una de ellas (`A_Check list de supervisiones entre técnicos.docx`) ni siquiera pertenece a
   este proceso.
3. **Sólo un bloque es imprimible.** Ni el texto de la Generalitat ni la comunicación a
   Transports tienen área de impresión: hay que reconfigurarla a mano cada vez.
4. **`=NOW()` como fecha de respaldo.** Un justificante firmado cambia de fecha cada vez que se
   abre el libro.
5. **La modalidad de entrega son cuatro celdas sueltas** (`L10:L13`). Nada impide marcar dos o
   ninguna. `L11` contiene además un espacio en blanco como basura.
6. **Los datos se teclean dos veces**: empresa, matrícula, modelo y nº de serie están en la hoja
   `Justificante` y otra vez en `Intransferibilidad`, sin relación entre ellas.

**Menores**

7. `J5 = LEN(I5)` etiquetada como *"DIA"*: celda de depuración olvidada.
8. `I7 = I3` hace que la fecha de entrega sea siempre la del informe. **No existe campo real de
   fecha de entrega**, aunque el proceso lo necesita.
9. Sin validación de datos ni listas desplegables en ninguna hoja. `SI`/`NO` se teclean.
10. `Intransferibilidad` no está protegida: cualquier clic borra una fórmula.
11. Datos reales de un cliente (`COMERCIAL TANK FOODS S.L.`, matrícula, nº de serie) quedan como
    plantilla de trabajo.
12. Texto justificado a base de espacios duros (`\xa0`) al final de las líneas.
13. Sin identificación de documento: ni código de formato, ni versión, ni fecha de edición.

---

## 2. Contraste con la UNE 66102:2025

Aquí está el hallazgo importante, y no es de formato.

### 2.1 El documento oficial lo emite la extranet de VDO — fuera de alcance

El apartado **7.5.1 c) y d)** exige que el centro disponga del *"modelo de informe sobre
transferencia de datos – certificado de intransferibilidad"* y conserve los
*"informes sobre transferencias de datos/certificado de intransferibilidad **según el anexo II
del RD 125/2017** (véase el anexo C de esta norma)"*.

Conviene tener claro qué es ese impreso, porque el nombre engaña: el anexo II se titula
*"INFORME SOBRE TRANSFERENCIA DE DATOS / CERTIFICADO DE INTRANSFERIBILIDAD"* y **es un único
formulario de 27 campos que sirve para los dos casos** — la casilla 22 (*"¿Era posible transferir
los datos?"*) decide si funciona como informe de transferencia o como certificado de
intransferibilidad. No son dos documentos.

**Ese impreso lo emite la extranet de VDO**, así que queda fuera de este libro y del futuro
módulo. Lo que se fabrica aquí son los documentos que lo envuelven: la autorización que firma el
cliente, el acuse de recibo y la comunicación a la administración — exactamente lo que ya tenía
el original.

Se llegó a construir la hoja del anexo II y después se retiró, al confirmarse que la emite la
extranet. Queda en el historial de la rama por si algún día hace falta.

### 2.2 Trazabilidad (8.5.2)

La norma exige documentar la trazabilidad entre equipos utilizados, unidad intravehicular,
**técnico que realiza la intervención**, vehículo, **precintos instalados** y centro técnico.
Equipos y precintos viven en el informe técnico de la extranet. Aquí se recogen sólo los dos que
hacen falta para estos documentos y para el registro: **técnico** y **nº de bastidor**.

### 2.3 Custodia y destrucción (8.5.1 y nota F del anexo II)

Los archivos transferidos se guardan **un año** y después se destruyen, documentando por cada
destrucción: fecha, matrícula, nº de bastidor, nº de serie de la UIV, firma digital del archivo,
método de destrucción y persona que la realiza. No había ni registro ni aviso de plazo.

**Esta obligación sí es del centro**, no de la extranet: por eso la hoja `REGISTRO TRANSFERENCIAS`
se mantiene.

### 2.4 Identificación y control de la información documentada (7.5.2 y 7.5.3)

Exige título, fecha, autor o número de referencia, control de versión y protección frente a
modificaciones no intencionadas. El original no lleva ninguna identificación de formato.

### 2.5 Confidencialidad (8.5.3 y notas D, E, F del anexo II)

Los datos de la memoria son confidenciales; el solicitante debe evaluar la confidencialidad del
medio de remisión que elige y el centro no responde de la violación durante la remisión; debe
archivarse el documento que avala la titularidad de los datos. Nada de esto aparecía en el
justificante, que es precisamente donde el cliente elige el medio.

---

## 3. Qué hace la versión nueva

| Hoja | Función |
|---|---|
| `DATOS` | Único punto de entrada. 24 campos en 7 secciones, desplegables, avisos de obligatorio condicionados al tipo de operación y cálculo del plazo de destrucción. |
| `JUSTIFICANTE TRANSFERENCIA` | Justificante del original + cláusulas de confidencialidad, custodia y titularidad + firma del técnico. |
| `INTRANSFERIBILIDAD CLIENTE` | Acuse de recibo del original. |
| `INTRANSF. ADMINISTRACION` | Comunicación a la Dirección General + bloque del trámite telemático en catalán, con celda copiable y enlaces web. |
| `REGISTRO TRANSFERENCIAS` | **Nuevo.** Registro acumulativo con fecha límite de destrucción, estado automático (*En custodia* / *⚠ PENDIENTE DE DESTRUIR* / *Destruido*) y los siete campos del documento de destrucción. |
| `CONFIGURACION` | Centro, responsables, control documental, enlaces, listas y fragmentos de texto legal. |

Cumple además: fechas `dd/mm/aaaa`, matrícula en mayúsculas, modalidad de entrega como
desplegable único, validación de fecha en todos los campos de fecha, A4 con área de impresión y
márgenes definidos por documento, hojas protegidas dejando desbloqueadas sólo las entradas, sin
macros, sin rutas locales, y pie de control documental (`Formato · Versión · Edición ·
Elaborado · Aprobado · UNE 66102:2025`) en cada documento imprimible.

**Validación:** 182 fórmulas, 0 errores. Probado en los dos escenarios (transferencia correcta e
intransferibilidad): los documentos que no aplican se marcan *"— NO APLICA —"*, y la entrega del
tacógrafo averiado y su achatarramiento son excluyentes en ambos sentidos.

---

## 4. Cambios sobre el contenido legal — revisar

Todo el texto jurídico del original se conserva. Estos son los cambios, uno a uno:

| # | Cambio | Motivo |
|---|---|---|
| 1 | *"de que el tacógrafos marca:"* → *"de que el tacógrafo marca:"* | Concordancia. |
| 2 | *"Assupmte"* → *"Assumpte"* | Ortografía catalana. |
| 3 | *"Nº de Serie"* → *"Nº de Sèrie"* en el bloque catalán | Ortografía catalana. |
| 4 | El *Exposo / Sol·licito* catalán se reúne en un párrafo copiable | Se pega en el formulario web de un tirón. Contenido íntegro. |
| 5 | **Se añaden** tres cláusulas al justificante: confidencialidad, custodia a un año y titularidad de los datos | Notas D, E y F del anexo II del RD 125/2017, reproducidas en el anexo C de la UNE 66102:2025. |
| 6 | *(resuelto)* Entrega del aparato y achatarramiento siguen siendo **excluyentes**, como en el original | Se introduce sólo *"Se entrega al cliente"*; *"Se achatarrará"* se calcula como su contrario y está bloqueado. El acuse imprime siempre una sola de las dos líneas. |
| 7 | *(resuelto)* Nombre y DNI de **quien autoriza** y de **quien recibe** son campos distintos | Como en el original (`K3`/`M3` frente a `I9`/`I10`). El justificante usa a quien autoriza; el acuse, a quien recibe. Sin relleno automático entre ellos: en un documento firmado el nombre no se deduce. |
| 8 | En el anexo II, *"RD ......../....."* se rellena como *"RD 125/2017"* | El formulario oficial lo deja en blanco para que se complete. |

| 9 | *"Real decreto 125:2017"* → *"Real decreto 125/2017"* (y *"Reial decret 125: 2017"* → *"125/2017"*) | Ocho apariciones. La referencia correcta del real decreto lleva barra, no dos puntos. |

---

## 5. Lo que todavía falta para cumplir todos los requisitos documentales

Ninguno de estos cabe en una hoja de cálculo. Son el argumento para el módulo
(`PROMPT_modulo_tacografos.md`):

1. **Documento imprimible por cada destrucción.** Hoy es una fila del registro con los siete
   campos exigidos; la norma habla de *"un documento"* por destrucción.
3. **Firma digital del archivo destruido.** El registro tiene la columna, pero el hash debe
   calcularlo el sistema que custodia el fichero.
3b. **Descarga diaria de las tarjetas de centro técnico**, copia de seguridad y conservación
   cinco años (8.5.1).
5. **Registro de extravíos, pérdidas y sustracciones** de precintos y tarjetas, con archivo de
   comunicaciones y denuncias (7.5.1 d).
6. **Documentos de aceptación de condiciones de uso y confidencialidad** firmados por
   responsables técnicos y técnicos respecto a sus tarjetas (7.5.1 d).
7. **Tratamiento de reclamaciones** (8.3) y **producto no conforme / actas de inspección** (8.6).
8. **Control de versiones real.** El pie identifica el formato, pero quien edita `CONFIGURACION`
   cambia el texto de documentos ya emitidos. Sólo un sistema con plantillas versionadas y
   documentos inmutables lo resuelve.

## 6. Mejoras sugeridas que sí caben en el Excel, si las quieres

- Numeración automática del nº de informe a partir de la contraseña del centro y un contador.
- Campo de nº de bastidor obligatorio (hoy opcional): lo exige el documento de destrucción.
- Casilla de verificación final del técnico ("control final del servicio prestado", 8.5.1).
- Conservación **cinco años** de las copias de los certificados emitidos, que también es del centro.
