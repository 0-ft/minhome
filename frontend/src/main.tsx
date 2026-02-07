import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";

import "@fontsource-variable/inter";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
