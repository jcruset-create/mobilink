/// Qué matrícula manda en una asistencia.
///
/// Un camión con remolque tiene dos, y no siempre manda la de la tractora: si
/// la avería es del remolque, la asistencia va a nombre del remolque. Eso lo
/// decide el operador con el interruptor «Asistencia al remolque» al dar de
/// alta el servicio.
///
/// La regla ya vivía en dos sitios —el PDF del backend y la página pública de
/// seguimiento— pero NO en la pantalla de asistencias, que miraba «plate» a
/// secas y enseñaba «Sin matricula» en servicios que sí tenían la del
/// remolque. Aquí queda una sola vez, y la usan los tres.
export type ConMatriculas = {
  plate?: string | null;
  plateRemolque?: string | null;
  esRemolque?: boolean | null;
};

export type Matriculas = {
  /// La que va en el título. Cadena vacía si la asistencia no tiene ninguna.
  principal: string;
  /// ¿La principal es la del remolque? Sirve para etiquetarla como tal: un
  /// «R7657BDM» suelto no dice si es tractora o remolque.
  principalEsRemolque: boolean;
  /// La otra, si existe. Cadena vacía si no hay.
  secundaria: string;
  /// Cómo llamar a la secundaria, ya que depende de cuál sea la principal.
  etiquetaSecundaria: "Tractora" | "Remolque" | "";
};

export function matriculasDe(asistencia: ConMatriculas): Matriculas {
  const plate = (asistencia.plate ?? "").trim();
  const remolque = (asistencia.plateRemolque ?? "").trim();

  // Misma condición que usa el backend para el PDF. El «|| !plate» está a
  // propósito: una asistencia con SOLO la del remolque tiene que enseñarla
  // aunque nadie marcara el interruptor, porque si no se queda «sin
  // matrícula» teniendo una delante.
  const remolquePrincipal = Boolean(
    (asistencia.esRemolque === true || !plate) && remolque
  );

  if (remolquePrincipal) {
    return {
      principal: remolque,
      principalEsRemolque: true,
      secundaria: plate,
      etiquetaSecundaria: plate ? "Tractora" : "",
    };
  }

  return {
    principal: plate,
    principalEsRemolque: false,
    secundaria: remolque,
    etiquetaSecundaria: remolque ? "Remolque" : "",
  };
}

/// La matrícula para un título, ya resuelta, o el texto de relleno.
///
/// Se usa donde no cabe más que una línea: cabeceras de los diálogos de
/// fotos, informe y mapa.
export function etiquetaMatricula(
  asistencia: ConMatriculas,
  siNoHay = "Sin matrícula"
): string {
  const { principal, principalEsRemolque } = matriculasDe(asistencia);
  if (!principal) return siNoHay;
  return principalEsRemolque ? `Remolque ${principal}` : principal;
}
