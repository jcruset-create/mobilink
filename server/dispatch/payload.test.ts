import { describe, expect, it } from "vitest";

import {
  PROHIBIDOS,
  construirSobre,
  respuestaDeCentral,
  validarParaEnvio,
  type AsistenciaAssist,
} from "./payload.ts";

/** Una asistencia completa, con todo lo que Assist guarda de verdad. */
function asistencia(extra: Partial<AsistenciaAssist> = {}): AsistenciaAssist {
  return {
    id: 4210,
    expediente: "AST-4210",
    plate: "1234ABC",
    vehicleDescription: "Furgón 3.500 kg",
    vehicleMake: "Renault",
    vehicleModel: "Master",
    vehicleType: "furgoneta",
    address: "AP-7 km 245, sentido sur",
    latitude: 41.118,
    longitude: 1.244,
    googleMapsUrl: "https://maps.google.com/?q=41.118,1.244",
    customerName: "Transportes Ejemplo SL",
    customerPhone: "600111222",
    conductorNombre: "Luis",
    solicitanteEmpresa: "Aseguradora XYZ",
    solicitanteNombre: "Marta",
    solicitanteTelefono: "900111222",
    solicitanteAutorizacion: "AUT-99887",
    descripcionAveria: "Rueda reventada eje trasero",
    trabajosARealizar: "Sustituir por la de repuesto",
    priority: "urgente",
    status: "pendiente",
    createdAtMs: 1_700_000_000_000,
    notes: "El cliente debe 300 € de un servicio anterior",
    ...extra,
  };
}

const opciones = {
  correlationId: "COR-20260828-abcd1234",
  referencia: "AST-4210",
  empresaSolicitante: { nombre: "Aseguradora XYZ", cif: "B12345678", telefono: "900111222" },
};

describe("sobre Assist → Central", () => {
  it("lleva lo que hace falta para operar", () => {
    const s: any = construirSobre(asistencia(), opciones);

    expect(s.external_reference).toBe("AST-4210");
    expect(s.priority).toBe("urgente");
    expect(s.address).toContain("AP-7");
    expect(s.location).toEqual({ lat: 41.118, lng: 1.244 });
    expect(s.customer.phone).toBe("600111222");
    expect(s.vehicle.plate).toBe("1234ABC");
    expect(s.vehicle.make).toBe("Renault");
    expect(s.vehicle.model).toBe("Master");
    expect(s.description).toContain("Rueda reventada");
    expect(s.description).toContain("Sustituir");
    expect(s.metadata.correlation_id).toBe("COR-20260828-abcd1234");
    expect(s.metadata.source_system).toBe("assist");
    expect(s.metadata.source_assistance_id).toBe("4210");
    expect(s.metadata.requester.tax_id).toBe("B12345678");
    expect(s.metadata.authorization).toBe("AUT-99887");
    expect(s.metadata.map_url).toContain("maps.google.com");
  });

  /*
   * La prueba que justifica el fichero. Si alguien añade un campo al sobre sin
   * pensar y arrastra un importe, esto lo caza antes de que el margen de
   * Assist acabe en la pantalla de otra plataforma.
   */
  it("NO deja salir nada económico ni interno", () => {
    const s = construirSobre(
      {
        ...asistencia(),
        // Campos que en la fila real conviven con los demás
        ...( {
          costeProveedor: 120,
          precioCliente: 195,
          margen: 75,
          proveedorTallerId: 9,
          subcontrataSnapshot: { tallerNombre: "Grúas Pepe" },
        } as any),
      } as AsistenciaAssist,
      opciones,
    );
    const texto = JSON.stringify(s).toLowerCase();
    for (const prohibido of PROHIBIDOS) {
      expect(texto).not.toContain(prohibido.toLowerCase());
    }
  });

  /*
   * Las observaciones internas suelen llevar datos de terceros y notas que no
   * son para el destino ("debe 300 € de un servicio anterior"). Solo salen si
   * quien envía lo marca.
   */
  it("las observaciones no salen salvo que se marquen", () => {
    const sin: any = construirSobre(asistencia(), opciones);
    expect(sin.metadata.notes).toBeUndefined();

    const con: any = construirSobre(asistencia(), { ...opciones, incluirObservaciones: true });
    expect(con.metadata.notes).toContain("300");
  });

  it("no manda claves vacías: un sobre lleno de nulos es ruido", () => {
    const s: any = construirSobre(
      asistencia({ plate: null, vehicleMake: null, vehicleModel: null, googleMapsUrl: null }),
      opciones,
    );
    expect(s.vehicle).not.toHaveProperty("plate");
    expect(s.vehicle).not.toHaveProperty("make");
    expect(s.metadata).not.toHaveProperty("map_url");
  });

  it("sin coordenadas manda la dirección y no una localización a medias", () => {
    const s: any = construirSobre(asistencia({ latitude: null, longitude: null }), opciones);
    expect(s.location).toBeUndefined();
    expect(s.address).toContain("AP-7");
  });

  it("el contacto cae en el conductor si no hay nombre de cliente", () => {
    const s: any = construirSobre(asistencia({ customerName: null }), opciones);
    expect(s.customer.name).toBe("Luis");
  });

  it("una prioridad rara se normaliza a normal, nunca a urgente", () => {
    const s: any = construirSobre(asistencia({ priority: "loquesea" }), opciones);
    expect(s.priority).toBe("normal");
  });

  it("el límite autorizado viaja cuando se indica: sin él el destino no puede decidir", () => {
    const s: any = construirSobre(asistencia(), { ...opciones, limiteAutorizado: 450 });
    expect(s.metadata.authorized_limit).toBe(450);
  });
});

