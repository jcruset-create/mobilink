/**
 * La ruta del informe mensual de flota.
 *
 * Fase 1 de la réplica del informe de Grupo Soledad: la cabecera y los
 * recuentos (`docs/PLAN_informe_mensual_plana.md`). Las rejillas por
 * posición, los quesitos y el detalle por vehículo van detrás, sobre este
 * mismo cálculo.
 *
 * ── El acceso se comprueba AQUÍ ─────────────────────────────────────────────
 *
 * El servidor habla con Supabase con `service_role`, que NO pasa por RLS. Sin
 * esta comprobación, cualquiera con sesión podría pedir el informe de otro
 * cliente tecleando su id. Es el mismo criterio que el resto de informes,
 * `empresaDelInforme`, y no una comprobación nueva inventada aquí.
 *
 * ── Y el cálculo NO está aquí ───────────────────────────────────────────────
 *
 * Está en `armar.ts`, sin tocar la base, para que se pueda probar entero. Lo
 * de este fichero es leer, llamar y contestar.
 */

import type { Express, RequestHandler } from "express";

import { empresaDelInforme } from "../informes/alcance.ts";
import {
  MesInvalido, avisosDelMes, neumaticosRevisados, periodoDeMes, recuentos, revisionCuenta,
  ruedasDelMes, type CabeceraMensual,
} from "./armar.ts";
import {
  leerCondicionDeNeumaticos, leerMediciones, leerNeumaticos, leerNombreEmpresa,
  leerOrdenDePosiciones, leerRevisiones, leerVehiculos,
} from "./datos.ts";
import {
  avisosDeCondicion, completar, condicionPorPosicion, marcaPorPosicion,
  medidaPorMarca, medidaPorMilimetro, medidaPorPosicion, profundidadPorPosicion,
  type Matriz,
} from "./matrices.ts";

/** El mes en curso, para cuando no se pide ninguno. */
const mesActual = (): string => new Date().toISOString().slice(0, 7);

export function mountInformeMensual(app: Express, ...guards: RequestHandler[]): void {
  app.get("/api/tyrecontrol/informes/mensual", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      let periodo;
      try {
        periodo = periodoDeMes(String(req.query.mes ?? mesActual()));
      } catch (e) {
        if (e instanceof MesInvalido) return res.status(400).json({ error: e.message });
        throw e;
      }
      const incluirBaja = req.query.incluirBaja === "1";

      const [vehiculos, revisiones, posiciones, empresaNombre] = await Promise.all([
        leerVehiculos(empresa),
        leerRevisiones(empresa, periodo.desde, periodo.hasta),
        leerOrdenDePosiciones(),
        leerNombreEmpresa(empresa),
      ]);

      const cuentas = recuentos(vehiculos, revisiones, periodo, incluirBaja);

      // Las mediciones solo de las revisiones que cuentan: pedir las de los
      // borradores sería traerse filas para tirarlas después.
      const idsQueCuentan = revisiones.filter((r) => revisionCuenta(r.estado)).map((r) => r.id);
      const mediciones = await leerMediciones(empresa, idsQueCuentan, posiciones.orden);

      // La misma flota que los recuentos, o el total de neumáticos no cuadra
      // con la flota y nadie sabría por qué.
      const contados = new Set(
        vehiculos.filter((v) => incluirBaja || v.activo).map((v) => v.id),
      );
      // Una rueda, una vez: el arco de CheckPoint mide cada pasada, y contar
      // mediciones daría un número once veces mayor que el del informe.
      const ruedas = ruedasDelMes(revisiones, mediciones, periodo, contados);
      const neumaticos = neumaticosRevisados(ruedas);

      /*
       * Las rejillas necesitan saber qué goma llevaba cada rueda: marca,
       * modelo, medida y si estaba reesculturada o recauchutada. Las dos
       * lecturas van por id y no enteras: de 6.541 neumáticos de Plana, en un
       * mes se miden unos 2.100.
       */
      const idsNeumatico = ruedas.ruedas
        .map((r) => r.neumaticoId).filter((x): x is string => !!x);
      const [neumaticosRef, condiciones] = await Promise.all([
        leerNeumaticos(empresa, idsNeumatico),
        leerCondicionDeNeumaticos(empresa, idsNeumatico),
      ]);
      const completas = completar(ruedas.ruedas, neumaticosRef, condiciones);
      const pos = neumaticos.posiciones;

      const rejillas: Record<string, Matriz> = {
        marcaPorPosicion: marcaPorPosicion(completas, pos),
        medidaPorPosicion: medidaPorPosicion(completas, pos),
        condicionPorPosicion: condicionPorPosicion(completas, pos),
        profundidadPorPosicion: profundidadPorPosicion(completas, pos),
        medidaPorMilimetro: medidaPorMilimetro(completas),
        medidaPorMarca: medidaPorMarca(completas),
      };

      const cabecera: CabeceraMensual = {
        empresa,
        empresaNombre,
        periodo,
        recuentos: cuentas,
        neumaticos,
        avisos: [
          ...avisosDelMes(vehiculos, neumaticos, posiciones.repetidas, incluirBaja),
          ...avisosDeCondicion(completas),
        ],
      };
      res.json({ ok: true, ...cabecera, rejillas });
    } catch (e: any) {
      console.error("[informe-mensual] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido generar el informe mensual" });
    }
  });
}
