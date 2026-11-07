/**
 * Qué hacer con un informe técnico en PDF que alguien acaba de subir.
 *
 * Son dos casos y los pidió así el cliente: «si la revisión no está dada de
 * alta, la das de alta importando los datos del informe» y «si adjunto un PDF
 * de una revisión ya grabada, únicamente que la adjunte para poder
 * consultar». La diferencia la decide el «A1. Nº de orden de la
 * intervención», que es el mismo `id_origen` que trae el Excel del centro.
 *
 * Esto no escribe nada ni lee nada: recibe la situación ya averiguada y
 * devuelve la decisión, para que se pueda probar entera. Lo que escribe es la
 * ruta, en `index.ts`.
 *
 * ── Por qué una matrícula que no casa NO se resuelve sola ────────────────────
 *
 * El error fácil es subir el informe en la ficha de al lado, y es el caro:
 * deja una intervención colgando del autobús equivocado y le mueve el
 * vencimiento a los dos. Así que cuando la matrícula del impreso no es la del
 * vehículo abierto, esto NO decide: devuelve las dos matrículas y dice que se
 * puede confirmar. Confirmar es una decisión de una persona que está mirando
 * el papel, no una heurística.
 *
 * ── Y por qué una intervención de otro vehículo tampoco ─────────────────────
 *
 * Si el nº de orden ya está en la base pero vinculado a OTRO vehículo, no se
 * adjunta: quedaría un documento colgado de este vehículo apuntando a una
 * intervención de otro, y el clip saldría en una ficha y el dato en otra. Eso
 * es un lío que hay que mirar, no un empate que desatascar.
 */

import type { FilaTacografo, Problema } from "./parser.ts";

export type Accion =
  | "crear_y_adjuntar"
  /** Se crea la intervención, pero el PDF no se puede archivar: ver `motivo`. */
  | "crear_sin_adjuntar"
  | "solo_adjuntar"
  | "duplicado"
  | "no_se_puede";

/** La intervención que ya existe con ese nº de orden. */
export interface IntervencionExistente {
  id: string;
  vehiculoId: string | null;
  fecha: string | null;
  creadaDePdf: boolean;
}

export interface Situacion {
  /** Lo leído del PDF, y lo que el lector no haya podido leer. */
  fila: FilaTacografo | null;
  problemas: Problema[];
  /**
   * El vehículo al que va el informe: el de la ficha abierta, o el que casa
   * con la matrícula del impreso. `null` si esa matrícula no está en
   * TyreControl, que desde el panel de importación pasa.
   */
  vehiculoId: string | null;
  /**
   * Matrícula normalizada del vehículo de la ficha abierta, para comprobar
   * que el impreso es suyo. `null` cuando no hay ficha abierta contra la que
   * comparar —desde el panel el vehículo se BUSCA por la matrícula del
   * impreso, así que no puede no coincidir—.
   */
  matriculaVehiculo: string | null;
  /** La intervención con ese `id_origen`, si ya está. */
  existente: IntervencionExistente | null;
  /** Un documento de este vehículo con el mismo sha256, si ya está. */
  mismoFichero: { id: string; intervencionId: string | null } | null;
  /** Alguien ha confirmado que es este vehículo aunque la matrícula no case. */
  confirmado?: boolean;
}

export interface Decision {
  accion: Accion;
  /** Por qué no se puede, o de qué duplicado se trata. Para enseñar tal cual. */
  motivo?: string;
  /** La intervención a la que se adjunta, cuando ya existe. */
  intervencionId?: string;
  /**
   * El vehículo bajo el que se archiva el PDF. Es el de la intervención si ya
   * la había —ahí es donde tiene que salir el clip— y si no, el que casó con
   * la matrícula. `null` si no hay ninguno y el informe no se puede archivar.
   */
  vehiculoDelInforme?: string | null;
  /** El documento que ya estaba, cuando es un duplicado. */
  documentoId?: string;
  /**
   * La intervención estaba sin vehículo y la matrícula casa: se vincula. Pasa
   * con los informes de un autobús que se dio de alta después de importarse
   * el Excel.
   */
  vincular?: boolean;
  /** `true` si lo único que falta es que una persona confirme el vehículo. */
  sePuedeConfirmar?: boolean;
  /** Lo que hay que decir aunque se haga. */
  avisos: string[];
}

