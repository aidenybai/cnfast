import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import {
  LRU_BENCHMARK_TIME_MS,
  LRU_BENCHMARK_WARMUP_TIME_MS,
  LRU_CACHE_ENTRY_COUNT,
  LRU_HIT_RATIO_ITERATION_COUNT,
} from "./constants";

interface Cache {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface FifoEntry {
  value: string;
  frequency: number;
}

interface CacheImplementation {
  name: string;
  createCache: (maxEntries: number) => Cache;
}

interface ThroughputResult {
  throughput: {
    mean: number;
  };
}

interface RandomNumberGenerator {
  getNext(): number;
}

const createHitRatioRandomNumberGenerator = (): RandomNumberGenerator => {
  let state = 0x9e3779b9 >>> 0;
  return {
    getNext: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let randomValue = state;
      randomValue = Math.imul(randomValue ^ (randomValue >>> 15), randomValue | 1);
      randomValue ^= randomValue + Math.imul(randomValue ^ (randomValue >>> 7), randomValue | 61);
      return ((randomValue ^ (randomValue >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
};

const createTwoBucketObjectCache = (maxEntries: number): Cache => {
  let size = 0;
  let cache: Record<string, string> = Object.create(null);
  let previousCache: Record<string, string> = Object.create(null);
  const setNewEntry = (key: string, value: string) => {
    cache[key] = value;
    if (++size > maxEntries) {
      size = 0;
      previousCache = cache;
      cache = Object.create(null);
    }
  };
  return {
    get(key) {
      let value = cache[key];
      if (value !== undefined) return value;
      if ((value = previousCache[key]) !== undefined) {
        setNewEntry(key, value);
        return value;
      }
    },
    set(key, value) {
      if (key in cache) cache[key] = value;
      else setNewEntry(key, value);
    },
  };
};

const createTwoBucketMapCache = (maxEntries: number): Cache => {
  let cache = new Map<string, string>();
  let previousCache = new Map<string, string>();
  const setNewEntry = (key: string, value: string) => {
    cache.set(key, value);
    if (cache.size > maxEntries) {
      previousCache = cache;
      cache = new Map();
    }
  };
  return {
    get(key) {
      let value = cache.get(key);
      if (value !== undefined) return value;
      if ((value = previousCache.get(key)) !== undefined) {
        setNewEntry(key, value);
        return value;
      }
    },
    set(key, value) {
      if (cache.has(key)) cache.set(key, value);
      else setNewEntry(key, value);
    },
  };
};

const createLruMapCache = (maxEntries: number): Cache => {
  const cache = new Map<string, string>();
  return {
    get(key) {
      const value = cache.get(key);
      if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
      }
      return value;
    },
    set(key, value) {
      if (cache.has(key)) cache.delete(key);
      cache.set(key, value);
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    },
  };
};

interface SieveNode {
  key: string;
  value: string;
  visited: boolean;
  prev: SieveNode | null;
  next: SieveNode | null;
}

const createSieveCache = (maxEntries: number): Cache => {
  const map = new Map<string, SieveNode>();
  let head: SieveNode | null = null;
  let tail: SieveNode | null = null;
  let hand: SieveNode | null = null;
  let size = 0;

  const evict = () => {
    let nodeToEvict = hand ?? tail;
    while (nodeToEvict && nodeToEvict.visited) {
      nodeToEvict.visited = false;
      nodeToEvict = nodeToEvict.next ?? tail;
    }
    if (!nodeToEvict) return;
    hand = nodeToEvict.next ?? tail;

    if (nodeToEvict.prev) nodeToEvict.prev.next = nodeToEvict.next;
    else tail = nodeToEvict.next;
    if (nodeToEvict.next) nodeToEvict.next.prev = nodeToEvict.prev;
    else head = nodeToEvict.prev;
    if (hand === nodeToEvict) hand = null;

    map.delete(nodeToEvict.key);
    size--;
  };

  return {
    get(key) {
      const node = map.get(key);
      if (node !== undefined) {
        node.visited = true;
        return node.value;
      }
    },
    set(key, value) {
      const existing = map.get(key);
      if (existing !== undefined) {
        existing.value = value;
        existing.visited = true;
        return;
      }
      if (size >= maxEntries) evict();
      const node: SieveNode = { key, value, visited: false, prev: head, next: null };
      if (head) head.next = node;
      head = node;
      if (!tail) tail = node;
      map.set(key, node);
      size++;
    },
  };
};

const createS3FifoCache = (maxEntries: number): Cache => {
  const smallMaxEntries = Math.max(1, Math.floor(maxEntries / 10));
  const mainMaxEntries = maxEntries - smallMaxEntries;
  const entries = new Map<string, FifoEntry>();
  const smallQueue: string[] = [];
  const mainQueue: string[] = [];
  const evictedKeys = new Set<string>();

  const evictMain = () => {
    while (mainQueue.length > 0) {
      const key = mainQueue.shift()!;
      const entry = entries.get(key);
      if (entry === undefined) continue;
      if (entry.frequency > 0) {
        entry.frequency = 0;
        mainQueue.push(key);
      } else {
        entries.delete(key);
        return;
      }
    }
  };

  const evictSmall = () => {
    while (smallQueue.length > 0) {
      const key = smallQueue.shift()!;
      const entry = entries.get(key);
      if (entry === undefined) continue;
      if (entry.frequency > 1) {
        entry.frequency = 0;
        mainQueue.push(key);
        if (mainQueue.length > mainMaxEntries) evictMain();
      } else {
        entries.delete(key);
        evictedKeys.add(key);
        return;
      }
    }
  };

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry !== undefined) {
        if (entry.frequency < 3) entry.frequency++;
        return entry.value;
      }
    },
    set(key, value) {
      const entry = entries.get(key);
      if (entry !== undefined) {
        entry.value = value;
        return;
      }
      if (evictedKeys.has(key)) {
        evictedKeys.delete(key);
        if (mainQueue.length >= mainMaxEntries) evictMain();
        entries.set(key, { value, frequency: 0 });
        mainQueue.push(key);
        return;
      }
      if (smallQueue.length >= smallMaxEntries) evictSmall();
      entries.set(key, { value, frequency: 0 });
      smallQueue.push(key);
    },
  };
};

const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL("./cases.json", import.meta.url)), "utf8"),
) as string[];

