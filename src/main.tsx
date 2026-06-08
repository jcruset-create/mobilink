import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";

import "./index.css";

if (
  import.meta.env.VITE_NATIVE_MOBILE_APP === "true" &&
  ["/", "/index.html"].includes(window.location.pathname)
) {
  window.history.replaceState(null, "", "/almacen-neumaticos/mobile");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
