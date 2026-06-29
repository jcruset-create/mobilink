import { useMemo, useState } from "react";

import { belongsToWorkshop } from "./assignmentMutations";
import {
  createRoadsideAssistanceInBackend,
  createRoadsideVehicleInBackend,
  deactivateRoadsideVehicleInBackend,
  deleteRoadsideOperatorCodeInBackend,
  enCaminoRoadsideAssistanceInBackend,
  loadRoadsideAssistancesFromBackend,
  loadRoadsideOperatorCodesFromBackend,
  loadRoadsideVehiclesFromBackend,
  sendRoadsideTrackingWhatsappInBackend,
  updateRoadsideAssistanceInBackend,
  updateRoadsideAssistanceStatusInBackend,
  updateRoadsideOperatorCodeInBackend,
  updateRoadsideVehicleInBackend,
} from "./roadsideAssistanceApi";
import type {
  RoadsideAssistance,
  RoadsideAssistanceDraft,
  RoadsideAssistanceEditDraft,
  RoadsideAssistanceStatus,
  RoadsideOperatorCode,
  RoadsideVehicle,
  RoadsideVehicleDraft,
} from "./roadsideAssistanceTypes";
import type { WorkshopId } from "./workshops";
import type { Tech } from "./workshopTypes";

type UseRoadsideDeps = {
  selectedWorkshopId: WorkshopId;
  visibleTechs: Tech[];
  appendLog: (text: string) => void;
};

