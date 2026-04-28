# Registry Schema

A registry is a JSON file with ranges and entries.

```json
{
  "version": 1,
  "updatedAt": "2026-04-28",
  "defaults": {
    "host": "127.0.0.1",
    "primaryPlatform": "linux",
    "supportedPlatforms": ["linux", "darwin"],
    "registryFile": "ports.json"
  },
  "ranges": [],
  "entries": []
}
```

## Entry

```json
{
  "port": 3001,
  "status": "assigned",
  "project": "my-app",
  "service": "web",
  "type": "frontend",
  "host": "127.0.0.1",
  "url": "http://localhost:3001",
  "command": "npm run dev -- -p 3001",
  "owner": "user",
  "notes": "Main local web app"
}
```

## Status Values

- `reserved`: user-level reservation
- `preferred`: tool/project preferred port
- `assigned`: assigned to a concrete local service
- `blocked`: never use

## Registry Location

Default global registry:

```txt
~/.config/vibe-ports/ports.json
```

Override with:

```bash
PORT_REGISTRY_FILE=/path/to/ports.json portctl list
portctl list --file /path/to/ports.json
```
