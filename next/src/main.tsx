import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Bootstrap } from "./platform/Bootstrap";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
