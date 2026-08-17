/**
 * Connect Pro — puesta en marcha de la central.
 *
 * Quien compra la licencia se encuentra un motor que sabe tarificar y una base
 * vacía. Esta pantalla es lo que le lleva de "no hay nada" a "ya factura".
 *
 * Está construida sobre una observación: configurar esto tiene ocho pasos y
 * siete de ellos **no dan error si te los saltas**. Simplemente no se factura,
 * y nadie se entera hasta fin de mes. Por eso cada paso dice *por qué* hace
 * falta: una lista de casillas sin el porqué se rellena a ciegas, y lo que se
 * está configurando aquí es dinero.
 *
 * Y por eso las plantillas no traen precios. Montan la estructura —que es lo
 * que cuesta acertar— con los importes a cero, bien visibles, para que haya
 * que ponerlos a mano.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { PageTitle, Card, Badge, Input, Select, Button, ErrorBanner } from "../components/ui";
import { useCentroDeTrabajo, SelectorCentro, AvisoElegirCentro } from "../components/CentroDeTrabajo";

type Paso = {
  clave: string; titulo: string; porQue: string;
  hecho: boolean; imprescindible: boolean;
  detalle?: string; ruta?: string;
};

type Estado = { listo: boolean; pasos: Paso[]; pendientes: number };

type PlantillaInfo = {
  code: string; nombre: string; paraQuien: string; descripcion: string; aRellenar: string[];
};

export default function PuestaEnMarcha() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [plantillas, setPlantillas] = useState<PlantillaInfo[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nombre, setNombre] = useState("");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const ctxCentro = useCentroDeTrabajo();
  const { centro } = ctxCentro;

  const cargar = useCallback(() => {
    if (centro == null) { setEstado(null); return; }
    boFetch<Estado>("/setup/status", { centro }).then(setEstado).catch((e) => setError(e.message));
  }, [centro]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    boFetch<{ data: PlantillaInfo[] }>("/setup/templates")
      .then((r) => setPlantillas(r.data)).catch(() => {});
  }, []);

  const aplicar = async () => {
    if (!elegida) return;
    setBusy(true); setError(null); setAviso(null);
    try {
      const r = await boFetch<any>("/setup/apply-template", {
        method: "POST", centro,
        body: { plantilla: elegida, code, nombre, anio: Number(anio) },
      });
      setAviso(
        `Creado "${nombre}" como borrador: ${r.reglas} reglas, ${r.extras} suplementos, ` +
        `${r.franjas} franjas y ${r.diasCalendario} festivos. ` +
        `Los importes están a cero: ponlos en Tarifas y publica la versión.`);
      setElegida(null); setCode(""); setNombre("");
      cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const plantilla = plantillas.find((p) => p.code === elegida);
  const hechos = estado ? estado.pasos.filter((p) => p.hecho).length : 0;

  return (
    <div>
      <PageTitle
        title="Puesta en marcha"
        subtitle="Lo que le falta a esta central para poder facturar, en orden."
      />
      <SelectorCentro ctx={ctxCentro} />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {ctxCentro.faltaElegir && <AvisoElegirCentro />}
      {aviso && (
        <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
          {aviso}
        </div>
      )}

      {estado && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-100">
              {hechos} de {estado.pasos.length} pasos
            </span>
            {estado.listo
              ? <Badge className="border-emerald-500/40 text-emerald-300">Lista para facturar</Badge>
              : <Badge className="border-amber-500/40 text-amber-300">{estado.pendientes} pendiente(s)</Badge>}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-cyan-500 transition-all"
                 style={{ width: `${Math.round((hechos / estado.pasos.length) * 100)}%` }} />
          </div>
        </Card>
      )}

      <div className="mb-6 flex flex-col gap-2">
        {estado?.pasos.map((p, i) => (
          <Card key={p.clave} className={`p-3 ${p.hecho ? "opacity-70" : ""}`}>
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                p.hecho ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                {p.hecho ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-slate-100">{p.titulo}</span>
                  {!p.imprescindible && (
                    <Badge className="border-slate-600 text-slate-500">opcional</Badge>
                  )}
                  {p.ruta && !p.hecho && (
                    <Link to={p.ruta} className="ml-auto text-[12px] text-cyan-300 hover:underline">
                      Ir a configurarlo ↗
                    </Link>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-slate-400">{p.porQue}</p>
                {p.detalle && <p className="mt-0.5 text-[12px] text-slate-500">{p.detalle}</p>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ── Plantillas ── */}
      {centro != null && <>

      <h2 className="mb-2 text-sm font-semibold text-slate-300">Empezar desde una plantilla</h2>
      <p className="mb-3 text-[13px] text-slate-400">
        Montan la estructura del tarifario —las franjas, las reglas, los suplementos
        y el calendario de festivos— que es la parte que cuesta acertar.{" "}
        <strong className="text-slate-300">Los precios no vienen puestos</strong>: nacen a
        cero para que los pongas tú. Un precio de plantilla es un número que
        alguien acaba publicando con prisa.
      </p>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        {plantillas.map((p) => (
          <Card
            key={p.code}
            className={`cursor-pointer p-4 transition ${
              elegida === p.code ? "border-cyan-500/60" : "hover:border-slate-600"}`}
          >
            <button type="button" className="w-full text-left" onClick={() => {
              setElegida(p.code);
              setCode(p.code);
              setNombre(p.nombre);
            }}>
              <span className="text-[14px] font-semibold text-slate-100">{p.nombre}</span>
              <p className="mt-1 text-[12px] text-slate-400">{p.paraQuien}</p>
              <p className="mt-2 text-[12px] text-slate-500">{p.descripcion}</p>
            </button>
          </Card>
        ))}
      </div>

      {plantilla && (
        <Card className="p-4">
          <p className="mb-3 text-[13px] font-medium text-slate-200">
            Crear un tarifario con la plantilla «{plantilla.nombre}»
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Código</span>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Nombre</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Año del calendario</span>
              <Select value={anio} onChange={(e) => setAnio(e.target.value)}>
                {[0, 1, 2].map((n) => {
                  const a = new Date().getFullYear() + n;
                  return <option key={a} value={a}>{a}</option>;
                })}
              </Select>
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <p className="text-[13px] font-medium text-amber-300">Lo que tendrás que rellenar después:</p>
            <ul className="mt-1 list-inside list-disc text-[12px] text-slate-300">
              {plantilla.aRellenar.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={aplicar} disabled={busy || !code.trim() || !nombre.trim()}>
              Crear el tarifario
            </Button>
            <Button variant="ghost" onClick={() => setElegida(null)} disabled={busy}>Cancelar</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Se crea como borrador y no factura nada hasta que lo publiques a conciencia.
          </p>
        </Card>
      )}

      </>}
    </div>
  );
}
