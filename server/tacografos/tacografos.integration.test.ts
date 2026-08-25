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
import { extraerTextoPdf as textoDelPdf } from "./pdfTexto.ts";

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

/*
 * El pool se cierra UNA vez, al terminar el fichero entero. Estaba en el
 * `afterAll` del primer bloque y mataba la conexión antes de que corriera el
 * segundo: "Cannot use a pool after calling end on the pool".
 */
afterAll(async () => {
  await db?.end().catch(() => {});
});

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

  beforeEach(async () => {
    // Cada prueba parte de limpio. Las firmas y los documentos primero: llevan
    // clave ajena al expediente.
    await db.query(`DELETE FROM tac_comunicaciones WHERE empresa_id = ANY($1)`, [[EMPRESA, OTRA_EMPRESA]]);
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
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos({ tacSerie: "" }));
    await expect(
      servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente")
    ).rejects.toMatchObject({ code: "EXPEDIENTE_INCOMPLETO" });
  });

  it("sin nombre ni DNI del receptor SÍ se emite: el acuse sale con huecos", async () => {
    const e = await repo.crearExpediente(
      EMPRESA,
      USUARIO,
      datos({ receptorNombre: "", receptorDni: "", autorizaNombre: "", autorizaNif: "" })
    );
    const doc = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    const { leerDocumento } = await import("./storage.ts");
    const texto = textoDelPdf((await leerDocumento(doc.ruta))!);
    // El hueco punteado invita a escribir el dato a mano sobre el papel.
    expect(texto).toContain("Nombre: " + ".".repeat(40));
  });

  // ── Anular: borrar la prueba, conservar el rastro ─────────────────────────

  it("anular un expediente que nunca emitió lo borra del todo, firmas incluidas", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta");
    const r = await servicio.anularExpediente(EMPRESA, e.id);
    expect(r.eliminado).toBe(true);
    expect(await repo.obtenerExpediente(EMPRESA, e.id)).toBeNull();
    expect(await repo.listarFirmas(EMPRESA, e.id)).toEqual([]);
  });

  it("anular uno con documento emitido deja el rastro, no lo borra", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    const r = await servicio.anularExpediente(EMPRESA, e.id);
    expect(r.eliminado).toBe(false);
    expect(r.expediente?.estado).toBe("anulado");
    expect(await repo.listarDocumentos(EMPRESA, e.id)).toHaveLength(1);
  });

  it("el nº de informe de un anulado queda libre para el expediente de verdad", async () => {
    // El caso que motivó esto: una prueba guardada con el nº real y anulada
    // bloqueaba el registro del informe auténtico de la extranet.
    const prueba = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.emitirDocumento(EMPRESA, USUARIO, prueba.id, "acuse_cliente");
    await servicio.anularExpediente(EMPRESA, prueba.id); // queda como rastro
    const real = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    expect(real.numInforme).toBe(prueba.numInforme);
    // Pero entre dos VIVOS sigue chocando.
    await expect(repo.crearExpediente(EMPRESA, USUARIO, datos())).rejects.toMatchObject({
      code: "NUM_INFORME_DUPLICADO",
    });
  });

  it("firmar con la tablet escribe nombre y DNI en el expediente", async () => {
    const e = await repo.crearExpediente(
      EMPRESA,
      USUARIO,
      datos({ receptorNombre: "", receptorDni: "" })
    );
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "Marta Solé Vidal", "40123456X");
    const tras = await repo.obtenerExpediente(EMPRESA, e.id);
    expect(tras?.receptorNombre).toBe("Marta Solé Vidal");
    expect(tras?.receptorDni).toBe("40123456X");
    // Y un firmado sin datos no borra lo que ya había.
    await repo.borrarFirma(EMPRESA, e.id, "receptor");
    await servicio.firmar(EMPRESA, USUARIO, e.id, "receptor", PNG, "", "");
    expect((await repo.obtenerExpediente(EMPRESA, e.id))?.receptorNombre).toBe("Marta Solé Vidal");
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

  // ── Autorrelleno desde el taller (fase 6) ─────────────────────────────────

  it("sin licencia de TyreControl no se consulta nada del taller", async () => {
    const { autorrellenoDisponible, buscar, olvidarEsquema } = await import("./intervenciones.ts");
    olvidarEsquema();
    // Esta base de pruebas no tiene las tablas tc_*, que es exactamente la
    // situación de un centro que compró sólo el módulo de Tacógrafos.
    expect(await autorrellenoDisponible(EMPRESA)).toBe(false);
    expect(await buscar(EMPRESA, "7567")).toEqual([]);
  });

  it("un texto vacío no dispara ninguna consulta", async () => {
    const { buscar } = await import("./intervenciones.ts");
    expect(await buscar(EMPRESA, "   ")).toEqual([]);
  });

  // ── Exportación de respaldo (fase 6) ──────────────────────────────────────

  it("exporta el expediente a un .xlsx con el rastro documental", async () => {
    const XLSX = await import("xlsx");
    const { componerXlsx, nombreFichero } = await import("./export.ts");

    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const d = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acuse_cliente");
    const actualizado = (await repo.obtenerExpediente(EMPRESA, e.id))!;

    const buf = componerXlsx(
      actualizado,
      await repo.obtenerCentro(EMPRESA),
      await repo.listarDocumentos(EMPRESA, e.id)
    );
    const libro = XLSX.read(buf, { type: "buffer" });
    expect(libro.SheetNames).toEqual(["EXPEDIENTE", "DOCUMENTOS"]);

    const texto = XLSX.utils
      .sheet_to_csv(libro.Sheets.EXPEDIENTE)
      .replace(/\r/g, "");
    expect(texto).toContain("E943009-INT-001");
    expect(texto).toContain("7567MPF");
    expect(texto).toContain("Intransferibilidad");
    // Las fechas salen en formato español, no en ISO.
    expect(texto).toContain("10/03/2025");
    // Excluyentes también en el respaldo.
    expect(texto).toContain("Se entrega al cliente,No");
    expect(texto).toContain("Se achatarrará,Sí");

    // El hash es lo que permite comprobar después que el PDF es el que salió
    // de aquí: sin él, el respaldo no serviría para nada.
    const docs = XLSX.utils.sheet_to_csv(libro.Sheets.DOCUMENTOS);
    expect(docs).toContain(d.hash);
    expect(docs).toContain("Vigente");

    expect(nombreFichero(actualizado)).toBe(
      "expediente-E943009-INT-001-7567MPF.xlsx"
    );
  });

  it("el respaldo de una transferencia lleva el plazo de destrucción", async () => {
    const XLSX = await import("xlsx");
    const { componerXlsx } = await import("./export.ts");
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    const texto = XLSX.utils.sheet_to_csv(
      XLSX.read(componerXlsx(e, await repo.obtenerCentro(EMPRESA), []), { type: "buffer" })
        .Sheets.EXPEDIENTE
    );
    expect(texto).toContain("Destruir los archivos a partir de,10/03/2026");
    expect(texto).toContain("En mano");
  });

  it("el nombre del fichero aguanta un nº de informe con caracteres raros", async () => {
    const { nombreFichero } = await import("./export.ts");
    const e = await repo.crearExpediente(
      EMPRESA,
      USUARIO,
      datos({ numInforme: "E943009/2025 nº 7", matricula: "1234 ABC" })
    );
    expect(nombreFichero(e)).toBe("expediente-E943009-2025-n-7-1234ABC.xlsx");
  });

  // ── Custodia y destrucción (fase 5) ───────────────────────────────────────

  it("la cola de custodia sólo trae transferencias sin destruir", async () => {
    await repo.crearExpediente(EMPRESA, USUARIO, datos()); // intransferibilidad
    const t = await repo.crearExpediente(
      EMPRESA,
      USUARIO,
      datosTransferencia({ numInforme: "E943009-INT-002" })
    );
    const cola = await servicio.colaCustodia(EMPRESA);
    expect(cola).toHaveLength(1);
    expect(cola[0].expediente.id).toBe(t.id);
    expect(cola[0].fechaLimite).toBe("2026-03-10");
    expect(cola[0].estado).toBe("pendiente_destruir"); // la transferencia es de 2025
  });

  it("no deja destruir antes de que se cumpla el año", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    await expect(
      servicio.registrarDestruccion(EMPRESA, e.id, {
        fecha: "2025-09-01",
        metodo: "Borrado seguro",
        persona: "Jordi Cruset",
        hash: "a".repeat(64),
      })
    ).rejects.toMatchObject({ code: "DESTRUCCION_ANTES_DE_PLAZO" });
  });

  it("ni sin los cuatro datos del acta", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    await expect(
      servicio.registrarDestruccion(EMPRESA, e.id, {
        fecha: "2026-03-11",
        metodo: "",
        persona: "Jordi Cruset",
        hash: "",
      })
    ).rejects.toMatchObject({ code: "DESTRUCCION_INCOMPLETA" });
  });

  it("un expediente sin transferencia no tiene archivos que destruir", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await expect(
      servicio.registrarDestruccion(EMPRESA, e.id, {
        fecha: "2026-03-11",
        metodo: "Borrado seguro",
        persona: "Jordi Cruset",
        hash: "a".repeat(64),
      })
    ).rejects.toMatchObject({ code: "SIN_TRANSFERENCIA" });
  });

  it("registrada la destrucción, sale de la cola y no se repite", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    const d = {
      fecha: "2026-03-11",
      metodo: "Borrado seguro y destrucción física del soporte",
      persona: "Jordi Cruset",
      hash: "b".repeat(64),
    };
    const actualizado = await servicio.registrarDestruccion(EMPRESA, e.id, d);
    expect(actualizado.destruccionFecha).toBe("2026-03-11");
    expect(await servicio.colaCustodia(EMPRESA)).toHaveLength(0);
    await expect(servicio.registrarDestruccion(EMPRESA, e.id, d)).rejects.toMatchObject({
      code: "DESTRUCCION_NO_POSIBLE",
    });
  });

  it("el acta de destrucción no se emite sin haberla registrado antes", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    await expect(
      servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acta_destruccion")
    ).rejects.toMatchObject({ code: "DESTRUCCION_NO_REGISTRADA" });
  });

  it("el acta lleva los siete datos que exige la norma", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    await servicio.registrarDestruccion(EMPRESA, e.id, {
      fecha: "2026-03-11",
      metodo: "Borrado seguro y destrucción física del soporte",
      persona: "Jordi Cruset",
      hash: "c".repeat(64),
    });
    const doc = await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "acta_destruccion");
    const { leerDocumento } = await import("./storage.ts");
    const pdf = (await leerDocumento(doc.ruta))!;
    const texto = textoDelPdf(pdf);

    expect(texto).toContain("11/03/2026");            // fecha de destrucción
    expect(texto).toContain("7567MPF");               // matrícula
    expect(texto).toContain("VF3XXXXXXXXXXXXXX");     // bastidor
    expect(texto).toContain("1000567");               // nº de serie de la UIV
    expect(texto).toContain("c".repeat(32));          // firma digital, primera mitad
    expect(texto).toContain("Borrado seguro");        // método
    expect(texto).toContain("Jordi Cruset");          // persona
  });

  // ── Comunicaciones a la administración (fase 5) ───────────────────────────

  it("sólo entra en la cola lo que ya tiene la comunicación emitida", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    // Recién creado no se reclama: todavía no ha salido ningún papel.
    expect(await servicio.colaComunicaciones(EMPRESA)).toHaveLength(0);
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "comunicacion_admin");
    const cola = await servicio.colaComunicaciones(EMPRESA);
    expect(cola.map((x) => x.id)).toEqual([e.id]);
  });

  it("anotada la presentación, sale de la cola y el estado pasa a comunicado", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "comunicacion_admin");
    const c = await servicio.registrarComunicacion(EMPRESA, USUARIO, e.id, {
      fechaPresentacion: "2025-03-18",
      referencia: "9015/2025",
      notas: "",
    });
    expect(c.fechaPresentacion).toBe("2025-03-18");
    expect(c.referencia).toBe("9015/2025");
    expect(await servicio.colaComunicaciones(EMPRESA)).toHaveLength(0);
    expect((await repo.obtenerExpediente(EMPRESA, e.id))?.estado).toBe("comunicado");
  });

  it("una segunda presentación no borra la primera", async () => {
    // Si el trámite se rechaza y hay que volver a presentarlo, el intento
    // anterior tiene que seguir ahí.
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    await servicio.emitirDocumento(EMPRESA, USUARIO, e.id, "comunicacion_admin");
    await servicio.registrarComunicacion(EMPRESA, USUARIO, e.id, {
      fechaPresentacion: "2025-03-18", referencia: "9015/2025", notas: "rechazada",
    });
    await servicio.registrarComunicacion(EMPRESA, USUARIO, e.id, {
      fechaPresentacion: "2025-03-25", referencia: "9099/2025", notas: "",
    });
    const todas = await repo.listarComunicaciones(EMPRESA, e.id);
    expect(todas).toHaveLength(2);
    expect(todas[0].referencia).toBe("9099/2025"); // la más reciente primero
  });

  it("una transferencia correcta no se comunica a la administración", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datosTransferencia());
    await expect(
      servicio.registrarComunicacion(EMPRESA, USUARIO, e.id, {
        fechaPresentacion: "2025-03-18", referencia: "x", notas: "",
      })
    ).rejects.toMatchObject({ code: "COMUNICACION_NO_APLICA" });
  });

  it("el texto del trámite sale montado y en catalán", async () => {
    const e = await repo.crearExpediente(EMPRESA, USUARIO, datos());
    const t = await servicio.textoTramite(EMPRESA, e.id);
    expect(t.assumpte).toContain("Certificat de Intransferibilitat");
    expect(t.nomFitxer).toBe("E943009-INT-001 Certificat de Intransferibilitat");
    expect(t.exposo).toContain("Reial decret 125/2017");
    expect(t.exposo).toContain("1381.7550303006");
    expect(t.exposo).toContain("7567MPF");
    expect(t.exposo).toContain("10/03/2025");
    expect(t.exposo).toContain("Sol·licito");
    expect(t.urlTramite).toContain("gencat.cat");
  });

  it("conservar los certificados cinco años desde su emisión", async () => {
    const emitido = Date.parse("2026-08-22T10:00:00");
    expect(servicio.conservarCertificadoHasta(emitido)).toBe("2031-08-22");
  });

  it("ErrorTacografos lleva su código y su estado HTTP", async () => {
    const e = new ErrorTacografos("mensaje", "CODIGO", 409);
    expect(e.code).toBe("CODIGO");
    expect(e.status).toBe(409);
  });
});

