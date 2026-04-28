import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cli = path.join(root, "src", "portctl.mjs");
const tmp = await mkdtemp(path.join(os.tmpdir(), "vibe-ports-"));
const registry = path.join(tmp, "ports.json");
const site = path.join(tmp, "site");

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

run(["init", "--file", registry, "--examples", "--force"]);
const listOutput = run(["list", "--file", registry]);
if (!listOutput.includes("my-main-app") || !listOutput.includes("openclaw")) {
  throw new Error("list output did not include example entries");
}

const nextOutput = run([
  "next",
  "api",
  "--file",
  registry,
  "--project",
  "demo",
  "--service",
  "api"
]);
if (!nextOutput.includes("3100")) {
  throw new Error("next api did not choose 3100");
}

run(["reserve", "3100", "demo", "api", "--type", "api", "--file", registry]);
const registryJson = JSON.parse(await readFile(registry, "utf8"));
if (!registryJson.entries.some((entry) => entry.port === 3100 && entry.project === "demo")) {
  throw new Error("reserve did not write demo/api entry");
}

run(["export", "--file", registry, "--out", site]);
await stat(path.join(site, "index.html"));
await stat(path.join(site, "ports.json"));

console.log("smoke test passed");
