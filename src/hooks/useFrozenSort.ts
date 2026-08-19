import { useCallback, useMemo, useRef, useState } from "react";

export type SortDir = "asc" | "desc" | null;

/** Sort once by column value — only invoked on explicit user sort clicks. */
export function sortBySortKey<T>(
  arr: T[],
  sortKey: string,
  sortDir: SortDir,
  getValue: (item: T, sortKey: string) => number | string,
): T[] {
  if (!sortDir) return arr;
  return [...arr].sort((a, b) => {
    const va = getValue(a, sortKey);
    const vb = getValue(b, sortKey);
    if (typeof va === "string" || typeof vb === "string") {
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    }
    return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });
}

/** Reorder items to match a previously captured row-key order (values may change; positions do not). */
export function applyFrozenSortOrder<T>(
  items: T[],
  frozenOrder: string[] | null,
  getKey: (item: T) => string,
): T[] {
  if (!frozenOrder) return items;
  const byKey = new Map(items.map((item) => [getKey(item), item]));
  const result: T[] = [];
  for (const key of frozenOrder) {
    const item = byKey.get(key);
    if (item) {
      result.push(item);
      byKey.delete(key);
    }
  }
  for (const item of byKey.values()) result.push(item);
  return result;
}

/**
 * One-time sort: rows reorder only when the user clicks a sort header.
 * Subsequent data edits recalculate cell values but never re-sort automatically.
 */
export function useFrozenSort<T>(
  items: T[],
  getRowKey: (item: T) => string,
  getSortValue: (item: T, sortKey: string) => number | string,
) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [frozenSortOrder, setFrozenSortOrder] = useState<string[] | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const toggleSort = useCallback(
    (key: string) => {
      const newDir: SortDir = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      setSortKey(key);
      setSortDir(newDir);
      setFrozenSortOrder(
        sortBySortKey(itemsRef.current, key, newDir, getSortValue).map(getRowKey),
      );
    },
    [sortKey, sortDir, getSortValue, getRowKey],
  );

  const resetSort = useCallback(() => {
    setSortKey(null);
    setSortDir(null);
    setFrozenSortOrder(null);
  }, []);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir || !frozenSortOrder) return items;
    return applyFrozenSortOrder(items, frozenSortOrder, getRowKey);
  }, [items, sortKey, sortDir, frozenSortOrder, getRowKey]);

  return { sortKey, sortDir, toggleSort, sorted, resetSort };
}
