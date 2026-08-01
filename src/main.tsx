import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/lexend";
import "@fontsource-variable/source-sans-3";
import { App } from "./app/App";
import { AppStateProvider } from "./state/app-state";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>,
);
