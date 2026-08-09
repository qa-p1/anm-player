import { AnimatePresence } from "framer-motion";
import { useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router";

import { BottomNav } from "@/components/navigation/bottom-nav";
import { DownloadQueueDialog, DownloadQueueTrigger } from "@/components/download-queue";
import { Sidebar } from "@/components/navigation/sidebar";
import { FloatingPlayerPlaceholder } from "@/layouts/floating-player-placeholder";
import { StorageMigrationOverlay } from "@/features/settings/storage-migration-overlay";
import { ShortcutHelpDialog } from "@/components/player/shortcut-help-dialog";
import { ConnectionStatus } from "@/components/connection-status";

export function AppLayout() {
  const location = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="min-h-screen pb-44 lg:ml-64 lg:pb-24">
        <AnimatePresence mode="wait">
          <Outlet key={location.pathname} />
        </AnimatePresence>
      </main>
      <FloatingPlayerPlaceholder />
      <DownloadQueueTrigger mobile />
      <DownloadQueueDialog />
      <BottomNav />
      <StorageMigrationOverlay />
      <ShortcutHelpDialog />
      <ConnectionStatus />
    </div>
  );
}
