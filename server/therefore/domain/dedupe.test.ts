import { describe, expect, it } from "vitest";
import {
  PESOS_DEDUPE_POR_DEFECTO,
  UMBRALES_DEDUPE_POR_DEFECTO,
  clasificarNotificacion,
  cuentaComoReclamacion,
  deduplicar,
  normalizarIdentificador,
  normalizarNombre,
  planDeFusion,
  puntuar,
  type CorreoNormalizado,
  type ExpedienteCandidato,
} from "./dedupe.ts";

/* ── Ayudantes ───────────────────────────────────────────────────────────── */

function correo(cambios: Partial<CorreoNormalizado> = {}): CorreoNormalizado {
  return {
    tipo: "INCIDENCIA_ALBARAN",
    empresaCodigo: "007",
    proveedorCodigo: "P100",
    proveedorNombre: "PROVEEDOR UNO, S.L.",
    facturaNumero: "0000555111",
    importeCentimos: -4563,
    hilo: null,
    enRespuestaA: null,
    hashesAdjuntos: [],
    actuaciones: [{ accion: "GRABAR", albaranNormalizado: "9011223344" }],
    urgente: false,
    tareaVencida: false,
    reclamacion: false,
    ...cambios,
  };
}

function expediente(cambios: Partial<ExpedienteCandidato> = {}): ExpedienteCandidato {
  return {
    id: "exp-1",
    numero: "INC-000452",
    estado: "PENDIENTE",
    tipo: "INCIDENCIA_ALBARAN",
    empresaCodigo: "007",
    proveedorCodigo: "P100",
    proveedorNombre: "PROVEEDOR UNO, S.L.",
    facturaNumero: "0000555111",
    importeCentimos: -4563,
    fechaUltimaNotificacion: "2026-09-01T10:00:00.000Z",
    actuaciones: [
      { id: "act-1", accion: "GRABAR", albaranNormalizado: "9011223344", descartada: false },
    ],
    hashesAdjuntos: [],
    hilos: [],
    messageIds: [],
    numeroNotificaciones: 1,
    ...cambios,
  };
}

const puntos = (c: ReturnType<typeof puntuar>, clave: string) =>
  c.motivos.find((m) => m.clave === clave)?.puntos ?? 0;

/* ── Normalización de identificadores ────────────────────────────────────── */

describe("normalizar identificadores", () => {
  it("la misma factura escrita con y sin ceros es la misma", () => {
    expect(normalizarIdentificador("0000555111")).toBe("555111");
    expect(normalizarIdentificador("555111")).toBe("555111");
    expect(normalizarIdentificador("555.111")).toBe("555111");
  });

  /*
   * La diferencia con `claveAlbaran`, que sí trocea en tiradas de dígitos: un
   * albarán viene con prefijo del proveedor y hay que quedarse con el núcleo;
   * una factura no, y trocearla dejaría «FA-2026/001» en «1», que coincide con
   * cualquier cosa. Dos problemas parecidos con respuestas distintas.
   */
  it("una referencia con letras no se reduce a su último número", () => {
    expect(normalizarIdentificador("FA-2026/001")).toBe("FA2026001");
    expect(normalizarIdentificador("FA-2026/001")).not.toBe("1");
  });

  it("lo que no tiene nada comparable es null", () => {
    expect(normalizarIdentificador("")).toBeNull();
    expect(normalizarIdentificador("---")).toBeNull();
    expect(normalizarIdentificador(null)).toBeNull();
    expect(normalizarIdentificador("000")).toBeNull();
  });

  it("el nombre del proveedor no depende de la forma jurídica ni de los acentos", () => {
    expect(normalizarNombre("Neumáticos Ejemplo, S.L.")).toBe("NEUMATICOS EJEMPLO");
    expect(normalizarNombre("NEUMATICOS EJEMPLO SL")).toBe("NEUMATICOS EJEMPLO");
  });
});

/* ── Cada peso, por separado ─────────────────────────────────────────────── */

