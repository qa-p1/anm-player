import { Filter, X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface FilterState {
  query?: string;
  yearMin?: number;
  yearMax?: number;
  durationMin?: number;
  durationMax?: number;
  hasArtwork?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface FilterPanelProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onClear: () => void;
}

export function FilterPanel({ filters, onFiltersChange, onClear }: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const idPrefix = useId();

  const hasActiveFilters = Object.keys(filters).some(
    (key) => key !== "sortBy" && key !== "sortOrder" && filters[key as keyof FilterState] !== undefined
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant={isOpen ? "default" : "outline"}
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filters
          {hasActiveFilters && <span className="rounded-full bg-primary px-2 py-0.5 text-xs">Active</span>}
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-2">
            <X className="h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>

      {isOpen && (
        <div className="glass-panel rounded-2xl p-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* Year Range */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Year range</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  aria-label="Minimum year"
                  placeholder="From"
                  value={filters.yearMin || ""}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      yearMin: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className="w-24"
                  min={1900}
                  max={2100}
                />
                <span className="flex items-center text-muted-foreground">-</span>
                <Input
                  type="number"
                  aria-label="Maximum year"
                  placeholder="To"
                  value={filters.yearMax || ""}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      yearMax: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className="w-24"
                  min={1900}
                  max={2100}
                />
              </div>
            </div>

            {/* Duration Range */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Duration (minutes)</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  aria-label="Minimum duration in minutes"
                  placeholder="Min"
                  value={filters.durationMin ? Math.floor(filters.durationMin / 60) : ""}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      durationMin: e.target.value ? parseInt(e.target.value) * 60 : undefined,
                    })
                  }
                  className="w-20"
                  min={0}
                  max={120}
                />
                <span className="flex items-center text-muted-foreground">-</span>
                <Input
                  type="number"
                  aria-label="Maximum duration in minutes"
                  placeholder="Max"
                  value={filters.durationMax ? Math.floor(filters.durationMax / 60) : ""}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      durationMax: e.target.value ? parseInt(e.target.value) * 60 : undefined,
                    })
                  }
                  className="w-20"
                  min={0}
                  max={120}
                />
              </div>
            </div>

            {/* Artwork Filter */}
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-artwork`}>Artwork</Label>
              <select
                id={`${idPrefix}-artwork`}
                value={filters.hasArtwork === undefined ? "all" : filters.hasArtwork ? "yes" : "no"}
                onChange={(e) => {
                  const value = e.target.value;
                  onFiltersChange({
                    ...filters,
                    hasArtwork: value === "all" ? undefined : value === "yes",
                  });
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All</option>
                <option value="yes">With artwork</option>
                <option value="no">Without artwork</option>
              </select>
            </div>

            {/* Sort By */}
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-sort-by`}>Sort by</Label>
              <select
                id={`${idPrefix}-sort-by`}
                value={filters.sortBy || "relevance"}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    sortBy: e.target.value,
                  })
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="relevance">Relevance</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="album">Album</option>
                <option value="year">Year</option>
                <option value="duration">Duration</option>
                <option value="date_added">Date Added</option>
              </select>
            </div>

            {/* Sort Order */}
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-sort-order`}>Sort order</Label>
              <select
                id={`${idPrefix}-sort-order`}
                value={filters.sortOrder || "asc"}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    sortOrder: e.target.value as "asc" | "desc",
                  })
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
