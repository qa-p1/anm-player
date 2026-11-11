import { CommandPalette } from "@/features/commands/command-palette";
import { useUiStore } from "@/stores/ui-store";
import { Search } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Suspense, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router";

import { BottomNav } from "@/components/navigation/bottom-nav";
import { DownloadQueueDialog, DownloadQueueTrigger } from "@/components/download-queue";
import { Sidebar } from "@/components/navigation/sidebar";
import { FloatingPlayerPlaceholder } from "@/layouts/floating-player-placeholder";
import { StorageMigrationOverlay } from "@/features/settings/storage-migration-overlay";
import { ShortcutHelpDialog } from "@/components/player/shortcut-help-dialog";
import { ConnectionStatus } from "@/components/connection-status";
import { AppUpdateMonitor } from "@/features/updates/app-update-controls";
import { TooltipLayer } from "@/components/ui/tooltip-layer";

export function AppLayout() {
  const location = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[500] focus:rounded-xl focus:bg-background focus:p-4">Skip to content</a>
      <button type="button" onClick={() => useUiStore.getState().setCommandPaletteOpen(true)} aria-label="Quick find music and commands" className="fixed right-4 top-3 z-30 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-background/85 shadow-lg backdrop-blur-xl lg:hidden"><Search className="h-4 w-4" /></button>
      <main id="main-content" tabIndex={-1} className="min-h-screen pb-48 lg:ml-64 lg:pb-32">
        <AnimatePresence mode="wait">
          <Suspense key={location.pathname} fallback={<div role="status" className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">Loading…</div>}><Outlet /></Suspense>
        </AnimatePresence>
      </main>
      <FloatingPlayerPlaceholder />
      <DownloadQueueTrigger mobile />
      <DownloadQueueDialog />
      <BottomNav />
      <StorageMigrationOverlay />
      <ShortcutHelpDialog />
      <CommandPalette />
      <ConnectionStatus />
      <AppUpdateMonitor />
      <TooltipLayer />
    </div>
  );
}
