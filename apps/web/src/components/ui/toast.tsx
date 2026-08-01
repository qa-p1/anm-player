type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

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