describe("respuesta del destino", () => {
  it("se queda con el expediente y el id, que es lo que hace falta", () => {
    const r = respuestaDeCentral({
      id: "uuid-central-1",
      expedient_number: "AS-2026-000123",
      status: "pending",
      customer: { name: "no nos interesa" },
    });
    expect(r.externalAssistanceId).toBe("uuid-central-1");
    expect(r.externalReference).toBe("AS-2026-000123");
    expect(r.status).toBe("pending");
  });

  it("aguanta una respuesta vacía o rara sin romperse", () => {
    expect(respuestaDeCentral(null)).toEqual({
      externalAssistanceId: null, externalReference: null, status: null,
    });
    expect(respuestaDeCentral({}).externalReference).toBeNull();
  });
});

describe("validación antes de enviar", () => {
  it("una asistencia completa pasa", () => {
    expect(validarParaEnvio(asistencia())).toEqual([]);
  });

  /*
   * Se valida ANTES de crear el envío: mandar una asistencia sin sitio ni
   * teléfono obliga al destino a llamar para preguntar, y eso lo paga el
   * cliente en minutos de espera.
   */
  it("exige saber dónde es", () => {
    const f = validarParaEnvio(asistencia({ address: "", latitude: null, longitude: null }));
    expect(f.join(" ")).toContain("coordenadas");
  });

  it("las coordenadas valen aunque no haya dirección escrita", () => {
    expect(validarParaEnvio(asistencia({ address: "" }))).toEqual([]);
  });

  it("exige un teléfono, del cliente o del solicitante", () => {
    expect(validarParaEnvio(asistencia({ customerPhone: "", solicitanteTelefono: "" }))
      .join(" ")).toContain("teléfono");
    expect(validarParaEnvio(asistencia({ customerPhone: "" }))).toEqual([]);
  });

  it("exige saber qué pasa", () => {
    expect(validarParaEnvio(asistencia({ descripcionAveria: "", trabajosARealizar: "" }))
      .join(" ")).toContain("avería");
  });

  /*
   * La matrícula NO se exige: hay asistencias legítimas sin ella y bloquear el
   * envío por eso sería peor que enviarlo.
   */
  it("no exige matrícula", () => {
    expect(validarParaEnvio(asistencia({ plate: null }))).toEqual([]);
  });
});
