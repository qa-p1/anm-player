import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "@/app/App";
import { AppErrorBoundary } from "@/app/app-error-boundary";
import { queryClient } from "@/lib/query-client";
import "@/styles.css";

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() => import("@tanstack/react-query-devtools").then((module) => ({ default: module.ReactQueryDevtools })))
  : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </BrowserRouter>
      {ReactQueryDevtools && <Suspense fallback={null}><ReactQueryDevtools initialIsOpen={false} /></Suspense>}
    </QueryClientProvider>
  </React.StrictMode>,
);
