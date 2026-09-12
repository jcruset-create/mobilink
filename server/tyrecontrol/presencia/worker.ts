/**
 * El barrido automático de presencia en bases.
 *
 * «Saber automáticamente qué vehículos están dentro de una base» es esto: un
 * temporizador que pregunta al proveedor por la flota entera, compara con las
 * geo-zonas y guarda. Sin él, la pantalla solo sabría lo que se supo la última
 * vez que alguien pulsó un botón.
 *
 * ── La cadencia y por qué esta ──────────────────────────────────────────────
 *
 * Diez minutos, y sale de la medición, no del gusto: en la cuenta real el 40 %
 * de la flota había emitido hace menos de 5 minutos y el 73 % hace menos de 15.
 * Barrer más a menudo no trae posiciones nuevas —el equipo aún no ha hablado— y
 * sí gasta cupo del proveedor; barrer cada media hora dejaría la pantalla
 * enseñando un autobús que ya se ha ido.
 *
 * Es una llamada por cuenta y vuelta: 144 al día para una flota de 751
 * vehículos. Preguntando vehículo a vehículo serían 108.000, y de ahí la
 * capacidad `FLEET_POSITIONS`.
 *
 * ── Un cliente que falla no puede dejar sin barrer a los siguientes ─────────
 *
 * Las empresas se recorren en serie y cada una va en su `try`. Y `barrerBases`
 * no lanza nunca: devuelve el motivo. Lo que no se hace es escribir «no se
 * sabe» para la flota de una cuenta caída —eso lo decide el servicio, y la
 * razón está en su cabecera—.
 */

import { barrerBases } from "./barrido.ts";

/**
 * Cada cuánto se barre, en minutos.
 *
 * Configurable por entorno para poder aflojarlo si un proveedor aprieta el
 * cupo, con suelo de 2 minutos: por debajo se estaría preguntando más deprisa
 * de lo que los equipos emiten.
 */
export const INTERVALO_MIN = Math.max(
  2,
  Number(process.env.PRESENCIA_BASES_MIN) || 10,
);

/** Una vuelta: barre todas las empresas con telemática configurada. */
export async function tickPresenciaBases(): Promise<{
  barridas: string[];
  sinBases: number;
  fallos: number;
}> {
  const { listTenantsWithConnectors } = await import(
    "../../integration-hub/infrastructure/repositories.ts"
  );
  const { knownTelematicsConnectorKeys } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );

  const empresas = await listTenantsWithConnectors(knownTelematicsConnectorKeys());
  const barridas: string[] = [];
  let sinBases = 0;
  let fallos = 0;

  for (const empresaId of empresas) {
    try {
      const r = await barrerBases(empresaId);
      // Sin bases o sin cuentas no es un fallo: es un cliente que todavía no
      // tiene esto configurado, y no merece ruido en el registro cada diez
      // minutos.
      if (r.estado === "sin_bases" || r.estado === "sin_cuentas") {
        sinBases += 1;
        continue;
      }
      if (!r.ok) {
        fallos += 1;
        console.warn("[presencia-bases]", empresaId, r.nota);
        continue;
      }
      barridas.push(empresaId);
      if (r.estado === "incompleto") console.warn("[presencia-bases]", empresaId, r.nota);
    } catch (e) {
      fallos += 1;
      console.error("[presencia-bases]", empresaId, (e as any)?.message ?? e);
    }
  }

  return { barridas, sinBases, fallos };
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startPresenciaBases(): void {
  if (temporizador) return;
  const vuelta = () => {
    void tickPresenciaBases()
      .then(({ barridas, fallos }) => {
        if (barridas.length > 0) {
          console.log(`[presencia-bases] ${barridas.length} empresas barridas`);
        } else if (fallos > 0) {
          console.log(`[presencia-bases] ninguna empresa barrida (${fallos} con fallo)`);
        }
      })
      .catch((e) => console.error("[presencia-bases]", (e as any)?.message ?? e));
  };
  // La primera, a los dos minutos: deja que el servidor acabe de levantarse.
  setTimeout(vuelta, 2 * 60 * 1000);
  temporizador = setInterval(vuelta, INTERVALO_MIN * 60 * 1000);
}

export function stopPresenciaBases(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
