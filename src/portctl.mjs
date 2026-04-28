#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const appName = "vibe-ports";
const userConfigDir = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, appName)
  : path.join(os.homedir(), ".config", appName);
const globalRegistryFile = path.join(userConfigDir, "ports.json");
const exampleRegistryFile = path.join(rootDir, "examples", "local-ports.json");
const dashboardDir = path.join(rootDir, "dashboard");

const blockingStatuses = new Set(["assigned", "blocked", "preferred", "reserved"]);
const writableStatuses = new Set(["assigned", "blocked", "preferred", "reserved"]);

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const [rawKey, rawInlineValue] = value.slice(2).split("=", 2);
    const key = rawKey.trim();

    if (!key) {
      continue;
    }

    if (rawInlineValue !== undefined) {
      flags[key] = rawInlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positional };
}

function expandHome(file) {
  return String(file).replace(/^~(?=$|\/)/, os.homedir());
}

function resolveRegistryFile(flags) {
  const file = flags.file || process.env.PORT_REGISTRY_FILE || globalRegistryFile;
  return path.resolve(expandHome(file));
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readRegistry(file) {
  const raw = await readFile(file, "utf8");
  const registry = JSON.parse(raw);

  if (!Array.isArray(registry.ranges) || !Array.isArray(registry.entries)) {
    throw new Error(`Invalid registry shape in ${file}`);
  }

  return registry;
}

async function writeRegistry(file, registry) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(registry, null, 2)}\n`);
}

function asPort(value) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function contextFromFlags(flags) {
  return {
    project: flags.project ? String(flags.project) : "",
    service: flags.service ? String(flags.service) : "",
    type: flags.type ? String(flags.type) : ""
  };
}

function matchesContext(entry, context) {
  const projectMatches =
    !context.project || normalize(entry.project) === normalize(context.project);
  const serviceMatches =
    !context.service || normalize(entry.service) === normalize(context.service);
  const typeMatches = !context.type || normalize(entry.type) === normalize(context.type);

  return projectMatches && serviceMatches && typeMatches;
}

function matchesRequestedService(entry, context) {
  if (!context.project && !context.service) {
    return false;
  }

  return matchesContext(entry, context);
}

function findRange(registry, typeOrPort) {
  if (typeof typeOrPort === "number") {
    return registry.ranges.find((range) => typeOrPort >= range.start && typeOrPort <= range.end);
  }

  return registry.ranges.find((range) => normalize(range.id) === normalize(typeOrPort));
}

function inferType(registry, port) {
  return findRange(registry, port)?.id || "custom";
}

function registryDecision(registry, port, context = {}) {
  const entries = registry.entries.filter((entry) => Number(entry.port) === port);

  if (entries.length === 0) {
    return {
      available: true,
      reason: "not registered",
      entries
    };
  }

  const matchingEntries = entries.filter((entry) => matchesRequestedService(entry, context));
  if (matchingEntries.length > 0) {
    const preferred = matchingEntries.find((entry) => entry.status === "preferred");
    const existing = preferred || matchingEntries[0];

    return {
      available: existing.status !== "blocked",
      reason:
        existing.status === "preferred"
          ? "preferred for requested service"
          : `${existing.status} for requested service`,
      entries
    };
  }

  const blocking = entries.find((entry) => blockingStatuses.has(entry.status));
  if (blocking) {
    return {
      available: false,
      reason: `${blocking.status} by ${blocking.project}/${blocking.service}`,
      entries
    };
  }

  return {
    available: true,
    reason: "no blocking registry entry",
    entries
  };
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "ignore"
  });

  return result.error?.code !== "ENOENT";
}

function getListenerInfo(port) {
  const platform = os.platform();

  if (platform === "linux" && commandExists("ss")) {
    const result = spawnSync("ss", ["-H", "-ltnp"], { encoding: "utf8" });
    const lines = `${result.stdout || ""}${result.stderr || ""}`
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.includes(`:${port} `) || line.endsWith(`:${port}`));

    return {
      command: "ss -H -ltnp",
      lines
    };
  }

  if ((platform === "darwin" || commandExists("lsof")) && commandExists("lsof")) {
    const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8"
    });
    const lines = `${result.stdout || ""}${result.stderr || ""}`
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      command: `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      lines
    };
  }

  return {
    command: "node net bind probe",
    lines: []
  };
}