export function decidirInforme(s: Situacion): Decision {
  const avisos: string[] = [];

  if (!s.fila) {
    return {
      accion: "no_se_puede",
      motivo: s.problemas[0]?.motivo ?? "No se ha podido leer el informe.",
      avisos: s.problemas.slice(1).map((p) => p.motivo),
    };
  }

  // El mismo fichero otra vez. Se dice cuál es el que ya estaba, para que
  // quien lo subió pueda abrirlo en vez de quedarse con un «ya existe».
  if (s.mismoFichero) {
    return {
      accion: "duplicado",
      motivo: "Este mismo informe ya está adjunto a este vehículo.",
      documentoId: s.mismoFichero.id,
      intervencionId: s.mismoFichero.intervencionId ?? undefined,
      avisos,
    };
  }

  if (s.matriculaVehiculo != null && s.fila.matriculaNorm !== s.matriculaVehiculo && !s.confirmado) {
    return {
      accion: "no_se_puede",
      motivo: `El informe es del vehículo ${s.fila.matriculaOrigen ?? s.fila.matriculaNorm} `
        + `y la ficha abierta es la de ${s.matriculaVehiculo}. Si de verdad es este `
        + "vehículo, hay que confirmarlo.",
      sePuedeConfirmar: true,
      avisos,
    };
  }
  if (s.matriculaVehiculo != null && s.fila.matriculaNorm !== s.matriculaVehiculo) {
    avisos.push(`El informe venía con la matrícula ${s.fila.matriculaOrigen ?? s.fila.matriculaNorm}`
      + ` y se ha adjuntado a ${s.matriculaVehiculo} porque alguien lo ha confirmado.`);
  }

  // Lo que el lector haya tenido que dejar sin decidir se dice siempre, se
  // cree la intervención o se adjunte a una que ya estaba.
  for (const p of s.problemas) avisos.push(p.motivo);
  if (s.fila.tipoOperacion == null) {
    avisos.push("La intervención se queda sin tipo de operación: el informe no dice "
      + "ninguno de los tres que usa el histórico.");
  }

  if (s.existente) {
    // Vinculada a otro autobús: ni se adjunta ni se toca. Quedaría un
    // documento de este vehículo apuntando a la intervención de otro.
    if (s.existente.vehiculoId != null && s.existente.vehiculoId !== s.vehiculoId) {
      return {
        accion: "no_se_puede",
        motivo: `La intervención ${s.fila.idOrigen} ya está en el histórico, pero `
          + "vinculada a OTRO vehículo. Hay que mirarlo antes de adjuntar nada: o el "
          + "informe no es de este autobús, o la intervención está mal vinculada.",
        intervencionId: s.existente.id,
        avisos,
      };
    }
    if (s.existente.vehiculoId == null) {
      avisos.push("La intervención estaba en el histórico sin vehículo asignado y se ha "
        + "vinculado a este, porque la matrícula del informe es la suya.");
    }
    // El clip tiene que salir en la ficha donde está la intervención.
    const vehiculoDelInforme = s.existente.vehiculoId ?? s.vehiculoId;
    if (vehiculoDelInforme == null) {
      return {
        accion: "no_se_puede",
        motivo: `La intervención ${s.fila.idOrigen} ya está en el histórico, pero sin vehículo, `
          + `y la matrícula del informe (${s.fila.matriculaOrigen ?? s.fila.matriculaNorm}) no `
          + "está en TyreControl. Da de alta el vehículo y vuelve a subirlo.",
        intervencionId: s.existente.id,
        avisos,
      };
    }
    return {
      accion: "solo_adjuntar",
      intervencionId: s.existente.id,
      vehiculoDelInforme,
      vincular: s.existente.vehiculoId == null && s.vehiculoId != null,
      avisos,
    };
  }

  /*
   * Sin vehículo, la intervención se crea igual —sin vincular, como hace el
   * importador del Excel: es historia del centro y el autobús puede darse de
   * alta mañana— pero el PDF no se archiva. Un documento cuelga de un
   * vehículo, y no hay ninguno.
   */
  if (s.vehiculoId == null) {
    return {
      accion: "crear_sin_adjuntar",
      vehiculoDelInforme: null,
      motivo: `La matrícula del informe (${s.fila.matriculaOrigen ?? s.fila.matriculaNorm}) no `
        + "está en TyreControl: la intervención se da de alta sin vincular, pero el PDF no se "
        + "archiva. Da de alta el vehículo y vuelve a subirlo para adjuntarlo.",
      avisos,
    };
  }

  return { accion: "crear_y_adjuntar", vehiculoDelInforme: s.vehiculoId, avisos };
}
