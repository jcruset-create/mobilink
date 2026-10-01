/**
 * Posición global: todo el efectivo que tenemos ahora mismo.
 *
 * Lo que hay en la caja más lo que espera para ir al banco, pieza a pieza. La
 * pregunta que contesta es «¿cuántos billetes de 50 € tenemos en total?», sin
 * sumar a mano el cajón y la bolsa.
 *
 * El selector deja ver una caja o todas las que ve el usuario. Con una sola
 * caja las dos vistas coinciden, pero se deja: es la misma pantalla el día que
 * haya una segunda.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Share2 } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import { Aviso, Cabecera, ErrorBox } from "../components/ui";
import ContarRemanente from "../components/ContarRemanente";
import { euros } from "../utils/money";
import type { Denominacion, LineaDenominacion, PosicionCaja } from "../types";
import * as api from "../services/api";

type Vista = "caja" | "todas";

const valor = (l: readonly LineaDenominacion[]) => l.reduce((a, x) => a + x.valor * x.cantidad, 0);

function sumarLineas(listas: readonly (readonly LineaDenominacion[])[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const lista of listas) for (const l of lista) m.set(l.valor, (m.get(l.valor) ?? 0) + l.cantidad);
  return m;
}

/** Las cajas elegidas, sumadas en una sola posición. */
function agregar(cajas: readonly PosicionCaja[]) {
  const suma = (f: (c: PosicionCaja) => number) => cajas.reduce((a, c) => a + f(c), 0);
  return {
    caja: sumarLineas(cajas.map((c) => c.caja)),
    pendiente: sumarLineas(cajas.map((c) => c.pendiente)),
    faltan: sumarLineas(cajas.map((c) => c.faltan)),
    cajaCentimos: suma((c) => c.cajaCentimos),
    pendienteCentimos: suma((c) => c.pendienteCentimos),
    cierresCentimos: suma((c) => c.cierresCentimos),
    numCierres: suma((c) => c.numCierres),
    remanenteCentimos: suma((c) => c.remanenteCentimos),
    repuestoCentimos: suma((c) => c.repuestoCentimos),
    sinDesgloseCentimos: suma((c) => c.sinDesgloseCentimos),
    piezasPendiente: suma((c) => valor(c.pendiente)),
  };
}

export default function PosicionGlobal() {
  const { cajaId, denominaciones } = useCash();
  const [datos, setDatos] = useState<{ cajas: PosicionCaja[]; actualizadoMs: number } | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.posicionGlobal());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la posición");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!datos) return <p className="text-sm text-slate-400">Cargando la posición…</p>;
  return (
    <VistaPosicion
      datos={datos}
      cajaId={cajaId}
      denominaciones={denominaciones}
      onRecargar={cargar}
      contar={(c) => (
        <ContarRemanente registerId={c.registerId} importeCentimos={c.sinDesgloseCentimos} onHecho={cargar} />
      )}
    />
  );
}

