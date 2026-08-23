/**
 * El módulo Tacógrafos contra PostgreSQL de verdad.
 *
 * Aquí se prueba lo que no se puede probar en memoria y que es exactamente lo
 * que no se puede permitir que falle en documentación legal:
 *
 *  · Que el nº de informe no se pueda repetir dentro de una empresa.
 *  · Que **no puedan existir dos documentos vigentes del mismo tipo** — lo
 *    sostiene un índice único parcial, y si esa sintaxis no funcionara la
 *    inmutabilidad sería una ilusión y nadie se enteraría.
 *  · Que las fechas viajen a `DATE` y vuelvan como `aaaa-mm-dd`, sin que una
 *    zona horaria mueva un día el certificado.
 *  · Que las transiciones de estado sean las que son: emitir saca del
 *    borrador, entregar exige haber emitido, y anular cierra la puerta.
 *  · Que una empresa no vea nada de otra.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

// Los PDF y las firmas se guardan en disco durante las pruebas: lo que se
// prueba aquí es el módulo, no el almacenamiento de Supabase.
process.env.TACOGRAFOS_STORAGE_LOCAL = "1";

/*
 * Zona horaria del centro, y no la del servidor de turno.
 *
 * Sin esto, la prueba de fechas pasaba en UTC —donde la CI la ejecutaba— y
 * fallaba en producción: `pg` construye la fecha de una columna DATE a
 * medianoche LOCAL, así que en Madrid un 2025-03-10 vuelve como
 * 2025-03-09T23:00:00Z y `toISOString()` lo daba por día 9. El certificado
 * habría salido fechado un día antes en toda España.
 *
 * Fijarla aquí hace que la prueba vuelva a fallar si alguien reintroduce esa
 * conversión, corra donde corra.
 */
process.env.TZ = "Europe/Madrid";

let db: typeof import("../db.ts").default;
let repo: typeof import("./repository.ts");
let servicio: typeof import("./service.ts");
let ErrorTacografos: typeof import("./repository.ts").ErrorTacografos;

const EMPRESA = "00000000-0000-4000-a000-0000000000aa";
const OTRA_EMPRESA = "00000000-0000-4000-a000-0000000000bb";
const USUARIO = "00000000-0000-4000-a000-0000000000c1";

