/**
 * Lo que se le pide al modelo, y el molde en el que tiene que devolverlo.
 *
 * Dos reglas gobiernan este fichero:
 *
 * 1. **Aquí no vive ninguna regla financiera.** El modelo no sabe qué es
 *    ClearOne ni qué TPV tiene este taller, y no tiene por qué: eso lo decide
 *    `classifier.ts` con las reglas de la empresa. Lo que se le pide es que
 *    LEA y que diga lo que ve, campo por campo.
 *
 * 2. **Todo sale como texto, tal y como está impreso.** Ni céntimos, ni fechas
 *    ISO, ni cuentas. Convertir es trabajo de `normalize.ts`, que tiene tests;
 *    un modelo que multiplica por cien se equivoca en silencio.
 *
 * El esquema es ESTRICTO: la Responses API valida la respuesta contra él antes
 * de devolverla, así que lo que llega tiene la forma que dice este fichero o
 * no llega. Eso obliga a que toda propiedad esté en `required` y a que lo
 * opcional se exprese como `["string","null"]`.
 */

const texto = { type: ["string", "null"] } as const;

function objeto<T extends Record<string, unknown>>(propiedades: T) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(propiedades),
    properties: propiedades,
  };
}

export const ESQUEMA_FACTURA = objeto({
  es_factura: {
    type: "boolean",
    description: "true solo si el documento es una factura o un ticket de venta.",
  },
  facturas_detectadas: {
    type: "integer",
    description: "Cuántas facturas distintas hay en el documento. Normalmente 1.",
  },
  factura: objeto({
    numero: {
      ...texto,
      description:
        "Número de factura, tal y como está impreso. Es el que va junto a «Factura», " +
        "«Nº factura» o equivalente fiscal. NO es el número de pedido, ni el de albarán, " +
        "ni el de operación o ticket del TPV, ni el código del cliente.",
    },
    fecha: { ...texto, description: "Fecha de la factura, tal cual: «27/08/2026»." },
  }),
  cliente: objeto({
    codigo: {
      ...texto,
      description: "Código interno del cliente si lo hay. Puede llevar letras: «2979», «CC0890255».",
    },
    nombre: {
      ...texto,
      description:
        "Nombre o razón social de QUIEN RECIBE la factura, no de quien la emite. " +
        "Si viene como «2979 - NOMBRE», aquí va solo el nombre.",
    },
    nif: { ...texto, description: "NIF o CIF del cliente, no el del emisor." },
  }),
  /*
   * Quién EMITE el documento. Se añade sin tocar `cliente`, y ese detalle es
   * todo el diseño:
   *
   * En una factura de venta el emisor es el taller y no interesa —cobros sigue
   * leyendo `cliente` exactamente igual que antes, sin cambio de
   * comportamiento—. En un ticket de compra es al revés: el emisor es la
   * ferretería y es justo el dato que hay que poner en «proveedor».
   *
   * Se extraen los DOS y se decide al usarlos, en vez de tener dos prompts
   * según el sentido. La razón es AutoScan: analiza en cuanto el escáner deja
   * el papel, cuando todavía nadie sabe si es una venta o una compra. Con dos
   * prompts habría que adivinar, o analizar dos veces y pagar el doble.
   */
  emisor: objeto({
    nombre: {
      ...texto,
      description:
        "Nombre o razón social de QUIEN EMITE el documento: el que cobra. En un ticket " +
        "de compra es la tienda o el proveedor; en una factura de venta, el propio taller.",
    },
    nif: { ...texto, description: "NIF o CIF del emisor, no el del destinatario." },
  }),
  vehiculo: objeto({
    marca: { ...texto, description: "Marca. null si no consta o si pone «S/D»." },
    modelo: { ...texto, description: "Modelo. null si no consta o si pone «S/D»." },
    matricula: { ...texto, description: "Matrícula tal cual: «9655JYL»." },
  }),
  concepto: {
    ...texto,
    description:
      "Una línea corta para el histórico de caja, no la factura entera. Se prefiere, por " +
      "este orden: vehículo y matrícula, trabajo principal, producto principal. " +
      "Ejemplos: «NISSAN IVERA · 9655JYL · Cambio de aceite y filtro»; " +
      "«3950LXL · 2 neumáticos Hankook K127 + montaje y equilibrado».",
  },
  totales: objeto({
    base_imponible: { ...texto, description: "Base imponible, tal y como está impresa." },
    iva_importe: { ...texto, description: "Importe del IVA, tal y como está impreso." },
    iva_porcentaje: { ...texto, description: "Tipo de IVA: «21,00%»." },
    total: {
      ...texto,
      description:
        "TOTAL FINAL con impuestos, tal y como está impreso: «195,10 EUR», «22,93 €». " +
        "Se busca por este orden: «Total a Pagar», «Total factura», «Total (IVA incluido)», " +
        "«Total». NUNCA la base imponible, ni el importe del IVA, ni un precio unitario.",
    },
    moneda: { ...texto, description: "«EUR» normalmente." },
  }),
  recibo: objeto({
    detectado: {
      type: "boolean",
      description:
        "true SOLO si en el documento hay un justificante de pago con tarjeta: un recibo " +
        "de TPV, un ticket de datáfono, un resguardo del comercio. Si no lo hay, false. " +
        "No lo deduzcas de que la factura esté pagada.",
    },
    recibos_detectados: { type: "integer", description: "Cuántos justificantes distintos hay." },
    plantilla: {
      type: "string",
      enum: ["INTEGRADO_ERP", "TICKET_BANCO", "DESCONOCIDA"],
      description:
        "INTEGRADO_ERP si el resguardo lo imprime la propia factura, con su misma " +
        "tipografía y sus columnas. TICKET_BANCO si es el papelito del datáfono, pegado " +
        "o fotografiado encima, con su logotipo y su formato de ticket.",
    },
    importe: { ...texto, description: "Importe del justificante, tal cual: «22,93 EUR»." },
    tipo_operacion: { ...texto, description: "«VENTA», «VENDA», «DEVOLUCIÓN»…" },
    tarjeta: {
      ...texto,
      description: "La tarjeta tal y como sale impresa, enmascarada: «************7394».",
    },
    num_operacion: { ...texto, description: "Número de operación del TPV." },
    cod_autorizacion: { ...texto, description: "Código de autorización: «Cod. Aut», «AUT»." },
    comercio: {
      ...texto,
      description: "Número de comercio: «Comercio: 702», «COMERC: 266179530».",
    },
    terminal: { ...texto, description: "Terminal o TPV: «Tpv : 1», «TPV: 01038447»." },
    red: { ...texto, description: "Red de medios de pago: «Servired»…" },
    adquirente: {
      ...texto,
      description:
        "Entidad que presta el TPV, tal y como aparece en el resguardo o en su logotipo: " +
        "«Comercia Global Payments», «Redsys»… Es el proveedor del datáfono, NO la marca " +
        "de la tarjeta del cliente ni el banco que la emitió.",
    },
    cuenta: { ...texto, description: "Cuenta o entidad que indique el propio resguardo." },
    fecha_hora: { ...texto, description: "Fecha y hora del pago, tal cual." },
    texto: {
      ...texto,
      description: "Todo el texto del justificante, seguido, para poder auditarlo después.",
    },
  }),
  confianza: objeto({
    numero_factura: { type: "number", description: "0 a 1." },
    cliente: { type: "number", description: "0 a 1." },
    emisor: { type: "number", description: "0 a 1: seguridad al leer QUIÉN EMITE." },
    total: { type: "number", description: "0 a 1." },
    concepto: { type: "number", description: "0 a 1." },
    recibo: {
      type: "number",
      description: "0 a 1: cuánta seguridad hay de haber leído bien el justificante.",
    },
  }),
});

