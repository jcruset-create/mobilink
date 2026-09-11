/**
 * Cotejar el cierre del ERP con el de Mobilink pegando una captura.
 *
 * Se copia la pantalla de arqueo del ERP, se pega aquí con Ctrl+V, y la
 * comparación sale sola: qué cuadra, qué falta en Mobilink, qué sobra y qué no
 * se ha podido emparejar con seguridad.
 *
 * ## Esta pantalla no registra nada
 *
 * Informa. Los cobros se siguen metiendo por Cobros, con sus validaciones y su
 * detalle de piezas. Un botón que creara movimientos a partir de una captura
 * sería la automatización que sale mal el día que el modelo lea 377,24 como
 * 377,74 — y saldría mal en silencio, porque el descuadre lo vería el arqueo
 * tres horas después.
 *
 * ## Los avisos van ARRIBA, no al final
 *
 * Si la lectura no es de fiar, eso condiciona todo lo que hay debajo. Ponerlo
 * al pie, después de una tabla de líneas que parecen buenas, es esconderlo.
 *
 * Y cuando la lectura es **bloqueante** —sabemos que está mal— no se enseña
 * ningún cotejo: diría «falta este cobro» por una línea que el modelo no supo
 * leer, y alguien acabaría metiéndola dos veces.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ClipboardPaste, Loader2, X } from "lucide-react";

import { useCash } from "../contexts/CashContext";
import * as api from "../services/api";
import type { InformeCotejo, LineaErp, LineaMobilink, ResultadoCotejo } from "../types";

const euros = (c: number) =>
  (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** El tope que acepta el servidor. Se comprueba aquí para no subir en balde. */
const MAXIMO_BYTES = 8 * 1024 * 1024;

/**
 * El panel de sección.
 *
 * `Card` del módulo es una tarjeta de CIFRA —título y valor— y no un
 * contenedor, así que no vale aquí. Esto repite el borde que ya usan Arqueo y
 * Cierre, en un solo sitio para no esparcirlo por la pantalla.
 */
function Panel({ children, tono }: { children: ReactNode; tono?: string }) {
  return (
    <div
      className={`rounded-xl border p-4 ${tono ?? "border-slate-700 bg-slate-800/40"}`}
    >
      {children}
    </div>
  );
}

export default function CotejoErp() {
  const { jornada, refrescar } = useCash();
  const sessionId = jornada?.sesion?.id ?? null;

  const [imagen, setImagen] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<ResultadoCotejo | null>(null);

  const cotejar = useCallback(
    async (dataUri: string) => {
      if (!sessionId) return;
      setCargando(true);
      setError("");
      setResultado(null);
      try {
        setResultado(await api.cotejarConErp(sessionId, dataUri));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se ha podido cotejar la captura.");
      } finally {
        setCargando(false);
      }
    },
    [sessionId]
  );

  /** Lee el fichero y lanza el cotejo. Vale para pegar y para elegir. */
  const aceptar = useCallback(
    (fichero: File) => {
      if (fichero.size > MAXIMO_BYTES) {
        setError("La captura es demasiado grande. Recorta la ventana del ERP y vuelve a pegarla.");
        return;
      }
      const lector = new FileReader();
      lector.onload = () => {
        const dataUri = String(lector.result);
        setImagen(dataUri);
        void cotejar(dataUri);
      };
      lector.onerror = () => setError("No se ha podido leer la imagen.");
      lector.readAsDataURL(fichero);
    },
    [cotejar]
  );

  if (!sessionId) {
    return (
      <Panel>
        <p className="text-sm text-slate-400">
          No hay ninguna jornada abierta que cotejar. Abre la jornada y vuelve.
        </p>
        <button
          onClick={() => void refrescar()}
          className="mt-3 rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-100"
        >
          Volver a mirar
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="mb-1 text-sm font-bold text-slate-100">Cotejar con el ERP</h2>
        <p className="mb-3 text-xs text-slate-400">
          Copia la pantalla de arqueo del ERP y pégala aquí con <b>Ctrl+V</b>. Se compara con los
          cobros y pagos de la jornada abierta. <b>No se registra nada</b>: esto solo informa.
        </p>

        {/*
          El área de pegado es un div con tabIndex y no un input: lo que llega
          por el portapapeles es una imagen, no texto, y `onPaste` sobre un
          contenedor enfocable es la forma que ya usa el resto del panel.
        */}
        <div
          tabIndex={0}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((i) =>
              i.type.startsWith("image/")
            );
            const fichero = item?.getAsFile();
            if (fichero) {
              e.preventDefault();
              aceptar(fichero);
            }
          }}
          className="flex min-h-[96px] cursor-text flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/40 p-4 text-center outline-none focus:border-sky-500"
        >
          <ClipboardPaste className="h-6 w-6 text-slate-500" />
          <p className="text-xs text-slate-400">
            Haz clic aquí y pulsa <b>Ctrl+V</b>
          </p>
          <label className="cursor-pointer text-[11px] text-sky-400 underline">
            o elegir un fichero
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) aceptar(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {imagen && (
          <div className="mt-3">
            <img
              src={imagen}
              alt="Captura del ERP"
              className="max-h-40 w-full rounded-lg border border-slate-700 object-contain object-left"
            />
          </div>
        )}

        {cargando && (
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Leyendo la captura…
          </p>
        )}
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
      </Panel>

      {resultado && <Resultado resultado={resultado} />}
    </div>
  );
}

