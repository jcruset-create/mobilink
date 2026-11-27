import { useEffect, useRef, useState } from "react";

/**
 * La cámara para hacerse la foto de la ficha, a pantalla completa y con un
 * óvalo de guía para colocar la cara.
 *
 * Se usa en el enlace de alta (el trabajador, con su móvil) y en la ficha de
 * Core (el administrador, con la webcam o el móvil).
 *
 * Abre la cámara FRONTAL con `getUserMedia`. Si el navegador no la da —sin
 * permiso, sin cámara, un navegador raro—, no se queda en negro: ofrece la
 * cámara del propio móvil o elegir una foto, que funciona siempre.
 *
 * La imagen se ve en espejo, como en cualquier cámara frontal, pero la foto
 * se guarda sin invertir. El recorte y el tamaño los pone el servidor.
 */
export default function CamaraSelfie({ onFoto, onCancelar }: { onFoto: (foto: Blob) => void; onCancelar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [lista, setLista] = useState(false);
  const [sinCamara, setSinCamara] = useState("");

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
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        });
        // Si se ha cerrado mientras el navegador pedía permiso, se suelta.
        if (cerrado) {
          flujo.getTracks().forEach((t) => t.stop());
          return;
        }
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
      // La luz de la cámara no puede quedarse encendida al salir.
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function disparar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const lienzo = document.createElement("canvas");
    lienzo.width = v.videoWidth;
    lienzo.height = v.videoHeight;
    lienzo.getContext("2d")?.drawImage(v, 0, 0);
    lienzo.toBlob((b) => { if (b) onFoto(b); }, "image/jpeg", 0.92);
  }

  const elegirFichero = (
    <label className="cursor-pointer rounded-xl border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100">
      Usar la cámara del móvil o elegir una foto
      <input
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFoto(f);
        }}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />

        {/*
          * Todo oscurecido menos el óvalo. Es un círculo estirado con una
          * sombra enorme alrededor: así guarda su proporción (3:4) igual en un
          * móvil en vertical que en la webcam apaisada de un ordenador.
          */}
        {!sinCamara && (
          <div
            className="pointer-events-none absolute left-1/2 top-[45%] border-2 border-dashed border-white"
            style={{
              height: "min(60%, 100vw)",
              aspectRatio: "3 / 4",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              boxShadow: "0 0 0 200vmax rgba(0, 0, 0, 0.6)",
            }}
          />
        )}

        <p className="absolute inset-x-0 top-5 px-6 text-center text-sm font-bold drop-shadow">
          {sinCamara ? "" : "Coloca la cara dentro del óvalo"}
        </p>

        {sinCamara && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-sm text-slate-200">{sinCamara}</p>
            {elegirFichero}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 bg-black px-5 py-4">
        <button onClick={onCancelar} className="rounded-xl px-3 py-2 text-sm text-slate-300">Cancelar</button>
        {!sinCamara && (
          <button
            onClick={disparar}
            disabled={!lista}
            aria-label="Hacer la foto"
            className="h-16 w-16 rounded-full border-4 border-slate-400 bg-white disabled:opacity-40"
          />
        )}
        {/* Hueco para que el disparador quede centrado. */}
        <span className="w-[72px] text-right text-xs text-slate-500">{!sinCamara && !lista ? "Abriendo…" : ""}</span>
      </div>

      {!sinCamara && <div className="bg-black pb-4 text-center">{elegirFichero}</div>}
    </div>
  );
}
