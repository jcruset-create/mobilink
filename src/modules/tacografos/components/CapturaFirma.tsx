/**
 * Recoge una firma a mano alzada sobre un lienzo.
 *
 * Con eventos de puntero, no de ratón: el técnico firma con el dedo o con un
 * lápiz sobre la tablet del taller, y `pointerdown`/`pointermove` cubren los
 * tres casos con el mismo código.
 *
 * El lienzo se dibuja a la resolución real de la pantalla (`devicePixelRatio`)
 * para que la rúbrica no salga pixelada en el PDF, que es donde acaba.
 */

import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";

type Props = {
  titulo: string;
  /** Se llama con el PNG en base64 al confirmar. */
  onFirmar: (pngBase64: string) => Promise<void>;
  onCancelar: () => void;
};

const ANCHO = 520;
const ALTO = 180;

export default function CapturaFirma({ titulo, onFirmar, onCancelar }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const [vacio, setVacio] = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const lienzo = ref.current;
    if (!lienzo) return;
    const escala = window.devicePixelRatio || 1;
    lienzo.width = ANCHO * escala;
    lienzo.height = ALTO * escala;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    // Fondo blanco explícito: sin él el PNG sale transparente y la firma se
    // pierde sobre el papel.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ANCHO, ALTO);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
  }, []);

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function empezar(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const { x, y } = punto(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setVacio(false);
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = punto(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function soltar() {
    dibujando.current = false;
  }

  function limpiar() {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ANCHO, ALTO);
    setVacio(true);
  }

  async function confirmar() {
    const lienzo = ref.current;
    if (!lienzo) return;
    setGuardando(true);
    try {
      await onFirmar(lienzo.toDataURL("image/png"));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-100">
          <PenLine className="h-4 w-4" /> {titulo}
        </h3>
        <p className="mb-3 text-[12px] text-slate-400">
          Firma con el dedo o con el lápiz dentro del recuadro.
        </p>
        <canvas
          ref={ref}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerLeave={soltar}
          style={{ width: ANCHO, height: ALTO }}
          className="mx-auto block max-w-full touch-none rounded-lg border border-slate-600 bg-white"
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            onClick={limpiar}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-slate-300 hover:bg-slate-800"
          >
            <Eraser className="h-4 w-4" /> Borrar
          </button>
          <button
            onClick={onCancelar}
            className="rounded-lg px-3 py-2 text-[13px] text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            onClick={() => void confirmar()}
            disabled={vacio || guardando}
            className="rounded-lg bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Firmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
