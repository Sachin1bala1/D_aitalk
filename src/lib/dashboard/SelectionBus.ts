export interface RangeFilter {
  xColumn: string;
  xMin: number;
  xMax: number;
  yColumn?: string;
  yMin?: number;
  yMax?: number;
  colorValues?: unknown[];
}

export interface SelectionEvent {
  sourceId: string;
  selectedIndices: number[];
  selectedRowKeys: unknown[];
  selectionMode: "indices" | "range";
  rangeFilter?: RangeFilter;
  whereClause?: string;
}

type SelectionListener = (event: SelectionEvent) => void;

class SelectionBusImpl {
  private listeners: Set<SelectionListener> = new Set();
  private _current: SelectionEvent | null = null;

  get current(): SelectionEvent | null { return this._current; }

  emit(event: SelectionEvent): void {
    this._current = event;
    this.listeners.forEach((fn) => fn(event));
  }

  subscribe(fn: SelectionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear(): void {
    this._current = null;
    this.listeners.forEach((fn) =>
      fn({
        sourceId: "__clear__",
        selectedIndices: [],
        selectedRowKeys: [],
        selectionMode: "indices",
      })
    );
  }
}

export const selectionBus = new SelectionBusImpl();
