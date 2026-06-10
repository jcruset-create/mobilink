import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";

// En la app nativa, arrancar siempre en la pantalla del operario
if (
  import.meta.env.VITE_NATIVE_MOBILE_APP === "true" &&
  ["/", "/index.html"].includes(window.location.pathname)
) {
  window.history.replaceState(null, "", "/operario/asistencias");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
