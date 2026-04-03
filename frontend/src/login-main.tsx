import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LoginPage } from "./components/LoginPage.js";

import "@fontsource-variable/inter";
import "@fontsource/space-mono/400.css";
import "./index.css";

const redirect = new URLSearchParams(window.location.search).get("redirect") || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LoginPage onSuccess={() => { window.location.href = redirect; }} />
  </StrictMode>,
);
