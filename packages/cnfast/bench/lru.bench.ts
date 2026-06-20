import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";

// Settle empirically: is the LRU data structure a bottleneck, and would a
// different caching algorithm be faster? We compare per-op throughput of the
// current two-bucket plain-object cache against alternatives, in two regimes:
//   - HIT-heavy (working set fits): the re-render case.
//   - THRASH (working set = 2x capacity): the miss/insert case.

type Cache = { get(k: string): string | undefined; set(k: string, v: string): void };

const MAX = 500;

// Current implementation: two generations of null-proto objects.
const twoBucketObject = (max: number): Cache => {
  let size = 0;
  let cache: Record<string, string> = Object.create(null);
  let prev: Record<string, string> = Object.create(null);
  const update = (k: string, v: string) => {
    cache[k] = v;
    if (++size > max) {
      size = 0;
      prev = cache;
      cache = Object.create(null);
    }
  };
  return {
    get(k) {
      let v = cache[k];
      if (v !== undefined) return v;
      if ((v = prev[k]) !== undefined) {
        update(k, v);
        return v;
      }
    },
    set(k, v) {
      if (k in cache) cache[k] = v;
      else update(k, v);
    },
  };
};

// Same algorithm but backed by Map instead of plain objects.
const twoBucketMap = (max: number): Cache => {
  let cache = new Map<string, string>();
  let prev = new Map<string, string>();
  const update = (k: string, v: string) => {
    cache.set(k, v);
    if (cache.size > max) {
      prev = cache;
      cache = new Map();
    }
  };
  return {
    get(k) {
      let v = cache.get(k);
      if (v !== undefined) return v;
      if ((v = prev.get(k)) !== undefined) {
        update(k, v);
        return v;
      }
    },
    set(k, v) {
      if (cache.has(k)) cache.set(k, v);
      else update(k, v);
    },
  };
};

// True LRU via Map insertion-order: on hit, move-to-end; on overflow, evict oldest.
const trueLruMap = (max: number): Cache => {
  const m = new Map<string, string>();
  return {
    get(k) {
      const v = m.get(k);
      if (v !== undefined) {
        m.delete(k);
        m.set(k, v);
      }
      return v;
    },
    set(k, v) {
      if (m.has(k)) m.delete(k);
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value!);
    },
  };
};

// SIEVE (Zhang et al., NSDI 2024): a single FIFO queue plus a per-entry "visited" bit and a
// moving "hand". A hit only flips a bit (no list reordering, unlike true LRU); eviction sweeps the
// hand from old to new, clearing visited bits and dropping the first unvisited entry. Higher hit
// ratio than LRU at O(1), but the index is still a Map, so lookups pay Map.get, not object reads.
interface SieveNode {
  key: string;
  value: string;
  visited: boolean;
  prev: SieveNode | null;
  next: SieveNode | null;
}

const sieve = (max: number): Cache => {
  const map = new Map<string, SieveNode>();
  let head: SieveNode | null = null;
  let tail: SieveNode | null = null;
  let hand: SieveNode | null = null;
  let size = 0;

  const evict = () => {
    let object = hand ?? tail;
    while (object && object.visited) {
      object.visited = false;
      object = object.next ?? tail;
    }
    if (!object) return;
    hand = object.next ?? tail;

    if (object.prev) object.prev.next = object.next;
    else tail = object.next;
    if (object.next) object.next.prev = object.prev;
    else head = object.prev;
    if (hand === object) hand = null;

    map.delete(object.key);
    size--;
  };

  return {
    get(k) {
      const node = map.get(k);
      if (node !== undefined) {
        node.visited = true;
        return node.value;
      }
    },
    set(k, v) {
      const existing = map.get(k);
      if (existing !== undefined) {
        existing.value = v;
        existing.visited = true;
        return;
      }
      if (size >= max) evict();
      const node: SieveNode = { key: k, value: v, visited: false, prev: head, next: null };
      if (head) head.next = node;
      head = node;
      if (!tail) tail = node;
      map.set(k, node);
      size++;
    },
  };
};

