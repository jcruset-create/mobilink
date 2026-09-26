/**
 * Lo que se ha sacado del albarán, y cómo de seguro es cada cosa.
 *
 * ── Por qué se marcan las celdas ────────────────────────────────────────────
 *
 * Porque una tabla de números todos iguales invita a copiarlos todos igual. El
 * parser sabe cuáles ha leído bien y cuáles no, y esa diferencia es la mitad
 * del valor de la pantalla: en ámbar lo dudoso, en rosa lo que no se leyó, y el
 * resto normal. Quien teclea el ERP sabe entonces dónde mirar el PDF y dónde
 * no hace falta.
 *
 * ── Y por qué la suma se recalcula aquí ─────────────────────────────────────
 *
 * La fila guardada trae su total, pero el que se enseña se vuelve a sumar de
 * las líneas que hay en pantalla. Si alguna vez no coincidieran, es que se
 * están enseñando unas líneas y sumando otras, y más vale que se note.
 *
 * ── Los descuentos van como están impresos ──────────────────────────────────
 *
 * `60% + 10%`, nunca un 64 %. Aritméticamente da igual y contablemente no: lo
 * pactado con el proveedor es «60 y 10», y el ERP los pide así.
 */

import { useState } from "react";
import { Check, FileText, Highlighter, RefreshCw, Undo2 } from "lucide-react";
import * as api from "../services/api";
import { abrirEnPestana } from "../services/documentos";
import { celdasFlojas, sumaDeLineas, tituloAnalisis } from "../services/analisis";
import PedirDatos, { VERBOS, type DatosDelMovimiento } from "./PedirDatos";
import {
  Aviso,
  Celda,
  ChipAnalisis,
  ChipEstadoActuacion,
  Dato,
  ErrorBox,
  Pill,
  btnMini,
  thCls,
  tdCls,
} from "./ui";
import type { AlbaranAnalizado as Albaran, Actuacion } from "../types";
import { eurosConSigno } from "../../cash/utils/money";
import { fmtFecha } from "../../administracion/types";

const eur = (c: number | null | undefined) => (c === null || c === undefined ? "—" : eurosConSigno(c));

function Descuentos({ albaran, numero }: { albaran: Albaran; numero: number }) {
  const linea = albaran.lineas.find((l) => l.numeroLinea === numero);
  if (!linea || linea.descuentos.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <span title={linea.descuentosRaw || undefined}>
      {linea.descuentos.map((d) => d.raw).join(" + ")}
    </span>
  );
}

