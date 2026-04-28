---
name: local-port-registry
description: Manage local development ports for vibe coding and AI/coding agents through Vibe Ports. Use when Codex creates, modifies, starts, or documents a local dev service; assigns a PORT value; edits .env, package scripts, docker-compose, Next.js/Vite/API/worker/admin service ports; or needs to avoid conflicts with user-level reserved ports.
---

# Vibe Ports Local Registry

Use this skill before assigning or changing any local development port.

## Source Of Truth

Resolve the active registry in this order:

```txt
explicit --file
PORT_REGISTRY_FILE
~/.config/vibe-ports/ports.json
```

Use the CLI when available:

```bash
portctl list
portctl check <port>
portctl next <type> --project <project> --service <service>
portctl reserve <port> <project> <service> --type <type>
```

If `portctl` is not installed but the project has this repo checked out, run:

```bash
node src/portctl.mjs <command>
```

## Status Semantics

- `reserved`: user-level reservation. Do not use for another service even when the port is not currently listening.
- `preferred`: tool/project preferred port. Use only when the requested project/service matches.
- `assigned`: already assigned to a concrete service.
- `blocked`: never use.

## Workflow

1. Classify the service as `frontend`, `api`, `worker`, `admin`, `webhook`, `experiment`, `database`, or `ai-gateway`.
2. Read the registry before choosing a port.
3. Use `next` with explicit `--project` and `--service` to get the candidate port.
4. Use `check` before writing the port into config.
5. Write the port through env/config rather than hardcoding where the framework supports it.
6. Update the registry with `reserve` after assigning the port.
7. Do not kill a process occupying a port unless the user explicitly asks.

## Platform Policy

Default to Linux. Use `ss -H -ltnp` for listener inspection on Linux.

Support macOS. Use `lsof -nP -iTCP:<port> -sTCP:LISTEN` for listener inspection on macOS.

Treat runtime checks and registry checks as separate gates:

```txt
registry free + runtime free = usable
registry blocked + runtime free = not usable
registry free + runtime listening = not usable
```