export function useRoadside({
  selectedWorkshopId,
  visibleTechs,
  appendLog,
}: UseRoadsideDeps) {
  const [roadsideAssistances, setRoadsideAssistances] = useState<
    RoadsideAssistance[]
  >([]);
  const [roadsideVehicles, setRoadsideVehicles] = useState<RoadsideVehicle[]>(
    []
  );
  const [roadsideOperatorCodes, setRoadsideOperatorCodes] = useState<
    RoadsideOperatorCode[]
  >([]);
  const [roadsideAssistancesLoading, setRoadsideAssistancesLoading] =
    useState(false);
  const [roadsideAssistanceError, setRoadsideAssistanceError] = useState("");
  const [roadsideVehicleError, setRoadsideVehicleError] = useState("");
  const [roadsideOperatorCodeError, setRoadsideOperatorCodeError] =
    useState("");

  const visibleRoadsideAssistances = useMemo(
    () =>
      roadsideAssistances.filter((assistance) =>
        belongsToWorkshop(assistance, selectedWorkshopId)
      ),
    [roadsideAssistances, selectedWorkshopId]
  );

  const visibleRoadsideVehicles = useMemo(
    () =>
      roadsideVehicles.filter((vehicle) =>
        belongsToWorkshop(vehicle, selectedWorkshopId)
      ),
    [roadsideVehicles, selectedWorkshopId]
  );

  const roadsideEligibleTechNames = useMemo(
    () =>
      new Set(
        roadsideOperatorCodes
          .filter((item) => item.hasCustomCode)
          .map((item) => item.techName)
      ),
    [roadsideOperatorCodes]
  );

  const visibleRoadsideTechs = useMemo(
    () =>
      visibleTechs.filter((tech) => roadsideEligibleTechNames.has(tech.name)),
    [visibleTechs, roadsideEligibleTechNames]
  );

  async function reloadRoadsideAssistancesFromBackend() {
    setRoadsideAssistancesLoading(true);
    setRoadsideAssistanceError("");

    try {
      const data = await loadRoadsideAssistancesFromBackend(true);
      setRoadsideAssistances(data);
    } catch (error) {
      console.error("Error recargando asistencias carretera:", error);
      setRoadsideAssistanceError(
        error instanceof Error
          ? error.message
          : "Error cargando asistencias carretera."
      );
    } finally {
      setRoadsideAssistancesLoading(false);
    }
  }

  async function reloadRoadsideVehiclesFromBackend() {
    setRoadsideVehicleError("");

    try {
      const data = await loadRoadsideVehiclesFromBackend(true);
      setRoadsideVehicles(data);
    } catch (error) {
      console.error("Error recargando furgonetas carretera:", error);
      setRoadsideVehicleError(
        error instanceof Error ? error.message : "Error cargando furgonetas."
      );
    }
  }

  async function reloadRoadsideOperatorCodesFromBackend() {
    setRoadsideOperatorCodeError("");

    try {
      const data = await loadRoadsideOperatorCodesFromBackend();
      setRoadsideOperatorCodes(data);
    } catch (error) {
      console.error("Error recargando codigos de operario:", error);
      setRoadsideOperatorCodeError(
        error instanceof Error
          ? error.message
          : "Error cargando codigos de operario."
      );
    }
  }

  async function createRoadsideVehicle(draft: RoadsideVehicleDraft) {
    const created = await createRoadsideVehicleInBackend({
      ...draft,
      workshopId: selectedWorkshopId,
    });

    setRoadsideVehicles((prev) => [
      created,
      ...prev.filter((item) => item.id !== created.id),
    ]);

    appendLog(`Furgoneta creada: ${created.name}.`);
  }

  async function updateRoadsideVehicle(
    vehicle: RoadsideVehicle,
    draft: RoadsideVehicleDraft
  ) {
    const updated = await updateRoadsideVehicleInBackend(vehicle.id, {
      ...draft,
      workshopId: vehicle.workshopId ?? selectedWorkshopId,
    });

    setRoadsideVehicles((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    appendLog(`Furgoneta actualizada: ${updated.name}.`);
  }

  async function deactivateRoadsideVehicle(vehicle: RoadsideVehicle) {
    const updated = await deactivateRoadsideVehicleInBackend(vehicle.id);

    setRoadsideVehicles((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    appendLog(`Furgoneta desactivada: ${updated.name}.`);
  }

  async function updateRoadsideOperatorCode(techName: string, code: string) {
    const updated = await updateRoadsideOperatorCodeInBackend(techName, code);

    setRoadsideOperatorCodes((prev) => {
      const exists = prev.some((item) => item.techName === updated.techName);

      if (!exists) {
        return [...prev, updated];
      }

      return prev.map((item) =>
        item.techName === updated.techName ? updated : item
      );
    });

    appendLog(`Codigo operario actualizado: ${updated.techName}.`);
  }

  async function deleteRoadsideOperatorCode(techName: string) {
    const deleted = await deleteRoadsideOperatorCodeInBackend(techName);

    setRoadsideOperatorCodes((prev) =>
      prev.filter((item) => item.techName !== deleted.techName)
    );

    appendLog(`Operario baja asistencia: ${deleted.techName}.`);
  }

  async function createRoadsideAssistance(draft: RoadsideAssistanceDraft) {
    const created = await createRoadsideAssistanceInBackend({
      ...draft,
      workshopId: selectedWorkshopId,
    });

    let assistanceToStore = created;

    if (draft.sendTrackingWhatsapp && created.customerPhone) {
      try {
        const result = await sendRoadsideTrackingWhatsappInBackend(created.id);
        assistanceToStore = result.assistance;
        appendLog(
          `WhatsApp seguimiento enviado a ${created.customerPhone}: ${
            created.plate || created.customerName || created.id
          }.`
        );
      } catch (error) {
        console.error("Error enviando WhatsApp seguimiento:", error);
        appendLog(
          `Asistencia creada pero WhatsApp no enviado: ${
            created.plate || created.customerName || created.id
          }.`
        );
      }
    }

    setRoadsideAssistances((prev) => [
      assistanceToStore,
      ...prev.filter((item) => item.id !== assistanceToStore.id),
    ]);

    appendLog(
      `Asistencia carretera creada: ${
        assistanceToStore.plate ||
        assistanceToStore.customerName ||
        assistanceToStore.customerPhone
      }.`
    );
  }

  async function updateRoadsideAssistance(
    assistance: RoadsideAssistance,
    draft: RoadsideAssistanceEditDraft
  ) {
    let updated = await updateRoadsideAssistanceInBackend(assistance.id, {
      ...draft,
      workshopId: assistance.workshopId ?? selectedWorkshopId,
    });

    const assignedNow =
      !assistance.assignedTechName && Boolean(updated.assignedTechName);

    if (
      (draft.sendTrackingWhatsapp || assignedNow) &&
      updated.customerPhone &&
      !updated.trackingWhatsappSentAtMs
    ) {
      try {
        const result = await sendRoadsideTrackingWhatsappInBackend(updated.id);
        updated = result.assistance;
        appendLog(
          `WhatsApp seguimiento enviado a ${updated.customerPhone}: ${
            updated.plate || updated.customerName || updated.id
          }.`
        );
      } catch (error) {
        console.error("Error enviando WhatsApp seguimiento:", error);
        appendLog(
          `Asistencia actualizada pero WhatsApp no enviado: ${
            updated.plate || updated.customerName || updated.id
          }.`
        );
      }
    }

    setRoadsideAssistances((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    appendLog(
      `Asistencia carretera actualizada: ${
        updated.plate || updated.customerName || updated.customerPhone
      }.`
    );
  }

  async function sendRoadsideTrackingWhatsapp(assistance: RoadsideAssistance) {
    const result = await sendRoadsideTrackingWhatsappInBackend(assistance.id);

    setRoadsideAssistances((prev) =>
      prev.map((item) =>
        item.id === result.assistance.id ? result.assistance : item
      )
    );

    appendLog(
      `WhatsApp seguimiento enviado a ${assistance.customerPhone}: ${
        assistance.plate || assistance.customerName || assistance.id
      }.`
    );
  }

  async function updateRoadsideAssistanceStatus(
    assistance: RoadsideAssistance,
    status: RoadsideAssistanceStatus
  ) {
    let updated = await updateRoadsideAssistanceStatusInBackend(
      assistance.id,
      status
    );

    if (
      status === "asignada" &&
      updated.customerPhone &&
      !updated.trackingWhatsappSentAtMs
    ) {
      try {
        const result = await sendRoadsideTrackingWhatsappInBackend(updated.id);
        updated = result.assistance;
        appendLog(
          `WhatsApp seguimiento enviado a ${updated.customerPhone}: ${
            updated.plate || updated.customerName || updated.id
          }.`
        );
      } catch (error) {
        console.error("Error enviando WhatsApp seguimiento:", error);
        appendLog(
          `Estado actualizado pero WhatsApp no enviado: ${
            updated.plate || updated.customerName || updated.id
          }.`
        );
      }
    }

    setRoadsideAssistances((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    appendLog(
      `Asistencia carretera ${updated.id}: estado ${updated.status}.`
    );
  }

  async function enCaminoRoadsideAssistance(assistance: RoadsideAssistance) {
    const updated = await enCaminoRoadsideAssistanceInBackend(assistance.id);

    setRoadsideAssistances((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    appendLog(
      `Asistencia ${updated.id} en camino. ETA: ${updated.etaMinutos ?? "?"} min, ${updated.etaKm ?? "?"} km.`
    );
  }

  return {
    roadsideAssistances,
    roadsideVehicles,
    roadsideOperatorCodes,
    roadsideAssistancesLoading,
    roadsideAssistanceError,
    roadsideVehicleError,
    roadsideOperatorCodeError,
    visibleRoadsideAssistances,
    visibleRoadsideVehicles,
    roadsideEligibleTechNames,
    visibleRoadsideTechs,
    reloadRoadsideAssistancesFromBackend,
    reloadRoadsideVehiclesFromBackend,
    reloadRoadsideOperatorCodesFromBackend,
    createRoadsideVehicle,
    updateRoadsideVehicle,
    deactivateRoadsideVehicle,
    updateRoadsideOperatorCode,
    deleteRoadsideOperatorCode,
    createRoadsideAssistance,
    updateRoadsideAssistance,
    sendRoadsideTrackingWhatsapp,
    updateRoadsideAssistanceStatus,
    enCaminoRoadsideAssistance,
  };
}
