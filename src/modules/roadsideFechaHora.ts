/// La fecha y la hora de una asistencia, en el hueco de una tarjeta.
///
/// Vive aparte del componente a proposito, igual que `roadsideCoordenadas`:
/// «RoadsideAssistanceView» arrastra «apiFetch» y con el la conexion de
/// Supabase, que revienta al importarse sin variables de entorno. Aqui no hay
/// dependencias, asi que se puede probar.
///
/// ── Por que hacia falta ──────────────────────────────────────────────────
///
/// La lista de cerradas puede tener noventa y cinco tarjetas de muchos dias
/// distintos, y cada una ponia solo «19:39». Dos servicios de semanas
/// diferentes se veian igual, y para saber de cuando era uno habia que abrir
/// el informe.
export type FechaHoraOpciones = {
  /// Desde cuando se mira, para decidir si hace falta el ano. Inyectable para
  /// poder probar el cambio de ano sin esperar a Nochevieja.
  ahora?: Date;
};

/// Convierte a milisegundos lo que llega, venga como numero o como cadena.
///
/// Hace falta porque `new Date("1789204588796")` NO es esa marca de tiempo:
/// es «Invalid Date». A una cadena, `Date` le aplica el parseo de TEXTO de
/// fecha, no el de epoch. Y los BIGINT de postgres llegan como cadena segun
/// por donde entre la asistencia, asi que la marca buena se convertia en un
/// guion en pantalla. Este repositorio ya tropezo con esto una vez, en el
/// «visto» de la conciliacion.
export function aMilisegundos(valor?: number | string | null): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/// Devuelve «14/09 19:39», o «14/09/25 19:39» si es de otro ano.
///
/// El ano solo cuando no es el corriente, y esto no es un adorno: esta lista
/// llega meses atras, y un «14/09 19:39» a secas en enero de 2027 para un
/// servicio de septiembre de 2026 no es ambiguo, es que dice otra cosa. El
/// resto del tiempo sobra y solo ocupa sitio en una tarjeta estrecha.
///
/// Devuelve «-» sin fecha o con una fecha que no se puede leer, igual que
/// hacia `formatTime`: quien lo llama pinta el resultado tal cual.
export function fechaHoraCorta(
  valor?: number | string | null,
  opciones: FechaHoraOpciones = {},
): string {
  const ms = aMilisegundos(valor);
  if (ms == null) return "-";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "-";

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  const ahora = opciones.ahora ?? new Date();
  const anoAparte =
    d.getFullYear() === ahora.getFullYear()
      ? ""
      : `/${String(d.getFullYear() % 100).padStart(2, "0")}`;

  return `${dd}/${mm}${anoAparte} ${hh}:${min}`;
}
