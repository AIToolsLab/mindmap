import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PlatformBootstrap from "./platform/PlatformBootstrap";
import "./platform/platform.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformBootstrap />
  </StrictMode>,
);
