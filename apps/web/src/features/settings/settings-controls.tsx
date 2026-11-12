import { Minus, Plus } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A titled group of setting rows, styled like the rest of the app's cards. */
export function SettingsGroup({ id, title, icon, children, tone = "default" }: { id: string; title: string; icon: ReactNode; children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-3">
      <h2 id={`${id}-title`} className={cn("flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wider", tone === "danger" ? "text-red-400" : "text-muted-foreground")}>
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{title}
      </h2>
      <div className={cn("divide-y overflow-hidden rounded-[1.4rem] border", tone === "danger" ? "divide-red-500/15 border-red-500/30 bg-red-500/[0.05]" : "divide-white/[0.06] border-white/[0.06] bg-card/40")}>
        {children}
      </div>
    </section>
  );
}

export function SettingRow({ label, description, control, htmlFor, stacked = false }: { label: string; description?: ReactNode; control?: ReactNode; htmlFor?: string; stacked?: boolean }) {
  return (
    <div className={cn("flex gap-4 px-4 py-4 sm:px-5", stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between")}>
      <div className="min-w-0">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label> : <p className="text-sm font-semibold">{label}</p>}
        {description && <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cn("relative h-7 w-12 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", checked ? "bg-primary" : "bg-white/15")}>
      <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200", checked ? "left-6" : "left-1")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit max-w-full flex-wrap rounded-full border border-white/10 bg-white/[0.04] p-1">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground", value === option.value && "bg-foreground text-background hover:text-background")}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label, unit }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string; unit?: string }) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  return (
    <div role="group" aria-label={label} className="flex h-9 items-center rounded-full border border-white/10 bg-white/[0.04]">
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
      <span className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums">{value}{unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export function SelectControl({ value, options, onChange, id, label }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; id?: string; label: string }) {
  const generated = useId();
  return (
    <select id={id ?? generated} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 max-w-[16rem] rounded-full border border-white/10 bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition focus:ring-2 focus:ring-ring">
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
