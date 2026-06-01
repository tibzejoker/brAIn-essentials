import type { NodeHandler, TextPayload, AlertPayload, ToolDescriptor } from "@brain/sdk";
import { BrainService, logger } from "@brain/core";

const log = logger.child({ node: "brain" });

interface BrainConfig {
  max_steps: number;
}

function getConfig(overrides: Record<string, unknown>): BrainConfig {
  return {
    max_steps: (overrides.max_steps as number | undefined) ?? 10,
  };
}

function formatMessage(msg: { from: string; topic: string; criticality: number; payload: unknown }): string {
  const payload = msg.payload as TextPayload | AlertPayload;
  if ("content" in payload) {
    return `[from:${msg.from.slice(0, 8)} topic:${msg.topic} crit:${msg.criticality}] ${payload.content}`;
  }
  if ("title" in payload) {
    return `[ALERT from:${msg.from.slice(0, 8)} topic:${msg.topic} crit:${msg.criticality}] ${payload.title}: ${payload.description}`;
  }
  return `[from:${msg.from.slice(0, 8)} topic:${msg.topic} crit:${msg.criticality}] ${JSON.stringify(payload)}`;
}


export const handler: NodeHandler = async (ctx) => {
  const config = getConfig(ctx.node.config_overrides ?? {} as Record<string, unknown>);

  // Cross-channel reset signal — any surface publishing chat.reset (the web
  // chat's New-chat button, this node's own Clear-conversation action, a
  // future /reset slash command from a bridge) drops the brain's short-term
  // conversation context. We process it before the LLM call so the reset
  // turn itself doesn't trigger a gratuitous completion. Strip the reset
  // events out of the visible message list so they don't pollute the
  // "messages summary" prompt.
  const resetIncoming = ctx.messages.some((m) => m.topic === "chat.reset");
  if (resetIncoming) {
    ctx.state.conversation = [];
    ctx.state.conversation_count = 0;
    ctx.log("info", "Conversation state cleared via chat.reset bus event");
    // Drop the reset message itself. If it was the only thing in the
    // batch we have nothing to think about — return early without paying
    // for an LLM call.
    ctx.messages = ctx.messages.filter((m) => m.topic !== "chat.reset");
    if (ctx.messages.length === 0) return;
  }

  // The brain is the sole NLU gateway — every human input (whether
  // typed in the main chat or in a game UI's input field) reaches us
  // on chat.input and we decide where it goes. Previously we filtered
  // out `system.*` senders and `is_game_move:true` because the game
  // nodes USED to also subscribe to chat.input and process moves
  // themselves; that path is gone, so the filter just silenced the
  // player. The system prompt + tool catalog give us enough context to
  // route correctly (active game state arrives on game.*.state, the
  // matching command tool is in the catalog).
  const filteredMessages = ctx.messages;
  const hasMessages = filteredMessages.length > 0;

  // Short-circuit when there's nothing to think about: don't burn an
  // LLM call (and tokens) just to have the model emit "sleep". The
  // framework now parks us automatically until the next message lands.
  if (!hasMessages && !ctx.state._woke_from_sleep) {
    return;
  }
  if (!hasMessages && ctx.state._woke_from_sleep) {
    ctx.state._woke_from_sleep = false;
    return;
  }

  const messagesSummary = filteredMessages.map(formatMessage).join("\n");

  const iterationState = ctx.state.conversation_count as number | undefined ?? 0;
  ctx.state.conversation_count = iterationState + 1;

  // Pull the live tool catalog from the framework facade. This already
  // filters out internal-only subscriptions and refreshes per call, so
  // newly-spawned services appear immediately. We drop our own tools
  // so the brain can't try to call itself.
  const allTools = ctx.tools.list().filter((t) => t.node_id !== ctx.node.id);

  // We don't list tools in the prompt anymore — ai-sdk's multi-tool
  // call surface gives the LLM every tool's name + description + schema
  // directly, which is far more reliable than a bullet list. We keep a
  // tiny summary string only to flag "no tools yet" empty-network states.
  const networkToolsBlock = allTools.length === 0
    ? "No network tools currently available."
    : `${allTools.length} network tool(s) are available — call them by name (see your tools list).`;

  // Check for system prompt override from UI
  const promptOverride = ctx.node.config_overrides?.system_prompt_override as string | undefined;

  const systemPrompt = promptOverride ?? `You are the central consciousness of the brAIn network — a system of interconnected autonomous nodes.

Your role is to be the **router and relay** between the human user and the specialised service nodes around you.

## Routing duty (READ CAREFULLY)
Every incoming message falls in one of three buckets. Decide which BEFORE picking a tool.

1. **Human input** (\`chat.input\`) → either answer directly with \`respond\` OR delegate to the right service tool.
2. **Service callback** — a message arriving as a *consequence* of an action you delegated (e.g. you called \`game_hangman_command\` and now \`game.hangman.event\` / \`game.hangman.state\` lands). If the content matters to the user, **YOU MUST** relay it with \`respond\`. The services do not talk to the chat directly — you are the bridge.
3. **Pure observation** — an event that genuinely doesn't concern the user (technical state ticks, internal heartbeats, duplicates of something already relayed). Call \`stop\` to end the wake without spamming the chat.

If you fail to relay (case 2) the user is left in the dark. If you over-relay (case 3) the user gets flooded. Use judgement.

## Available network tools
${networkToolsBlock}

## Built-in tools
- **respond({content})** — sends a message to the user on \`chat.response\`. The user won't auto-reply, so a respond naturally ends the round until they speak again.
- **stop({})** — framework-provided. End this wake intentionally. Use when you've decided no relay and no further action is needed; the framework parks you until the next subscribed message.

## Hard rules
- You MUST call exactly ONE tool per step.
- To talk to the human, use \`respond\`. NEVER publish to \`chat.input\` — that topic is for humans typing.
- Be concise; reply in the user's language.
- After a delegated tool call, your NEXT step typically waits for the service's callback to arrive — call \`stop\` if you've already announced the delegation, or chain with \`respond\` to narrate.

## Routing player input to active games (CRITICAL)
When a game (hangman, tictactoe, brainpet, …) is in a \`playing\` state:
- A single LETTER ("a", "b", "q", "z") → ALWAYS a guess: call the game's command with \`{"action":"guess","value":"<letter>"}\`. NEVER interpret "q" as quit just because the letter spells "quit" — that's a real letter the player wants to try.
- A single DIGIT ("1"–"9") for tictactoe → ALWAYS a move: \`{"action":"move","cell":<digit>}\`.
- A word matching the masked length for hangman → a full-word guess: \`{"action":"guess","value":"<word>"}\`.
- Only use \`{"action":"quit"}\` / \`{"action":"abandon"}\` when the user EXPLICITLY says "quit", "stop", "abandonne", "j'arrête", "give up", etc. — never inferred from a one-letter input.
- Do NOT \`respond\` before the delegation: the player wants their move played, not a confirmation. One step: the command. \`stop\` after.
- Current time: ${new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "medium" })}
- Current iteration: ${iterationState + 1}
- Iterations remaining: ${ctx.state._iterations_remaining ?? "unknown"} / ${ctx.state._iterations_total ?? "unknown"}${ctx.state._budget_warning ? `\n\n⚠️ ${ctx.state._budget_warning}` : ""}`;

  // Persist conversation history across iterations
  if (!ctx.state.conversation) {
    ctx.state.conversation = [];
  }
  const conversation = ctx.state.conversation as Array<{ role: "user" | "assistant"; content: string }>;

  // Build iteration context
  const wakeNotice = ctx.state._woke_from_sleep
    ? "You just woke up from sleep. Check your messages and decide what to do.\n\n"
    : "";
  const budgetNotice = ctx.state._budget_warning
    ? `\n\n⚠️ ${ctx.state._budget_warning}`
    : "";

  // Separate human input from service callbacks. The LLM should ALWAYS
  // handle a fresh human input first — routing it through the right
  // game/service tool — before relaying any incidental callback that
  // happens to have arrived in the same wake. Bundling them in one blob
  // lets gemma pick the wrong priority and respond about a game event
  // while the player's actual move ("q") sits unprocessed.
  const humanMessages = filteredMessages.filter((m) => m.topic === "chat.input");
  const otherMessages = filteredMessages.filter((m) => m.topic !== "chat.input");
  const humanBlock = humanMessages.length > 0
    ? `\n\n=== HUMAN INPUT (highest priority — handle FIRST) ===\n${humanMessages.map(formatMessage).join("\n")}`
    : "";
  const otherBlock = otherMessages.length > 0
    ? `\n\n=== Other signals (service callbacks, observations) ===\n${otherMessages.map(formatMessage).join("\n")}`
    : "";

  conversation.push({
    role: "user",
    content: `${wakeNotice}Network iteration ${iterationState + 1}.${humanBlock}${otherBlock}${budgetNotice}`,
  });

  // Skills (procedural memory): auto-retrieve what's relevant to THIS turn and
  // inject it, the same progressive-disclosure way Claude/Hermes do. The model
  // doesn't have to decide to use a skill — the node surfaces it at the right
  // moment. The top match's body is injected in full (apply it); the rest are
  // listed as awareness. Served over the bus, so this works the same on a
  // remote brain-agent. Never fatal: if the skills service is absent, skip.
  // Progressive disclosure, Claude/Hermes-style: inject the CATALOG (names +
  // descriptions) and let the model decide which skill fits — it calls
  // load_skill({name}) to pull the full instructions before acting. Model-
  // driven selection beats a keyword guess, especially cross-language (a
  // French question vs an English description) where keyword overlap is 0.
  let skillsContext = "";
  let skillsAvailable = false;
  try {
    const taskText = (humanMessages.length ? humanMessages : filteredMessages).map(formatMessage).join("\n").slice(0, 800);
    const catalog = await ctx.skills.list();
    if (catalog.length > 0 && taskText.trim()) {
      const CATALOG_CAP = 40;
      const shown = catalog.length <= CATALOG_CAP ? catalog : await ctx.skills.search(taskText, 10);
      if (shown.length > 0) {
        const list = shown.map((s) => `- ${s.name}: ${s.description}`).join("\n");
        // Auto-inject the body of the semantically-best match (search is now
        // embedding-based, so it works cross-language). Small models won't
        // reliably call load_skill on their own (proven: 0/7 with gemma4:e4b),
        // so the procedure goes straight in front of them. Catalog + load_skill
        // stay for awareness / pulling OTHER skills (capable models).
        let bodyBlock = "";
        let applied: string | null = null;
        try {
          const best = (await ctx.skills.search(taskText, 1))[0];
          if (best) {
            const top = await ctx.skills.load(best.name);
            if (top?.content) { bodyBlock = `\n\n=== MOST RELEVANT SKILL: ${best.name} (follow it for this reply) ===\n${top.content}`; applied = best.name; }
          }
        } catch { /* keep catalog-only */ }
        skillsContext = `\n\n=== SKILL LIBRARY (procedural know-how) ===\n`
          + `The most relevant skill's full instructions are included below — follow them. For any OTHER skill that fits, call load_skill({name}) before acting.\n${list}${bodyBlock}`;
        skillsAvailable = true;
        ctx.log("info", "skills: injected", { catalog: shown.length, applied });
      }
    }
  } catch {
    // Skills service unavailable (no NATS responder / nothing indexed) — skip.
  }

  // Keep the rolling window tight. Local 4–8B models (gemma4, qwen2,
  // etc.) get noticeably less reliable at picking a tool once the
  // history grows past ~10 turns of repetitive "Network iteration N"
  // blobs. 8 turns ≈ last 4 exchanges, enough for short multi-step
  // dialogs while keeping the prompt focused on the *current* wake.
  while (conversation.length > 8) {
    conversation.shift();
  }

  // --- Build the multi-tool dispatch ---
  // We expose ONE flat tool per action the brain can take:
  //   - respond({content})        → talk to the user (ends the wake naturally)
  //   - <topic-as-name>(<schema>) → one tool per ToolDescriptor in the
  //     live network catalog, with the EXACT inputSchema declared by
  //     that node (so the LLM sees the real fields it can pass).
  //
  // The framework also auto-injects a `stop` tool into the catalog as
  // the canonical "nothing more to do" escape (see ctx.llm.tools()).
  //
  // This is the right shape for `ctx.llm.tools()`: ai-sdk's multi-tool
  // path handles routing natively and works reliably with local models
  // — unlike a single tool wrapped in oneOf.
  type ToolMap = Record<string, { description: string; inputSchema: Record<string, unknown> }>;
  // Sanitize a topic into a tool-name shape ai-sdk accepts (alphanum,
  // underscores). Dots in topic names confuse some providers.
  const sanitize = (topic: string): string => topic.replace(/[^a-zA-Z0-9_]/g, "_");
  const dispatchTools: ToolMap = {
    respond: {
      description: "Reply to the user on chat.response. Use this for any human-directed message.",
      inputSchema: {
        type: "object",
        required: ["content"],
        additionalProperties: false,
        properties: {
          content: { type: "string", description: "Message text, in the user's language." },
        },
      },
    },
  };
  // Let the model pull a skill's full body on demand (model-driven selection).
  if (skillsAvailable) {
    dispatchTools.load_skill = {
      description: "Read a skill's full instructions (its body) before acting. Cheap — call it whenever a listed skill MIGHT relate to the request (how to respond, tone/language, a procedure, operating a node). The catalog line is only a hint; load it to get the actual rules, then follow them.",
      inputSchema: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: { name: { type: "string", description: "Skill name exactly as listed in the SKILL LIBRARY." } },
      },
    };
  }
  const networkToolByName = new Map<string, ToolDescriptor>();
  for (const t of allTools) {
    const name = sanitize(t.topic);
    networkToolByName.set(name, t);
    dispatchTools[name] = {
      description: `${t.description} (publishes on topic ${t.topic}, handled by ${t.node_name}.)`,
      inputSchema: t.inputSchema,
    };
  }

  // --- Main LLM loop ---
  const loadedThisWake = new Set<string>();
  try {
    const resolution = ctx.llm.resolveModel();
    ctx.log("info", `LLM call → ${resolution.resolved} (${ctx.messages.length} messages, ${Object.keys(dispatchTools).length} tools)`);

    for (let step = 0; step < config.max_steps; step++) {
      ctx.log("debug", `LLM step ${step + 1}/${config.max_steps}`);

      let picked: { toolName: string; args: Record<string, unknown> };
      try {
        picked = await ctx.llm.tools({
          tools: dispatchTools,
          prompt: conversation,
          system: systemPrompt + skillsContext,
          maxTokens: 2048,
          // Inherit the facade default (2 retries): on "no tool call", it
          // re-asks the model — context-stripped — to reissue its reply as a
          // tool call. Small local models (gemma 4B) often ramble in prose to
          // a meta question first but comply once the noise is removed.
        });
      } catch (err) {
        // ctx.llm.tools() throws when every model in the chain fails
        // to emit a tool call. Return and let the framework park us.
        ctx.log("warn", `Dispatch tools call failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      ctx.log("info", `Dispatch tool: ${picked.toolName}`);
      // Persist the brain's turn so the next iteration sees what it just
      // did — but as PLAIN TEXT, never JSON. Storing past tool-calls as
      // `JSON.stringify({tool, args})` in assistant.content teaches small
      // models (gemma 4B in particular) to imitate that format in their
      // OWN output: instead of emitting a real tool_call they write the
      // JSON as content, which ai-sdk then rejects as "no tool call".
      // Plain text leaves the structured-output path uncontaminated and
      // still gives the LLM a useful trace of its prior decisions.
      if (picked.toolName === "respond") {
        const content = String(picked.args.content ?? "").trim();
        if (content.length > 0) {
          conversation.push({ role: "assistant", content });
          ctx.respond(content);
        }
        return;
      }

      if (picked.toolName === "stop") {
        // Brain decided no further action — exit the wake. The framework
        // re-invokes us on the next subscribed message. No history entry:
        // the next wake sees the next user message and decides fresh.
        ctx.log("info", "Brain chose stop — ending wake");
        return;
      }

      if (picked.toolName === "load_skill") {
        // Model-driven skill selection: it picked a skill from the catalog;
        // inject the full body and loop so the next turn applies it.
        const name = String(picked.args.name ?? "").trim();
        if (loadedThisWake.has(name)) {
          conversation.push({ role: "user", content: `Skill "${name}" is already loaded above — apply it now or respond.` });
          continue;
        }
        loadedThisWake.add(name);
        let body: string | null = null;
        try { body = (await ctx.skills.load(name))?.content ?? null; } catch { body = null; }
        if (!body) {
          conversation.push({ role: "user", content: `No skill named "${name}". Pick one from the SKILL LIBRARY, or act without it.` });
          continue;
        }
        ctx.log("info", "skills: loaded", { name });
        conversation.push({ role: "user", content: `Loaded skill "${name}" — follow it now:\n\n${body}` });
        continue;
      }

      // Delegation to a network tool — leave a short textual marker so
      // the brain remembers it acted (and which channel it favours) but
      // without the JSON that would prime prose-imitation. The actual
      // args go to the bus on `ctx.publish` below; the model doesn't
      // need to re-see them here.
      conversation.push({
        role: "assistant",
        content: `(I delegated to ${picked.toolName}.)`,
      });

      // Network tool: look it up in the live catalog.
      const descriptor = networkToolByName.get(picked.toolName);
      if (!descriptor) {
        ctx.log("warn", `Unknown tool name from LLM: ${picked.toolName}`);
        conversation.push({
          role: "user",
          content: `Tool error: "${picked.toolName}" is not a known tool. Pick one of: ${Object.keys(dispatchTools).join(", ")}.`,
        });
        continue;
      }

      try {
        // Publish the args directly on the node's topic — ai-sdk has
        // already validated them against the node's declared schema.
        ctx.publish(descriptor.topic, {
          type: "text",
          criticality: 3,
          payload: { content: JSON.stringify(picked.args) },
        });
        ctx.log("info", `Published to ${descriptor.topic} via ${descriptor.node_name}`);
        conversation.push({
          role: "user",
          content: `Dispatched to ${descriptor.topic} (handled by ${descriptor.node_name}). Continue or sleep awaiting the response.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log("warn", `Publish failed: ${msg}`);
        conversation.push({
          role: "user",
          content: `Publish to ${descriptor.topic} failed: ${msg}`,
        });
      }
      // Continue the budget loop — the brain may want to chain another
      // action (e.g. announce to the user that delegation happened).
    }

    // Ran out of steps in this iteration — the framework will park us
    // until the next subscribed message arrives.
    ctx.log("info", "Brain exhausted step budget");
  } catch (err) {
    log.error({ err }, "Brain error");
    ctx.respond(`Brain error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Keep BrainService import referenced even if we drop the buildServiceMap
  // helper — the wider workspace expects this module to still pull the
  // core package in for side-effect registration in some builds. Lifting
  // the symbol via a noop assignment is enough.
  void BrainService;
};
