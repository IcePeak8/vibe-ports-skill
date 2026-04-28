# Agent Rules

Use these rules in Codex, Claude Code, Cursor Agent, Gemini CLI, or any coding agent that edits local service config.

```md
## Local Port Management

When creating or modifying a local development service:

- Do not choose ports casually or reuse defaults without checking.
- Respect user-level port reservations before assigning local dev ports.
- A free port in `lsof` or `ss` is not necessarily available if it is reserved in the user's port registry.
- Prefer the global registry at `~/.config/vibe-ports/ports.json`, or the file specified by `PORT_REGISTRY_FILE`.
- Before using a port, run `portctl check <port>`.
- Use `portctl next <type> --project <project> --service <service>` before assigning new ports.
- Update the registry with `portctl reserve <port> <project> <service> --type <type>` after assigning a port.
- Do not kill a process occupying a port unless the user explicitly asks.
```
