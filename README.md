# brAIn-essentials

Heart-of-the-system nodes for [brAIn](https://github.com/tibzejoker/brAIn).

| Node | Purpose |
|---|---|
| `brain` | Central LLM-driven consciousness. Inspects the network, delegates work to other nodes, reflects, orchestrates. |
| `developer` | Meta-node that authors new node packages at runtime. Writes code into `nodes/_dynamic/<slug>/`, builds, iterates on framework feedback. |
| `mcp-config` | Manager + federation hub for MCP servers. Owns the global `mcpServers` JSON, spawns one `mcp-server` child per entry. |
| `mcp-server` | Bridges ONE external MCP server. Each upstream tool becomes its own bus topic (`mcp.<alias>.<tool>`). |
| `clock` | Periodic tick. Useful as a heartbeat or for time-based testing. |
| `cron` | Schedules messages on a cron expression. |
| `echo` | Trivial node — echoes anything it receives. Debug tool, also serves as the smallest example handler. |
| `attention` | Bridges intent / voice / gaze perception services into the brain's input. |

## Why "essentials" and not "core"?

The framework itself (sdk + core + api + dashboard + agent) lives in [brAIn](https://github.com/tibzejoker/brAIn) — it has no nodes built in. This repo is the curated set of nodes that almost every brAIn install probably wants, but it's still optional: a use case that just wants to wire memory + tools without a central brain can skip this entirely.

Install via the [brAIn marketplace](https://github.com/tibzejoker/brAIn-store) — typical seed:

```yaml
needs:
  - type: brain
  - type: mcp-config
nodes:
  - { type: brain, name: consciousness, ... }
```

Or clone as a sibling of `brAIn/` for dev mode (auto-picked by brAIn's `pnpm-workspace.yaml`).
