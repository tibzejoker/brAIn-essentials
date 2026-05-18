/**
 * TEMPLATE node — replace this docblock with what the node actually does.
 *
 * This file is a SCAFFOLD: it demonstrates every brAIn-framework API the
 * runtime exposes through ctx, with explicit "TODO" markers where your
 * logic plugs in. Strip the parts you don't need; the framework only
 * cares that `handler` is exported and that tests pass.
 *
 * Mental model:
 *   - The node sits idle until a subscribed message lands in its mailbox.
 *   - `handler(ctx)` runs ONCE per incoming batch — read `ctx.messages`,
 *     decide what to do, publish/respond, return. The runner parks the
 *     node again.
 *   - There is no manual sleep. Periodic work subscribes to `time.tick`
 *     from the always-running `clock` node (or a `cron` instance for
 *     custom cadences from ms to year).
 */
import type {
  NodeHandler, NodeContext, NodeOnSpawn, NodeTeardown,
  TextPayload,
} from "@brain/sdk";

// ============================================================================
// onSpawn — runs ONCE when a fresh instance of this type boots.
// Use for: one-time side-effects (open a long-lived socket, register a
// global callback, seed `ctx.state` from disk). Optional; delete if unused.
// ============================================================================
export const onSpawn: NodeOnSpawn = (info) => {
  // TODO: per-instance init. `info.id` is the unique node id; you can stash
  // per-instance state here in a module-level Map if you need a handle
  // outside the request/response loop.
  void info;
  return Promise.resolve();
};

// ============================================================================
// teardown — runs when the instance is killed / the API shuts down.
// Use for: closing sockets, flushing buffers. Optional; delete if unused.
// ============================================================================
export const teardown: NodeTeardown = (info) => {
  // TODO: close sockets, flush pending state. If you opened a DB via
  // ./db.ts:
  //   import { closeDb } from "./db";
  //   closeDb(<your-data-dir>);   // dataDir isn't on `info` — keep it
  //                                  in a module-level Map<id, string>
  //                                  written from onSpawn if you need it.
  void info;
  return Promise.resolve();
};

// ============================================================================
// handler — the main entry. Called for each batch of incoming messages.
// ============================================================================
export const handler: NodeHandler = async (ctx: NodeContext) => {
  // 1. Read incoming messages from the mailbox. Filter by topic if you
  //    subscribe to multiple. Empty mailbox → return early (cheap path).
  if (ctx.messages.length === 0) return;

  for (const msg of ctx.messages) {
    // The framework guarantees msg.payload matches your declared inputSchema
    // for non-internal subscriptions, so you can trust the shape after parse.
    // For chat.input / loose strings, content is just a string.
    let parsed: Record<string, unknown> = {};
    try {
      const content = (msg.payload as TextPayload).content;
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // Not JSON — treat as free text.
      parsed = { _raw: (msg.payload as TextPayload).content };
    }

    // -----------------------------------------------------------------------
    // CTX SURFACE — every primitive available to a node, with one example.
    // Pick what you need, drop the rest.
    // -----------------------------------------------------------------------

    // a) Reply to the SENDER on the canonical chat.response surface.
    //    The chat node (and brAIn-mobile) subscribe to this; bridges too.
    //    Use `metadata.from_game` etc. to let UIs filter your lines.
    ctx.respond("Hello from TEMPLATE_NAME", { from_template: true });

    // b) Publish on an explicit topic. Use this when the message doesn't
    //    target the chat — e.g. fan-out to a downstream node.
    ctx.publish("TEMPLATE_PUBLIC_TOPIC.event", {
      type: "text",
      criticality: 3,
      payload: { content: JSON.stringify({ status: "tick", from: ctx.node.id }) },
    });

    // c) Persistent KV across iterations. Re-hydrated on restart from
    //    the framework DB.
    ctx.state._last_seen_at = Date.now();
    ctx.state._count = ((ctx.state._count as number | undefined) ?? 0) + 1;

    // d) Per-node sandboxed data dir on disk (auto-created, 0o700).
    //    Good for SQLite DBs, downloaded files, anything that should
    //    survive process restart. The scaffold ships ./db.ts which
    //    opens a better-sqlite3 store under this dir — uncomment when
    //    your node needs real persistence beyond ctx.state, otherwise
    //    delete db.ts + the better-sqlite3 dep from package.json.
    //
    //    import { openDb } from "./db";
    //    const db = openDb(ctx.dataDir);
    //    db.prepare("INSERT INTO items(key,value,created_at,updated_at) VALUES (?,?,?,?)")
    //      .run("hello", "world", Date.now(), Date.now());
    void ctx.dataDir;

    // e) Structured logging (level + message + optional data object).
    //    Visible in the dashboard's Logs tab on this node.
    ctx.log("info", "handler iteration", { count: ctx.state._count });

    // f) LLM — three flavours. Pick the one matching your need.
    //    f.1) Free text — narration, summaries, anything human-facing.
    //         await ctx.llm.text({ system: "…", prompt: "…", maxTokens: 256 });
    //
    //    f.2) Single forced tool call — structured decision with strict
    //         schema. ai-sdk validates args. KEEP THE SCHEMA PERMISSIVE
    //         (just type + min/maxLength) and validate in code — local
    //         LLMs reliably emit the SEMANTICS but botch the FORMAT
    //         (uppercase, accents, trailing punctuation).
    //         const r = await ctx.llm.tool({
    //           tool: { name: "pick_x", description: "...",
    //                   inputSchema: { type: "object", required: ["x"],
    //                                  additionalProperties: false,
    //                                  properties: { x: { type: "string" } } } },
    //           system: "...", prompt: "...",
    //         });
    //         const x = String((r as { x?: unknown }).x ?? "").trim();
    //
    //    f.3) Multi-tool dispatch — let the LLM pick among several actions.
    //         ai-sdk handles routing natively (no oneOf). The framework
    //         auto-injects a `stop` tool the LLM can call when there's
    //         nothing meaningful to do — detect via toolName === "stop"
    //         and return.
    //         const picked = await ctx.llm.tools({
    //           tools: { respond: {…}, sendQuery: {…} },
    //           system: "...", prompt: "...",
    //         });

    // g) Spawn / kill OTHER nodes — requires authority. Drop if not needed.
    //    await ctx.spawn({ type: "echo", name: "child" });
    //    ctx.kill(otherId, "no longer needed");

    // h) Pre-emption — long LLM calls / fetches should pass `ctx.signal`
    //    so a higher-criticality incoming message can abort them.
    //    The next handler invocation gets ctx.wasPreempted = true and
    //    ctx.preemptionContext with the partial state.

    void parsed;
  }
};

export default handler;
