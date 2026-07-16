import { CheckCircle, XCircle, AlertCircle, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

const toastIcons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const toastColors = {
  success: "bg-green-500/90",
  error: "bg-red-500/90",
  warning: "bg-orange-500/90",
  info: "bg-blue-500/90",
};

let toastId = 0;
const toastCallbacks = new Set<(toast: Toast) => void>();

export function toast(message: string, type: ToastType = "info") {
  const newToast: Toast = {
    id: `toast-${toastId++}`,
    type,
    message,
  };
  
  toastCallbacks.forEach((callback) => callback(newToast));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const addToast = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 3000);
    };

    toastCallbacks.add(addToast);
    return () => {
      toastCallbacks.delete(addToast);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = toastIcons[t.type];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-white shadow-lg backdrop-blur-sm ${toastColors[t.type]}`}
            >
              <Icon className="h-5 w-5" />
              <p className="text-sm font-medium">{t.message}</p>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
