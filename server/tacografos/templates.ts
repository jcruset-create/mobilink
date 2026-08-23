/**
 * Textos legales de los documentos, versionados.
 *
 * Están aquí como **semilla** y se copian a `tac_plantillas` al arrancar. Los
 * documentos leen de la tabla, no de este fichero: un cambio normativo crea una
 * versión nueva y los documentos ya emitidos siguen apuntando a la suya, que es
 * lo que permite explicar dentro de tres años por qué un certificado de 2025
 * decía lo que decía.
 *
 * Proceden literalmente del libro original del centro
 * (`docs/plantillas/TACOGRAFOS_documentacion.xlsx`). Las desviaciones respecto
 * de aquél están listadas una a una en `docs/ANALISIS_excel_tacografos.md`; la
 * más visible es que la cita del real decreto lleva barra —RD 125/2017— y no
 * dos puntos, como aparecía en el original.
 *
 * Las cláusulas de confidencialidad, custodia y titularidad NO estaban en el
 * libro: salen de las notas D, E y F del anexo II del RD 125/2017, reproducidas
 * en el anexo C de la UNE 66102:2025.
 *
 * Este fichero NO toca la base de datos a propósito: los textos legales son lo
 * más delicado del módulo y tienen que poder leerse y probarse sin levantar
 * nada. La siembra vive en `schema.ts` y la lectura en `repository.ts`.
 */

/** Subir esto crea una versión nueva de TODAS las plantillas de la semilla. */
export const VERSION_SEMILLA = 1;