/** La pantalla con los datos ya cargados. Aparte para poder pintarla sin servidor. */
export function VistaPosicion({
  datos,
  cajaId,
  denominaciones,
  onRecargar,
  contar,
  vistaInicial = "caja",
}: {
  datos: { cajas: PosicionCaja[]; actualizadoMs: number };
  cajaId: number | null;
  denominaciones: Denominacion[];
  onRecargar: () => void | Promise<void>;
  /** Botón para contar lo que quedó sin desglose en una caja. */
  contar?: (caja: PosicionCaja) => ReactNode;
  vistaInicial?: Vista;
}) {
  const [vista, setVista] = useState<Vista>(vistaInicial);

  const estaCaja = datos.cajas.find((c) => c.registerId === cajaId) ?? datos.cajas[0] ?? null;
  const elegidas = useMemo(
    () => (vista === "todas" ? datos.cajas : estaCaja ? [estaCaja] : []),
    [vista, datos, estaCaja]
  );
  const p = useMemo(() => agregar(elegidas), [elegidas]);

  const centros = new Set(datos.cajas.map((c) => c.centro ?? ""));
  const etiquetaTodas =
    centros.size === 1 && [...centros][0] ? `Todas las cajas de ${[...centros][0]}` : "Todas las cajas";

  const billetes = denominaciones.filter((d) => d.tipo === "BILLETE");
  const monedas = denominaciones.filter((d) => d.tipo === "MONEDA");
  const totalDe = (m: Map<number, number>, grupo: Denominacion[]) =>
    grupo.reduce((a, d) => a + (m.get(d.valor) ?? 0) * d.valor, 0);

  const cajaBilletes = totalDe(p.caja, billetes);
  const cajaMonedas = totalDe(p.caja, monedas);
  const pendBilletes = totalDe(p.pendiente, billetes);
  // Lo que quedó sin desglose son monedas casi siempre: el banco no las quiso.
  const pendMonedas = totalDe(p.pendiente, monedas) + p.sinDesgloseCentimos;
  const total = p.cajaCentimos + p.pendienteCentimos;
  const totalBilletes = cajaBilletes + pendBilletes;
  const pctBilletes = total > 0 ? Math.round((totalBilletes / total) * 100) : 0;

  const descuadre = p.piezasPendiente + p.sinDesgloseCentimos - p.pendienteCentimos;
  const faltan = [...p.faltan.entries()].sort((a, b) => b[0] - a[0]);

  if (datos.cajas.length === 0) return <Aviso tono="aviso">No hay ninguna caja dada de alta.</Aviso>;

  const actualizado = new Date(datos.actualizadoMs).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Posición global"
        descripcion={`Todo el efectivo que tenemos ahora mismo: lo que hay en la caja más lo que espera para ir al banco · ${actualizado}`}
      >
        <BotonesInforme
          ruta={`/posicion/report.pdf?caja=${vista === "todas" ? "todas" : estaCaja?.registerId ?? "todas"}`}
          rutaExcel={`/posicion/report.xlsx?caja=${vista === "todas" ? "todas" : estaCaja?.registerId ?? "todas"}`}
          nombre={`posicion-${vista === "todas" ? "todas" : (estaCaja?.nombre ?? "caja").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date(datos.actualizadoMs).toISOString().slice(0, 10)}`}
        />
        <button
          onClick={() => void onRecargar()}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          ↺ Actualizar
        </button>
      </Cabecera>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["caja", estaCaja ? `Esta caja · ${estaCaja.nombre}` : "Esta caja"],
            ["todas", `${etiquetaTodas} (${datos.cajas.length})`],
          ] as const
        ).map(([k, texto]) => (
          <button
            key={k}
            onClick={() => setVista(k)}
            className={`rounded-full border px-3 py-1 text-[12px] ${
              vista === k
                ? "border-sky-600 bg-sky-700 font-bold text-white"
                : "border-slate-600 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="rounded-xl border border-sky-700 bg-gradient-to-b from-sky-950 to-slate-900 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Efectivo disponible total
          </div>
          <div className="mt-1 text-3xl font-black tabular-nums text-sky-300">{euros(total)}</div>
          <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-slate-300">
            <span>
              Billetes <strong className="text-sky-300">{euros(totalBilletes)}</strong>
            </span>
            <span>
              Monedas <strong className="text-amber-300">{euros(cajaMonedas + pendMonedas)}</strong>
            </span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-700">
            <span className="h-full bg-sky-400" style={{ width: `${pctBilletes}%` }} />
            <span className="h-full bg-amber-500" style={{ width: `${100 - pctBilletes}%` }} />
          </div>
        </div>
        <Tarjeta
          titulo="En la caja"
          valor={p.cajaCentimos}
          tono="text-emerald-400"
          linea1={
            vista === "caja" && estaCaja
              ? estaCaja.estado === "ABIERTA"
                ? `Efectivo teórico de la jornada abierta del ${fecha(estaCaja.fecha)}`
                : estaCaja.estado === "CERRADA"
                  ? `Caja cerrada: el cambio que dejó el cierre del ${fecha(estaCaja.fecha)}`
                  : "Esta caja todavía no ha abierto ninguna jornada"
              : "Lo que hay en el cajón de cada caja"
          }
          linea2={`Billetes ${euros(cajaBilletes)} · monedas ${euros(cajaMonedas)}`}
        />
        <Tarjeta
          titulo="Pendiente de ingresar"
          valor={p.pendienteCentimos}
          tono="text-amber-300"
          linea1="La bolsa que espera al banco"
          linea2={`Billetes ${euros(pendBilletes)} · monedas ${euros(pendMonedas)}`}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left">
                Pieza
              </th>
              <th colSpan={2} className="border-l border-slate-700 px-3 py-1 text-center">
                En la caja
              </th>
              <th colSpan={2} className="border-l border-slate-700 px-3 py-1 text-center">
                Pendiente de ingresar
              </th>
              <th colSpan={2} className="border-l border-slate-700 px-3 py-1 text-center">
                Total
              </th>
            </tr>
            <tr>
              {[0, 1, 2].map((i) => (
                <FilaCabecera key={i} />
              ))}
            </tr>
          </thead>
          <tbody>
            <Seccion titulo="Billetes" />
            <Filas grupo={billetes} caja={p.caja} pendiente={p.pendiente} tipo="BILLETE" />
            <Subtotal texto="Total billetes" caja={cajaBilletes} pendiente={pendBilletes} />
            <Seccion titulo="Monedas" />
            <Filas grupo={monedas} caja={p.caja} pendiente={p.pendiente} tipo="MONEDA" />
            {p.sinDesgloseCentimos > 0 && (
              <tr className="border-t border-slate-800 bg-amber-500/5">
                <td className="px-3 py-1.5 text-slate-300">
                  <span className="mr-2">Sin desglose, del último ingreso</span>
                  {vista === "caja" && estaCaja && contar?.(estaCaja)}
                </td>
                <td className="border-l border-slate-800" />
                <td />
                <td className="border-l border-slate-800 px-3 text-right text-slate-500">?</td>
                <td className="px-3 text-right tabular-nums text-slate-200">{euros(p.sinDesgloseCentimos)}</td>
                <td className="border-l border-slate-800 px-3 text-right text-slate-500">?</td>
                <td className="px-3 text-right font-bold tabular-nums text-white">
                  {euros(p.sinDesgloseCentimos)}
                </td>
              </tr>
            )}
            <Subtotal texto="Total monedas" caja={cajaMonedas} pendiente={pendMonedas} />
            <tr className="border-t-2 border-sky-700 bg-sky-950 text-[15px] font-black text-white">
              <td className="px-3 py-2">TOTAL EFECTIVO</td>
              <td className="border-l border-slate-800" />
              <td className="px-3 text-right tabular-nums">{euros(p.cajaCentimos)}</td>
              <td className="border-l border-slate-800" />
              <td className="px-3 text-right tabular-nums">{euros(p.pendienteCentimos)}</td>
              <td className="border-l border-slate-800" />
              <td className="px-3 text-right tabular-nums">{euros(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {descuadre !== 0 && (
        <Aviso tono="aviso">
          Las piezas de la bolsa suman {euros(p.piezasPendiente + p.sinDesgloseCentimos)} y lo pendiente
          de ingresar son {euros(p.pendienteCentimos)}
          {faltan.length > 0 && (
            <>
              : se sacaron de la bolsa{" "}
              {faltan.map(([v, n], i) => (
                <span key={v}>
                  {i > 0 && ", "}
                  {n} × {euros(v)}
                </span>
              ))}{" "}
              que, según los cierres, no estaban
            </>
          )}
          . El total de arriba usa lo pendiente de la cuenta; el desglose por piezas de la bolsa no
          es fiable hasta el próximo ingreso. Cuenta la bolsa y fíate de lo contado.
        </Aviso>
      )}

      {vista === "todas" && datos.cajas.length > 1 && (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-900 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Caja</th>
                <th className="px-3 py-2 text-right">En la caja</th>
                <th className="px-3 py-2 text-right">Pendiente de ingresar</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.cajas.map((c) => (
                <tr key={c.registerId} className="border-t border-slate-800">
                  <td className="px-3 py-1.5 text-slate-200">
                    {c.centro ? `${c.centro} · ` : ""}
                    {c.nombre}
                  </td>
                  <td className="px-3 text-right tabular-nums text-slate-300">{euros(c.cajaCentimos)}</td>
                  <td className="px-3 text-right tabular-nums text-slate-300">{euros(c.pendienteCentimos)}</td>
                  <td className="px-3 text-right font-bold tabular-nums text-white">
                    {euros(c.cajaCentimos + c.pendienteCentimos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-[12px] text-slate-400">
          <div className="mb-1 font-bold text-slate-200">De dónde sale lo pendiente de ingresar</div>
          <Linea texto={`Cierres sin ingresar (${p.numCierres})`} valor={p.cierresCentimos} />
          <Linea texto="Sin ingresar del último ingreso" valor={p.remanenteCentimos} />
          <Linea texto="Repuesto al cajón" valor={-p.repuestoCentimos} />
          <div className="mt-1 flex justify-between border-t border-slate-700 pt-1 font-bold text-white">
            <span>Pendiente de ingresar</span>
            <span className="tabular-nums">{euros(p.pendienteCentimos)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-[12px] leading-relaxed text-slate-400">
          <div className="mb-1 font-bold text-slate-200">Cómo se cuenta</div>
          <p>
            · <strong className="text-slate-200">En la caja</strong>: el efectivo teórico de la jornada
            abierta, tubos y bolsas precintadas incluidos. Con la caja cerrada, el cambio que dejó el
            último cierre.
          </p>
          <p>
            · <strong className="text-slate-200">Pendiente de ingresar</strong>: la misma bolsa de
            Ingresos bancarios, con lo que quedó sin ingresar la última vez.
          </p>
          <p>
            · Tarjetas, Bizum y transferencias no cuentan, ni el dinero que está fuera de la tienda
            (cambio pedido al banco, entregas a personas): aquí solo el efectivo que se puede tocar.
          </p>
        </div>
      </div>
    </div>
  );
}

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function Tarjeta({
  titulo,
  valor: v,
  tono,
  linea1,
  linea2,
}: {
  titulo: string;
  valor: number;
  tono: string;
  linea1: string;
  linea2: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{titulo}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tono}`}>{euros(v)}</div>
      <div className="mt-1 text-[11px] leading-snug text-slate-500">
        {linea1}
        <br />
        {linea2}
      </div>
    </div>
  );
}

