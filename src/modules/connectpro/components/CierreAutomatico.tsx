/**
 * Connect Pro — interruptor del cierre automático de tarifas.
 *
 * De fábrica está APAGADO: el cierre lo dispara una persona desde la ficha de
 * cada asistencia. Esto lo automatiza cuando la central quiera.
 *
 * Lo que decide la forma de esta pantalla es que **la etapa de cierre es
 * inmutable**. Una vez cerrada, un neumático que el taller comunique después
 * ya no entra en la tarifa y hay que meterlo como ajuste manual auditado. Por
 * eso lo que se configura de verdad no es el sí/no, es **cuánto se espera**, y
 * por eso antes de encenderlo se enseña cuántos servicios cerraría ahora
 * mismo: encenderlo a ciegas en una central con seiscientos pendientes es una
 * sorpresa que conviene ahorrarse.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { useCentroDeTrabajo, SelectorCentro, AvisoElegirCentro } from "./CentroDeTrabajo";
import { Card, Select, Button, ErrorBanner, Badge } from "./ui";

type Estado = {
  activo: boolean; esperaMin: number;
  cerrariaAhora: number; pendientesTotal: number;
};

const ESPERAS: [number, string][] = [
  [0, "Al momento, en cuanto el servicio termina"],
  [60, "1 hora después"],
  [4 * 60, "4 horas después"],
  [12 * 60, "12 horas después"],
  [24 * 60, "24 horas después (recomendado)"],
  [48 * 60, "48 horas después"],
  [7 * 24 * 60, "Una semana después"],
];

export default function CierreAutomatico({ canEdit }: { canEdit: boolean }) {
  const ctxCentro = useCentroDeTrabajo();
  const { centro } = ctxCentro;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [espera, setEspera] = useState(24 * 60);
  const [previa, setPrevia] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    if (centro == null) { setEstado(null); return; }
    boFetch<Estado>("/pricing/auto-close", { centro })
      .then((r) => { setEstado(r); setEspera(r.esperaMin); setPrevia(r.cerrariaAhora); })
      .catch((e) => setError(e.message));
  }, [centro]);
  useEffect(cargar, [cargar]);

  // Al cambiar la espera se recalcula cuántos entrarían, sin tocar nada
  useEffect(() => {
    if (!estado) return;
    boFetch<{ cerrariaAhora: number }>(`/pricing/auto-close/preview?esperaMin=${espera}`, { centro })
      .then((r) => setPrevia(r.cerrariaAhora)).catch(() => {});
  }, [espera, estado, centro]);

  const guardar = async (activo: boolean) => {
    if (activo && previa && previa > 0) {
      if (!window.confirm(
        `Al activarlo se van a cerrar ${previa} servicio(s) en el próximo pase.\n\n` +
        `El cierre es irreversible: lo que el taller comunique después habrá que ` +
        `meterlo como ajuste manual.\n\n¿Continuar?`)) return;
    }
    setBusy(true); setError(null); setAviso(null);
    try {
      const r = await boFetch<Estado>("/pricing/auto-close", {
        method: "PUT", centro, body: { activo, esperaMin: espera },
      });
      setEstado(r);
      setAviso(activo
        ? "Cierre automático activado. El primer pase entra en unos minutos."
        : "Cierre automático desactivado. El cierre vuelve a ser manual desde cada ficha.");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (ctxCentro.faltaElegir) {
    return (
      <Card className="mb-6 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Cierre automático de tarifas</h2>
        <SelectorCentro ctx={ctxCentro} />
        <AvisoElegirCentro />
      </Card>
    );
  }
  if (!estado) return null;

  return (
    <Card className="mb-6 p-4">
      <SelectorCentro ctx={ctxCentro} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-300">Cierre automático de tarifas</h2>
        <Badge className={estado.activo
          ? "border-emerald-500/40 text-emerald-300" : "border-slate-600 text-slate-400"}>
          {estado.activo ? "Activado" : "Manual"}
        </Badge>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {aviso && <p className="mb-2 text-[13px] text-emerald-300">{aviso}</p>}

      <p className="mb-3 text-[13px] text-slate-400">
        Cerrar la tarifa es regularizar el servicio con los kilómetros y el tiempo
        reales: el forfait pactado no se mueve, pero se le suman los extras. Hoy lo
        dispara una persona desde la pestaña Tarificación de cada ficha.
      </p>

      <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-[12px] text-slate-400">
        <strong className="text-slate-300">El cierre es irreversible.</strong> Una vez
        cerrada, la tarifa no se recalcula: lo que el taller comunique después
        —un neumático, un material— hay que meterlo como ajuste manual, y eso
        queda en la auditoría económica como una desviación. Por eso conviene
        dejar un margen antes de cerrar solo.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Cuándo cerrar</span>
          <Select value={espera} onChange={(e) => setEspera(Number(e.target.value))} disabled={!canEdit}>
            {ESPERAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Select>
        </label>

        {canEdit && (
          estado.activo ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => guardar(true)} disabled={busy}>
                Guardar la espera
              </Button>
              <Button variant="danger" onClick={() => guardar(false)} disabled={busy}>
                Desactivar
              </Button>
            </div>
          ) : (
            <Button onClick={() => guardar(true)} disabled={busy}>Activar</Button>
          )
        )}
      </div>

      <p className="mt-3 text-[13px]">
        {previa != null && previa > 0 ? (
          <span className={estado.activo ? "text-slate-400" : "text-amber-300"}>
            Con esta espera se cerrarían <strong>{previa}</strong> servicio(s) en el
            próximo pase.
          </span>
        ) : (
          <span className="text-slate-500">
            Con esta espera no hay ningún servicio que cerrar ahora mismo.
          </span>
        )}
        {estado.pendientesTotal > 0 && (
          <span className="text-slate-500">
            {" "}Hay {estado.pendientesTotal} servicio(s) terminados sin tarifa de cierre en total —{" "}
            <Link to="/connect/facturacion" className="text-cyan-300 hover:underline">
              se ven en Facturación
            </Link>.
          </span>
        )}
      </p>
    </Card>
  );
}
