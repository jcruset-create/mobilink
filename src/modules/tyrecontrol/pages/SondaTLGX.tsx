import { useEffect, useRef, useState } from "react";
import { Bluetooth, Gauge, Ruler, ScanLine, Trash2 } from "lucide-react";
import { TlgxProbe, parsearLinea, webBluetoothDisponible } from "../services/tlgxProbe";

// Pantalla de prueba: conectar la sonda TLGX y ver lecturas en vivo
// (profundidad, presión, RFID). Valida la conexión antes de integrarla
// en la Revisión de vehículo.
export default function SondaTLGX() {
  const probeRef = useRef<TlgxProbe | null>(null);
  const [conectada, setConectada] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");

  const [modelo, setModelo] = useState("");
  const [version, setVersion] = useState("");
  const [bateria, setBateria] = useState("");
  const [profundidad, setProfundidad] = useState<number | null>(null);
  const [presion, setPresion] = useState<number | null>(null);
  const [rfid, setRfid] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const soportado = webBluetoothDisponible();

  function agregarLog(txt: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString("es-ES")} · ${txt}`, ...prev].slice(0, 100));
  }

  useEffect(() => {
    return () => { void probeRef.current?.desconectar(); };
  }, []);

  async function conectar() {
    setError("");
    setConectando(true);
    try {
      const probe = new TlgxProbe(
        (line) => {
          agregarLog(`◀ ${line}`);
          const r = parsearLinea(line);
          if (r.tipo === "profundidad") setProfundidad(r.mm);
          else if (r.tipo === "presion") setPresion(r.valor);
          else if (r.tipo === "rfid") setRfid(r.epc);
          else if (r.tipo === "info") {
            if (r.clave === "modelo") setModelo(r.valor);
            else if (r.clave === "version") setVersion(r.valor);
            else if (r.clave === "bateria") setBateria(r.valor);
          }
        },
        (estado) => {
          setConectada(estado);
          if (!estado) agregarLog("Sonda desconectada");
        }
      );
      probeRef.current = probe;
      await probe.conectar();
      setNombre(probe.nombre);
      agregarLog(`Conectada: ${probe.nombre}`);
      // Configura unidades conocidas y pide info básica
      await enviar("UTM"); // profundidad en mm
      await enviar("UPP"); // presión en psi
      await enviar("MODSTR");
      await enviar("V");
      await enviar("BV");
    } catch (e: any) {
      if (e?.name === "NotFoundError") setError("No se seleccionó ninguna sonda.");
      else setError(e?.message || "Error conectando con la sonda");
    } finally {
      setConectando(false);
    }
  }

  async function enviar(cmd: string) {
    try {
      await probeRef.current?.enviar(cmd);
      agregarLog(`▶ ${cmd}`);
    } catch (e: any) {
      setError(e?.message || "Error enviando comando");
    }
  }

  async function desconectar() {
    await probeRef.current?.desconectar();
    probeRef.current = null;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Sonda TLGX</h1>
          <p className="text-sm text-slate-400">Prueba de conexión con la sonda de medición (profundidad, presión y RFID).</p>
        </div>
        {conectada ? (
          <button onClick={desconectar} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800">Desconectar</button>
        ) : (
          <button onClick={conectar} disabled={conectando || !soportado} className="flex items-center gap-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50">
            <Bluetooth className="h-4 w-4" /> {conectando ? "Conectando…" : "Conectar sonda"}
          </button>
        )}
      </div>

      {!soportado && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Este navegador no soporta Bluetooth Web. Abre la app en <b>Chrome</b> o <b>Edge</b> de ordenador, o en <b>Chrome de Android</b> (en iPhone/iPad no funciona).
        </div>
      )}
      {error && <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {conectada && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">● {nombre || "Conectada"}</span>
          {modelo && <span>Modelo: <b className="text-slate-200">{modelo}</b></span>}
          {version && <span>FW: <b className="text-slate-200">{version}</b></span>}
          {bateria && <span>Batería: <b className="text-slate-200">{bateria} V</b></span>}
        </div>
      )}

      {/* Lecturas en vivo */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400"><Ruler className="h-3.5 w-3.5" /> Profundidad</div>
          <div className="mt-1 text-3xl font-black text-sky-300">{profundidad != null ? `${profundidad.toFixed(2)} mm` : "—"}</div>
          <button onClick={() => enviar("T")} disabled={!conectada} className="mt-1 text-[11px] text-slate-400 hover:underline disabled:opacity-40">medir ahora</button>
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400"><Gauge className="h-3.5 w-3.5" /> Presión</div>
          <div className="mt-1 text-3xl font-black text-emerald-300">{presion != null ? `${presion.toFixed(2)} psi` : "—"}</div>
          <button onClick={() => enviar("P")} disabled={!conectada} className="mt-1 text-[11px] text-slate-400 hover:underline disabled:opacity-40">medir ahora</button>
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400"><ScanLine className="h-3.5 w-3.5" /> RFID (EPC)</div>
          <div className="mt-1 break-all font-mono text-sm font-black text-violet-300">{rfid || "—"}</div>
          <button onClick={() => enviar("GR")} disabled={!conectada} className="mt-1 text-[11px] text-slate-400 hover:underline disabled:opacity-40">leer tag</button>
        </div>
      </div>

      <p className="mb-2 text-[12px] text-slate-500">
        Apoya la sonda en el neumático: la profundidad y la presión se envían solas al detectar la medida. También puedes forzar la lectura con los botones.
      </p>

      {/* Consola */}
      <div className="rounded-lg border border-slate-700 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
          <span className="text-[11px] font-bold uppercase text-slate-400">Consola</span>
          <button onClick={() => setLog([])} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"><Trash2 className="h-3 w-3" /> limpiar</button>
        </div>
        <div className="max-h-64 overflow-y-auto p-2 font-mono text-[11px] text-slate-400">
          {log.length === 0 ? <div className="text-slate-600">Sin actividad.</div> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}
