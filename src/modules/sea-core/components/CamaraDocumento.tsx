import { useEffect, useRef, useState } from "react";

import { ALTO_GUARDADO, ANCHO_GUARDADO, marcoEnPantalla, recorteDeCamara, type Rect } from "./marcoDocumento";

/**
 * La cámara para fotografiar el DNI y el carnet, con un marco fijo con la
 * forma del documento.
 *
 * Abre la cámara de ATRÁS con `getUserMedia` y oscurece todo menos el marco.
 * Al disparar se guarda solo lo que hay dentro del marco (con un poco de
 * margen), a un tamaño fijo: todas las fotos de documentos salen iguales. El
 * servidor las endereza después, como siempre.
 *
 * El marco es fijo a propósito: no intenta adivinar si el documento está
 * dentro. Un aviso que se equivoca a veces es peor que ninguno.
 *
 * Si la cámara no se puede abrir —sin permiso, navegador raro—, ofrece la
 * cámara del propio móvil o elegir una foto, que funciona siempre (esa no se
 * recorta aquí: la endereza el servidor).
 */
export default function CamaraDocumento({
  titulo,
  paso,
  guia,
  dorso,
  onFoto,
  onCancelar,
}: {
  /** «DNI · por delante». */
  titulo: string;
  /** «Paso 1 de 4». */
  paso: string;
  /** Una frase de cómo ponerlo. */
  guia: string;
  /** Es el reverso: el dibujo de ayuda va sin foto. */
  dorso?: boolean;
  onFoto: (foto: Blob) => void;
  onCancelar: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const pista = useRef<MediaStreamTrack | null>(null);
  const [lista, setLista] = useState(false);
  const [sinCamara, setSinCamara] = useState("");
  const [marco, setMarco] = useState<Rect | null>(null);
  const [linterna, setLinterna] = useState<boolean | null>(null);

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let cerrado = false;

    async function abrir() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setSinCamara("Este navegador no deja usar la cámara desde aquí.");
        return;
      }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          audio: false,
          // Resolución alta: la letra pequeña del carnet se tiene que leer.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cerrado) {
          flujo.getTracks().forEach((t) => t.stop());
          return;
        }
        const t = flujo.getVideoTracks()[0] ?? null;
        pista.current = t;
        // La linterna solo se ofrece si el móvil la tiene.
        const capacidades = (t?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setLinterna(capacidades.torch ? false : null);
        if (video.current) {
          video.current.srcObject = flujo;
          await video.current.play().catch(() => undefined);
          setLista(true);
        }
      } catch {
        setSinCamara("No se ha podido abrir la cámara. Puede que no le hayas dado permiso.");
      }
    }
    void abrir();

    return () => {
      cerrado = true;
      // La luz de la cámara (y la linterna) no pueden quedarse encendidas al salir.
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // El marco se recalcula si cambia el tamaño (girar el móvil).
  useEffect(() => {
    const medir = () => {
      const c = caja.current;
      if (c) setMarco(marcoEnPantalla(c.clientWidth, c.clientHeight));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  async function cambiarLinterna() {
    const t = pista.current;
    if (!t || linterna === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !linterna } as MediaTrackConstraintSet] });
      setLinterna(!linterna);
    } catch {
      setLinterna(null);
    }
  }

  function disparar() {
    const v = video.current;
    const c = caja.current;
    if (!v || !c || !v.videoWidth || !marco) return;
    const r = recorteDeCamara(
      { ancho: v.videoWidth, alto: v.videoHeight },
      { ancho: c.clientWidth, alto: c.clientHeight },
      marco
    );
    const lienzo = document.createElement("canvas");
    lienzo.width = ANCHO_GUARDADO;
    lienzo.height = ALTO_GUARDADO;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(v, r.x, r.y, r.ancho, r.alto, 0, 0, ANCHO_GUARDADO, ALTO_GUARDADO);
    lienzo.toBlob((b) => { if (b) onFoto(b); }, "image/jpeg", 0.92);
  }

  const elegirFichero = (
    <label className="cursor-pointer rounded-xl border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100">
      Usar la cámara del móvil o elegir una foto
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFoto(f);
        }}
      />
    </label>
  );

  const esquina = "pointer-events-none absolute h-7 w-7 border-white";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div ref={caja} className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className="h-full w-full object-cover" />

        {!sinCamara && marco && (
          <>
            {/* Todo oscurecido menos el marco. */}
            <div
              className="pointer-events-none absolute rounded-xl"
              style={{
                left: marco.x, top: marco.y, width: marco.ancho, height: marco.alto,
                boxShadow: "0 0 0 200vmax rgba(2, 6, 23, 0.72)",
              }}
            />
            {/* Las cuatro esquinas, un poco por fuera. */}
            <div className={`${esquina} rounded-tl-xl border-l-4 border-t-4`} style={{ left: marco.x - 4, top: marco.y - 4 }} />
            <div className={`${esquina} rounded-tr-xl border-r-4 border-t-4`} style={{ left: marco.x + marco.ancho - 24, top: marco.y - 4 }} />
            <div className={`${esquina} rounded-bl-xl border-b-4 border-l-4`} style={{ left: marco.x - 4, top: marco.y + marco.alto - 24 }} />
            <div className={`${esquina} rounded-br-xl border-b-4 border-r-4`} style={{ left: marco.x + marco.ancho - 24, top: marco.y + marco.alto - 24 }} />
          </>
        )}

        <div className="absolute inset-x-0 top-0 px-6 pt-5 text-center drop-shadow">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">{paso}</p>
          <p className="mt-1 text-xl font-bold">{titulo}</p>
        </div>

        {!sinCamara && marco && (
          <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-3 px-6 text-center"
            style={{ bottom: `calc(100% - ${marco.y}px + 16px)` }}>
            <p className="text-sm leading-snug text-slate-200">{guia}</p>
            {/* El dibujito: cómo tiene que verse el documento dentro del marco. */}
            <div className="relative h-8 w-[51px] rounded border-2 border-slate-500">
              {!dorso && <div className="absolute left-1 top-1 h-[18px] w-[11px] rounded-sm bg-slate-500" />}
              {dorso && <div className="absolute inset-x-1 top-[10px] h-[2px] bg-slate-500 shadow-[0_5px_0_#64748b]" />}
            </div>
          </div>
        )}

        {!sinCamara && marco && (
          <p className="pointer-events-none absolute inset-x-0 text-center" style={{ top: marco.y + marco.alto + 18 }}>
            <span className="rounded-full border border-white/30 bg-black/40 px-3 py-1 text-xs text-slate-100">
              Encaja el documento en el marco, sin reflejos, y dispara
            </span>
          </p>
        )}

        {sinCamara && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-sm text-slate-200">{sinCamara}</p>
            {elegirFichero}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 bg-black px-5 py-4">
        <button onClick={onCancelar} className="w-[84px] rounded-xl px-3 py-2 text-left text-sm text-slate-300">Cancelar</button>
        {!sinCamara && (
          <button
            onClick={disparar}
            disabled={!lista || !marco}
            aria-label="Hacer la foto"
            className="h-16 w-16 rounded-full border-4 border-slate-400 bg-white disabled:opacity-40"
          />
        )}
        <span className="w-[84px] text-right text-xs text-slate-400">
          {!sinCamara && !lista ? "Abriendo…" : linterna !== null ? (
            <button onClick={() => void cambiarLinterna()} className={`rounded-lg px-2 py-1 ${linterna ? "bg-amber-400 text-black" : "text-slate-300"}`}>
              ⚡ Linterna
            </button>
          ) : ""}
        </span>
      </div>

      {!sinCamara && <div className="bg-black pb-4 text-center">{elegirFichero}</div>}
    </div>
  );
}
