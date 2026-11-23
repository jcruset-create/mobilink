/**
 * El alta, tal como la ve el operario que recibe el SMS.
 *
 * ── Fuera del panel ────────────────────────────────────────────────────────
 *
 * Página suelta: sin barra lateral, sin sesión y sin nada del back-office. Al
 * otro lado hay alguien que todavía no ha pisado el taller, con su móvil y
 * posiblemente sin wifi. De ahí las tres decisiones de la pantalla:
 *
 *  · **Se guarda solo según escribe.** Un formulario de treinta campos que se
 *    pierde al cerrarse la pestaña no lo rellena nadie dos veces.
 *  · **Las fotos se suben de una en una, en cuanto se hacen.** Mandarlas
 *    todas al final convierte un corte de cobertura en empezar de cero.
 *  · **Los errores no vacían nada.** Lo tecleado se queda en pantalla pase lo
 *    que pase.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { API_BASE } from "../modules/workshopApi";

type Ficha = Record<string, string | null>;
type Tallas = Record<string, string | null>;

const DOCUMENTOS = [
  { tipo: "dni_anverso", label: "DNI · delante", obligatorio: true },
  { tipo: "dni_reverso", label: "DNI · detrás", obligatorio: true },
  { tipo: "carnet_anverso", label: "Carnet · delante", obligatorio: false },
  { tipo: "carnet_reverso", label: "Carnet · detrás", obligatorio: false },
] as const;

const TALLAS = [
  { campo: "calzado", label: "Calzado" },
  { campo: "pantalon", label: "Pantalón" },
  { campo: "camisa", label: "Camisa" },
  { campo: "camiseta", label: "Camiseta" },
  { campo: "chaqueta", label: "Chaqueta" },
  { campo: "sudadera", label: "Sudadera" },
  { campo: "chaleco", label: "Chaleco" },
] as const;

const MOTIVOS: Record<string, { titulo: string; texto: string }> = {
  no_existe: {
    titulo: "Este enlace no vale",
    texto: "Puede que esté mal copiado. Pídele al encargado que te lo vuelva a mandar.",
  },
  caducada: {
    titulo: "El enlace ha caducado",
    texto: "Los enlaces duran 72 horas. Pídele al encargado que te mande uno nuevo.",
  },
  anulada: {
    titulo: "Este enlace ya no está activo",
    texto: "Se ha mandado uno nuevo: mira el último SMS que has recibido.",
  },
  ya_enviada: {
    titulo: "Ya nos has mandado tu ficha",
    texto: "No tienes que hacer nada más. Si falta algo, el encargado te avisará.",
  },
};

const etiqueta = "text-[10px] font-bold uppercase tracking-wide text-slate-400";
const campo =
  "mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 " +
  "placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500";

export default function AltaOperarioPage() {
  const { token = "" } = useParams();
  const [cargando, setCargando] = useState(true);
  /** Por qué no se puede rellenar. `null` mientras se pueda. */
  const [motivo, setMotivo] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [ficha, setFicha] = useState<Ficha>({});
  const [tallas, setTallas] = useState<Tallas>({});
  const [documentos, setDocumentos] = useState<string[]>([]);
  const [consentimientos, setConsentimientos] = useState({
    normativa: false,
    whatsapp: false,
    datos: false,
  });
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<"limpio" | "guardando" | "guardado">("limpio");
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [error, setError] = useState("");

  const url = `${API_BASE}/api/public/alta/${encodeURIComponent(token)}`;

  useEffect(() => {
    let vivo = true;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        setCargando(false);
        if (!d?.abierto) {
          setMotivo(String(d?.motivo ?? "no_existe"));
          return;
        }
        setEmpresa(d.empresa ?? null);
        setFicha(d.ficha ?? {});
        setTallas(d.tallas ?? {});
        setDocumentos(d.documentos ?? []);
      })
      .catch(() => {
        if (!vivo) return;
        setCargando(false);
        setMotivo("no_existe");
      });
    return () => {
      vivo = false;
    };
  }, [url]);

  /*
   * El borrador se manda un segundo después de dejar de escribir. Con cada
   * tecla sería una petición por letra; al salir de cada campo se perdería
   * lo último escrito en quien cierra la pestaña sin tocar nada más.
   */
  const pendiente = useRef<number | null>(null);
  const guardarPronto = useCallback(
    (siguienteFicha: Ficha, siguientesTallas: Tallas) => {
      if (pendiente.current) window.clearTimeout(pendiente.current);
      setGuardado("guardando");
      pendiente.current = window.setTimeout(() => {
        fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...siguienteFicha, tallas: siguientesTallas }),
        })
          .then((r) => (r.ok ? setGuardado("guardado") : setGuardado("limpio")))
          .catch(() => setGuardado("limpio"));
      }, 1000);
    },
    [url]
  );

  function cambiar(nombre: string, valor: string) {
    const siguiente = { ...ficha, [nombre]: valor };
    setFicha(siguiente);
    guardarPronto(siguiente, tallas);
  }

  function cambiarTalla(nombre: string, valor: string) {
    const siguiente = { ...tallas, [nombre]: valor };
    setTallas(siguiente);
    guardarPronto(ficha, siguiente);
  }

  async function subirFoto(tipo: string, fichero: File) {
    setSubiendo(tipo);
    setError("");
    try {
      const cuerpo = new FormData();
      cuerpo.append("tipo", tipo);
      cuerpo.append("foto", fichero);
      const r = await fetch(`${url}/documento`, { method: "POST", body: cuerpo });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido subir la foto.");
      setDocumentos(d.documentos ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido subir la foto.");
    } finally {
      setSubiendo(null);
    }
  }

  const [firma, setFirma] = useState("");

  async function enviar() {
    setEnviando(true);
    setError("");
    try {
      const r = await fetch(`${url}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...ficha,
          tallas,
          consentimientos,
          firma,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido enviar.");
      setEnviada(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido enviar.");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return <Marco><p className="text-sm text-slate-400">Cargando…</p></Marco>;
  }

  if (motivo) {
    const m = MOTIVOS[motivo] ?? MOTIVOS.no_existe;
    return (
      <Marco>
        <h1 className="text-lg font-bold text-slate-100">{m.titulo}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">{m.texto}</p>
      </Marco>
    );
  }

  if (enviada) {
    return (
      <Marco>
        <h1 className="text-lg font-bold text-slate-100">Ficha enviada. Gracias.</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Ya puedes cerrar esta página. El encargado la revisará y te avisará si falta algo.
        </p>
      </Marco>
    );
  }

  const nombre = String(ficha.nombre ?? "").split(" ")[0];

  return (
    <Marco>
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-slate-100">
          Tu alta{empresa ? ` en ${empresa}` : ""}
        </h1>
        <p className="text-xs leading-5 text-slate-400">
          {nombre ? `${nombre}, rellena` : "Rellena"} lo que falta. Se guarda solo según escribes: si lo
          dejas a medias, sigues desde el mismo enlace.
        </p>
        <p className="h-4 text-[11px] text-slate-500">
          {guardado === "guardando" ? "Guardando…" : guardado === "guardado" ? "Guardado" : ""}
        </p>
      </header>

      <Seccion titulo="1 · Quién eres" nota="obligatorio">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nombre" valor={ficha.nombre} onChange={(v) => cambiar("nombre", v)} />
          <Campo label="Apellidos" valor={ficha.apellidos} onChange={(v) => cambiar("apellidos", v)} />
          <Campo label="DNI / NIE" valor={ficha.dni_nie} onChange={(v) => cambiar("dni_nie", v)} />
          <Campo
            label="Fecha de nacimiento"
            valor={ficha.fecha_nacimiento}
            placeholder="dd/mm/aaaa"
            onChange={(v) => cambiar("fecha_nacimiento", v)}
          />
          <Campo label="Nacionalidad" valor={ficha.nacionalidad} onChange={(v) => cambiar("nacionalidad", v)} />
          <Campo
            label="Nº Seguridad Social"
            valor={ficha.num_seguridad_social}
            onChange={(v) => cambiar("num_seguridad_social", v)}
          />
        </div>
      </Seccion>

      <Seccion titulo="2 · Dónde te localizamos" nota="obligatorio">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Móvil" valor={ficha.telefono} tipo="tel" onChange={(v) => cambiar("telefono", v)} />
          <Campo label="Email" valor={ficha.email} tipo="email" onChange={(v) => cambiar("email", v)} />
        </div>
        <Campo label="Dirección" valor={ficha.direccion} onChange={(v) => cambiar("direccion", v)} />
        <div className="grid grid-cols-3 gap-3">
          <Campo label="C. postal" valor={ficha.codigo_postal} onChange={(v) => cambiar("codigo_postal", v)} />
          <Campo label="Población" valor={ficha.poblacion} onChange={(v) => cambiar("poblacion", v)} />
          <Campo label="Provincia" valor={ficha.provincia} onChange={(v) => cambiar("provincia", v)} />
        </div>
      </Seccion>

      <Seccion titulo="3 · Tu documentación" nota="foto con el móvil">
        <div className="grid grid-cols-2 gap-3">
          {DOCUMENTOS.map((d) => {
            const hecha = documentos.includes(d.tipo);
            return (
              <label
                key={d.tipo}
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 ${
                  hecha ? "border-green-700 bg-green-900/20" : "border-dashed border-slate-600 bg-slate-900"
                }`}
              >
                <span className="text-xs font-semibold text-slate-200">{d.label}</span>
                <span className={`text-[11px] ${hecha ? "text-green-400" : "text-slate-500"}`}>
                  {subiendo === d.tipo
                    ? "Subiendo…"
                    : hecha
                      ? "Hecha · toca para repetirla"
                      : d.obligatorio
                        ? "Toca para hacer la foto"
                        : "Si tienes carnet"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void subirFoto(d.tipo, f);
                    e.target.value = "";
                  }}
                />
              </label>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nº de carnet" valor={ficha.carnet_numero} onChange={(v) => cambiar("carnet_numero", v)} />
          <Campo
            label="Carnet caduca el"
            valor={ficha.carnet_caducidad}
            placeholder="dd/mm/aaaa"
            onChange={(v) => cambiar("carnet_caducidad", v)}
          />
        </div>
        <Campo
          label="Clases que tienes"
          valor={ficha.carnet_clases}
          placeholder="B, C, C+E…"
          onChange={(v) => cambiar("carnet_clases", v)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nº CAP" valor={ficha.cap_numero} onChange={(v) => cambiar("cap_numero", v)} />
          <Campo
            label="CAP caduca el"
            valor={ficha.cap_caducidad}
            placeholder="dd/mm/aaaa"
            onChange={(v) => cambiar("cap_caducidad", v)}
          />
        </div>
      </Seccion>

      <Seccion titulo="4 · Si pasa algo" nota="contacto de emergencia">
        <div className="grid grid-cols-2 gap-3">
          <Campo
            label="Nombre"
            valor={ficha.emergencia_nombre}
            onChange={(v) => cambiar("emergencia_nombre", v)}
          />
          <Campo
            label="Teléfono"
            valor={ficha.emergencia_telefono}
            tipo="tel"
            onChange={(v) => cambiar("emergencia_telefono", v)}
          />
        </div>
      </Seccion>

      <Seccion titulo="5 · Tu ropa de trabajo" nota="para el vestuario">
        <div className="grid grid-cols-3 gap-3">
          {TALLAS.map((t) => (
            <Campo
              key={t.campo}
              label={t.label}
              valor={tallas[t.campo]}
              onChange={(v) => cambiarTalla(t.campo, v)}
            />
          ))}
        </div>
      </Seccion>

      <Seccion titulo="6 · Permisos y firma" nota="obligatorio">
        <Permiso
          marcado={consentimientos.normativa}
          onChange={(v) => setConsentimientos((c) => ({ ...c, normativa: v }))}
        >
          He leído la normativa interna y la acepto
        </Permiso>
        <Permiso
          marcado={consentimientos.whatsapp}
          onChange={(v) => setConsentimientos((c) => ({ ...c, whatsapp: v }))}
        >
          Acepto recibir avisos de trabajo por WhatsApp <span className="text-slate-500">(opcional)</span>
        </Permiso>
        <Permiso
          marcado={consentimientos.datos}
          onChange={(v) => setConsentimientos((c) => ({ ...c, datos: v }))}
        >
          Autorizo el tratamiento de mis datos y de mi documentación para la relación laboral
        </Permiso>

        <Firma firmada={firma !== ""} onFirma={setFirma} />
        <p className="text-[10px] leading-4 text-slate-500">
          Al enviar se guarda la fecha, la hora y el dispositivo, como evidencia de la firma.
        </p>
      </Seccion>

      {error && (
        <p className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{error}</p>
      )}

      <button
        type="button"
        onClick={() => void enviar()}
        disabled={enviando}
        className="h-12 w-full rounded-xl bg-sky-600 text-[15px] font-bold text-white disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Enviar mi ficha"}
      </button>
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">{children}</div>
    </div>
  );
}