describe("puntuación", () => {
  it("misma factura suma su peso", () => {
    const c = puntuar(correo(), expediente({ actuaciones: [], importeCentimos: null }));
    expect(puntos(c, "misma_factura")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismaFactura);
  });

  it("facturas distintas restan", () => {
    const c = puntuar(correo({ facturaNumero: "999" }), expediente());
    expect(puntos(c, "factura_diferente")).toBe(PESOS_DEDUPE_POR_DEFECTO.facturaDiferente);
    expect(puntos(c, "misma_factura")).toBe(0);
  });

  /*
   * Si sólo uno de los dos tiene factura no se puede decir nada: ni que es la
   * misma ni que es otra. Restar ahí castigaría al correo que viene incompleto,
   * que es justamente el que más necesita que lo agrupen bien.
   */
  it("una factura que falta no suma ni resta", () => {
    const c = puntuar(correo({ facturaNumero: null }), expediente());
    expect(puntos(c, "misma_factura")).toBe(0);
    expect(puntos(c, "factura_diferente")).toBe(0);
  });

  it("el mismo albarán suma una vez aunque coincidan varios", () => {
    const uno = puntuar(correo(), expediente());
    const varios = puntuar(
      correo({
        actuaciones: [
          { accion: "GRABAR", albaranNormalizado: "9011223344" },
          { accion: "GRABAR", albaranNormalizado: "501234" },
        ],
      }),
      expediente({
        actuaciones: [
          { id: "a", accion: "GRABAR", albaranNormalizado: "9011223344", descartada: false },
          { id: "b", accion: "GRABAR", albaranNormalizado: "501234", descartada: false },
        ],
      })
    );
    expect(puntos(uno, "mismo_albaran")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoAlbaran);
    expect(puntos(varios, "mismo_albaran")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoAlbaran);
  });

  it("una actuación descartada ya no cuenta como albarán del expediente", () => {
    const c = puntuar(
      correo(),
      expediente({
        actuaciones: [
          { id: "act-1", accion: "GRABAR", albaranNormalizado: "9011223344", descartada: true },
        ],
      })
    );
    expect(puntos(c, "mismo_albaran")).toBe(0);
  });

  it("el importe con signo tiene que coincidir en el signo", () => {
    const igual = puntuar(correo(), expediente({ actuaciones: [] }));
    const alReves = puntuar(correo({ importeCentimos: 4563 }), expediente({ actuaciones: [] }));
    expect(puntos(igual, "mismo_importe")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoImporte);
    expect(puntos(alReves, "mismo_importe")).toBe(0);
  });

  it("dos códigos de proveedor distintos restan; dos nombres distintos no", () => {
    const porCodigo = puntuar(correo({ proveedorCodigo: "P999" }), expediente());
    expect(puntos(porCodigo, "proveedor_diferente")).toBe(
      PESOS_DEDUPE_POR_DEFECTO.proveedorDiferente
    );

    const porNombre = puntuar(
      correo({ proveedorCodigo: null, proveedorNombre: "OTRO PROVEEDOR, S.L." }),
      expediente({ proveedorCodigo: null })
    );
    expect(puntos(porNombre, "proveedor_diferente")).toBe(0);
    expect(puntos(porNombre, "mismo_proveedor")).toBe(0);
  });

  it("el mismo proveedor se reconoce por el nombre cuando falta el código", () => {
    const c = puntuar(
      correo({ proveedorCodigo: null, proveedorNombre: "Proveedor Uno SL" }),
      expediente({ proveedorCodigo: null, proveedorNombre: "PROVEEDOR UNO, S.L." })
    );
    expect(puntos(c, "mismo_proveedor")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoProveedor);
  });

  it("el mismo adjunto suma", () => {
    const c = puntuar(
      correo({ hashesAdjuntos: ["abc"] }),
      expediente({ hashesAdjuntos: ["abc", "def"] })
    );
    expect(puntos(c, "mismo_documento")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoDocumento);
  });

  it("el hilo suma por el identificador del servidor o por el In-Reply-To", () => {
    const porHilo = puntuar(correo({ hilo: "t-1" }), expediente({ hilos: ["t-1"] }));
    const porRespuesta = puntuar(
      correo({ enRespuestaA: "<uno@therefore>" }),
      expediente({ messageIds: ["<uno@therefore>"] })
    );
    expect(puntos(porHilo, "mismo_hilo")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoHilo);
    expect(puntos(porRespuesta, "mismo_hilo")).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoHilo);
  });

  it("una aprobación de factura y una incidencia de albarán no son lo mismo", () => {
    const c = puntuar(correo({ tipo: "APROBACION_FACTURA" }), expediente());
    expect(puntos(c, "tipo_incompatible")).toBe(PESOS_DEDUPE_POR_DEFECTO.tipoIncompatible);
  });

  /*
   * OTRO es el cajón de lo que no se ha sabido clasificar. Castigarlo separaría
   * un correo mal clasificado de su propio expediente, que es el error que más
   * cuesta ver: el trabajo aparece dos veces y ninguna de las dos está mal.
   */
  it("OTRO no es incompatible con nada", () => {
    expect(puntos(puntuar(correo({ tipo: "OTRO" }), expediente()), "tipo_incompatible")).toBe(0);
    expect(puntos(puntuar(correo(), expediente({ tipo: "OTRO" })), "tipo_incompatible")).toBe(0);
  });

  it("cada motivo lleva su texto para la pantalla de revisión", () => {
    const c = puntuar(correo(), expediente());
    expect(c.motivos.map((m) => m.texto)).toContain("misma factura 0000555111");
    expect(c.motivos.map((m) => m.texto)).toContain("albarán 9011223344 ya en INC-000452");
  });
});

