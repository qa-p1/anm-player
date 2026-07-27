import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";

interface BackButtonProps {
  fallback?: string;
  label?: string;
}

export function BackButton({ fallback = "/library", label = "Back" }: BackButtonProps) {
  const navigate = useNavigate();

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }

  return (
    <Button type="button" variant="quiet" size="sm" onClick={handleBack} className="-ml-2 gap-1">
      <ChevronLeft className="h-5 w-5" />
      {label}
    </Button>
  );
}
