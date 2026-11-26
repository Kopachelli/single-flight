export interface FlightOptions {
  /**
   * After a task settles successfully, reuse its result for this many ms
   * instead of starting a new execution. Default 0 (in-flight dedupe only).
   */
  ttlMs?: number;
  /** Maximum entries kept for ttl replay. Default 1000. */
  maxEntries?: number;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
}

interface Slot {
  promise: Promise<unknown>;
  /** Set once the task fulfills; cleared on rejection. */
  value?: unknown;
  settledAt?: number;
}

/**
 * Collapse concurrent calls for the same key into a single execution.
 *
 * - While a task for `key` is in flight, every caller shares its promise.
 * - Rejections propagate to all waiters and are never cached: the next call
 *   after a failure starts a fresh execution.
 * - With `ttlMs > 0`, a fulfilled result is replayed (without re-running)
 *   until the window expires — a tiny, honest cache-stampede guard.
 */
export class SingleFlight {
  private readonly slots = new Map<string, Slot>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: FlightOptions = {}) {
    this.ttlMs = options.ttlMs ?? 0;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Run `task` for `key`, or join the in-flight/recent execution.
   * `task` receives no arguments; capture inputs in the closure.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const slot = this.slots.get(key);
    const t = this.now();
    if (slot) {
      if (slot.promise && !slot.settledAt) return slot.promise as Promise<T>;
      if (slot.settledAt !== undefined && t - slot.settledAt < this.ttlMs) {
        return Promise.resolve(slot.value as T);
      }
      this.slots.delete(key);
    }
    const promise = (async () => task())();
    const entry: Slot = { promise };
    this.slots.set(key, entry);
    promise.then(
      (value) => {
        if (this.ttlMs > 0) {
          entry.value = value;
          entry.settledAt = this.now();
          this.evict();
        } else {
          if (this.slots.get(key) === entry) this.slots.delete(key);
        }
      },
      () => {
        if (this.slots.get(key) === entry) this.slots.delete(key);
      }
    );
    return promise;
  }

  private evict(): void {
    if (this.slots.size <= this.maxEntries) return;
    // Drop oldest settled entries first; in-flight entries are never evicted.
    const settled = [...this.slots.entries()]
      .filter(([, s]) => s.settledAt !== undefined)
      .sort((a, b) => (a[1].settledAt ?? 0) - (b[1].settledAt ?? 0));
    for (const [k] of settled) {
      if (this.slots.size <= this.maxEntries) break;
      this.slots.delete(k);
    }
  }

  /** Number of tracked keys (in-flight + ttl-replayed). */
  get size(): number {
    return this.slots.size;
  }

  /** Drop all state. In-flight tasks are not cancelled. */
  clear(): void {
    this.slots.clear();
  }
}

/** Shared default instance for simple use. */
export const flight = new SingleFlight();

/**
 * One-shot helper: dedupe `key` on the shared instance.
 * For per-scope isolation prefer `new SingleFlight(...)`.
 */
export function single<T>(key: string, task: () => Promise<T>, options?: FlightOptions): Promise<T> {
  return (options ? new SingleFlight(options) : flight).run(key, task);
}