export const PLANTILLAS: Record<string, string> = {
  // ── Justificante de transferencia ────────────────────────────────────────
  just_titulo:
    "JUSTIFICANTE PARA AUTORIZAR TODO EL PROCESO DE TRANSFERENCIA, EN EL CAMBIO DE UN " +
    "TACÓGRAFO DIGITAL CON DESCARGA DE LA MEMORIA INTERNA DEL MISMO.",
  just_informado: "He sido informado por el centro técnico de tacógrafos de",
  just_contrasena: "con contraseña",
  just_marca: ", de que el tacógrafo marca:",
  just_p1:
    "instalado en el vehículo de matrícula indicada arriba, que ha de cambiarse, puede ser " +
    "correctamente descargado en el contenido de su memoria interna.",
  just_p2:
    "Siendo representante de la empresa propietaria del vehículo o estando autorizado por la " +
    "Dirección de la misma, doy la indicación y autorizo, al centro técnico de tacógrafos de " +
    "COMERCIAL SEA, S.A. a la descarga de la mencionada memoria interna del tacógrafo.",
  just_p3:
    "Quedo advertido, en caso de no ser uno de los representantes de dicha empresa, de que debo " +
    "autorizar todo este proceso habiendo recibido indicación expresa de la Dirección de la misma " +
    "a actuar en el sentido en el que me manifiesto y que el proceso no tendrá respaldo legal si " +
    "yo falseo esta autorización.",
  just_p4:
    "Doy la indicación, así mismo, de que los archivos de transferencia originados en la " +
    "mencionada descarga sean entregados a la empresa propietaria del vehículo a través del medio " +
    "indicado debajo, de entre las cuatro posibles opciones indicadas en el punto 6 de la " +
    "disposición adicional primera del Real decreto 125/2017 (señálese la opción que proceda)",
  just_op_en_mano:
    "Entrega en mano a una persona designada y autorizada para tal por la empresa propietaria " +
    "del vehículo de matrícula arriba indicada",
  just_op_email: "Entrega por medios electrónicos (por ejemplo, email)",
  just_op_mensajeria: "Entrega a través de empresa de mensajería",
  just_op_correo_certificado: "Entrega por correo certificado",
  just_firma:
    "FIRMA DE LA PERSONA QUE AUTORIZA LA DESCARGA Y DA LA INDICACIÓN PARA LA MODALIDAD DE " +
    "ENTREGA DE LOS ARCHIVOS DE TRANSFERENCIA",

  // ── Cláusulas de las notas D, E y F del anexo II ──────────────────────────
  clausula_confid:
    "Los datos contenidos en la memoria de la unidad intravehicular tienen carácter confidencial. " +
    "El solicitante debe evaluar la confidencialidad de los datos transferidos para el " +
    "procedimiento de remisión que elija. El centro técnico no será responsable de la violación " +
    "de la confidencialidad de los datos durante su remisión (nota E del anexo II del Real " +
    "decreto 125/2017).",
  clausula_custodia:
    "Los datos recuperados de la unidad instalada en el vehículo se guardarán en el centro " +
    "técnico durante un año desde la fecha de la transferencia. Una vez cumplido dicho plazo, los " +
    "datos serán destruidos (nota F del anexo II del Real decreto 125/2017).",
  clausula_titularidad:
    "Se ha presentado al centro técnico documento que avala la titularidad de los datos por parte " +
    "de la empresa de transportes, verificado y archivado por el centro (nota D del anexo II del " +
    "Real decreto 125/2017).",

  // ── Acuse de recibo del certificado de intransferibilidad ─────────────────
  acuse_titulo: "Acuse de recibo Certificado de Intransferibilidad de datos",
  acuse_saludo: "Estimados señores:",
  acuse_p1:
    "En cumplimiento del requisito expresado en la disposición adicional primera, apartado 10, " +
    "del Real decreto 125/2017, les remitimos copia del certificado de intransferibilidad " +
    "correspondiente a la sustitución del tacógrafo:",
  acuse_compromiso:
    "En el caso de que el receptor no sea propietario de la organización de transportes, se " +
    "compromete explícitamente, por el presente compromiso firmado, a entregar este documento " +
    "(el certificado de intransferibilidad) a la propiedad de la citada organización",
  acuse_entrega_si: "***Se entrega tacógrafo Averiado",
  acuse_achatarrar_si: "***El tacógrafo se achatarrará",

  // ── Acta de destrucción de los archivos transferidos ──────────────────────
  // Apartado 8.5.1 de la UNE 66102:2025 y nota F del anexo II: pasado un año
  // desde la transferencia, los archivos se destruyen y de cada destrucción se
  // levanta un documento con siete datos, que son los que lleva esta acta.
  acta_titulo: "ACTA DE DESTRUCCIÓN DE ARCHIVOS DE TRANSFERENCIA DE DATOS",
  acta_p1:
    "En cumplimiento de lo establecido en la disposición adicional primera del Real decreto " +
    "125/2017 y en el apartado 8.5.1 de la Norma UNE 66102:2025, transcurrido un año desde la " +
    "fecha de la transferencia, se procede a la destrucción de los archivos que contenían los " +
    "datos descargados de la unidad intravehicular identificada a continuación, así como de sus " +
    "copias de seguridad.",
  acta_p2:
    "El responsable técnico del centro deja constancia de que la destrucción se ha realizado por " +
    "el método indicado y de que no se conserva ninguna otra copia de dichos archivos.",

  // ── Trámite telemático ante la Generalitat (en catalán) ───────────────────
  // Se compone en un párrafo copiable para pegarlo en la petición genérica.
  cat_exposo_1:
    "En compliment del requisit expressat en la disposició addicional primera, apartat 10, del " +
    "Reial decret 125/2017, els remetem còpia del certificat de intransferibilitat corresponent " +
    "a la substitució del tacògraf: Model: ",
  cat_exposo_2: ", Nº de Sèrie: ",
  cat_exposo_3: ", muntat en el vehicle: ",
  cat_exposo_4: ", Nº d\u2019informe / certificat: ",
  cat_exposo_5: ", Data Informe: ",
  cat_exposo_6: ". Sol\u00b7licito que es doni el tràmit acceptat.",
  cat_assumpte: "Certificat de Intransferibilitat de dades Tacògraf digital",
  cat_fitxer: " Certificat de Intransferibilitat",
};

export type Plantillas = Record<string, string>;
