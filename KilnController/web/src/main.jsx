import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { UiProvider } from "./ui.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </StrictMode>
);