const hitKeys = corpus.slice(0, LRU_CACHE_ENTRY_COUNT);
const thrashKeys = corpus.slice(0, LRU_CACHE_ENTRY_COUNT * 2);

const cacheImplementations: CacheImplementation[] = [
  { name: "two-bucket object (current)", createCache: createTwoBucketObjectCache },
  { name: "two-bucket Map", createCache: createTwoBucketMapCache },
  { name: "true-LRU Map", createCache: createLruMapCache },
  { name: "SIEVE (NSDI'24)", createCache: createSieveCache },
  { name: "S3-FIFO (SOSP'23)", createCache: createS3FifoCache },
];

const runBenchmark = async (label: string, keys: string[]): Promise<void> => {
  const benchmark = new Bench({
    time: LRU_BENCHMARK_TIME_MS,
    warmupTime: LRU_BENCHMARK_WARMUP_TIME_MS,
  });
  for (const implementation of cacheImplementations) {
    const cache = implementation.createCache(LRU_CACHE_ENTRY_COUNT);
    for (const key of keys) cache.set(key, key);
    benchmark.add(implementation.name, () => {
      for (let index = 0; index < keys.length; index++) {
        if (cache.get(keys[index]!) === undefined) cache.set(keys[index]!, keys[index]!);
      }
    });
  }
  await benchmark.run();
  console.log(`\n${label} (${keys.length} keys, cap ${LRU_CACHE_ENTRY_COUNT})`);
  console.table(
    benchmark.tasks.map((task) => ({
      impl: task.name,
      "ops/s": Math.round((task.result as ThroughputResult).throughput.mean).toLocaleString(
        "en-US",
      ),
    })),
  );
};

const measureHitRatio = (createCache: (maxEntries: number) => Cache, keys: string[]): number => {
  const cache = createCache(LRU_CACHE_ENTRY_COUNT);
  const keyspaceSize = Math.min(keys.length, LRU_CACHE_ENTRY_COUNT * 4);
  const randomNumberGenerator = createHitRatioRandomNumberGenerator();
  const getRandomKey = () =>
    keys[
      Math.floor(randomNumberGenerator.getNext() * randomNumberGenerator.getNext() * keyspaceSize)
    ]!;

  let hitCount = 0;
  for (let index = 0; index < LRU_HIT_RATIO_ITERATION_COUNT; index++) {
    const key = getRandomKey();
    if (cache.get(key) !== undefined) hitCount++;
    else cache.set(key, key);
  }
  return hitCount / LRU_HIT_RATIO_ITERATION_COUNT;
};

await runBenchmark("HIT-heavy", hitKeys);
await runBenchmark("THRASH", thrashKeys);

console.log(
  `\nHIT-RATIO (Zipf-like skew, keyspace ${Math.min(
    corpus.length,
    LRU_CACHE_ENTRY_COUNT * 4,
  )}, cap ${LRU_CACHE_ENTRY_COUNT})`,
);
console.table(
  cacheImplementations.map((implementation) => ({
    impl: implementation.name,
    "hit %": (measureHitRatio(implementation.createCache, corpus) * 100).toFixed(1),
  })),
);
