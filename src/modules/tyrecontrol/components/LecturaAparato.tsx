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
import { useState } from "react";
import { verSensores, type LecturaAparato as Lectura } from "../services/kilometrajeMensual";

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
