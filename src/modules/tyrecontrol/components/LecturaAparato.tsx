/**
 * «Lo que dice el aparato»: gasóleo, peso por eje y estado del motor.
 *
 * ── Por qué hay un botón y no se carga solo ─────────────────────────────────
 *
 * Abrir la ficha de un vehículo NO puede costar una petición al proveedor.
 * Es la regla que ya sigue el bloque de kilómetros mensuales (lee de nuestra
 * base, nunca de Movertis) y aquí vale igual: con 751 vehículos, cargarlo al
 * abrir sería gastar el cupo del proveedor en cada clic de cualquiera.
 *
 * Así que se pide a mano, una vez, cuando alguien quiere saberlo.
 *
 * ── Qué se enseña y qué no ──────────────────────────────────────────────────
 *
 * Lo que tiene unidad comprobada va con su unidad. El depósito y el AdBlue
 * van con el nombre que les da el aparato y sin unidad: Movertis no las
 * documenta y en este mismo conector ya hubo un lío de metros contra
 * kilómetros que costó caro. El porqué está en `server/tyrecontrol/lecturaAparato.ts`.
 */
import { useEffect, useState } from "react";
import {
  historicoAparato, verSensores,
  type HistoricoAparato, type LecturaAparato as Lectura,
} from "../services/kilometrajeMensual";

const num = (n: number | null | undefined, dec = 0) =>
  n == null ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function Dato({ etiqueta, valor, pista, destacado }: {
  etiqueta: string; valor: string; pista?: string; destacado?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</div>
      <div className={`text-lg font-extrabold ${destacado ? "text-sky-300" : "text-slate-100"}`}>{valor}</div>
      {pista && <div className="text-[10px] text-slate-500">{pista}</div>}
    </div>
  );
}