function FilaCabecera() {
  return (
    <>
      <th className="border-l border-slate-700 px-3 py-1 text-left">Uds.</th>
      <th className="px-3 py-1 text-right">Importe</th>
    </>
  );
}

function Seccion({ titulo }: { titulo: string }) {
  return (
    <tr className="border-t border-slate-800 bg-slate-900">
      <td colSpan={7} className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {titulo}
      </td>
    </tr>
  );
}

function Filas({
  grupo,
  caja,
  pendiente,
  tipo,
}: {
  grupo: Denominacion[];
  caja: Map<number, number>;
  pendiente: Map<number, number>;
  tipo: "BILLETE" | "MONEDA";
}) {
  const visibles = grupo.filter((d) => (caja.get(d.valor) ?? 0) + (pendiente.get(d.valor) ?? 0) > 0);
  if (visibles.length === 0) {
    return (
      <tr className="border-t border-slate-800">
        <td colSpan={7} className="px-3 py-1.5 text-slate-500">
          Ninguno.
        </td>
      </tr>
    );
  }
  const chip =
    tipo === "BILLETE" ? "bg-sky-900/70 text-sky-200" : "bg-amber-900/50 text-amber-200";
  return (
    <>
      {visibles.map((d) => {
        const c = caja.get(d.valor) ?? 0;
        const p = pendiente.get(d.valor) ?? 0;
        return (
          <tr key={d.valor} className="border-t border-slate-800">
            <td className="px-3 py-1">
              <span className="flex items-center gap-2">
                {/* La foto del catálogo: se reconoce la pieza antes de leer el número. */}
                {d.imagenUrl ? (
                  <img src={d.imagenUrl} alt="" className="h-7 w-11 flex-none object-contain" loading="lazy" />
                ) : (
                  <span className="block h-7 w-11 flex-none" />
                )}
                <span className={`inline-block min-w-[72px] rounded-md px-2 py-0.5 text-center font-bold ${chip}`}>
                  {euros(d.valor)}
                </span>
              </span>
            </td>
            <td className="border-l border-slate-800 px-3 text-slate-400 tabular-nums">{c ? `×${c}` : "—"}</td>
            <td className="px-3 text-right tabular-nums text-slate-300">{c ? euros(c * d.valor) : ""}</td>
            <td className="border-l border-slate-800 px-3 text-slate-400 tabular-nums">{p ? `×${p}` : "—"}</td>
            <td className="px-3 text-right tabular-nums text-slate-300">{p ? euros(p * d.valor) : ""}</td>
            <td className="border-l border-slate-800 px-3 font-bold tabular-nums text-white">×{c + p}</td>
            <td className="px-3 text-right font-bold tabular-nums text-white">{euros((c + p) * d.valor)}</td>
          </tr>
        );
      })}
    </>
  );
}

