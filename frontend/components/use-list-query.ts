"use client";

import { useCallback, useState } from "react";
import type { FilterValues } from "./ui/filter-menu";
import type { SortDirection } from "./ui/sort-header";

// Filter, sort and pagination state for a server-paginated list. Any change returns to page 1.
export function useListQuery(
  initialFilters: FilterValues = {},
  initialPerPage = 10,
  defaultSort: { key: string; direction: SortDirection } = { key: "", direction: "asc" },
) {
  const [filters, setFilters] = useState<FilterValues>(initialFilters);
  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState(initialPerPage);
  const [{ sort, direction }, setSortState] = useState<{ sort: string; direction: SortDirection }>(
    { sort: defaultSort.key, direction: defaultSort.direction },
  );

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);
  const clearFilters = useCallback(() => {
    setFilters({});
    setPage(1);
  }, []);
  const setPerPage = useCallback((n: number) => {
    setPerPageState(n);
    setPage(1);
  }, []);
  const resetPage = useCallback(() => setPage(1), []);

  // Clicking the active column flips asc <-> desc; a new column starts ascending.
  // One pure state update, so it behaves the same when React runs updaters twice (dev/StrictMode).
  const toggleSort = useCallback((key: string) => {
    setSortState((current) => ({
      sort: key,
      direction: current.sort === key ? (current.direction === "asc" ? "desc" : "asc") : "asc",
    }));
    setPage(1);
  }, []);

  return { filters, setFilter, clearFilters, page, setPage, perPage, setPerPage, resetPage, sort, direction, toggleSort };
}
