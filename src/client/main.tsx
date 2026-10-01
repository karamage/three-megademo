import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  // StrictMode is intentionally off: its double-mount would create two renderers on one WebGL context.
  createRoot(root).render(<App />);
}