export default function AlbaranAnalizado({
  albaran,
  actuacion,
  umbralCampo,
  puedeReanalizar,
  onReanalizado,
}: {
  albaran: Albaran;
  actuacion: Actuacion | undefined;
  umbralCampo: number;
  puedeReanalizar: boolean;
  onReanalizado: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [resaltando, setResaltando] = useState(false);
  const [pidiendo, setPidiendo] = useState<string | null>(null);

  /**
   * Dar por hecho ESTE albarán, desde donde se está mirando.
   *
   * Quien graba trabaja albarán por albarán con el PDF delante: acaba uno y
   * pasa al siguiente. Obligarle a cambiar de pestaña, buscar la actuación
   * entre ocho y acordarse de cuál era hace que nadie las marque, y una
   * bandeja con todo pendiente no dice nada.
   *
   * Es la misma actuación y el mismo formulario que en la pestaña Actuaciones
   * —qué se ha hecho y la referencia del ERP—, no un estado aparte del
   * albarán: un albarán no tiene estado, lo tiene el trabajo que se pidió
   * sobre él.
   */
  async function mover(verbo: string, datos: DatosDelMovimiento) {
    if (!actuacion) return;
    setTrabajando(true);
    setError(null);
    try {
      await api.moverActuacion(actuacion.id, verbo, datos);
      setPidiendo(null);
      onReanalizado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido mover la actuación");
    } finally {
      setTrabajando(false);
    }
  }

  const puedeResolver =
    puedeReanalizar && actuacion !== undefined && VERBOS.resolver.desde.includes(actuacion.estado);
  const puedeReabrir =
    puedeReanalizar && actuacion !== undefined && VERBOS.reabrir.desde.includes(actuacion.estado);

  /*
   * La tarjeta entera en verde cuando el albarán ya está hecho.
   *
   * En un expediente de ocho albaranes, todas las tarjetas son iguales y la
   * chapita del estado es lo más pequeño que hay en pantalla: para saber
   * cuáles quedan había que leerlas una a una. El color se ve desde el otro
   * lado de la mesa, que es como se mira una lista de tareas.
   *
   * Sólo el borde y el fondo, y flojos: encima va una tabla de números que
   * tiene que seguir leyéndose, y hay celdas que se marcan en ámbar y en rosa
   * por dudosas. Un verde fuerte se comería justo la información que hace que
   * alguien vuelva a mirar el PDF.
   */
  const resuelta = actuacion?.estado === "RESUELTA";

  const suma = sumaDeLineas(albaran.lineas);
  const flojas = celdasFlojas(albaran.lineas, umbralCampo);
  const conceptos = albaran.metadata?.conceptosAdicionales ?? [];
  const otros = Object.entries(albaran.metadata?.otros ?? {});

  /**
   * El PDF del proveedor con ESTE albarán en amarillo.
   *
   * Se compone en el servidor y llega como fichero, no como enlace: se crea al
   * pedirlo y no se guarda en ninguna parte. El objeto que lo representa en el
   * navegador se suelta cuando la pestaña ya lo ha cargado.
   */
  async function abrirResaltado() {
    setError(null);
    setResaltando(true);
    try {
      await abrirEnPestana(async () => {
        const url = URL.createObjectURL(await api.pdfResaltado(albaran.id));
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return url;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido resaltar el documento");
    } finally {
      setResaltando(false);
    }
  }

  async function abrirPdf() {
    setError(null);
    try {
      await abrirEnPestana(async () => (await api.enlaceDocumento(albaran.id)).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido abrir el documento");
    }
  }

  async function volverAAnalizar() {
    if (!actuacion) return;
    setTrabajando(true);
    setError(null);
    try {
      await api.reanalizar(actuacion.id);
      onReanalizado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido pedir el análisis");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <article
      className={`rounded-2xl border p-4 ${
        resuelta ? "border-emerald-500/60 bg-emerald-900/60" : "border-slate-700 bg-slate-800"
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{tituloAnalisis(actuacion?.tipoAccion ?? "")}</span>
        <ChipAnalisis estado={albaran.estadoAnalisis ?? albaran.estadoProceso} />
        {albaran.metadata?.modoTabla === "POSICIONAL" && (
          <Pill className="bg-amber-500/15 text-amber-300">Sin cabecera de columnas</Pill>
        )}
        {albaran.origen === "PDF_IA" && (
          <Pill className="bg-amber-500/15 text-amber-300">Leído con ayuda de IA</Pill>
        )}
        {actuacion && <ChipEstadoActuacion estado={actuacion.estado} />}
        <span className="ml-auto flex gap-2">
          {puedeResolver && (
            <button
              onClick={() => setPidiendo("resolver")}
              className={btnMini}
              disabled={trabajando}
              title="Dar por hecho este albarán"
            >
              <Check className="mr-1 inline h-3 w-3" />
              Resuelto
            </button>
          )}
          {puedeReabrir && (
            <button
              onClick={() => void mover("reabrir", {})}
              className={btnMini}
              disabled={trabajando}
              title="Volver a dejarlo pendiente"
            >
              <Undo2 className="mr-1 inline h-3 w-3" />
              Reabrir
            </button>
          )}
          {albaran.adjuntoId && (
            <button onClick={() => void abrirPdf()} className={btnMini}>
              <FileText className="mr-1 inline h-3 w-3" />
              Ver el PDF
            </button>
          )}
          {albaran.adjuntoId && (
            <button
              onClick={() => void abrirResaltado()}
              className={btnMini}
              disabled={resaltando}
              title="El PDF entero con este albarán subrayado en amarillo"
            >
              <Highlighter className="mr-1 inline h-3 w-3" />
              {resaltando ? "Preparando…" : "Ver resaltado"}
            </button>
          )}
          {puedeReanalizar && actuacion && (
            <button onClick={() => void volverAAnalizar()} className={btnMini} disabled={trabajando}>
              <RefreshCw className={`mr-1 inline h-3 w-3 ${trabajando ? "animate-spin" : ""}`} />
              Volver a analizar
            </button>
          )}
        </span>
      </header>

      {error && <ErrorBox>{error}</ErrorBox>}

      {pidiendo && (
        <PedirDatos
          verbo={pidiendo}
          onCerrar={() => setPidiendo(null)}
          onConfirmar={(datos) => void mover(pidiendo, datos)}
          ocupado={trabajando}
        />
      )}

      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <Dato rotulo="Albarán pedido" valor={albaran.numeroSolicitado} />
        <Dato
          rotulo="Albarán localizado"
          valor={
            albaran.numeroDocumento ? (
              <>
                {albaran.numeroDocumento}
                {albaran.confianzaMatch !== null && (
                  <span className="ml-1 text-[11px] text-slate-500">
                    {(Number(albaran.confianzaMatch) * 100).toFixed(0)} %
                  </span>
                )}
              </>
            ) : (
              <span className="text-rose-300">no encontrado</span>
            )
          }
        />
        <Dato rotulo="Fecha" valor={albaran.fecha ? fmtFecha(albaran.fecha) : "—"} />
        <Dato rotulo="Matrícula" valor={albaran.matricula ?? "—"} />
        <Dato rotulo="Bastidor" valor={albaran.bastidor ?? "—"} />
        <Dato
          rotulo="Páginas"
          valor={
            albaran.paginaInicio
              ? albaran.paginaInicio === albaran.paginaFin
                ? String(albaran.paginaInicio)
                : `${albaran.paginaInicio}–${albaran.paginaFin}`
              : "—"
          }
        />
      </div>

      {albaran.error && <Aviso tono="mal">{albaran.error}</Aviso>}

      {albaran.lineas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={thCls}>Referencia</th>
                <th className={thCls}>Descripción</th>
                <th className={`${thCls} text-right`}>Cantidad</th>
                <th className={`${thCls} text-right`}>Precio</th>
                <th className={thCls}>Descuento</th>
                <th className={`${thCls} text-right`}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {albaran.lineas.map((l) => (
                <tr key={l.id} className={l.cuadraAritmetica === false ? "bg-amber-500/5" : ""}>
                  <td className={tdCls}>
                    <Celda valor={l.referencia} confianza={l.confianza.referencia} umbral={umbralCampo} />
                  </td>
                  <td className={tdCls} title={l.rawText}>
                    <Celda valor={l.descripcion} confianza={l.confianza.descripcion} umbral={umbralCampo} />
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <Celda valor={l.cantidad} confianza={l.confianza.cantidad} umbral={umbralCampo} />
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <Celda
                      valor={l.precioUnitarioCentimos === null ? null : eur(l.precioUnitarioCentimos)}
                      confianza={l.confianza.precio}
                      umbral={umbralCampo}
                    />
                  </td>
                  <td className={tdCls}>
                    <Descuentos albaran={albaran} numero={l.numeroLinea} />
                  </td>
                  <td className={`${tdCls} text-right font-mono`}>
                    <Celda
                      valor={l.importeCentimos === null ? null : eur(l.importeCentimos)}
                      confianza={l.confianza.importe}
                      umbral={umbralCampo}
                    />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-700">
                <td className={tdCls} colSpan={5}>
                  <b>Suma de las líneas</b>
                </td>
                <td className={`${tdCls} text-right font-mono font-bold`}>{eur(suma)}</td>
              </tr>
              <tr>
                <td className={tdCls} colSpan={5}>
                  Importe de la incidencia
                </td>
                <td className={`${tdCls} text-right font-mono`}>
                  {eur(albaran.importeIncidenciaCentimos)}
                </td>
              </tr>
              {albaran.diferenciaCentimos !== null && albaran.diferenciaCentimos !== 0 && (
                <tr>
                  <td className={tdCls} colSpan={5}>
                    <b>Diferencia</b>
                  </td>
                  <td
                    className={`${tdCls} text-right font-mono font-bold ${
                      albaran.diferenciaCentimos > 0 ? "text-amber-300" : "text-rose-300"
                    }`}
                  >
                    {eur(albaran.diferenciaCentimos)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(flojas.dudosas > 0 || flojas.vacias > 0) && (
        <p className="mt-2 text-[12px] text-slate-400">
          {flojas.vacias > 0 && <span className="text-rose-300">{flojas.vacias} sin leer</span>}
          {flojas.vacias > 0 && flojas.dudosas > 0 && " · "}
          {flojas.dudosas > 0 && <span className="text-amber-300">{flojas.dudosas} dudosas</span>}
          {" — compruébalas en el PDF antes de grabar."}
        </p>
      )}

      {conceptos.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-700 p-3">
          <p className="mb-1 text-[12px] font-bold text-slate-300">
            Conceptos del documento, NO incluidos en la suma
          </p>
          <ul className="space-y-0.5 text-[12px] text-slate-400">
            {conceptos.map((c, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{c.etiqueta}</span>
                <span className="font-mono">{eur(c.importeCentimos)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(albaran.observaciones || otros.length > 0) && (
        <div className="mt-3 space-y-1 text-[12px] text-slate-400">
          {albaran.observaciones && (
            <p>
              <span className="text-slate-500">Observaciones: </span>
              {albaran.observaciones}
            </p>
          )}
          {otros.map(([clave, valor]) => (
            <p key={clave}>
              <span className="text-slate-500">{clave}: </span>
              {valor}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
