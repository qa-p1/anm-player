import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function CollectionBrowser({ label, query, onQueryChange, sort, onSortChange, options, children }: {
  label: string; query: string; onQueryChange: (query: string) => void; sort: string; onSortChange: (sort: string) => void;
  options: Array<{ value: string; label: string }>; children?: React.ReactNode;
}) {
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-card/45 p-3">
    <div className="relative min-w-40 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={`Search ${label}`} placeholder={`Search ${label}…`} value={query} onChange={(event) => onQueryChange(event.target.value)} className="h-10 pl-9 pr-10 text-sm" />{query && <button type="button" aria-label={`Clear ${label} search`} onClick={() => onQueryChange("")} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}</div>
    <label className="flex items-center gap-2 text-xs text-muted-foreground">Sort<select aria-label={`Sort ${label}`} value={sort} onChange={(event) => onSortChange(event.target.value)} className="h-10 rounded-xl border border-white/10 bg-card px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    {children}
  </div>;
}