export default function LecturaAparatoBloque({ vehiculoId, empresaId }: {
  vehiculoId: string; empresaId: string;
}) {
  const [l, setL] = useState<Lectura | null>(null);
  const [cuando, setCuando] = useState<string | null>(null);
  const [sinDatos, setSinDatos] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [hist, setHist] = useState<HistoricoAparato | null>(null);

  // El histórico SÍ se carga solo: lo escribe el reloj de las 04:00 en nuestra
  // base y leerlo no cuesta ninguna petición al proveedor.
  useEffect(() => {
    let vivo = true;
    void historicoAparato(vehiculoId).then((h) => { if (vivo) setHist(h); }).catch(() => {});
    return () => { vivo = false; };
  }, [vehiculoId]);

  async function leer() {
    setCargando(true); setError(""); setSinDatos(false);
    try {
      const r = await verSensores({ empresaId, vehiculoId });
      setL(r.lectura);
      setSinDatos(r.lectura == null);
      setCuando(r.pedidoEn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido leer del aparato");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase text-slate-400">Lo que dice el aparato</div>
          <div className="text-[11px] text-slate-500">
            Gasóleo, peso por eje y motor, leídos del equipo de telemática. Se pide a mano para no gastar
            cupo del proveedor cada vez que alguien abre una ficha.
          </div>
        </div>
        <button
          onClick={() => void leer()}
          disabled={cargando}
          className="rounded-lg border border-slate-500 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-700/40 disabled:opacity-50">
          {cargando ? "Leyendo…" : l || sinDatos ? "Volver a leer" : "Leer del aparato"}
        </button>
      </div>

      {error && <div className="mt-2 rounded-lg bg-red-500/10 p-3 text-[13px] text-red-300">{error}</div>}

      {hist && <Historico h={hist} />}

      {sinDatos && !error && (
        <div className="mt-2 rounded-lg border border-slate-600 bg-slate-900/40 p-3 text-[13px] text-slate-300">
          El aparato de este vehículo no da gasóleo, ni peso por eje, ni horas de motor. Eso pasa cuando el equipo
          no está conectado al bus del vehículo: solo sabe dónde está.
        </div>
      )}

      {l && (
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dato etiqueta="Gasóleo consumido" valor={l.consumidoL == null ? "—" : `${num(l.consumidoL)} l`}
              pista="desde que se instaló el equipo" />
            <Dato etiqueta="Consumo medio" destacado
              valor={l.consumoMedioL100 == null ? "—" : `${num(l.consumoMedioL100, 1)} l/100 km`}
              pista={l.consumoMedioL100 == null ? "no sale una cifra creíble" : "consumo real, no estimado"} />
            <Dato etiqueta="Horas de motor" valor={l.horasMotor == null ? "—" : `${num(l.horasMotor)} h`} />
            <Dato etiqueta="Odómetro del aparato" valor={l.odometroKm == null ? "—" : `${num(l.odometroKm)} km`} />
          </div>

          {l.ejes.length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Peso por eje</span>
                <span className="text-[12px] text-slate-400">
                  Total <b className="text-slate-100">{num(l.pesoTotalKg)} kg</b>
                </span>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(l.ejes.length, 5)}, minmax(0, 1fr))` }}>
                {l.ejes.map((e) => (
                  <div key={e.eje} className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-400">Eje {e.eje}</div>
                    <div className="text-base font-extrabold text-slate-100">{num(e.kg)} kg</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-slate-500">
                Es el peso de ahora mismo, no un máximo del día. Los ejes sin sensor no salen.
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-300">
            <span>Motor <b className={l.rpm ? "text-emerald-300" : "text-slate-400"}>{l.rpm == null ? "—" : `${num(l.rpm)} rpm`}</b></span>
            <span>Velocidad <b>{l.velocidadKmh == null ? "—" : `${num(l.velocidadKmh)} km/h`}</b></span>
            <span>Contacto <b>{l.contacto == null ? "—" : l.contacto ? "dado" : "quitado"}</b></span>
            {l.rpm != null && l.velocidadKmh != null && l.rpm > 0 && l.velocidadKmh === 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                ahora mismo, al ralentí
              </span>
            )}
          </div>

          {l.deposito.length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Depósitos</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-300">
                {l.deposito.map((d) => (
                  <span key={d.nombre}>{d.nombre} <b className="text-slate-100">{String(d.valor)}</b></span>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Sin unidad a propósito: Movertis no documenta si son litros o porcentaje, y ponérsela sería inventarla.
              </div>
            </div>
          )}

          {l.otros.length > 0 && (
            <details className="text-[11px] text-slate-400">
              <summary className="cursor-pointer">Lo demás que manda el aparato ({l.otros.length})</summary>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {l.otros.map((o) => (
                  <span key={o.nombre}>{o.nombre} <b className="text-slate-200">{String(o.valor)}</b></span>
                ))}
              </div>
            </details>
          )}

          {cuando && (
            <div className="text-[10px] text-slate-500">
              Leído el {new Date(cuando).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" })}.
              No se guarda: cada lectura es una foto del momento.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lo que se ha ido guardando cada madrugada, y lo que sale de restarlo.
 *
 * Un tramo con aviso se enseña igual, con el motivo: un contador que baja o
 * un salto imposible significan «equipo cambiado» o «lectura mala», y eso es
 * información, no basura que esconder. Lo que no se hace es sumarlo.
 */
function Historico({ h }: { h: HistoricoAparato }) {
  const r = h.ultimos30;
  if (h.fotos === 0) {
    return (
      <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-[12px] text-slate-400">
        Todavía no hay histórico de este vehículo. Se guarda una foto de los contadores cada madrugada a las 04:00;
        el primer consumo por días sale con la segunda foto, o sea pasado mañana.
      </div>
    );
  }
  if (h.fotos === 1) {
    return (
      <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-[12px] text-slate-400">
        Hay una sola foto, del {h.primeraFoto}. El consumo de un periodo es la resta de dos: mañana por la mañana
        ya habrá tramo.
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Últimos 30 días</span>
        <span className="text-[10px] text-slate-500">
          {h.fotos} fotos, de {h.primeraFoto} a {h.ultimaFoto}
          {r.conAviso > 0 && <> · {r.conAviso} tramo(s) con algo descartado: la suma es de menos</>}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato etiqueta="Gasóleo" valor={r.litros == null ? "—" : `${num(r.litros)} l`} />
        <Dato etiqueta="Consumo" destacado valor={r.l100 == null ? "—" : `${num(r.l100, 1)} l/100 km`} />
        <Dato etiqueta="Horas de motor" valor={r.horasMotor == null ? "—" : `${num(r.horasMotor, 1)} h`} />
        <Dato etiqueta="Kilómetros" valor={r.km == null ? "—" : `${num(r.km)} km`} />
      </div>

      <details className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
        <summary className="cursor-pointer text-[11px] font-bold text-slate-300">Día a día ({h.tramos.length} tramos)</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-1 text-left">Hasta</th>
                <th className="px-2 py-1 text-right">Gasóleo</th>
                <th className="px-2 py-1 text-right">Km</th>
                <th className="px-2 py-1 text-right">l/100 km</th>
                <th className="px-2 py-1 text-right">Motor</th>
              </tr>
            </thead>
            <tbody>
              {[...h.tramos].reverse().map((t) => (
                <tr key={`${t.desde}-${t.hasta}`} className="border-t border-slate-800">
                  <td className="px-2 py-1 text-slate-200">
                    {t.hasta}
                    {t.horasTranscurridas > 30 && (
                      <span className="ml-1 text-[10px] text-slate-500">({Math.round(t.horasTranscurridas)} h)</span>
                    )}
                    {t.aviso && <div className="text-[10px] text-amber-400">{t.aviso}</div>}
                  </td>
                  <td className="px-2 py-1 text-right text-slate-300">{t.litros == null ? "—" : `${num(t.litros)} l`}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{t.km == null ? "—" : num(t.km)}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{t.l100 == null ? "—" : num(t.l100, 1)}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{t.horasMotor == null ? "—" : `${num(t.horasMotor, 1)} h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