function Subtotal({ texto, caja, pendiente }: { texto: string; caja: number; pendiente: number }) {
  return (
    <tr className="border-t border-slate-700 bg-slate-900/80 font-bold text-slate-100">
      <td className="px-3 py-1.5">{texto}</td>
      <td className="border-l border-slate-800" />
      <td className="px-3 text-right tabular-nums">{euros(caja)}</td>
      <td className="border-l border-slate-800" />
      <td className="px-3 text-right tabular-nums">{euros(pendiente)}</td>
      <td className="border-l border-slate-800" />
      <td className="px-3 text-right tabular-nums">{euros(caja + pendiente)}</td>
    </tr>
  );
}

function Linea({ texto, valor: v }: { texto: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <span>{texto}</span>
      <span className="tabular-nums">{euros(v)}</span>
    </div>
  );
}

/**
 * Descargar el informe en PDF o en Excel y, donde el navegador sabe, mandar el PDF.
 *
 * «Enviar» usa el menú de compartir del sistema (correo, WhatsApp…) con el PDF
 * adjunto. Solo sale donde el navegador puede compartir ficheros; donde no, se
 * descarga y se adjunta a mano.
 */
function BotonesInforme({ ruta, rutaExcel, nombre }: { ruta: string; rutaExcel: string; nombre: string }) {
  const [ocupado, setOcupado] = useState<"" | "descargar" | "excel" | "enviar">("");
  const [error, setError] = useState("");
  const fichero = `${nombre}.pdf`;
  const sePuedeCompartir =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof File !== "undefined" &&
    navigator.canShare({ files: [new File([""], fichero, { type: "application/pdf" })] });

  async function descargar(que: "descargar" | "excel") {
    setOcupado(que);
    setError("");
    try {
      // El mismo camino sirve para el PDF y el Excel: lleva la sesión en la
      // cabecera y devuelve el fichero tal cual.
      const url = URL.createObjectURL(await api.descargarPdf(que === "excel" ? rutaExcel : ruta));
      const a = document.createElement("a");
      a.href = url;
      a.download = que === "excel" ? `${nombre}.xlsx` : fichero;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido generar el informe");
    } finally {
      setOcupado("");
    }
  }

  async function enviar() {
    setOcupado("enviar");
    setError("");
    try {
      const blob = await api.descargarPdf(ruta);
      await navigator.share({
        files: [new File([blob], fichero, { type: "application/pdf" })],
        title: "Posición global de efectivo",
      });
    } catch (e) {
      // Cerrar el menú de compartir no es un error.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "No se ha podido enviar el informe");
      }
    } finally {
      setOcupado("");
    }
  }

  const cls =
    "flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-600 disabled:opacity-60";
  return (
    <>
      <button onClick={() => void descargar("descargar")} disabled={ocupado !== ""} className={cls}>
        <FileDown className="h-3.5 w-3.5" />
        {ocupado === "descargar" ? "Generando…" : "Descargar PDF"}
      </button>
      <button
        onClick={() => void descargar("excel")}
        disabled={ocupado !== ""}
        className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {ocupado === "excel" ? "Generando…" : "Excel"}
      </button>
      {sePuedeCompartir && (
        <button onClick={() => void enviar()} disabled={ocupado !== ""} className={cls}>
          <Share2 className="h-3.5 w-3.5" />
          {ocupado === "enviar" ? "Preparando…" : "Enviar"}
        </button>
      )}
      {error && <span className="text-[11px] text-rose-300">{error}</span>}
    </>
  );
}