/* ── Los casos del encargo ───────────────────────────────────────────────── */

describe("las decisiones que pide el encargo", () => {
  /* Caso 3: la reclamación del mismo problema NO abre expediente nuevo. */
  it("caso 3 · una reclamación con la misma factura y el mismo albarán se fusiona", () => {
    const r = deduplicar(correo({ reclamacion: true }), [expediente()]);
    expect(r.decision).toBe("FUSIONAR");
    expect(r.mejor?.id).toBe("exp-1");
    expect(r.mejor!.score).toBeGreaterThanOrEqual(UMBRALES_DEDUPE_POR_DEFECTO.fusionar);
  });

  /*
   * Caso 5. Es la desviación deliberada del cuadro original: con «acción
   * incompatible» restando 40, esto puntuaba 35 y abría expediente nuevo, que
   * es exactamente lo que el encargo prohíbe. Un albarán conocido con otra
   * acción es un cambio de instrucción, no otro problema.
   */
  it("caso 5 · GRABAR y luego MODIFICAR el mismo albarán siguen siendo un expediente", () => {
    const r = deduplicar(
      correo({ actuaciones: [{ accion: "MODIFICAR", albaranNormalizado: "9011223344" }] }),
      [expediente()]
    );
    expect(r.decision).toBe("FUSIONAR");
  });

  /* Caso 7: la reclamación trae un albarán más. Ni se duplica ni se pierde. */
  it("caso 7 · un albarán nuevo junto a los de siempre se añade y los demás no se repiten", () => {
    const cand = expediente({
      actuaciones: [
        { id: "a", accion: "GRABAR", albaranNormalizado: "111", descartada: false },
        { id: "b", accion: "GRABAR", albaranNormalizado: "222", descartada: false },
        { id: "c", accion: "GRABAR", albaranNormalizado: "333", descartada: false },
      ],
    });
    const plan = planDeFusion(
      correo({
        actuaciones: [
          { accion: "GRABAR", albaranNormalizado: "111" },
          { accion: "GRABAR", albaranNormalizado: "222" },
          { accion: "GRABAR", albaranNormalizado: "333" },
          { accion: "GRABAR", albaranNormalizado: "999" },
        ],
      }),
      cand
    );
    expect(plan.nuevas.map((a) => a.albaranNormalizado)).toEqual(["999"]);
    expect(plan.repetidas).toHaveLength(3);
    expect(plan.cambiosInstruccion).toHaveLength(0);
  });

  /* Caso 8: la aprobación y sus tres tareas vencidas son un solo expediente. */
  it("caso 8 · una tarea vencida cae en la aprobación de la misma factura", () => {
    const aprobacion = expediente({
      tipo: "APROBACION_FACTURA",
      numero: "APR-000012",
      actuaciones: [{ id: "a", accion: "APROBAR", albaranNormalizado: null, descartada: false }],
      facturaNumero: "0000555111",
    });
    const r = deduplicar(
      correo({
        tipo: "APROBACION_FACTURA",
        tareaVencida: true,
        actuaciones: [],
        // La tarea vencida llega pelada: sin importe y sin albaranes.
        importeCentimos: null,
      }),
      [aprobacion]
    );
    expect(r.decision).toBe("FUSIONAR");
    expect(r.mejor!.score).toBe(100);
    expect(r.mejor!.motivos[0].clave).toBe("aprobacion_misma_terna");
  });

  it("caso 8 · sin código de proveedor la aprobación se puntúa como todo lo demás", () => {
    const aprobacion = expediente({
      tipo: "APROBACION_FACTURA",
      proveedorCodigo: null,
      actuaciones: [],
    });
    const r = deduplicar(
      correo({ tipo: "APROBACION_FACTURA", proveedorCodigo: null, actuaciones: [] }),
      [aprobacion]
    );
    expect(r.mejor!.score).not.toBe(100);
    expect(r.decision).toBe("FUSIONAR");
  });

  /*
   * Caso 24. Un expediente resuelto NO se reabre solo: puede que el trabajo
   * esté hecho y el correo sea el eco de un proceso que iba con retraso.
   */
  it("caso 24 · una reclamación sobre un expediente resuelto pregunta, no reabre", () => {
    const r = deduplicar(correo({ reclamacion: true }), [expediente({ estado: "RESUELTO" })]);
    expect(r.decision).toBe("RECLAMACION_SOBRE_RESUELTO");
    expect(r.mejor?.numero).toBe("INC-000452");
  });

  it("un expediente cerrado se trata igual que uno resuelto", () => {
    const r = deduplicar(correo(), [expediente({ estado: "CERRADO" })]);
    expect(r.decision).toBe("RECLAMACION_SOBRE_RESUELTO");
  });
});

