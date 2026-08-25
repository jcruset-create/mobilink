# PROMPT — Excel de documentación de sustitución de tacógrafos

> Estado: **ejecutado**. Resultado en `plantillas/TACOGRAFOS_documentacion.xlsx`;
> análisis y desviaciones en `ANALISIS_excel_tacografos.md`.
> Centro técnico: COMERCIAL SEA S.A. — Nº centro `E943009`.
> El Excel es la **fase 1** del módulo propio `tacografos`: ver
> [`PROMPT_modulo_tacografos.md`](./PROMPT_modulo_tacografos.md).

---

## 0. Contexto

Un centro técnico de tacógrafos gestiona con una hoja de cálculo la documentación
legal asociada a la **sustitución de tacógrafos digitales**. Hoy los datos de una
misma intervención se reescriben en varios sitios. El objetivo es que **los datos
se introduzcan una sola vez** y que todos los documentos imprimibles se generen
automáticamente a partir de ellos.

Existen dos procesos, excluyentes entre sí para una misma intervención:

1. **Transferencia correcta** — la memoria interna del tacógrafo sustituido se
   descarga sin incidencias. Se genera un *justificante de transferencia de datos*
   que el cliente firma autorizando la descarga, la transferencia de los ficheros
   y la modalidad de entrega.
2. **Intransferibilidad** — no es posible transferir los datos. Se genera un
   *certificado de intransferibilidad*, su *acuse de recibo* para el cliente y la
   *comunicación a la administración* (Generalitat de Catalunya).

---

## 1. Fase 0 — Análisis del Excel original (obligatoria, antes de tocar nada)

Analizar el `.xlsx` adjunto y entregar por escrito, antes de construir nada:

- **Inventario de hojas**: nombre, función, si es entrada, documento imprimible o auxiliar.
- **Mapa de celdas de entrada**: qué celdas escribe realmente el usuario en cada hoja.
- **Documentos que genera**: qué se imprime, con qué rango de impresión y qué texto legal contiene.
- **Fórmulas y dependencias**: referencias entre hojas, rangos con nombre, validaciones
  de datos, formatos condicionales, hipervínculos, celdas combinadas, macros si las hay.
- **Problemas detectados**: datos duplicados, textos legales escritos dentro de fórmulas,
  rutas locales `C:\Users\...`, hipervínculos rotos, formatos de fecha inconsistentes,
  celdas desprotegidas con fórmulas, campos obligatorios sin control.
- **Transcripción literal de todos los textos jurídicos** encontrados, para poder
  reutilizarlos sin reescribirlos.

Regla dura: **no se elimina ni se reescribe ningún texto legal del original sin
avisar explícitamente y listar el cambio propuesto.** Se puede mejorar estructura,
maquetación y automatización; el sentido jurídico se conserva.

---

## 2. Estructura destino del nuevo libro

Cinco hojas, en este orden.

### Hoja 1 — `DATOS`
Único punto de entrada manual. Celdas de entrada con relleno diferenciado y borde;
todo lo demás bloqueado. Secciones:

| Sección | Campos |
|---|---|
| Cliente | Empresa · Nombre persona autorizada · DNI/NIF |
| Vehículo | Matrícula |
| Tacógrafo | Marca · Modelo · Nº de serie |
| Intervención | Nº informe/certificado · Fecha informe · Fecha entrega · Tipo de operación (`Transferencia correcta` / `Intransferibilidad`) |
| Entrega de datos | Modalidad única: `En mano` / `Email` / `Mensajería` / `Correo certificado` |
| Tacógrafo averiado | Se entrega al cliente `Sí`/`No` · Se achatarrará `Sí`/`No` |

- Listas desplegables (validación de datos) en tipo de operación, modalidad y todos los Sí/No.
- La modalidad es **una sola celda con lista**, no cuatro casillas — así es imposible marcar dos.
- Bloque de **avisos**: una columna a la derecha de cada campo obligatorio con
  `SI(campo="";"⚠ Obligatorio";"")`, más un semáforo de resumen arriba
  (`Faltan N campos obligatorios` / `Datos completos`) y formato condicional en rojo.
- Los campos obligatorios dependen del tipo de operación: en `Transferencia correcta`
  no se exigen los campos de achatarramiento, y viceversa.

