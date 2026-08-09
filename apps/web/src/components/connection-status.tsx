import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ConnectionStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [showRecovered, setShowRecovered] = useState(false);
  const wasOffline = useRef(!navigator.onLine);

  useEffect(() => {
    const onOffline = () => {
      wasOffline.current = true;
      setShowRecovered(false);
      setOnline(false);
    };
    const onOnline = () => {
      setOnline(true);
      if (wasOffline.current) {
        wasOffline.current = false;
        setShowRecovered(true);
        window.setTimeout(() => setShowRecovered(false), 3_500);
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (online && !showRecovered) return null;
  return (
    <div role="status" className={`fixed left-1/2 top-3 z-[300] flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-2xl backdrop-blur-xl ${online ? "border-emerald-400/25 bg-emerald-950/85 text-emerald-100" : "border-amber-400/25 bg-amber-950/90 text-amber-100"}`}>
      {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {online ? "Back online" : "Offline · downloaded music is still available"}
    </div>
  );
}
