import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const limitBytes = 500 * 1024;
const assetsDirectory = path.resolve("apps/web/dist/assets");
const entries = await readdir(assetsDirectory);
const chunks = [];

for (const entry of entries) {
  if (!entry.endsWith(".js")) continue;
  const file = path.join(assetsDirectory, entry);
  const size = (await stat(file)).size;
  chunks.push({ entry, size });
}

if (chunks.length === 0) {
  throw new Error("No production JavaScript chunks were found. Run npm run build first.");
}

const oversized = chunks.filter(({ size }) => size > limitBytes);
const largest = chunks.toSorted((left, right) => right.size - left.size)[0];
console.log(`Largest JavaScript chunk: ${largest.entry} (${(largest.size / 1024).toFixed(1)} KiB)`);

if (oversized.length > 0) {
  for (const { entry, size } of oversized) {
    console.error(`${entry} is ${(size / 1024).toFixed(1)} KiB; the release limit is 500 KiB.`);
  }
  process.exitCode = 1;
}