function hasListenerLines(listener) {
  return listener.lines.some((line) => !line.startsWith("COMMAND "));
}

function canBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.unref();
    server.once("error", (error) => {
      resolve({
        available: false,
        code: error.code || "UNKNOWN",
        message: error.message
      });
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => {
        resolve({
          available: true,
          code: "OK",
          message: "bindable"
        });
      });
    });
  });
}

async function probePort(port, host) {
  const bindStatus = await canBind(port, host);
  const listener = getListenerInfo(port);
  const listening = hasListenerLines(listener);

  if (bindStatus.available) {
    return {
      available: true,
      code: bindStatus.code,
      message: bindStatus.message,
      command: listener.command,
      listeners: listener.lines
    };
  }

  if (listening) {
    return {
      available: false,
      code: "LISTENING",
      message: "listener found",
      command: listener.command,
      listeners: listener.lines
    };
  }

  if (bindStatus.code === "EPERM") {
    return {
      available: true,
      code: "UNVERIFIED_EPERM",
      message: "bind probe denied, no listener found",
      command: listener.command,
      listeners: listener.lines
    };
  }

  return {
    available: false,
    code: bindStatus.code,
    message: bindStatus.message,
    command: listener.command,
    listeners: listener.lines
  };
}

function statusLabel(status) {
  return {
    assigned: "assigned",
    blocked: "blocked",
    preferred: "preferred",
    reserved: "reserved"
  }[status] || status;
}

function printTable(rows, columns) {
  const widths = columns.map((column) =>
    Math.max(
      column.label.length,
      ...rows.map((row) => String(column.value(row) ?? "").length)
    )
  );

  console.log(columns.map((column, index) => column.label.padEnd(widths[index])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(
      columns
        .map((column, index) => String(column.value(row) ?? "").padEnd(widths[index]))
        .join("  ")
    );
  }
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.port !== b.port) {
      return a.port - b.port;
    }

    return `${a.project}/${a.service}`.localeCompare(`${b.project}/${b.service}`);
  });
}

function createDefaultRegistry({ examples = false } = {}) {
  return {
    version: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    defaults: {
      host: "127.0.0.1",
      primaryPlatform: "linux",
      supportedPlatforms: ["linux", "darwin"],
      registryFile: "ports.json"
    },
    platforms: [
      {
        id: "linux",
        label: "Linux",
        primary: true,
        listenerCommand: "ss -H -ltnp",
        notes: "Primary target for local service checks."
      },
      {
        id: "darwin",
        label: "macOS",
        primary: false,
        listenerCommand: "lsof -nP -iTCP:<port> -sTCP:LISTEN",
        notes: "Supported fallback for local Mac development."
      }
    ],
    ranges: [
      {
        id: "frontend",
        label: "Frontend Apps",
        start: 3000,
        end: 3099,
        description: "Next.js, Vite, Astro, docs preview, and other browser apps."
      },
      {
        id: "api",
        label: "API / BFF",
        start: 3100,
        end: 3199,
        description: "HTTP APIs, BFF services, local model adapters, and webhook receivers."
      },
      {
        id: "worker",
        label: "Workers",
        start: 3200,
        end: 3299,
        description: "Queue workers, automation runners, crawlers, and background task UIs."
      },
      {
        id: "admin",
        label: "Admin / Docs",
        start: 3300,
        end: 3399,
        description: "Dashboards, docs, inspector panels, and admin consoles."
      },
      {
        id: "webhook",
        label: "Webhook Tests",
        start: 4000,
        end: 4099,
        description: "Local callback endpoints, tunnels, OAuth redirects, and integration tests."
      },
      {
        id: "experiment",
        label: "Experiments",
        start: 5000,
        end: 5999,
        description: "Disposable prototypes, demos, and temporary research apps."
      },
      {
        id: "database",
        label: "Local Datastores",
        start: 5400,
        end: 6499,
        description: "Postgres, Redis, vector stores, and datastore dashboards."
      },
      {
        id: "ai-gateway",
        label: "AI Gateways",
        start: 18700,
        end: 18799,
        description: "Local AI gateway services and agent control planes."
      }
    ],
    entries: examples
      ? [
          {
            port: 3000,
            status: "reserved",
            project: "my-main-app",
            service: "web",
            type: "frontend",
            host: "127.0.0.1",
            url: "http://localhost:3000",
            command: "npm run dev",
            owner: "user",
            notes: "Example reservation. Replace with your own project."
          },
          {
            port: 18789,
            status: "preferred",
            project: "openclaw",
            service: "gateway",
            type: "ai-gateway",
            host: "127.0.0.1",
            url: "http://localhost:18789",
            command: "openclaw gateway --port 18789 --verbose",
            owner: "tool",
            notes: "Example tool-preferred port."
          }
        ]
      : []
  };
}

