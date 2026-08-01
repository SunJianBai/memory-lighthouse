import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/lexend";
import "@fontsource-variable/source-sans-3";
import { App } from "./app/App";
import { AuthProvider } from "./auth/auth-context";
import { consumeSensitiveFragment } from "./security/sensitive-fragment";
import { AppStateProvider } from "./state/app-state";
import { WorkspaceProvider } from "./workspace/workspace-context";
import "./styles.css";

const sensitiveAction = consumeSensitiveFragment();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <WorkspaceProvider>
        <AppStateProvider>
          <App sensitiveAction={sensitiveAction} />
        </AppStateProvider>
      </WorkspaceProvider>
    </AuthProvider>
  </React.StrictMode>,
);
