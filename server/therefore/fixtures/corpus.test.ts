/**
 * El parser contra el corpus REAL, si está.
 *
 * El lote de correos de verdad no se versiona —este repositorio es público y un
 * correo de incidencia lleva el proveedor, su factura y lo que se le compró—,
 * así que esta prueba se salta sola cuando el fichero no está, que es lo que
 * pasa en la CI y en cualquier clon recién hecho. Quien tenga el corpus en
 * `fixtures/originales/corpus.json` la ejecuta sin hacer nada más.
 *
 * ── Qué comprueba, ya que no puede comprobar valores ────────────────────────
 *
 * No afirma que la factura de un correo concreto sea tal número: eso sería
 * volver a meter los datos reales en el repositorio por la puerta de atrás. Lo
 * que fija son INVARIANTES que tiene que cumplir cualquier correo de Therefore,
 * y muy en particular la que sostiene el módulo entero:
 *
 *   **ningún número que salga del parser puede no estar en el correo.**
 *
 * Es la prueba de que no inventa. Un parser que rellena huecos con el número
 * más parecido acierta casi siempre y el día que falla manda al ERP un albarán
 * que nadie pidió. Aquí eso se cae con un error que dice cuál.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsearCorreo } from "../domain/correo/index.ts";

type CorreoDelCorpus = { n: number; fecha: string; asunto: string; texto: string; nota?: string };

const FICHERO = path.join(import.meta.dirname, "originales", "corpus.json");
const HAY_CORPUS = fs.existsSync(FICHERO);

const corpus: CorreoDelCorpus[] = HAY_CORPUS
  ? (JSON.parse(fs.readFileSync(FICHERO, "utf8")) as CorreoDelCorpus[])
  : [];

describe.runIf(HAY_CORPUS)("el parser contra el corpus real", () => {
  it("hay corpus y tiene correos", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  /*
   * LA invariante. Todo número de albarán que el parser devuelva tiene que
   * aparecer, letra por letra, en el cuerpo del correo. Si alguna vez falla,
   * el mensaje dice qué correo y qué número se ha sacado de la manga.
   */
  it("no devuelve ni un albarán que no esté escrito en el correo", () => {
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      for (const a of r.acciones) {
        if (!a.albaran) continue;
        expect(c.texto, `correo ${c.n}: «${a.albaran}» no está en el texto`).toContain(a.albaran);
      }
      for (const amb of r.albaranesAmbiguos) {
        expect(c.texto, `correo ${c.n}: «${amb}» no está en el texto`).toContain(amb);
      }
    }
  });

  /* Lo mismo con el bloque libre: se conserva, no se reescribe. */
  it("el bloque «Información Adicional» sale tal y como entró", () => {
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      if (!r.informacionAdicional) continue;
      expect(c.texto, `correo ${c.n}`).toContain(r.informacionAdicional);
    }
  });

  it("todos se clasifican: ninguno cae en OTRO", () => {
    const perdidos = corpus.filter((c) => parsearCorreo(c.asunto, c.texto).tipo === "OTRO");
    expect(perdidos.map((c) => c.n)).toEqual([]);
  });

  it("de todos se sacan sociedad, proveedor, factura, fecha e importe", () => {
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      const faltan = (
        [
          ["empresaCodigo", r.empresaCodigo],
          ["proveedorCodigo", r.proveedorCodigo],
          ["facturaNumero", r.facturaNumero],
          ["facturaFecha", r.facturaFecha],
          ["importeCentimos", r.importeCentimos],
        ] as const
      )
        .filter(([, v]) => v === null || v === "")
        .map(([k]) => k);
      expect(faltan, `correo ${c.n}`).toEqual([]);
    }
  });

  /*
   * Una incidencia sin ninguna acción entendida sería el parser callándose. Se
   * admite que la acción venga INCOMPLETA —sin número, porque el correo no lo
   * dice— pero no que no haya nada: eso significaría que ni siquiera se ha
   * visto que pedían algo.
   */
  it("de toda incidencia se entiende al menos qué se pide", () => {
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      if (r.tipo !== "INCIDENCIA_ALBARAN") continue;
      expect(r.acciones.length, `correo ${c.n}: no se ha entendido qué pide`).toBeGreaterThan(0);
    }
  });

  /*
   * Y la contraria: lo que queda dudoso tiene que DECIRLO. Un correo con una
   * acción sin albarán y confianza alta sería el peor de los mundos, porque
   * nadie lo miraría.
   */
  it("lo que queda incompleto baja la confianza y deja aviso", () => {
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      const incompletas = r.acciones.filter((a) => a.albaran === null && a.accion !== "APROBAR");
      if (incompletas.length === 0 && r.albaranesAmbiguos.length === 0) continue;
      expect(r.confianza, `correo ${c.n}`).toBeLessThan(0.8);
      expect(r.avisos.length, `correo ${c.n}`).toBeGreaterThan(0);
    }
  });

  it("una tarea vencida no pide trabajo nuevo", () => {
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      if (!r.tareaVencida) continue;
      expect(r.acciones, `correo ${c.n}`).toEqual([]);
      expect(r.reclamacion, `correo ${c.n}`).toBe(true);
    }
  });

  /*
   * Los correos que comparten sociedad, proveedor y factura son el mismo
   * expediente. No se comprueba cuáles son —eso sería fijar datos reales— sino
   * que los que coinciden coinciden en las TRES cosas, que es lo que el motor
   * de deduplicación usa para fusionarlos.
   */
  it("las aprobaciones repetidas comparten la terna que las une", () => {
    const porTerna = new Map<string, number[]>();
    for (const c of corpus) {
      const r = parsearCorreo(c.asunto, c.texto);
      if (r.tipo !== "APROBACION_FACTURA") continue;
      const terna = `${r.empresaCodigo}|${r.proveedorCodigo}|${r.facturaNumero}`;
      porTerna.set(terna, [...(porTerna.get(terna) ?? []), c.n]);
    }
    // Al menos un grupo con varios correos: es lo que el corpus tiene que traer
    // para que esta comprobación signifique algo.
    const grupos = [...porTerna.values()].filter((v) => v.length > 1);
    expect(grupos.length, "el corpus no trae ninguna aprobación repetida").toBeGreaterThan(0);

    // Y todos los de un grupo apuntan al mismo expediente de Therefore.
    for (const [, numeros] of porTerna) {
      if (numeros.length < 2) continue;
      const casos = numeros.map(
        (n) => parsearCorreo(corpus.find((c) => c.n === n)!.asunto, corpus.find((c) => c.n === n)!.texto).casoReferencia
      );
      expect(new Set(casos).size, `los correos ${numeros.join(", ")} deberían ser el mismo caso`).toBe(1);
    }
  });
});
