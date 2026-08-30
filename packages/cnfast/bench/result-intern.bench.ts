import { runSuite, type Workload } from "./lib/harness";

const INPUT_COUNT = 6000;

const fewOutputInputs: string[] = [];
for (let index = 0; index < INPUT_COUNT; index++) {
  fewOutputInputs.push(`p-[${index}px] p-4 flex row-${index % 16}`);
}

const uniqueOutputInputs: string[] = [];
for (let index = 0; index < INPUT_COUNT; index++) {
  uniqueOutputInputs.push(`p-[${index}px] p-4 flex u-${index}`);
}

const workloads: Workload[] = [
  {
    group: "result-intern",
    name: "few-outputs / map-keyed consumer",
    meta: `(${INPUT_COUNT} inputs -> 16 outputs)`,
    run: (impl) => {
      let sink = 0;
      const seen = new Map<string, number>();
      for (let index = 0; index < INPUT_COUNT; index++) {
        const result = impl(fewOutputInputs[index]!);
        seen.set(result, (seen.get(result) ?? 0) + 1);
        sink += result.length;
      }
      return sink + seen.size;
    },
  },
  {
    group: "result-intern",
    name: "few-outputs / nested cn",
    meta: `(${INPUT_COUNT} inputs -> 16 outputs, result fed back in)`,
    run: (impl) => {
      let sink = 0;
      for (let index = 0; index < INPUT_COUNT; index++) {
        const inner = impl(fewOutputInputs[index]!);
        sink += impl(inner, "shrink-0").length;
      }
      return sink;
    },
  },
  {
    group: "result-intern",
    name: "unique-outputs / overhead",
    meta: `(${INPUT_COUNT} inputs, no repeats)`,
    run: (impl) => {
      let sink = 0;
      for (let index = 0; index < INPUT_COUNT; index++) {
        sink += impl(uniqueOutputInputs[index]!).length;
      }
      return sink;
    },
  },
];

await runSuite(workloads, process.env.BENCH_LABEL ?? "result-intern");