/** PNG 1x1 opaco: basta para comprobar que la firma llega y vuelve. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
  "base64"
).toString("base64");

function datos(sobre: Partial<import("./domain.ts").DatosExpediente> = {}) {
  return {
    numInforme: "E943009-INT-001",
    tipo: "intransferibilidad" as const,
    empresaCliente: "COMERCIAL TANK FOODS S.L.",
    autorizaNombre: "Joan Pla Serra",
    autorizaNif: "39887654T",
    docTitularidad: true,
    matricula: " 7567 mpf ",
    bastidor: "VF3XXXXXXXXXXXXXX",
    tacMarca: "VDO",
    tacModelo: "1381.7550303006",
    tacSerie: "1000567",
    fechaInforme: "2025-03-10",
    fechaEntrega: "2025-03-14",
    fechaTransferencia: null,
    fechaEnvio: null,
    tecnico: "Marc Roig",
    modalidadEntrega: null,
    receptorNombre: "Marta Solé Vidal",
    receptorDni: "40123456X",
    entregaAparato: false,
    intervencionId: null,
    ...sobre,
  };
}

function datosTransferencia(sobre: Partial<import("./domain.ts").DatosExpediente> = {}) {
  return datos({
    tipo: "transferencia",
    modalidadEntrega: "en_mano",
    fechaTransferencia: "2025-03-10",
    fechaEnvio: "2025-03-11",
    ...sobre,
  });
}

const centro = {
  nombre: "COMERCIAL SEA S.A.",
  centroTecnico: "Centro técnico de Tacógrafos",
  numCentro: "E943009",
  direccion1: "Pol.Ind. Riu Clar",
  direccion2: "C/ Coure, 27",
  ciudad: "43006 Tarragona",
  ciudadFirma: "Tarragona",
  email: "centro@example.com",
  destinatarioAdmin: "Direcció General de Transports i Mobilitat",
  responsableTecnico: "Jordi Cruset",
  urlTramite: "https://web.gencat.cat/ca/tramits/tramits-temes/Peticio-generica",
  urlTramiteOvt: "",
};

describe.runIf(RUN)("Tacógrafos contra PostgreSQL", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    repo = await import("./repository.ts");
    servicio = await import("./service.ts");
    ErrorTacografos = (await import("./repository.ts")).ErrorTacografos;
    await repo.guardarCentro(EMPRESA, centro);
  });

  afterAll(async () => {
    await db.end().catch(() => {});
  });

  beforeEach(async () => {
    // Cada prueba parte de limpio. Las firmas y los documentos primero: llevan
    // clave ajena al expediente.
    await db.query(`DELETE FROM tac_firmas WHERE empresa_id = ANY($1)`, [[EMPRESA, OTRA_EMPRESA]]);
    await db.query(`DELETE FROM tac_documentos WHERE empresa_id = ANY($1)`, [[EMPRESA, OTRA_EMPRESA]]);
    await db.query(`DELETE FROM tac_expedientes WHERE empresa_id = ANY($1)`, [[EMPRESA, OTRA_EMPRESA]]);
  });

  // ── Expedientes ───────────────────────────────────────────────────────────

  it("guarda y devuelve el expediente con la matrícula normalizada", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    expect(e.matricula).toBe("7567MPF");
    const leido = await repo.obtenerExpediente(EMPRESA, e.id);
    expect(leido?.matricula).toBe("7567MPF");
  });

  it("la prueba corre en una zona horaria capaz de destapar el fallo", () => {
    // Guardarraíl del guardarraíl: en UTC la prueba de abajo pasa aunque la
    // conversión esté mal, así que hay que asegurarse de que no estamos en UTC.
    expect(new Date("2025-03-10T00:00:00").getTimezoneOffset()).not.toBe(0);
  });

  it("las fechas vuelven como aaaa-mm-dd, sin correrse un día", async () => {
    // El motor las guarda como DATE y `pg` las devuelve como Date del sistema.
    // Si la conversión pasara por la zona horaria local, un 10/03 podría volver
    // como 09/03 y el certificado saldría con la fecha equivocada.
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    expect(e.fechaInforme).toBe("2025-03-10");
    expect(e.fechaEntrega).toBe("2025-03-14");
    expect(e.fechaTransferencia).toBeNull();
  });

  it("no deja repetir el nº de informe dentro de la misma empresa", async () => {
    await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await expect(repo.crearExpediente(EMPRESA, USUARIO, datos())).rejects.toMatchObject({
      code: "NUM_INFORME_DUPLICADO",
    });
  });

  it("pero dos empresas sí pueden usar el mismo número", async () => {
    await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const otra = await repo.crearExpediente(OTRA_EMPRESA, USUARIO, datos());
    expect(otra.numInforme).toBe("E943009-INT-001");
  });

  it("una empresa no ve los expedientes de otra", async () => {
    const ajeno = await repo.crearExpediente(OTRA_EMPRESA, USUARIO, datos());
    expect(await repo.obtenerExpediente(EMPRESA, ajeno.id)).toBeNull();
    expect(await repo.listarExpedientes(EMPRESA)).toHaveLength(0);
  });

  it("busca por matrícula, empresa, nº de serie y nº de informe", async () => {
    await repo.crearExpediente(EMPRESA, USUARIO, datos());
    for (const texto of ["7567mpf", "tank foods", "1000567", "INT-001"]) {
      expect(await repo.listarExpedientes(EMPRESA, { texto })).toHaveLength(1);
    }
    expect(await repo.listarExpedientes(EMPRESA, { texto: "no existe" })).toHaveLength(0);
  });

  it("un expediente anulado ya no se puede editar", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await repo.anularExpediente(EMPRESA, e.id);
    await expect(
      repo.actualizarExpediente(EMPRESA, e.id, datos({ tecnico: "Otro" }))
    ).rejects.toMatchObject({ code: "EXPEDIENTE_NO_EDITABLE" });
  });

  // ── Emisión de documentos ─────────────────────────────────────────────────

  it("emitir saca al expediente del borrador", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    expect(e.estado).toBe("borrador");
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    expect((await repo.obtenerExpediente(EMPRESA, e.id))?.estado).toBe("emitido");
  });

  it("el documento guarda su hash y la versión de plantilla", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    expect(d.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.plantillaVersion).toBeGreaterThanOrEqual(1);
    expect(d.tamanoBytes).toBeGreaterThan(0);
  });

  it("NO puede haber dos documentos vigentes del mismo tipo", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    await expect(
      servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente")
    ).rejects.toMatchObject({ code: "DOCUMENTO_YA_VIGENTE" });
  });

  it("anulado el anterior, sí se puede reemitir, y quedan los dos", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const primero = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    await repo.anularDocumento(EMPRESA, primero.id, "Nombre del receptor mal escrito");
    const segundo = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");

    const todos = await repo.listarDocumentos(EMPRESA, e.id);
    expect(todos).toHaveLength(2);
    expect(todos.filter((d) => !d.anulado)).toHaveLength(1);
    // El anulado sigue ahí, con su motivo: es el rastro de que hubo dos.
    const anulado = todos.find((d) => d.id === primero.id);
    expect(anulado?.motivoAnulacion).toBe("Nombre del receptor mal escrito");
    // Y en sitios distintos del almacenamiento, para no pisarse.
    expect(segundo.ruta).not.toBe(primero.ruta);
  });

  it("un documento no se anula dos veces", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    await repo.anularDocumento(EMPRESA, d.id, "motivo");
    await expect(repo.anularDocumento(EMPRESA, d.id, "otra vez")).rejects.toMatchObject({
      code: "DOCUMENTO_NO_ANULABLE",
    });
  });

  it("no emite el documento que no corresponde al tipo de operación", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await expect(
      servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "justificante")
    ).rejects.toMatchObject({ code: "DOCUMENTO_NO_APLICA" });
  });

  it("no emite si al expediente le faltan datos obligatorios", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos({ receptorDni: "" }));
    await expect(
      servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente")
    ).rejects.toMatchObject({ code: "EXPEDIENTE_INCOMPLETO" });
  });

  it("los enlaces de descarga se generan para los vigentes y no para los anulados", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    let lista = await servicio.documentosDelExpediente(EMPRESA, e.id);
    expect(lista[0].url).toBeTruthy();
    await repo.anularDocumento(EMPRESA, d.id, "motivo");
    lista = await servicio.documentosDelExpediente(EMPRESA, e.id);
    expect(lista[0].url).toBeNull();
  });

  // ── Firmas ────────────────────────────────────────────────────────────────

  it("guarda la firma y la reemplaza en su sitio, sin duplicarla", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta Solé Vidal");
    const primera = await repo.listarFirmas(EMPRESA, e.id);
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta Solé Vidal");
    const segunda = await repo.listarFirmas(EMPRESA, e.id);
    expect(primera).toHaveLength(1);
    expect(segunda).toHaveLength(1);
    expect(segunda[0].ruta).not.toBe(primera[0].ruta);
  });

  it("rechaza lo que no sea un PNG", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const basura = Buffer.from("esto no es una imagen").toString("base64");
    await expect(
      servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", basura, "X")
    ).rejects.toMatchObject({ code: "FIRMA_NO_PNG" });
  });

  it("emitido el documento, ya no se puede volver a firmar", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta");
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    await expect(
      servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta")
    ).rejects.toMatchObject({ code: "FIRMA_BLOQUEADA" });
  });

  it("la firma acaba dentro del PDF emitido", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta");
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    const { leerDocumento } = await import("./storage.ts");
    const pdf = await leerDocumento(d.ruta);
    expect(pdf).not.toBeNull();
    expect(pdf!.toString("latin1")).toContain("/Subtype /Image");
  });

  // ── Entrega ───────────────────────────────────────────────────────────────

  it("no se puede entregar lo que no se ha emitido", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await expect(
      servicio.registrarEntrega(EMPRESA, e.id, {
        fechaEntrega: "2025-03-14",
        receptorNombre: "Marta Solé Vidal",
        receptorDni: "40123456X",
      })
    ).rejects.toMatchObject({ code: "ENTREGA_NO_POSIBLE" });
  });

  it("registrar la entrega deja el estado y el receptor guardados", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    const entregado = await servicio.registrarEntrega(EMPRESA, e.id, {
      fechaEntrega: "2025-03-20",
      receptorNombre: "Pere Roca",
      receptorDni: "41222333Z",
    });
    expect(entregado.estado).toBe("entregado");
    expect(entregado.fechaEntrega).toBe("2025-03-20");
    expect(entregado.receptorNombre).toBe("Pere Roca");
  });

  it("reemitir un documento no deshace una entrega ya registrada", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    await servicio.registrarEntrega(EMPRESA, e.id, {
      fechaEntrega: "2025-03-20",
      receptorNombre: "Pere Roca",
      receptorDni: "41222333Z",
    });
    await repo.anularDocumento(EMPRESA, d.id, "corrección");
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    expect((await repo.obtenerExpediente(EMPRESA, e.id))?.estado).toBe("entregado");
  });

  // ── Centro y plantillas ───────────────────────────────────────────────────

  it("el centro se guarda una vez por empresa y se actualiza en su sitio", async () => {
    await repo.guardarCentro(EMPRESA, { ...centro, ciudadFirma: "Reus" });
    const leido = await repo.obtenerCentro(EMPRESA);
    expect(leido.ciudadFirma).toBe("Reus");
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM tac_centros WHERE empresa_id = $1`, [EMPRESA]);
    expect(rows[0].n).toBe(1);
    await repo.guardarCentro(EMPRESA, centro);
  });

  it("una empresa sin centro dado de alta recibe los valores por defecto", async () => {
    const vacio = await repo.obtenerCentro("00000000-0000-4000-a000-0000000000ff");
    expect(vacio.numCentro).toBe("");
    expect(vacio.urlTramite).toContain("gencat.cat");
  });

  it("las plantillas están sembradas y se leen por versión", async () => {
    const version = await repo.versionVigente();
    const textos = await repo.cargarPlantillas(version);
    expect(Object.keys(textos).length).toBeGreaterThan(15);
    expect(textos.acuse_p1).toContain("Real decreto 125/2017");
    // Una versión que no existe no revienta: devuelve vacío.
    expect(await repo.cargarPlantillas(999)).toEqual({});
  });

  // ── Justificante (la otra rama) ───────────────────────────────────────────

  it("el justificante se emite en la rama de transferencia correcta", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "justificante");
    expect(d.tipo).toBe("justificante");
    await expect(
      servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente")
    ).rejects.toMatchObject({ code: "DOCUMENTO_NO_APLICA" });
  });

  it("el plazo de custodia sale de la fecha de transferencia", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    const { fechaLimiteDestruccion } = await import("./domain.ts");
    expect(fechaLimiteDestruccion(e.fechaTransferencia)).toBe("2026-03-10");
  });

  it("ErrorTacografos lleva su código y su estado HTTP", async () => {
    const e = new ErrorTacografos("mensaje", "CODIGO", 409);
    expect(e.code).toBe("CODIGO");
    expect(e.status).toBe(409);
  });
});
