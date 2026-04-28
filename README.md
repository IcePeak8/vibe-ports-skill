# Vibe Ports

Local port registry and static dashboard for vibe coding agents.

When AI coding tools start adding services to a project, they tend to grab the same defaults: `3000`, `3001`, `5173`, `8000`. Vibe Ports gives humans and agents a shared local source of truth: reserve ports, discover the next available port, and export a static dashboard anyone can open or host.

## Features

- `portctl` CLI for checking, reserving, and documenting local ports
- User-level registry at `~/.config/vibe-ports/ports.json`
- Explicit `--file` support for project-level registries
- Linux-first listener detection with macOS support
- Static dashboard export with no database or daemon required
- Codex skill/rules for AI coding agents

## Install / Use From Source

```bash
git clone https://github.com/IcePeak8/vibe-ports.git
cd vibe-ports
npm install
npm link
```

Then initialize your global registry:

```bash
portctl init --examples
portctl list
```

Without `npm link`, run the CLI directly:

```bash
node src/portctl.mjs init --examples
node src/portctl.mjs list
```

## CLI

```bash
portctl init --examples
portctl config
portctl list
portctl ranges
portctl check 3000
portctl next frontend --project my-app --service web
portctl reserve 3001 my-app web --type frontend
portctl doctor
portctl export --out site
```

`portctl export --out site` writes a static dashboard to `site/`. You can serve that directory locally or publish it to GitHub Pages, Vercel, Netlify, or any static host.

## Registry Semantics

| Status | Meaning |
|---|---|
| `reserved` | User-level reservation. Do not use for another service even if the port is not listening. |
| `preferred` | Tool/project preferred port. Use only for the matching project/service. |
| `assigned` | Assigned to a concrete local service. |
| `blocked` | Never use. |

A port is usable only when both checks pass:

```txt
registry says usable + runtime says free = usable
registry says blocked + runtime says free = not usable
registry says usable + runtime says listening = not usable
```

## Default Port Ranges

| Type | Range | Usage |
|---|---:|---|
| `frontend` | 3000-3099 | Next.js, Vite, Astro, docs preview |
| `api` | 3100-3199 | API, BFF, model adapters |
| `worker` | 3200-3299 | Workers, queues, automation |
| `admin` | 3300-3399 | Dashboards, docs, inspectors |
| `webhook` | 4000-4099 | Webhooks, OAuth callbacks, tunnels |
| `experiment` | 5000-5999 | Demos and prototypes |
| `database` | 5400-6499 | Postgres, Redis, vector DBs |
| `ai-gateway` | 18700-18799 | Local AI gateways and agent control planes |

## Agent Rules

For Codex, copy or install:

```txt
skills/codex/local-port-registry/SKILL.md
```

The key rule is simple: before assigning any `PORT`, the agent must inspect the registry and run `portctl next` or `portctl check`.

## Static Dashboard

```bash
portctl init --examples
portctl export --out site
python3 -m http.server 8080 -d site
```

Open `http://localhost:8080`.

The exported dashboard is a snapshot. It can include runtime status at export time, but it does not scan the machine after deployment. For live status, run `portctl doctor` or re-export.

## Development

```bash
npm run check
npm test
```

## License

MIT
