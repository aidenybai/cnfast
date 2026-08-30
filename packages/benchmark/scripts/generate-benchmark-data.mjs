import { readFileSync, writeFileSync } from "node:fs";

const benchmarkDirectoryUrl = new URL("../../cnfast/bench/", import.meta.url);
const repositories = JSON.parse(readFileSync(new URL("repos.json", benchmarkDirectoryUrl), "utf8"));
const rawResults = readFileSync(new URL("results.jsonl", benchmarkDirectoryUrl), "utf8");
const repositoryNames = new Set(repositories.map((repository) => repository.name));
const recordsByTimestamp = new Map();

for (const line of rawResults.split("\n")) {
  if (!line) continue;
  const record = JSON.parse(line);
  if (record.group !== "corpus") continue;
  const repositoryName = record.corpus.split(" (")[0];
  if (!repositoryNames.has(repositoryName)) continue;
  const timestampRecords = recordsByTimestamp.get(record.timestamp) ?? new Map();
  timestampRecords.set(repositoryName, record);
  recordsByTimestamp.set(record.timestamp, timestampRecords);
}

const latestCompleteTimestamp = [...recordsByTimestamp.keys()]
  .sort()
  .reverse()
  .find((timestamp) => recordsByTimestamp.get(timestamp)?.size === repositories.length);

if (!latestCompleteTimestamp) throw new Error("No complete repository benchmark run was found");

const latestRecords = recordsByTimestamp.get(latestCompleteTimestamp);
const generatedRepositories = repositories.map((repository) => {
  const benchmark = latestRecords.get(repository.name);
  if (!benchmark) throw new Error(`Missing benchmark result for ${repository.name}`);

  return {
    name: repository.name,
    url: repository.url.replace(/\.git$/, ""),
    benchmark: {
      cnfast: benchmark.cnfast,
      reference: benchmark.reference,
      speedup: benchmark.speedup,
      detail: benchmark.corpus.slice(repository.name.length).trim(),
    },
  };
});
const generatedData = {
  benchmarkTimestamp: latestCompleteTimestamp,
  repositories: generatedRepositories,
};
const outputUrl = new URL("../src/generated/benchmark-data.json", import.meta.url);

writeFileSync(outputUrl, `${JSON.stringify(generatedData, null, 2)}\n`);
