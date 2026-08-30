import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { BenchmarkViewer } from "./benchmark-viewer";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("Benchmark root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <BenchmarkViewer />
  </StrictMode>,
);
