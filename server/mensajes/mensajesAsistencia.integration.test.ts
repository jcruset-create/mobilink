/**
 * Mensajes oficina ⇄ tablet, contra PostgreSQL: el camino entero de un
 * mensaje (enviado → recibido → leído), la respuesta del operario, y que solo
 * se puede mandar a una asistencia abierta con operario.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

describeSiHayBase("mensajes entre la oficina y la tablet de la asistencia", () => {
  let db: any;
  let m: typeof import("./mensajesAsistencia.ts");
  const ahora = Date.now();
  const tecnico = `Mensajes-${ahora}`;
  let asistencia = 0;

  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    m = await import("./mensajesAsistencia.ts");
    asistencia = Number(
      (
        await db.query(
          `INSERT INTO roadside_assistances (status, priority, plate, "trackingToken", "assignedTechName", "createdAtMs", "updatedAtMs")
           VALUES ('en_camino','normal','1111AAA',$2,$3,$1,$1) RETURNING id`,
          [ahora, `msg-${ahora}`, tecnico]
        )
      ).rows[0].id
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM asistencia_mensajes WHERE "assistanceId" = $1`, [asistencia]);
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistencia]);
  });

  it("enviado → recibido al recogerlo la tablet → leído con «Entendido»", async () => {
    const enviado = await m.enviarDesdeOficina({
      assistanceId: asistencia, texto: "  Entra por la puerta 3  ", urgente: false, autor: "Oficina", ahoraMs: ahora,
    });
    expect(enviado.texto).toBe("Entra por la puerta 3");
    expect(enviado.techName).toBe(tecnico);
    expect((await m.listarDeAsistencia(asistencia, ahora))[0].estado).toBe("enviado");

    const pendientes = await m.pendientesDeOperario(tecnico, ahora + 5_000);
    expect(pendientes.map((p) => p.id)).toEqual([enviado.id]);
    expect((await m.listarDeAsistencia(asistencia, ahora))[0].estado).toBe("recibido");

    // Otro operario no lo ve ni lo puede marcar.
    expect(await m.pendientesDeOperario(`${tecnico}-otro`, ahora)).toEqual([]);
    expect(await m.marcarLeido(enviado.id, `${tecnico}-otro`, ahora)).toBe(false);

    expect(await m.marcarLeido(enviado.id, tecnico, ahora + 10_000)).toBe(true);
    expect((await m.listarDeAsistencia(asistencia, ahora))[0].estado).toBe("leido");
    expect(await m.pendientesDeOperario(tecnico, ahora + 20_000)).toEqual([]);
  });

  it("uno normal sin leer pasados 3 minutos se trata como urgente", async () => {
    await m.enviarDesdeOficina({ assistanceId: asistencia, texto: "Llama a la oficina", urgente: false, autor: null, ahoraMs: ahora });
    const [antes] = await m.pendientesDeOperario(tecnico, ahora + 60_000);
    expect(antes).toMatchObject({ escalado: false, repetirSonido: false });
    const [despues] = await m.pendientesDeOperario(tecnico, ahora + m.ESCALADO_MS);
    expect(despues).toMatchObject({ escalado: true, repetirSonido: true, sinLeerMin: 3 });
  });

  it("contestar deja leídos los mensajes de la oficina de esa asistencia", async () => {
    const r = await m.responderDesdeTablet({ assistanceId: asistencia, techName: tecnico, texto: "Voy", ahoraMs: ahora + 1 });
    expect(r.de).toBe("operario");
    expect(await m.pendientesDeOperario(tecnico, ahora + 2)).toEqual([]);
    const hilo = await m.listarDeAsistencia(asistencia, ahora + 2);
    expect(hilo[hilo.length - 1]).toMatchObject({ estado: "respuesta", texto: "Voy" });
  });

  it("un mensaje vacío no se manda", async () => {
    await expect(
      m.enviarDesdeOficina({ assistanceId: asistencia, texto: "   ", urgente: false, autor: null })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("con la asistencia cerrada ya no se puede mandar nada, y lo pendiente deja de salir", async () => {
    await m.enviarDesdeOficina({ assistanceId: asistencia, texto: "Último aviso", urgente: true, autor: null, ahoraMs: ahora });
    await db.query(`UPDATE roadside_assistances SET status = 'llegada_taller' WHERE id = $1`, [asistencia]);
    expect(await m.pendientesDeOperario(tecnico, ahora)).toEqual([]);
    await expect(
      m.enviarDesdeOficina({ assistanceId: asistencia, texto: "Hola", urgente: false, autor: null })
    ).rejects.toMatchObject({ status: 409 });
  });

  describe("en una OTF", () => {
    let otf = 0;

    beforeAll(async () => {
      otf = Number(
        (
          await db.query(
            `INSERT INTO otf ("clientName", status, "assignedTechName", "createdAtMs", "updatedAtMs")
             VALUES ('Conti 360','planificada',$1,$2,$2) RETURNING id`,
            [tecnico, ahora]
          )
        ).rows[0].id
      );
    });

    afterAll(async () => {
      await db.query(`DELETE FROM asistencia_mensajes WHERE "otfId" = $1`, [otf]);
      await db.query(`DELETE FROM otf WHERE id = $1`, [otf]);
    });

    it("la tablet lo recoge con el cliente de la OTF, y contestar lo deja leído", async () => {
      const enviado = await m.enviarDesdeOficina({ otfId: otf, texto: "El 0348LJD no está", urgente: true, autor: "Oficina", ahoraMs: ahora });
      expect(enviado).toMatchObject({ otfId: otf, assistanceId: null, techName: tecnico });

      const pendientes = await m.pendientesDeOperario(tecnico, ahora + 1);
      expect(pendientes.find((p) => p.id === enviado.id)).toMatchObject({ otfCliente: "Conti 360", repetirSonido: true });

      await m.responderDesdeTablet({ otfId: otf, techName: tecnico, texto: "Lo dejo", ahoraMs: ahora + 2 });
      expect((await m.pendientesDeOperario(tecnico, ahora + 3)).some((p) => p.otfId === otf)).toBe(false);
      expect((await m.listarDeOtf(otf, ahora + 3)).map((x) => x.estado)).toEqual(["leido", "respuesta"]);
    });

    it("con la OTF finalizada ya no se manda nada", async () => {
      await db.query(`UPDATE otf SET status = 'finalizada' WHERE id = $1`, [otf]);
      await expect(
        m.enviarDesdeOficina({ otfId: otf, texto: "Hola", urgente: false, autor: null })
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
