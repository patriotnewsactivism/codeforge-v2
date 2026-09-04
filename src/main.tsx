import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { BackendProvider } from "./lib/backend-hooks";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BackendProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </BackendProvider>
  </StrictMode>,
);
