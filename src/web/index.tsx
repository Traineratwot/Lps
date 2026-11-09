import React from "react";
import { createRoot } from "react-dom/client";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
import "./styles.css";
import { App } from "./app.tsx";
import { applyTheme, currentTheme } from "./theme.ts";

// theme stylesheet is a <link> in index.html (swapped at runtime for dark mode)
applyTheme(currentTheme());

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
