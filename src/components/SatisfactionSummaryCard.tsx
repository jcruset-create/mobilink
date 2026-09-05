/**
 * Las valoraciones de una asistencia, dentro de su ficha.
 *
 * Componente único para las dos pantallas que enseñan una asistencia. Dos
 * implementaciones visuales del mismo bloque acabarían diciendo cosas distintas
 * del mismo dato.
 *
 * ── Discreto cuando no hay nada ─────────────────────────────────────────────
 *
 * La inmensa mayoría de asistencias no tendrán encuesta —Satisfaction está
 * apagado— y la ficha ya está cargada. Sin encuestas no se pinta nada: una
 * tarjeta vacía en cada expediente sería ruido en la pantalla que más se mira.
 */

import { useEffect, useState } from "react";

import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import {
  MOTIVO_CASO, MOTIVO_NEGATIVO, PRIORIDAD, RESPUESTA, ROL, estadoEncuesta, etiqueta,
} from "../modules/satisfaction/etiquetas";

type Respuesta = {
  overallRating: number | null; professionalRating: number | null;
  speedRating: number | null; trackingRating: number | null;
  resolution: string | null; negativeReasons: string[];
  comment: string | null; respondidaEnMs: number | null;
};

type Encuesta = {
  recipientRole: string; estado: string; creadaEnMs: number;
  iniciadaEnMs: number | null; caducaEnMs: number;
  respuesta: Respuesta | null; qualityCaseId: number | null;
};

type Caso = {
  id: number; estado: string; prioridad: string; motivo: string;
  responsable: string | null; origen: string | null;
};

type Datos = { driver: Encuesta | null; customer: Encuesta | null; qualityCases: Caso[] };

const TONO: Record<string, string> = {
  neutro: "border-slate-600 text-slate-300",
  espera: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  bien: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  aviso: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  apagado: "border-slate-700 text-slate-500",
};

function hora(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function SatisfactionSummaryCard({ assistanceId }: { assistanceId: number }) {
  const [datos, setDatos] = useState<Datos | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/calidad/asistencias/${assistanceId}/satisfaction`,
      { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { /* sin Satisfaction la ficha sigue igual de útil */ });
    return () => { vivo = false; };
  }, [assistanceId]);

  if (!datos?.driver && !datos?.customer) return null;

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">
        Satisfacción
      </h3>

      <div className="grid gap-2 md:grid-cols-2">
        <Bloque encuesta={datos.driver} rol="DRIVER" />
        <Bloque encuesta={datos.customer} rol="CUSTOMER" />
      </div>

      {datos.qualityCases.map((c) => <Expediente key={c.id} caso={c} />)}
    </section>
  );
}

function Bloque({ encuesta, rol }: { encuesta: Encuesta | null; rol: string }) {
  const e = estadoEncuesta(encuesta?.estado);
  const r = encuesta?.respuesta;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-black uppercase text-slate-400">{ROL[rol] ?? rol}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${TONO[e.tono]}`}>
          {e.texto}
        </span>
      </div>

      {!encuesta && <p className="text-[11px] text-slate-500">No se generó ninguna encuesta.</p>}

      {encuesta && !r && (
        <p className="text-[11px] text-slate-500">
          Todavía sin respuesta · caduca el {hora(encuesta.caducaEnMs)}
        </p>
      )}

      {r && (
        <div className="space-y-1 text-[12px] text-slate-200">
          <Estrellas etiqueta="General" valor={r.overallRating} />
          <Estrellas etiqueta="Profesional" valor={r.professionalRating} />
          <Estrellas etiqueta="Rapidez" valor={r.speedRating} />
          <Estrellas etiqueta="Seguimiento" valor={r.trackingRating} />
          {r.resolution && (
            <div className="text-slate-300">
              <span className="text-slate-500">Resuelto: </span>
              {etiqueta(RESPUESTA, r.resolution)}
            </div>
          )}
          {r.negativeReasons.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {r.negativeReasons.map((m) => (
                <span key={m} className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  {etiqueta(MOTIVO_NEGATIVO, m)}
                </span>
              ))}
            </div>
          )}
          {r.comment && (
            // `whitespace-pre-line` conserva los saltos que escribió el usuario
            // sin interpretar nada: React escapa el contenido y no se usa
            // dangerouslySetInnerHTML en ninguna parte.
            <p className="mt-1 whitespace-pre-line rounded bg-slate-800/60 p-2 text-[11px] italic text-slate-300">
              «{r.comment}»
            </p>
          )}
          <div className="pt-0.5 text-[10px] text-slate-500">
            Respondida el {hora(r.respondidaEnMs)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Estrellas con el número al lado: el conteo no depende de contar puntitos. */
function Estrellas({ etiqueta: texto, valor }: { etiqueta: string; valor: number | null }) {
  if (valor == null) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-slate-500">{texto}</span>
      <span className="text-amber-400" aria-hidden="true">
        {"★".repeat(valor)}{"☆".repeat(5 - valor)}
      </span>
      <span className="font-bold text-slate-300">{valor}/5</span>
    </div>
  );
}

function Expediente({ caso }: { caso: Caso }) {
  const critico = caso.prioridad === "CRITICAL";
  return (
    <a
      href={`/asistencias/calidad?caso=${caso.id}`}
      className={`mt-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${
        critico
          ? "border-red-500/50 bg-red-500/10 text-red-200"
          : "border-amber-500/40 bg-amber-500/10 text-amber-200"
      }`}
    >
      {/* El icono y la palabra «Crítico», no solo el color rojo. */}
      <span className="font-black">{critico ? "⚠ Crítico" : "Caso de calidad"}</span>
      <span className="opacity-90">{etiqueta(MOTIVO_CASO, caso.motivo)}</span>
      <span className="opacity-70">· {etiqueta(PRIORIDAD, caso.prioridad)}</span>
      <span className="opacity-70">· {caso.responsable ?? "sin responsable"}</span>
      <span className="ml-auto font-bold underline">Abrir caso</span>
    </a>
  );
}