/**
 * El autorrelleno con las tablas de TyreControl delante.
 *
 * El bloque de arriba sólo comprueba que sin ellas no se consulta nada. Aquí se
 * levantan unas tablas mínimas con las columnas que usa el JOIN —cuatro tablas
 * enlazadas— y una `app_licencia_activa` que dice que sí, para probar la
 * consulta de verdad y no sólo el camino de la degradación.
 */
describe.runIf(RUN)("Autorrelleno con TyreControl presente", () => {
  const EMPRESA_TC = "00000000-0000-4000-a000-0000000000dd";
  const VEHICULO = "00000000-0000-4000-a000-0000000000e1";
  const CLIENTE = "00000000-0000-4000-a000-0000000000e2";
  const TECNICO = "00000000-0000-4000-a000-0000000000e3";
  let intervenciones: typeof import("./intervenciones.ts");

  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    intervenciones = await import("./intervenciones.ts");

    await db.query(`
      CREATE TABLE IF NOT EXISTS tc_empresas (id UUID PRIMARY KEY, nombre TEXT);
      CREATE TABLE IF NOT EXISTS tc_vehiculos (id UUID PRIMARY KEY, matricula TEXT, bastidor TEXT);
      CREATE TABLE IF NOT EXISTS tc_usuarios (id UUID PRIMARY KEY, nombre TEXT);
      CREATE TABLE IF NOT EXISTS tc_intervenciones (
        id UUID PRIMARY KEY, empresa_id UUID, vehiculo_id UUID, tecnico_id UUID,
        numero TEXT, fecha DATE, created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE OR REPLACE FUNCTION app_licencia_activa(uuid, text)
        RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
    `);
    await db.query(`INSERT INTO tc_empresas VALUES ($1, 'TRANSPORTES PLANA S.L.') ON CONFLICT DO NOTHING`, [CLIENTE]);
    await db.query(`INSERT INTO tc_vehiculos VALUES ($1, '2380jbt', 'WDB9634031L') ON CONFLICT DO NOTHING`, [VEHICULO]);
    await db.query(`INSERT INTO tc_usuarios VALUES ($1, 'Marc Roig') ON CONFLICT DO NOTHING`, [TECNICO]);
    await db.query(
      `INSERT INTO tc_intervenciones (id, empresa_id, vehiculo_id, tecnico_id, numero, fecha)
       VALUES (gen_random_uuid(), $1, $2, $3, 'NT-2026-000089', DATE '2025-03-10')`,
      [CLIENTE, VEHICULO, TECNICO]
    );
    intervenciones.olvidarEsquema();
  });

  afterAll(async () => {
    await db.query(`
      DROP TABLE IF EXISTS tc_intervenciones;
      DROP TABLE IF EXISTS tc_vehiculos;
      DROP TABLE IF EXISTS tc_empresas;
      DROP TABLE IF EXISTS tc_usuarios;
      DROP FUNCTION IF EXISTS app_licencia_activa(uuid, text);
    `);
    intervenciones.olvidarEsquema();
  });

  it("con tablas y licencia, el autorrelleno está disponible", async () => {
    expect(await intervenciones.autorrellenoDisponible(EMPRESA_TC)).toBe(true);
  });

  it("encuentra la intervención por matrícula y devuelve los datos enlazados", async () => {
    const [s] = await intervenciones.buscar(EMPRESA_TC, "2380");
    expect(s).toBeDefined();
    // El JOIN de las cuatro tablas: vehículo, empresa cliente y técnico.
    expect(s.matricula).toBe("2380JBT");
    expect(s.bastidor).toBe("WDB9634031L");
    expect(s.empresaCliente).toBe("TRANSPORTES PLANA S.L.");
    expect(s.tecnico).toBe("Marc Roig");
    expect(s.numero).toBe("NT-2026-000089");
    // Y la fecha, otra vez, sin correrse un día.
    expect(s.fecha).toBe("2025-03-10");
  });

  it("también la encuentra por nº de parte y por nombre del cliente", async () => {
    expect(await intervenciones.buscar(EMPRESA_TC, "NT-2026")).toHaveLength(1);
    expect(await intervenciones.buscar(EMPRESA_TC, "plana")).toHaveLength(1);
    expect(await intervenciones.buscar(EMPRESA_TC, "no existe")).toHaveLength(0);
  });

  it("una intervención sin vehículo ni técnico no rompe la búsqueda", async () => {
    // Las claves ajenas son opcionales en tc_intervenciones: el LEFT JOIN tiene
    // que aguantar los huecos en vez de hacer desaparecer la fila.
    await db.query(
      `INSERT INTO tc_intervenciones (id, empresa_id, numero, fecha)
       VALUES (gen_random_uuid(), $1, 'NT-2026-000090', DATE '2025-04-01')`,
      [CLIENTE]
    );
    const r = await intervenciones.buscar(EMPRESA_TC, "NT-2026-000090");
    expect(r).toHaveLength(1);
    expect(r[0].matricula).toBe("");
    expect(r[0].tecnico).toBe("");
  });
});