/**
 * Las instrucciones.
 *
 * Escritas para que el modelo no tenga que decidir nada: se le dice qué campo
 * es cuál, qué NO confundir con qué, y que ante la duda deje null. Un campo
 * vacío se rellena a mano en diez segundos; uno mal relleno hay que
 * descubrirlo primero.
 */
export const INSTRUCCIONES = `Eres el lector de facturas de un taller. Lee el documento adjunto y devuelve sus datos en el esquema dado.

Reglas:

1. Copia lo que ves, TAL Y COMO ESTÁ IMPRESO. No conviertas importes ni fechas, no quites símbolos, no calcules nada. Si en el papel pone «195,10 EUR», devuelve «195,10 EUR».
2. Ante la duda, null. Un campo vacío es mejor que uno inventado.
3. Hay dos partes y las dos se copian: el EMISOR es quien cobra —el que firma el documento— y el CLIENTE es a quien va dirigido. En una factura del taller el emisor es el taller; en un ticket de compra el emisor es la tienda. No decidas cuál importa: copia las dos.
4. El total es el importe final con impuestos, el que se paga.
5. El justificante de pago solo existe si lo ves: un recibo de TPV o un ticket de datáfono, dentro del mismo documento. Que la factura esté pagada no es un justificante.
6. No decidas de qué banco o de qué proveedor es el TPV. Copia el número de comercio, el terminal, la red y el nombre del adquirente si aparecen, y ya está: la clasificación no es tuya.
7. Las confianzas son tuyas de verdad: 0,99 cuando el dato está impreso y claro; por debajo de 0,7 cuando estás adivinando.

El documento puede ser una factura de venta del taller o un ticket de compra a un proveedor, y puede ser un PDF digital, un PDF escaneado o una foto, con el ticket del datáfono pegado encima, torcido o mal enfocado. Un ticket de compra muchas veces no tiene número de factura ni NIF del comprador: eso no es un fallo, es null.`;
