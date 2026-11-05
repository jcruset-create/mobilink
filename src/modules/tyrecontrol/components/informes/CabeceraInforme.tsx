/**
 * La cabecera de marca de un informe, y lo que se repite en cada hoja.
 *
 * Un informe que se entrega a un cliente tiene que decir, sin que haya que
 * preguntarlo, de quién viene y a quién va. Antes no decía ninguna de las
 * dos cosas: la primera hoja empezaba por el menú del panel.
 *
 * ── Tres piezas ─────────────────────────────────────────────────────────────
 *
 *   · `CabeceraInforme`  · la portada: banda con el logo, el centro que lo
 *                          emite, el cliente, el periodo y cuándo se generó.
 *   · `CabeceraCorrida`  · una línea fina que SOLO sale impresa, en todas las
 *                          hojas menos donde estorbe.
 *   · `PieCorrido`       · lo mismo abajo, con el número de página.
 *
 * Las dos últimas se repiten en cada hoja porque van con `position: fixed`
 * (ver `estilos/impresion.css`). En cuanto alguien separa las grapas o
 * fotocopia una hoja suelta, esa hoja tiene que seguir diciendo de qué
 * informe y de qué periodo es.
 *
 * ── De dónde salen los nombres ──────────────────────────────────────────────
 *
 * El del CENTRO, de la empresa del usuario que ha entrado: quien imprime es
 * quien lo emite. El del CLIENTE, de la empresa elegida en los filtros. Si
 * un cliente entra con su propio usuario los dos coinciden, y entonces se
 * enseña uno solo en vez de repetirlo.
 */

interface Props {
  /** El informe: «Informe ejecutivo de flota». */
  titulo: string;
  /** Debajo del título, en la banda. Opcional. */
  subtitulo?: string;
  /** Quién lo emite. Normalmente la empresa del usuario. */
  centro?: string | null;
  /** Para quién es. La empresa elegida en los filtros. */
  cliente?: string | null;
  desde?: string | null;
  hasta?: string | null;
  /** ISO de cuándo se generó. */
  generado?: string | null;
  /** El botón de imprimir y lo que acompañe; no sale en papel. */
  acciones?: React.ReactNode;
}

const fecha = (iso?: string | null): string => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
};

const fechaHora = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? fecha(iso)
    : `${d.toLocaleDateString("es-ES")} a las ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
};

/** El periodo en una línea, o «todo el histórico» si no hay fechas. */
export function periodoEnPalabras(desde?: string | null, hasta?: string | null): string {
  if (!desde && !hasta) return "todo el histórico";
  if (desde && hasta) return `${fecha(desde)} → ${fecha(hasta)}`;
  return desde ? `desde ${fecha(desde)}` : `hasta ${fecha(hasta)}`;
}

export function CabeceraInforme({
  titulo, subtitulo, centro, cliente, desde, hasta, generado, acciones,
}: Props) {
  // Un cliente que entra con su usuario ve su propio nombre a los dos lados.
  // Repetirlo no informa de nada.
  const mismo = Boolean(centro && cliente && centro.trim() === cliente.trim());

  return (
    <header className="portada-informe bloque-informe overflow-hidden rounded-xl">
      {/*
        La banda. El emblema está sobre fondo negro, así que la banda oscura
        lo integra en vez de dejar un recuadro negro pegado en una hoja.

        El color va EN LÍNEA y no como clase de Tailwind a propósito: un
        `bg-[#0b1220]` depende de que el compilador lo encuentre al escanear,
        y si algún día no lo genera, la banda sale transparente y el emblema
        queda flotando sobre el blanco. Esto no se puede purgar.
      */}
      <div
        className="imprimir-fondo flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        style={{ backgroundColor: "#0b1220" }}
      >
        <div className="flex items-center gap-3">
          <img src="/tyrecontrol-emblem.png" alt="" className="h-9 w-auto rounded" />
          <div>
            <div className="text-[15px] font-black leading-none text-white">
              Mobi<span className="tinta-azul text-blue-400">link</span>{" "}
              <span className="tinta-verde text-green-400">Tyre</span>Control
            </div>
            <div className="tinta-suave mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Gestión de neumáticos de flota
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-black leading-tight text-white">{titulo}</div>
          {subtitulo && <div className="tinta-suave text-[11px] text-slate-400">{subtitulo}</div>}
        </div>
        {acciones && <div className="no-imprimir">{acciones}</div>}
      </div>

      {/* Quién, para quién y cuándo. */}
      <div className="grid gap-3 border-b-2 border-slate-600 px-4 py-3 sm:grid-cols-2">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {mismo ? "Informe de" : "Emitido por"}
          </div>
          <div className="text-[15px] font-black leading-tight text-slate-100">
            {centro || cliente || "—"}
          </div>
        </div>
        <div className="sm:text-right">
          {!mismo && (
            <>
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Informe para
              </div>
              <div className="text-[15px] font-black leading-tight text-slate-100">
                {cliente || "Todas las empresas"}
              </div>
            </>
          )}
          <div className="mt-1 text-[11px] leading-snug text-slate-400">
            Periodo {periodoEnPalabras(desde, hasta)}
            <br />
            Generado el {fechaHora(generado)}
          </div>
        </div>
      </div>
    </header>
  );
}

/** Solo impresa, en todas las hojas. */
export function CabeceraCorrida({ titulo, cliente }: { titulo: string; cliente?: string | null }) {
  return (
    <div className="cabecera-corrida">
      <span><b>{titulo}</b>{cliente ? ` · ${cliente}` : ""}</span>
      <img src="/tyrecontrol-emblem.png" alt="" style={{ height: "4mm", width: "auto" }} />
    </div>
  );
}

/**
 * Solo impreso, en todas las hojas. El número de página lo pone el navegador
 * con `counter(page)`: contarlo nosotros exigiría saber dónde cae cada salto,
 * que es justo lo que decide él.
 */
export function PieCorrido({
  centro, titulo, cliente, desde, hasta,
}: { centro?: string | null; titulo: string; cliente?: string | null;
     desde?: string | null; hasta?: string | null }) {
  return (
    <div className="pie-corrido">
      <span>
        {[centro, titulo, cliente].filter(Boolean).join(" · ")}
        {" · "}{periodoEnPalabras(desde, hasta)}
      </span>
      {/* Sin número de página: `counter(page)` imprime «Página 0» en Chrome
          fuera de las cajas de margen de @page. Lo numera el navegador. */}
      <span>{fecha(new Date().toISOString())}</span>
    </div>
  );
}