function Seccion({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-bold text-slate-100">{titulo}</h2>
        <span className="text-[11px] text-slate-500">{nota}</span>
      </div>
      {children}
    </section>
  );
}

function Campo({
  label,
  valor,
  onChange,
  tipo = "text",
  placeholder,
}: {
  label: string;
  valor: string | null | undefined;
  onChange: (v: string) => void;
  tipo?: string;
  placeholder?: string;
}) {
  const id = `alta-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className={etiqueta}>
        {label}
      </label>
      <input
        id={id}
        type={tipo}
        value={valor ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={campo}
      />
    </div>
  );
}

function Permiso({
  marcado,
  onChange,
  children,
}: {
  marcado: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-300">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-sky-500"
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * La firma, con el dedo.
 *
 * Un canvas y nada más: cualquier librería de firma pesa más que toda esta
 * pantalla, y lo único que hace falta es un trazo y una imagen al final.
 * La imagen sube al padre en cuanto se levanta el dedo, así que no hace
 * falta pedírsela a este componente cuando se envía.
 */
function Firma({ firmada, onFirma }: { firmada: boolean; onFirma: (dataUrl: string) => void }) {
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const pintando = useRef(false);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    // El canvas se dibuja a la resolución del móvil: a una sola escala, en
    // una pantalla de 3x, la firma sale como un trazo de pixeles gordos.
    const escala = window.devicePixelRatio || 1;
    c.width = c.clientWidth * escala;
    c.height = c.clientHeight * escala;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = lienzo.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={lienzo}
        className="h-28 w-full touch-none rounded-xl bg-slate-50"
        onPointerDown={(e) => {
          const ctx = lienzo.current?.getContext("2d");
          if (!ctx) return;
          pintando.current = true;
          const p = punto(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pintando.current) return;
          const ctx = lienzo.current?.getContext("2d");
          if (!ctx) return;
          const p = punto(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!pintando.current) return;
          pintando.current = false;
          onFirma(lienzo.current?.toDataURL("image/png") ?? "");
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {firmada ? "Firmado" : "Firma aquí con el dedo"}
        </span>
        <button
          type="button"
          onClick={() => {
            const c = lienzo.current;
            const ctx = c?.getContext("2d");
            if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
            onFirma("");
          }}
          className="rounded-lg border border-slate-600 px-3 py-1 text-[11px] text-slate-300"
        >
          Borrar
        </button>
      </div>
    </div>
  );
};
