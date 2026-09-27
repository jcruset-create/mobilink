import {
  API_BASE,
  getAdminHeaders,
} from "./workshopApi";

export async function downloadBackup() {
  const password = window.prompt("Introduce la contraseña de backup:");

  if (!password) return;

  try {
    // La contraseña va en cabecera y no en la URL: en la URL acababa en los
    // logs del servidor, en el historial del navegador y en el `Referer`.
    const response = await fetch(`${API_BASE}/api/backup`, {
      // Codificada, como el token: una contraseña con acentos no cabe cruda en
      // una cabecera HTTP y `fetch` lanzaría antes de salir.
      headers: getAdminHeaders({ "x-backup-password": encodeURIComponent(password) }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);

      alert(
        errorData?.error ??
          "No se pudo descargar el backup. Revisa la contraseña."
      );

      return;
    }

    const blob = await response.blob();

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\..+/, "");

    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `sea-tarragona-backup-${timestamp}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error descargando backup:", error);
    alert("Error descargando backup.");
  }
}