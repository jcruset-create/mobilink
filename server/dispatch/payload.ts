/**
 * El sobre que viaja de Assist a Central: qué se manda y, sobre todo, qué no.
 *
 * ── Minimización, y por qué no es un adorno ─────────────────────────────────
 *
 * Mandar la fila entera sería más fácil y es exactamente lo que no se puede
 * hacer. La asistencia de Assist lleva dentro lo que Assist le cobra al
 * cliente y lo que le cuesta el servicio; si eso cruza, la plataforma de
 * destino sabe el margen de su cliente y puede tarifar en consecuencia.
 *
 * Así que el sobre se construye campo a campo con una lista blanca. Añadir un
 * campo nuevo a la asistencia NO lo mete aquí solo, que es la propiedad que
 * interesa: para que un dato salga, alguien tiene que escribirlo en esta
 * función a conciencia.
 *
 * Lo mismo al revés lo hace `respuestaDeCentral`: de lo que contesta Central
 * se guarda lo justo para operar, no su ficha completa.
 */

/** Lo que Assist sabe de su asistencia, ya leído de la base. */
export type AsistenciaAssist = {
  id: number;
  expediente: string | null;
  plate: string | null;
  vehicleDescription: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleType?: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  customerName: string | null;
  customerPhone: string | null;
  conductorNombre: string | null;
  solicitanteEmpresa: string | null;
  solicitanteNombre: string | null;
  solicitanteTelefono: string | null;
  solicitanteAutorizacion: string | null;
  descripcionAveria: string | null;
  trabajosARealizar: string | null;
  priority: string | null;
  status: string | null;
  createdAtMs: number | string | null;
  notes?: string | null;
};

/** Datos de quien pide el servicio, para que el destino sepa a quién factura. */
export type EmpresaSolicitante = {
  nombre: string;
  cif: string | null;
  email?: string | null;
  telefono?: string | null;
};

export type OpcionesSobre = {
  correlationId: string;
  /** Expediente de Assist: la referencia con la que se hablará por teléfono. */
  referencia: string | null;
  empresaSolicitante: EmpresaSolicitante;
  /** Referencia del cliente final (nº de póliza, pedido, autorización…). */
  referenciaCliente?: string | null;
  /** Tope económico autorizado, si lo hay. Sin él, el destino no puede decidir. */
  limiteAutorizado?: number | null;
  /** Se manda solo si el usuario lo ha marcado: son datos de terceros. */
  incluirObservaciones?: boolean;
};

function texto(v: unknown): string | undefined {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? undefined : s;
}

function numero(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Quita las claves sin valor: un sobre con nulos es ruido para quien lo lee. */
function limpiar<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined) delete o[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      limpiar(v as Record<string, unknown>);
      if (Object.keys(v as object).length === 0) delete o[k];
    }
  }
  return o;
}

/**
 * Construye el cuerpo del POST a la API pública de Central.
 *
 * El formato es el que la API ya acepta (customer, location, vehicle,
 * metadata): no se inventa uno nuevo para no tener dos contratos que mantener.
 * Lo específico de esta integración viaja dentro de `metadata`, que es el
 * hueco que la API reserva para el partner y que NO se inyecta al núcleo.
 */
