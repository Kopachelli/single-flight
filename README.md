# single-flight

Collapse concurrent duplicate async work into one execution. Zero dependencies, works in Node and edge runtimes.

```ts
import { SingleFlight } from 'single-flight';

const flight = new SingleFlight();

// 100 concurrent callers → 1 actual execution
const results = await Promise.all(
  Array.from({ length: 100 }, () =>
    flight.run(`user:${id}:profile`, () => db.getProfile(id))
  )
);
```

## Why

Cache stampedes and thundering herds are the classic failure mode of "check cache → miss → fetch". The Cache API, `Map`-based caches, and most memoize helpers don't dedupe *in-flight* work — N concurrent misses all fetch.

`single-flight` is the missing primitive:

- **In-flight dedupe** — concurrent callers for the same key share one promise.
- **Honest failures** — rejections propagate to every waiter and are never cached; the next call retries fresh.
- **Optional TTL replay** — `ttlMs` replays a fulfilled result for a window, a tiny cache-stampede guard.
- **Bounded** — `maxEntries` evicts oldest settled entries; in-flight work is never evicted.

## API

```ts
const flight = new SingleFlight({ ttlMs?: number, maxEntries?: number, now?: () => number });

flight.run<T>(key: string, task: () => Promise<T>): Promise<T>
flight.size: number
flight.clear(): void
```

`single(key, task, options?)` is a one-shot helper on a shared instance — prefer a named `SingleFlight` per scope in real code.

## When NOT to use it

- You need durable dedupe across processes/restarts → look at `effect-ledger` (same author).
- You need request-level HTTP idempotency → look at `idemkit`.
- The "work" is cheap — dedupe overhead isn't free either.

## Install

```sh
npm install one-flight
```

Node >= 22.13 (uses standard JS only; runs on any modern runtime).