function Resultado({ resultado }: { resultado: ResultadoCotejo }) {
  const { lectura, informe } = resultado;

  return (
    <>
      {/* Los avisos ARRIBA: condicionan todo lo que viene debajo. */}
      {lectura.avisos.length > 0 && (
        <Panel
          tono={
            lectura.bloqueante
              ? "border-rose-500/40 bg-rose-500/5"
              : "border-amber-500/40 bg-amber-500/5"
          }
        >
          <p
            className={`mb-1 flex items-center gap-2 text-sm font-bold ${
              lectura.bloqueante ? "text-rose-200" : "text-amber-200"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            {lectura.bloqueante
              ? "La captura no se ha leído bien"
              : "La lectura no se ha podido comprobar del todo"}
          </p>
          <ul className="ml-5 list-disc space-y-1 text-xs text-slate-300">
            {lectura.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          {lectura.bloqueante && (
            <p className="mt-2 text-xs text-slate-400">
              No se enseña ninguna comparación con una lectura que se sabe mala: diría que falta un
              cobro que quizá sí está. Vuelve a copiar la pantalla del ERP entera, con la fila de
              totales incluida.
            </p>
          )}
        </Panel>
      )}

      {informe && <Informe informe={informe} />}
    </>
  );
}

function Informe({ informe }: { informe: InformeCotejo }) {
  const { totales } = informe;

  const revisar =
    informe.soloEnErp.length +
    informe.soloEnMobilink.length +
    informe.ambiguas.length +
    informe.discrepanciasDeForma.length;
  const nada = revisar === 0;

  return (
    <>
      <Panel tono={informe.cuadra ? "border-emerald-500/40 bg-emerald-500/5" : undefined}>
        <p
          className={`flex items-center gap-2 text-sm font-bold ${
            informe.cuadra ? "text-emerald-200" : "text-slate-100"
          }`}
        >
          {informe.cuadra ? <Check className="h-4 w-4" /> : <X className="h-4 w-4 text-amber-300" />}
          {informe.cuadra
            ? "Todo cuadra con el ERP"
            : revisar === 1
              ? "Hay 1 línea que revisar"
              : `Hay ${revisar} líneas que revisar`}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Dato titulo="Cobros en el ERP" valor={euros(totales.erpCobros)} />
          <Dato titulo="Cobros en Mobilink" valor={euros(totales.mobilinkCobros)} />
          <Dato
            titulo="Diferencia"
            valor={euros(totales.diferenciaCobros)}
            mal={totales.diferenciaCobros !== 0}
          />
          <Dato titulo="Emparejadas" valor={String(informe.emparejadas.length)} />
        </div>

        {(totales.erpPagos > 0 || totales.mobilinkPagos > 0) && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dato titulo="Pagos en el ERP" valor={euros(totales.erpPagos)} />
            <Dato titulo="Pagos en Mobilink" valor={euros(totales.mobilinkPagos)} />
            <Dato
              titulo="Diferencia"
              valor={euros(totales.diferenciaPagos)}
              mal={totales.diferenciaPagos !== 0}
            />
          </div>
        )}

        {/*
          Que los totales cuadren y aun así haya algo que revisar es un caso
          real y confuso. Se dice, porque si no la cifra grande en verde tapa el
          problema.
        */}
        {totales.diferenciaCobros === 0 && !nada && (
          <p className="mt-3 text-xs text-amber-200">
            Los totales cuadran, pero hay líneas que no encajan del todo. Míralas abajo.
          </p>
        )}
      </Panel>

      {informe.formasSinEquivalencia.length > 0 && (
        <Panel tono="border-amber-500/40 bg-amber-500/5">
          <p className="mb-1 text-sm font-bold text-amber-200">Formas de pago sin configurar</p>
          <p className="mb-2 text-xs text-slate-300">
            Estas etiquetas del ERP no tienen equivalente en Mobilink, así que sus líneas no se han
            podido emparejar. Se configuran en <b>Configuración → Equivalencias con el ERP</b>.
          </p>
          <ul className="ml-5 list-disc text-xs text-slate-200">
            {informe.formasSinEquivalencia.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {informe.formasAmbiguas.length > 0 && (
        <Panel tono="border-amber-500/40 bg-amber-500/5">
          <p className="mb-1 text-sm font-bold text-amber-200">
            Etiquetas del ERP que encajan con varias
          </p>
          <p className="mb-2 text-xs text-slate-300">
            El ERP corta la columna de forma de pago y lo que queda encaja con más de una
            equivalencia, así que no se elige ninguna. Se arregla configurando la etiqueta con{" "}
            <b>más letras</b>, hasta que se distinga de la otra.
          </p>
          <ul className="ml-5 list-disc space-y-1 text-xs text-slate-200">
            {informe.formasAmbiguas.map((f) => (
              <li key={f.etiqueta}>
                <code>{f.etiqueta}</code>{" "}
                <span className="text-slate-400">
                  podría ser {f.candidatas.map((c) => `«${c}»`).join(" o ")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/*
        Se enseña sin alarma —tono neutro— porque no es un problema: es una
        deducción que ha salido bien. Pero se enseña, porque es una DEDUCCIÓN.
        El día que el recorte empareje con la equivalencia equivocada, aquí está
        escrito con qué; sin esto, el cotejo daría por bueno un emparejamiento
        que nadie llegó a configurar del todo y no habría por dónde verlo.
      */}
      {informe.formasPorRecorte.length > 0 && (
        <Panel>
          <p className="mb-1 text-sm font-bold text-slate-200">Etiquetas cortadas por el ERP</p>
          <p className="mb-2 text-xs text-slate-400">
            El ERP corta esta columna según la resolución de la pantalla, así que se ha emparejado
            por el principio de la etiqueta. Comprueba que la equivalencia es la que esperabas:
          </p>
          <ul className="ml-5 list-disc space-y-1 text-xs text-slate-300">
            {informe.formasPorRecorte.map((f) => (
              <li key={f.etiqueta}>
                <code>{f.etiqueta}</code> → <code>{f.configurada}</code>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {informe.discrepanciasDeForma.length > 0 && (
        <Panel tono="border-amber-500/40 bg-amber-500/5">
          <p className="mb-1 text-sm font-bold text-amber-200">
            Mismo importe, distinta forma de pago
          </p>
          <p className="mb-2 text-xs text-slate-300">
            Es la misma operación a los dos lados, pero la forma de cobro no coincide. Dos cosas
            pueden estar pasando, y la de arriba se descarta sola mirando la captura:
          </p>
          <ul className="mb-3 ml-5 list-disc space-y-1 text-xs text-slate-300">
            <li>
              <b>La captura se leyó mal.</b> Comprueba en el ERP qué pone de verdad en esa fila: si
              coincide con lo que dice Mobilink, no hay nada que corregir.
            </li>
            <li>
              <b>El cobro se metió con la forma equivocada.</b> El dinero está, pero el arqueo
              descuadrará por ese importe.
            </li>
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500">
                  <th className="py-1">Importe</th>
                  <th>En el ERP</th>
                  <th>En Mobilink</th>
                  <th>Operación</th>
                </tr>
              </thead>
              <tbody>
                {informe.discrepanciasDeForma.map((d, i) => (
                  <tr key={i} className="border-t border-slate-800 text-slate-200">
                    <td className="py-1 font-medium">{euros(d.erp.importeCentimos)}</td>
                    <td>
                      {d.erp.formaErp}
                      {/*
                        Sin equivalencia configurada NO se dice «no coincide»:
                        sería engañoso, porque no se ha comparado nada. Se dice
                        lo que pasa de verdad.
                      */}
                      {d.formaEsperada === null && (
                        <span className="ml-1 rounded bg-slate-600/40 px-1.5 py-0.5 text-[10px] text-slate-300">
                          sin configurar
                        </span>
                      )}
                    </td>
                    <td>{d.mobilink.formaCodigo}</td>
                    <td className="text-slate-400">
                      {d.mobilink.numero}
                      {d.erp.justificante ? ` · justif. ${d.erp.justificante}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {informe.soloEnErp.length > 0 && (
        <TablaErp
          titulo="Está en el ERP y NO en Mobilink"
          ayuda="Cobros que hay que registrar, o que se registraron con otro importe."
          lineas={informe.soloEnErp}
        />
      )}

      {informe.soloEnMobilink.length > 0 && (
        <TablaMobilink
          titulo="Está en Mobilink y NO en el ERP"
          ayuda="Puede ser un cobro que en el ERP no se apuntó, o uno metido dos veces aquí."
          lineas={informe.soloEnMobilink}
        />
      )}

      {informe.ambiguas.length > 0 && (
        <Panel tono="border-amber-500/40 bg-amber-500/5">
          <p className="mb-1 text-sm font-bold text-amber-200">No se ha podido decidir</p>
          <p className="mb-2 text-xs text-slate-300">
            Estas líneas del ERP encajaban con varias de Mobilink por igual. No se elige ninguna a
            propósito: un emparejamiento inventado es peor que un hueco señalado.
          </p>
          <div className="space-y-2">
            {informe.ambiguas.map((a, i) => (
              <div key={i} className="rounded-lg border border-slate-700 bg-slate-800/40 p-2">
                <p className="text-xs text-slate-100">
                  {euros(a.erp.importeCentimos)} · {a.erp.formaErp}
                  {a.erp.concepto ? ` · ${a.erp.concepto}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Encajaba con: {a.candidatos.map((c) => c.numero).join(", ")}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function Dato({ titulo, valor, mal }: { titulo: string; valor: string; mal?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{titulo}</p>
      <p className={`text-sm font-bold ${mal ? "text-rose-300" : "text-slate-100"}`}>{valor}</p>
    </div>
  );
}

function TablaErp({
  titulo,
  ayuda,
  lineas,
}: {
  titulo: string;
  ayuda: string;
  lineas: LineaErp[];
}) {
  const total = useMemo(() => lineas.reduce((a, l) => a + l.importeCentimos, 0), [lineas]);
  return (
    <Panel>
      <p className="text-sm font-bold text-slate-100">{titulo}</p>
      <p className="mb-2 text-xs text-slate-400">{ayuda}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-500">
              <th className="py-1">Justif.</th>
              <th>Referencia</th>
              <th>Forma</th>
              <th>Concepto</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i} className="border-t border-slate-800 text-slate-200">
                <td className="py-1">{l.justificante ?? "—"}</td>
                <td>{l.referencia ?? "—"}</td>
                <td>{l.formaErp}</td>
                <td className="max-w-[16rem] truncate">{l.concepto ?? "—"}</td>
                <td className="text-right font-medium">{euros(l.importeCentimos)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 text-slate-100">
              <td colSpan={4} className="py-1 text-right text-[10px] uppercase text-slate-400">
                Total
              </td>
              <td className="text-right font-bold">{euros(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function TablaMobilink({
  titulo,
  ayuda,
  lineas,
}: {
  titulo: string;
  ayuda: string;
  lineas: LineaMobilink[];
}) {
  const total = useMemo(() => lineas.reduce((a, l) => a + l.importeCentimos, 0), [lineas]);
  return (
    <Panel>
      <p className="text-sm font-bold text-slate-100">{titulo}</p>
      <p className="mb-2 text-xs text-slate-400">{ayuda}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-500">
              <th className="py-1">Número</th>
              <th>Referencia</th>
              <th>Forma</th>
              <th>Concepto</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={`${l.id}-${l.formaCodigo}-${l.importeCentimos}`} className="border-t border-slate-800 text-slate-200">
                <td className="py-1">{l.numero}</td>
                <td>{l.referencia ?? "—"}</td>
                <td>{l.formaCodigo}</td>
                <td className="max-w-[16rem] truncate">{l.concepto ?? "—"}</td>
                <td className="text-right font-medium">{euros(l.importeCentimos)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 text-slate-100">
              <td colSpan={4} className="py-1 text-right text-[10px] uppercase text-slate-400">
                Total
              </td>
              <td className="text-right font-bold">{euros(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}