export function construirSobre(a: AsistenciaAssist, op: OpcionesSobre): Record<string, unknown> {
  const prioridad = a.priority === "urgente" ? "urgente" : "normal";

  /*
   * La avería y los trabajos van juntos en la descripción: son lo que el
   * destino necesita para decidir si puede con ello y qué unidad manda.
   */
  const descripcion = [texto(a.descripcionAveria), texto(a.trabajosARealizar)]
    .filter(Boolean)
    .join(". ");

  const sobre = {
    external_reference: texto(op.referencia),
    priority: prioridad,
    service_type: "other",
    description: texto(descripcion),

    address: texto(a.address),
    location:
      typeof a.latitude === "number" && typeof a.longitude === "number"
        ? { lat: a.latitude, lng: a.longitude }
        : undefined,

    /*
     * El contacto es el de quien está con el vehículo, no el de la oficina de
     * Assist: quien va a asistir necesita llamar a alguien que esté allí.
     */
    customer: limpiar({
      name: texto(a.customerName) ?? texto(a.conductorNombre),
      phone: texto(a.customerPhone),
    }),

    vehicle: limpiar({
      plate: texto(a.plate),
      make: texto(a.vehicleMake),
      model: texto(a.vehicleModel),
      type: texto(a.vehicleType),
      description: texto(a.vehicleDescription),
    }),

    metadata: limpiar({
      correlation_id: op.correlationId,
      source_system: "assist",
      source_assistance_id: String(a.id),
      source_reference: texto(op.referencia),
      source_created_at: a.createdAtMs != null ? new Date(Number(a.createdAtMs)).toISOString() : undefined,

      // Quién encarga el servicio: con esto el destino resuelve la empresa en
      // su cartera y sabe a quién factura.
      requester: limpiar({
        company: texto(op.empresaSolicitante.nombre),
        tax_id: texto(op.empresaSolicitante.cif),
        email: texto(op.empresaSolicitante.email),
        phone: texto(op.empresaSolicitante.telefono),
        contact_name: texto(a.solicitanteNombre),
        contact_phone: texto(a.solicitanteTelefono),
      }),

      client_reference: texto(op.referenciaCliente) ?? texto(a.solicitanteAutorizacion),
      authorization: texto(a.solicitanteAutorizacion),
      authorized_limit: numero(op.limiteAutorizado),

      // Enlace al mapa: ahorra teclear coordenadas a mano y llegar a otro sitio.
      map_url: texto(a.googleMapsUrl),

      // Las observaciones internas SOLO si se marca al enviar: suelen llevar
      // datos de terceros y notas que no son para el destino.
      notes: op.incluirObservaciones ? texto(a.notes) : undefined,
    }),
  };

  return limpiar(sobre as Record<string, unknown>);
}

/**
 * Campos que NUNCA pueden salir de Assist en este sobre.
 *
 * La lista existe para poder comprobarla en una prueba: es fácil añadir un
 * campo al sobre sin darse cuenta de lo que arrastra, y esto lo caza.
 */
export const PROHIBIDOS = [
  "cost", "coste", "precio", "price", "margen", "margin", "importe",
  "tarifa", "tariff", "invoice", "factura", "proveedorTallerId", "subcontrataSnapshot",
] as const;

/** Lo que se guarda de la respuesta del destino. Ni más ni menos. */
export function respuestaDeCentral(cuerpo: unknown): {
  externalAssistanceId: string | null;
  externalReference: string | null;
  status: string | null;
} {
  const b = (cuerpo ?? {}) as Record<string, any>;
  return {
    externalAssistanceId: b.id != null ? String(b.id) : null,
    // El expediente del destino es el número que se dirá por teléfono cuando
    // haya que preguntar por el servicio.
    externalReference:
      texto(b.expedient_number) ?? texto(b.external_reference) ?? null,
    status: texto(b.status) ?? null,
  };
}

/**
 * Lo mínimo para que el destino pueda trabajar sin llamar por teléfono.
 *
 * Se comprueba ANTES de crear el envío: una asistencia sin sitio ni contacto
 * obliga al destino a llamar para preguntar, y eso lo paga el cliente en
 * minutos de espera.
 *
 * La matrícula no está en la lista: hay asistencias legítimas sin ella (un
 * vehículo sin placa, una avería en finca privada) y bloquear el envío por eso
 * sería peor que enviarlo.
 */
export function validarParaEnvio(a: AsistenciaAssist): string[] {
  const fallos: string[] = [];
  const tieneSitio =
    (a.address ?? "").trim() !== "" ||
    (typeof a.latitude === "number" && typeof a.longitude === "number");
  if (!tieneSitio) fallos.push("dirección o coordenadas");
  if (!(a.customerPhone ?? "").trim() && !(a.solicitanteTelefono ?? "").trim()) {
    fallos.push("un teléfono de contacto");
  }
  if (!(a.descripcionAveria ?? "").trim() && !(a.trabajosARealizar ?? "").trim()) {
    fallos.push("descripción de la avería o de los trabajos");
  }
  return fallos;
}
