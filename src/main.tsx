import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { validateEnv } from "./lib/env";
import "./index.css";

const envError = validateEnv();
if (envError) {
  createRoot(document.getElementById("root")!).render(
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0a0f",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 600,
            marginBottom: "1rem",
            color: "#f87171",
          }}
        >
          Environment Error
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            color: "#a1a1aa",
            marginBottom: "2rem",
            lineHeight: 1.6,
          }}
        >
          {envError}
        </p>
        <div
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: 8,
            padding: "1rem",
            textAlign: "left",
            fontSize: "0.75rem",
            fontFamily: "monospace",
            color: "#a1a1aa",
          }}
        >
          <p style={{ marginBottom: "0.5rem", color: "#e4e4e7" }}>Quick fix:</p>
          <ol style={{ paddingLeft: "1.25rem", margin: 0 }}>
            <li style={{ marginBottom: "0.25rem" }}>
              Run{" "}
              <code
                style={{
                  color: "#22d3ee",
                  backgroundColor: "#27272a",
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                npx convex dev
              </code>
            </li>
            <li style={{ marginBottom: "0.25rem" }}>
              Wait for the dev server to start
            </li>
            <li>Refresh this page</li>
          </ol>
        </div>
      </div>
    </div>,
  );
} else {
  const convex = new ConvexReactClient(
    import.meta.env.VITE_CONVEX_URL as string,
  );

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