function usage() {
  console.log(`Vibe Ports - local port registry for vibe coding agents

Usage:
  portctl init [--examples] [--force] [--file path]
  portctl config [--json]
  portctl list [--type frontend] [--status reserved] [--json]
  portctl ranges [--json]
  portctl check <port> [--project name] [--service name] [--json]
  portctl next <type> [--project name] [--service name] [--json]
  portctl reserve <port> <project> <service> [--type frontend] [--status assigned]
  portctl doctor [--json]
  portctl export [--out site] [--json]

Options:
  --file <path>      Registry file. Defaults to ~/.config/vibe-ports/ports.json
  --host <host>      Host used for bind checks. Defaults to registry defaults.host
  --force            Allow overwriting in init or replacing a registered port
  --examples         Include sample entries when initializing a registry
`);
}

async function initCommand(flags) {
  const registryFile = resolveRegistryFile(flags);
  const exists = await fileExists(registryFile);

  if (exists && !flags.force) {
    throw new Error(`Registry already exists: ${registryFile}. Use --force to overwrite.`);
  }

  await writeRegistry(registryFile, createDefaultRegistry({ examples: Boolean(flags.examples) }));

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          registryFile,
          created: true
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Created registry: ${registryFile}`);
}

async function configCommand(flags) {
  const registryFile = resolveRegistryFile(flags);
  const result = {
    appName,
    registryFile,
    globalRegistryFile,
    exampleRegistryFile,
    envRegistryFile: process.env.PORT_REGISTRY_FILE || ""
  };

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printTable([result], [
    { label: "App", value: (row) => row.appName },
    { label: "Active registry", value: (row) => row.registryFile },
    { label: "Global registry", value: (row) => row.globalRegistryFile }
  ]);
}

async function listCommand(registry, flags) {
  const entries = sortEntries(registry.entries).filter((entry) => {
    const typeMatches = !flags.type || normalize(entry.type) === normalize(flags.type);
    const statusMatches = !flags.status || normalize(entry.status) === normalize(flags.status);
    return typeMatches && statusMatches;
  });

  if (flags.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log("No registry entries matched.");
    return;
  }

  printTable(entries, [
    { label: "Port", value: (entry) => entry.port },
    { label: "Status", value: (entry) => statusLabel(entry.status) },
    { label: "Type", value: (entry) => entry.type },
    { label: "Project", value: (entry) => entry.project },
    { label: "Service", value: (entry) => entry.service },
    { label: "URL", value: (entry) => entry.url || "" }
  ]);
}

async function rangesCommand(registry, flags) {
  if (flags.json) {
    console.log(JSON.stringify(registry.ranges, null, 2));
    return;
  }

  printTable(registry.ranges, [
    { label: "Type", value: (range) => range.id },
    { label: "Start", value: (range) => range.start },
    { label: "End", value: (range) => range.end },
    { label: "Label", value: (range) => range.label }
  ]);
}

async function checkCommand(registry, flags, positional) {
  const port = asPort(positional[0]);
  const host = String(flags.host || registry.defaults?.host || "127.0.0.1");
  const context = contextFromFlags(flags);
  const registryStatus = registryDecision(registry, port, context);
  const runtimeStatus = await probePort(port, host);
  const available = registryStatus.available && runtimeStatus.available;
  const result = {
    port,
    host,
    available,
    registry: registryStatus,
    runtime: {
      available: runtimeStatus.available,
      code: runtimeStatus.code,
      command: runtimeStatus.command,
      listeners: runtimeStatus.listeners
    }
  };

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Port: ${port}`);
  console.log(`Registry: ${registryStatus.available ? "ok" : "blocked"} (${registryStatus.reason})`);
  console.log(
    `Runtime: ${runtimeStatus.available ? `free (${runtimeStatus.code})` : `in use (${runtimeStatus.code})`}`
  );

  if (runtimeStatus.listeners.length > 0) {
    console.log(`Listener command: ${runtimeStatus.command}`);
    for (const line of runtimeStatus.listeners) {
      console.log(`  ${line}`);
    }
  }

  console.log(`Decision: ${available ? "available" : "not available"}`);
}