// S3-FIFO (Yang et al., SOSP 2023): a small FIFO (~10% capacity) filters one-hit-wonders before
// they reach the main FIFO, with a ghost queue tracking recently evicted keys for re-admission.
// Scan-resistant with a strong hit ratio, but again Map-backed for the index.
const s3Fifo = (max: number): Cache => {
  const smallMax = Math.max(1, Math.floor(max / 10));
  const mainMax = max - smallMax;
  const entries = new Map<string, { value: string; freq: number }>();
  const small: string[] = [];
  const main: string[] = [];
  const ghost = new Set<string>();

  const evictMain = () => {
    while (main.length > 0) {
      const key = main.shift()!;
      const entry = entries.get(key);
      if (entry === undefined) continue;
      if (entry.freq > 0) {
        entry.freq = 0;
        main.push(key);
      } else {
        entries.delete(key);
        return;
      }
    }
  };

  const evictSmall = () => {
    while (small.length > 0) {
      const key = small.shift()!;
      const entry = entries.get(key);
      if (entry === undefined) continue;
      if (entry.freq > 1) {
        entry.freq = 0;
        main.push(key);
        if (main.length > mainMax) evictMain();
      } else {
        entries.delete(key);
        ghost.add(key);
        return;
      }
    }
  };

  return {
    get(k) {
      const entry = entries.get(k);
      if (entry !== undefined) {
        if (entry.freq < 3) entry.freq++;
        return entry.value;
      }
    },
    set(k, v) {
      const entry = entries.get(k);
      if (entry !== undefined) {
        entry.value = v;
        return;
      }
      if (ghost.has(k)) {
        ghost.delete(k);
        if (main.length >= mainMax) evictMain();
        entries.set(k, { value: v, freq: 0 });
        main.push(k);
        return;
      }
      if (small.length >= smallMax) evictSmall();
      entries.set(k, { value: v, freq: 0 });
      small.push(k);
    },
  };
};

const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL("./cases.json", import.meta.url)), "utf8"),
) as string[];

const hitKeys = corpus.slice(0, MAX); // fits in cache -> all hits after warmup
const thrashKeys = corpus.slice(0, MAX * 2); // 2x capacity -> constant eviction

const impls: [string, (max: number) => Cache][] = [
  ["two-bucket object (current)", twoBucketObject],
  ["two-bucket Map", twoBucketMap],
  ["true-LRU Map", trueLruMap],
  ["SIEVE (NSDI'24)", sieve],
  ["S3-FIFO (SOSP'23)", s3Fifo],
];

const run = async (label: string, keys: string[]) => {
  const bench = new Bench({ time: 600, warmupTime: 150 });
  for (const [name, make] of impls) {
    const cache = make(MAX);
    for (const k of keys) cache.set(k, k); // warm
    bench.add(name, () => {
      for (let i = 0; i < keys.length; i++) {
        if (cache.get(keys[i]!) === undefined) cache.set(keys[i]!, keys[i]!);
      }
    });
  }
  await bench.run();
  console.log(`\n${label} (${keys.length} keys, cap ${MAX})`);
  console.table(
    bench.tasks.map((t) => ({
      impl: t.name,
      "ops/s": Math.round(
        (t.result as { throughput: { mean: number } }).throughput.mean,
      ).toLocaleString("en-US"),
    })),
  );
};

// Hit ratio under a skewed (Zipf-like) access pattern at half-capacity working pressure. This is
// where SIEVE/S3-FIFO are supposed to win over a simple two-bucket cache. We compare hit ratios so
// the speed numbers above can be weighed against any hit-ratio gain.
const measureHitRatio = (make: (max: number) => Cache, keys: string[]): number => {
  const cache = make(MAX);
  const keyspace = Math.min(keys.length, MAX * 4);
  const random = (() => {
    let state = 0x9e3779b9 >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  // Zipf-like skew: square the uniform sample so low indices (hot keys) dominate.
  const pick = () => keys[Math.floor(random() * random() * keyspace)]!;

  let hits = 0;
  const iterations = 100_000;
  for (let i = 0; i < iterations; i++) {
    const key = pick();
    if (cache.get(key) !== undefined) hits++;
    else cache.set(key, key);
  }
  return hits / iterations;
};

await run("HIT-heavy", hitKeys);
await run("THRASH", thrashKeys);

console.log(
  `\nHIT-RATIO (Zipf-like skew, keyspace ${Math.min(corpus.length, MAX * 4)}, cap ${MAX})`,
);
console.table(
  impls.map(([name, make]) => ({
    impl: name,
    "hit %": (measureHitRatio(make, corpus) * 100).toFixed(1),
  })),
);