### Hoja 2 — `JUSTIFICANTE TRANSFERENCIA`
Documento imprimible A4 que reproduce el justificante original: autorización de
descarga de la memoria interna, transferencia de los archivos y modalidad de
entrega elegida. Cabecera con datos del centro técnico desde `CONFIG`. Pie con
lugar, fecha, nombre, NIF y espacio de firma.

### Hoja 3 — `INTRANSFERIBILIDAD CLIENTE`
Acuse de recibo: el cliente o persona autorizada declara haber recibido el
certificado de intransferibilidad de la intervención. Incluye empresa, matrícula,
modelo, nº de serie, nº de informe, fecha del informe, nombre, DNI, fecha de
entrega y firma. Añade las líneas de entrega física del tacógrafo averiado y de
achatarramiento cuando proceda.

### Hoja 4 — `INTRANSFERIBILIDAD ADMINISTRACIÓN`
Comunicación del certificado de intransferibilidad a la Generalitat de Catalunya,
con modelo, nº de serie, matrícula, nº de informe/certificado y fecha insertados
automáticamente. Incluye además un bloque de **texto plano copiable** (una celda
con el párrafo completo montado con `TEXTOUNIR`/`&`) para pegarlo directamente en
el formulario del trámite, y el hipervínculo al trámite tomado de `CONFIG`.

### Hoja 5 — `CONFIG`
Datos fijos del centro, referenciados por nombre desde las demás hojas:
`Cfg_Empresa` = COMERCIAL SEA S.A. · `Cfg_CentroTecnico` · `Cfg_NumCentro` = E943009 ·
`Cfg_Direccion` · `Cfg_Ciudad` · `Cfg_Email` · `Cfg_UrlTramite`.
También las listas maestras (`Lst_Operacion`, `Lst_Modalidad`, `Lst_SiNo`) y los
párrafos legales largos, uno por celda, para que **ningún texto jurídico viva
dentro de una fórmula**.

---

## 3. Requisitos técnicos

1. Dato introducido una sola vez; el resto se deriva por fórmula.
2. Sin macros. Libro `.xlsx` estándar, compatible con Excel de escritorio.
3. Sin rutas locales `C:\Users\...`. Hipervínculos web o relativos.
4. Fechas en `dd/mm/aaaa`; se muestran con `TEXTO(fecha;"dd/mm/aaaa")` dentro de
   los párrafos para que no aparezca el número de serie.
5. Matrícula siempre en mayúsculas (`MAYUSC`) en los documentos.
6. Rangos con nombre para todas las entradas (`Dat_Empresa`, `Dat_Matricula`, …);
   los documentos no referencian celdas por coordenada.
7. Fórmulas sencillas y legibles: `SI`, `SI.ERROR`, `TEXTO`, `MAYUSC`, `&`.
   Nada de matriciales ni funciones exclusivas de Microsoft 365.
8. Los documentos que no correspondan al tipo de operación seleccionado se
   marcan visiblemente (`— No aplica a esta intervención —`) en lugar de imprimir
   un documento con huecos.
9. Impresión: A4 vertical, márgenes 1,5–2 cm, área de impresión definida por hoja,
   ajustado a 1 página de ancho, sin líneas de cuadrícula, sin celdas auxiliares
   dentro del área de impresión.
10. Protección: todas las hojas protegidas sin contraseña destructiva; sólo las
    celdas de entrada de `DATOS` y `CONFIG` quedan desbloqueadas.
11. Aspecto limpio: tipografía única, cabecera con datos del centro, numeración
    de documento, sin colores chillones en lo que se imprime.

---

## 4. Entregable

- `xlsx` final listo para usar en el centro técnico.
- Informe de análisis de la fase 0.
- Lista explícita de cualquier cambio sobre los textos legales originales, si lo hubiera.

## 5. Preguntas abiertas

- Falta el `.xlsx` original (no llegó adjunto): sin él no puede hacerse la fase 0
  ni garantizarse la conservación literal de los textos jurídicos.
- ¿El nº de informe/certificado sigue una serie que deba autogenerarse, o se teclea?
- ¿Los documentos deben llevar logotipo del centro?
- ¿La comunicación a la administración se presenta en catalán, castellano o ambos?