async function nextCommand(registry, flags, positional) {
  const type = positional[0] || flags.type || "frontend";
  const range = findRange(registry, type);
  const host = String(flags.host || registry.defaults?.host || "127.0.0.1");
  const context = { ...contextFromFlags(flags), type };

  if (!range) {
    throw new Error(`Unknown port type: ${type}`);
  }

  const knownCandidates = sortEntries(registry.entries).filter(
    (entry) =>
      matchesRequestedService(entry, context) &&
      ["preferred", "reserved", "assigned"].includes(entry.status) &&
      Number(entry.port) >= range.start &&
      Number(entry.port) <= range.end
  );

  for (const entry of knownCandidates) {
    const port = Number(entry.port);
    const registryStatus = registryDecision(registry, port, context);
    const runtimeStatus = await probePort(port, host);

    if (registryStatus.available && runtimeStatus.available) {
      const result = {
        port,
        type,
        host,
        url: entry.url || `http://localhost:${port}`,
        range,
        registryReason: registryStatus.reason
      };

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`${port}`);
      console.log(`type=${type}`);
      console.log(`url=${result.url}`);
      console.log(`reason=${registryStatus.reason}`);
      return;
    }

    throw new Error(
      `Registered port ${port} for ${entry.project}/${entry.service} is not available (${runtimeStatus.code}).`
    );
  }

  for (let port = range.start; port <= range.end; port += 1) {
    const runtimeStatus = await probePort(port, host);
    const registryStatus = registryDecision(registry, port, context);

    if (!registryStatus.available || !runtimeStatus.available) {
      continue;
    }

    const result = {
      port,
      type,
      host,
      url: `http://localhost:${port}`,
      range,
      registryReason: registryStatus.reason
    };

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`${port}`);
    console.log(`type=${type}`);
    console.log(`url=${result.url}`);
    console.log(`reason=${registryStatus.reason}`);
    return;
  }

  throw new Error(`No available ${type} port in ${range.start}-${range.end}`);
}

