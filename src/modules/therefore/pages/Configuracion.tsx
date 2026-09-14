/**
 * Los números con los que el módulo decide qué corre más.
 *
 * Sólo están los de la prioridad, que son los únicos que hoy hace algo: los
 * pesos del motor de deduplicación y los umbrales del parser aparecerán aquí
 * cuando exista el código que los lee. Una pantalla con mandos desconectados es
 * peor que no tenerla, porque alguien los mueve y se cree que ha cambiado algo.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import { Aviso, ErrorBox, TextField, btnPrimary } from "../components/ui";
import type { Config } from "../types";

export default function Configuracion() {
  const [config, setConfig] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setConfig(await api.leerConfig());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la configuración");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) return <p className="text-[13px] text-slate-400">Cargando…</p>;
  if (!config) return <ErrorBox>{error ?? "Sin configuración"}</ErrorBox>;

  const num = (v: string, sinValor: number) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : sinValor;
  };

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setGuardado(false);
    try {
      setConfig(await api.guardarConfig(config));
      setGuardado(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-black">Configuración</h1>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-4">
        <Aviso tono="info">
          La prioridad sale de sumar: días abierto × peso, reclamaciones × peso, y un tanto fijo si
          el correo venía urgente o si Therefore ha mandado una tarea vencida. Los umbrales
          reparten ese número entre las cuatro prioridades.
        </Aviso>
      </div>

      <section className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-bold">Pesos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Por cada día abierto"
            value={String(config.pesos.diasAbierto)}
            onChange={(v) =>
              setConfig({ ...config, pesos: { ...config.pesos, diasAbierto: num(v, 0) } })
            }
          />
          <TextField
            label="Por cada reclamación"
            value={String(config.pesos.reclamaciones)}
            onChange={(v) =>
              setConfig({ ...config, pesos: { ...config.pesos, reclamaciones: num(v, 0) } })
            }
          />
          <TextField
            label="Si viene marcado urgente"
            value={String(config.pesos.urgente)}
            onChange={(v) => setConfig({ ...config, pesos: { ...config.pesos, urgente: num(v, 0) } })}
          />
          <TextField
            label="Si hay tarea vencida"
            value={String(config.pesos.tareaVencida)}
            onChange={(v) =>
              setConfig({ ...config, pesos: { ...config.pesos, tareaVencida: num(v, 0) } })
            }
          />
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-bold">Umbrales</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="A partir de aquí, normal"
            value={String(config.umbrales.baja)}
            onChange={(v) =>
              setConfig({ ...config, umbrales: { ...config.umbrales, baja: num(v, 0) } })
            }
          />
          <TextField
            label="A partir de aquí, alta"
            value={String(config.umbrales.alta)}
            onChange={(v) =>
              setConfig({ ...config, umbrales: { ...config.umbrales, alta: num(v, 0) } })
            }
          />
          <TextField
            label="A partir de aquí, crítica"
            value={String(config.umbrales.critica)}
            onChange={(v) =>
              setConfig({ ...config, umbrales: { ...config.umbrales, critica: num(v, 0) } })
            }
          />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={() => void guardar()} className={btnPrimary} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {guardado && (
          <span className="text-[13px] text-emerald-300">
            Guardado. Se aplica al recalcular cada expediente.
          </span>
        )}
      </div>
    </div>
  );
}