/* ── Los umbrales ────────────────────────────────────────────────────────── */

describe("decisión", () => {
  it("sin candidatos se crea expediente", () => {
    const r = deduplicar(correo(), []);
    expect(r.decision).toBe("CREAR");
    expect(r.mejor).toBeNull();
    expect(r.candidatos).toEqual([]);
  });

  it("un parecido flojo se crea, y no se arrastra el candidato", () => {
    // Sólo la sociedad en común: 10 puntos.
    const r = deduplicar(
      correo({ facturaNumero: null, proveedorCodigo: null, proveedorNombre: null, importeCentimos: null, actuaciones: [] }),
      [expediente({ facturaNumero: null, proveedorCodigo: null, proveedorNombre: null, importeCentimos: null, actuaciones: [] })]
    );
    expect(r.mejor!.score).toBe(PESOS_DEDUPE_POR_DEFECTO.mismaEmpresa);
    expect(r.decision).toBe("CREAR");
    expect(r.candidatos).toEqual([]);
  });

  /*
   * La franja de en medio es la razón de que esto sea una puntuación y no un
   * `if`. Ni fusiona ni crea: pregunta. Un motor que siempre elige acierta el
   * 95 % y el 5 % restante aparece en contabilidad semanas después.
   */
  it("la franja de en medio pregunta en vez de decidir", () => {
    // Mismo proveedor (20) + misma sociedad (10) + mismo importe (15) = 45.
    const r = deduplicar(
      correo({ facturaNumero: null, actuaciones: [] }),
      [expediente({ facturaNumero: null, actuaciones: [] })]
    );
    expect(r.mejor!.score).toBe(45);
    expect(r.decision).toBe("POSIBLE_DUPLICADO");
    expect(r.candidatos).toHaveLength(1);
  });

  /*
   * El hilo es la señal más barata que hay —el servidor agrupa las
   * reclamaciones de Therefore en el hilo del primero— pero vale 30 y el
   * umbral de revisión es 40, así que por sí solo no arrastra el correo a
   * ningún sitio. Es deliberado: un hilo reutilizado para otra cosa pasa, y si
   * bastara, ese correo acabaría dentro de un expediente ajeno.
   */
  it("el hilo solo no llega ni al umbral de revisión", () => {
    const r = deduplicar(
      correo({
        facturaNumero: null,
        proveedorCodigo: null,
        proveedorNombre: null,
        empresaCodigo: null,
        importeCentimos: null,
        actuaciones: [],
        hilo: "t-1",
      }),
      [expediente({ facturaNumero: null, proveedorCodigo: null, proveedorNombre: null, empresaCodigo: null, importeCentimos: null, actuaciones: [], hilos: ["t-1"] })]
    );
    expect(r.mejor!.score).toBe(PESOS_DEDUPE_POR_DEFECTO.mismoHilo);
    expect(PESOS_DEDUPE_POR_DEFECTO.mismoHilo).toBeLessThan(UMBRALES_DEDUPE_POR_DEFECTO.revisar);
    expect(r.decision).toBe("CREAR");
  });

  it("a la pantalla de revisión van todos los que llegan al umbral, no solo el mejor", () => {
    const a = expediente({
      id: "a",
      numero: "INC-1",
      facturaNumero: null,
      actuaciones: [],
      fechaUltimaNotificacion: "2026-08-01T00:00:00.000Z",
    });
    const b = expediente({
      id: "b",
      numero: "INC-2",
      facturaNumero: null,
      actuaciones: [],
      fechaUltimaNotificacion: "2026-09-10T00:00:00.000Z",
    });
    const flojo = expediente({
      id: "c",
      numero: "INC-3",
      facturaNumero: null,
      proveedorCodigo: null,
      proveedorNombre: null,
      importeCentimos: null,
      actuaciones: [],
    });
    const r = deduplicar(correo({ facturaNumero: null, actuaciones: [] }), [a, b, flojo]);
    expect(r.decision).toBe("POSIBLE_DUPLICADO");
    expect(r.candidatos.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("el empate lo gana el más reciente", () => {
    const viejo = expediente({
      id: "viejo",
      numero: "INC-1",
      fechaUltimaNotificacion: "2026-01-01T00:00:00.000Z",
    });
    const nuevo = expediente({
      id: "nuevo",
      numero: "INC-2",
      fechaUltimaNotificacion: "2026-09-10T00:00:00.000Z",
    });
    expect(deduplicar(correo(), [viejo, nuevo]).mejor?.id).toBe("nuevo");
    expect(deduplicar(correo(), [nuevo, viejo]).mejor?.id).toBe("nuevo");
  });

  it("los pesos y los umbrales se pueden cambiar sin tocar el código", () => {
    const soloAlbaran = correo({
      facturaNumero: null,
      proveedorCodigo: null,
      proveedorNombre: null,
      empresaCodigo: null,
      importeCentimos: null,
    });
    const cand = expediente({
      facturaNumero: null,
      proveedorCodigo: null,
      proveedorNombre: null,
      empresaCodigo: null,
      importeCentimos: null,
    });

    // Con los pesos de casa, albarán (45) + misma acción (10) = 55: se revisa.
    expect(deduplicar(soloAlbaran, [cand]).decision).toBe("POSIBLE_DUPLICADO");

    // Una instalación que se fíe más del albarán lo fusiona sin desplegar nada.
    const r = deduplicar(
      soloAlbaran,
      [cand],
      { ...PESOS_DEDUPE_POR_DEFECTO, mismoAlbaran: 70 },
      UMBRALES_DEDUPE_POR_DEFECTO
    );
    expect(r.decision).toBe("FUSIONAR");
  });
});

/* ── El plan de fusión ───────────────────────────────────────────────────── */

describe("plan de fusión", () => {
  it("mismo albarán y otra acción: la actuación anterior NO se toca", () => {
    const plan = planDeFusion(
      correo({ actuaciones: [{ accion: "MODIFICAR", albaranNormalizado: "9011223344" }] }),
      expediente()
    );
    expect(plan.nuevas).toHaveLength(0);
    expect(plan.repetidas).toHaveLength(0);
    expect(plan.cambiosInstruccion).toEqual([
      {
        albaran: "9011223344",
        actuacionId: "act-1",
        accionAnterior: "GRABAR",
        accionNueva: "MODIFICAR",
      },
    ]);
  });

  it("si la anterior estaba descartada, la nueva acción entra sin preguntar", () => {
    const plan = planDeFusion(
      correo({ actuaciones: [{ accion: "MODIFICAR", albaranNormalizado: "9011223344" }] }),
      expediente({
        actuaciones: [
          { id: "act-1", accion: "GRABAR", albaranNormalizado: "9011223344", descartada: true },
        ],
      })
    );
    expect(plan.cambiosInstruccion).toHaveLength(0);
    expect(plan.nuevas.map((a) => a.accion)).toEqual(["MODIFICAR"]);
  });

  it("una acción sin albarán se crea cuando el expediente no la tenía", () => {
    const plan = planDeFusion(
      correo({ actuaciones: [{ accion: "GESTIONAR", albaranNormalizado: null }] }),
      expediente()
    );
    expect(plan.nuevas).toHaveLength(1);
  });

  /*
   * Y NO se vuelve a crear si ya está. El índice único de la base no cubre las
   * actuaciones sin albarán, así que sin esto una aprobación de factura que
   * nadie atiende —y que genera una tarea vencida cada semana— acabaría con un
   * «aprobar» por correo recibido.
   */
  it("una acción sin albarán que ya está no se duplica", () => {
    const plan = planDeFusion(
      correo({ actuaciones: [{ accion: "APROBAR", albaranNormalizado: null }] }),
      expediente({
        tipo: "APROBACION_FACTURA",
        actuaciones: [
          { id: "act-1", accion: "APROBAR", albaranNormalizado: null, descartada: false },
        ],
      })
    );
    expect(plan.nuevas).toHaveLength(0);
    expect(plan.repetidas).toHaveLength(1);
  });

  it("pero otra acción distinta sin albarán sí entra", () => {
    const plan = planDeFusion(
      correo({ actuaciones: [{ accion: "GESTIONAR", albaranNormalizado: null }] }),
      expediente({
        actuaciones: [
          { id: "act-1", accion: "APROBAR", albaranNormalizado: null, descartada: false },
        ],
      })
    );
    expect(plan.nuevas.map((a) => a.accion)).toEqual(["GESTIONAR"]);
  });

  it("un correo sin actuaciones no cambia nada", () => {
    const plan = planDeFusion(correo({ actuaciones: [] }), expediente());
    expect(plan).toEqual({ nuevas: [], cambiosInstruccion: [], repetidas: [] });
  });
});

/* ── Clasificar el correo dentro del expediente ──────────────────────────── */

describe("clasificar la notificación", () => {
  it("el primero es la solicitud; la aprobación se llama por su nombre", () => {
    const base = { hayCambioInstruccion: false, notificacionesPrevias: 0 };
    expect(clasificarNotificacion(correo(), base)).toBe("SOLICITUD");
    expect(clasificarNotificacion(correo({ tipo: "APROBACION_FACTURA" }), base)).toBe("APROBACION");
  });

  it("el segundo es un recordatorio", () => {
    expect(
      clasificarNotificacion(correo(), { hayCambioInstruccion: false, notificacionesPrevias: 1 })
    ).toBe("RECORDATORIO");
  });

  /*
   * A partir del tercero es reclamación aunque nadie use la palabra: pedir tres
   * veces lo mismo ES reclamar. Si dependiera del texto, un proveedor educado
   * que insiste cinco veces sin quejarse nunca subiría en la cola.
   */
  it("el tercero es una reclamación aunque el texto no lo diga", () => {
    expect(
      clasificarNotificacion(correo(), { hayCambioInstruccion: false, notificacionesPrevias: 2 })
    ).toBe("RECLAMACION");
  });

  it("urgente o con palabras de reclamación, reclamación desde el segundo", () => {
    const opciones = { hayCambioInstruccion: false, notificacionesPrevias: 1 };
    expect(clasificarNotificacion(correo({ urgente: true }), opciones)).toBe("RECLAMACION");
    expect(clasificarNotificacion(correo({ reclamacion: true }), opciones)).toBe("RECLAMACION");
  });

  it("la tarea vencida manda sobre la cuenta de correos", () => {
    expect(
      clasificarNotificacion(correo({ tareaVencida: true }), {
        hayCambioInstruccion: false,
        notificacionesPrevias: 0,
      })
    ).toBe("TAREA_VENCIDA");
  });

  it("el cambio de instrucción manda sobre todo lo demás", () => {
    expect(
      clasificarNotificacion(correo({ tareaVencida: true, urgente: true }), {
        hayCambioInstruccion: true,
        notificacionesPrevias: 5,
      })
    ).toBe("CAMBIO_INSTRUCCION");
  });

  it("solo la reclamación y la tarea vencida suben el contador", () => {
    expect(cuentaComoReclamacion("RECLAMACION")).toBe(true);
    expect(cuentaComoReclamacion("TAREA_VENCIDA")).toBe(true);
    expect(cuentaComoReclamacion("RECORDATORIO")).toBe(false);
    expect(cuentaComoReclamacion("SOLICITUD")).toBe(false);
  });
});