async function reserveCommand(registry, registryFile, flags, positional) {
  const port = asPort(positional[0]);
  const project = positional[1] || flags.project;
  const service = positional[2] || flags.service;
  const status = String(flags.status || "assigned");

  if (!project || !service) {
    throw new Error("reserve requires <port> <project> <service>");
  }

  if (!writableStatuses.has(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }

  const existing = registry.entries.filter((entry) => Number(entry.port) === port);
  const sameServiceIndex = registry.entries.findIndex(
    (entry) =>
      Number(entry.port) === port &&
      normalize(entry.project) === normalize(project) &&
      normalize(entry.service) === normalize(service)
  );

  if (existing.length > 0 && sameServiceIndex === -1 && !flags.force) {
    throw new Error(`Port ${port} is already registered. Use --force to replace.`);
  }

  const entry = {
    port,
    status,
    project: String(project),
    service: String(service),
    type: String(flags.type || inferType(registry, port)),
    host: String(flags.host || registry.defaults?.host || "127.0.0.1"),
    url: String(flags.url || `http://localhost:${port}`),
    command: flags.command ? String(flags.command) : "",
    owner: String(flags.owner || "user"),
    notes: flags.notes ? String(flags.notes) : ""
  };

  if (sameServiceIndex >= 0) {
    registry.entries[sameServiceIndex] = {
      ...registry.entries[sameServiceIndex],
      ...entry
    };
  } else {
    if (existing.length > 0 && flags.force) {
      registry.entries = registry.entries.filter((candidate) => Number(candidate.port) !== port);
    }
    registry.entries.push(entry);
  }

  registry.updatedAt = new Date().toISOString().slice(0, 10);
  registry.entries = sortEntries(registry.entries);

  await writeRegistry(registryFile, registry);

  if (flags.json) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  console.log(`Reserved ${port} for ${project}/${service} (${status}).`);
}

async function buildRuntimeSnapshot(registry, flags) {
  const host = String(flags.host || registry.defaults?.host || "127.0.0.1");
  const portCounts = new Map();

  for (const entry of registry.entries) {
    portCounts.set(Number(entry.port), (portCounts.get(Number(entry.port)) || 0) + 1);
  }

  const checks = [];
  for (const entry of sortEntries(registry.entries)) {
    const runtimeStatus = await probePort(Number(entry.port), host);
    checks.push({
      port: entry.port,
      status: entry.status,
      project: entry.project,
      service: entry.service,
      type: entry.type,
      duplicate: portCounts.get(Number(entry.port)) > 1,
      runtime: runtimeStatus.available ? "free" : "listening",
      runtimeCode: runtimeStatus.code,
      listenerCommand: runtimeStatus.command,
      listeners: runtimeStatus.listeners
    });
  }

  return checks;
}

async function doctorCommand(registry, flags) {
  const checks = await buildRuntimeSnapshot(registry, flags);

  if (flags.json) {
    console.log(JSON.stringify(checks, null, 2));
    return;
  }

  if (checks.length === 0) {
    console.log("No registry entries matched.");
    return;
  }

  printTable(checks, [
    { label: "Port", value: (check) => check.port },
    { label: "Status", value: (check) => check.status },
    { label: "Project", value: (check) => check.project },
    { label: "Service", value: (check) => check.service },
    { label: "Runtime", value: (check) => check.runtime },
    { label: "Dup", value: (check) => (check.duplicate ? "yes" : "") }
  ]);
}

async function exportCommand(registry, flags) {
  const outDir = path.resolve(expandHome(flags.out || "site"));
  await mkdir(outDir, { recursive: true });
  await cp(dashboardDir, outDir, { recursive: true });

  const payload = {
    ...registry,
    exportedAt: new Date().toISOString(),
    runtime: await buildRuntimeSnapshot(registry, flags)
  };

  await writeFile(path.join(outDir, "ports.json"), `${JSON.stringify(payload, null, 2)}\n`);

  if (flags.json) {
    console.log(JSON.stringify({ outDir }, null, 2));
    return;
  }

  console.log(`Exported static dashboard: ${outDir}`);
}

async function loadRegistryForCommand(command, flags) {
  const registryFile = resolveRegistryFile(flags);

  if (!(await fileExists(registryFile))) {
    throw new Error(`Registry not found: ${registryFile}. Run: portctl init --examples`);
  }

  return {
    registryFile,
    registry: await readRegistry(registryFile)
  };
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "init") {
    await initCommand(flags);
    return;
  }

  if (command === "config") {
    await configCommand(flags);
    return;
  }

  const { registryFile, registry } = await loadRegistryForCommand(command, flags);

  if (command === "list") {
    await listCommand(registry, flags);
    return;
  }

  if (command === "ranges") {
    await rangesCommand(registry, flags);
    return;
  }

  if (command === "check") {
    await checkCommand(registry, flags, positional);
    return;
  }

  if (command === "next") {
    await nextCommand(registry, flags, positional);
    return;
  }

  if (command === "reserve") {
    await reserveCommand(registry, registryFile, flags, positional);
    return;
  }

  if (command === "doctor") {
    await doctorCommand(registry, flags);
    return;
  }

  if (command === "export") {
    await exportCommand(registry, flags);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
