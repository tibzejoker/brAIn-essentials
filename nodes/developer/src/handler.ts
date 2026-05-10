import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { NodeContext, NodeHandler, TextPayload, Message, NodeInfo } from "@brain/sdk";
import { BrainService, CLIRegistry } from "@brain/core";
import { NODE_TEMPLATE_DOCS } from "./template";
import { v4 as uuid } from "uuid";

interface DevConfig {
  cli: string;
  timeout_ms: number;
  max_attempts: number;
}

interface WorkspaceMeta {
  slug: string;
  path: string;
  caller?: string;
  attempts: number;
  request: string;
  cli: string;
  mode: "create" | "improve";
}

interface WorkspacesState {
  [slug: string]: WorkspaceMeta;
}

/**
 * Persistent record of a node this dev instance has authored. Survives
 * across handler invocations / restarts via ctx.state — that's the dev
 * node's own little DB of "what I made". Used to:
 *   - Decide which on-disk workspaces dev.workspaces.list should flag
 *     as `created_by_me` vs found-on-disk-but-not-by-me.
 *   - Soft-validate dev.improve targets — warn (not block) if asked
 *     to improve a workspace this dev didn't create.
 */
interface CreatedRecord {
  slug: string;
  type_name: string;
  request: string;
  cli: string;
  created_at: number;
  attempts: number;
  improvements: number;
  last_modified_at: number;
}

interface CreatedRegistry {
  [slug: string]: CreatedRecord;
}

interface ValidationPayload {
  slug?: string;
  type_name?: string;
  phase?: string;
  errors?: string;
  path?: string;
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", ".dart_tool", ".pub-cache", "build",
  ".git", ".idea", ".vscode", "ios", "android", "windows", "macos", "linux",
]);

function getConfig(overrides: Record<string, unknown>): DevConfig {
  return {
    cli: (overrides.cli as string | undefined) ?? "claude",
    timeout_ms: (overrides.timeout_ms as number | undefined) ?? 300_000,
    max_attempts: (overrides.max_attempts as number | undefined) ?? 3,
  };
}

/**
 * Find brAIn's monorepo root — specifically brAIn (the framework repo),
 * not whichever sister repo this handler happens to be installed under.
 *
 * We anchor on `packages/sdk/package.json` containing `@brain/sdk`: a
 * marker only the framework root has. Sister repos have their own
 * `pnpm-workspace.yaml`, so just looking for that lands in the wrong
 * place when this node ships from `brAIn-essentials`.
 *
 * For the standard `npm create brain` layout the developer node lives
 * at `brain/storeprojects/brAIn-essentials/nodes/developer/`, so the
 * framework root (`brain/brAIn/`) is a SIBLING of an ancestor — never
 * an ancestor itself. We walk up from __dirname AND check each level's
 * `brAIn/` subdirectory for the SDK marker. cwd is the last fallback
 * for the case where this is invoked from inside the framework root.
 */
export function resolveMonorepoRoot(start: string = __dirname): string {
  function isFrameworkRoot(d: string): boolean {
    const sdkPkg = path.join(d, "packages", "sdk", "package.json");
    if (!fs.existsSync(sdkPkg)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(sdkPkg, "utf-8")) as { name?: string };
      return pkg.name === "@brain/sdk";
    } catch { return false; }
  }

  for (const origin of [start, process.cwd()]) {
    let dir = origin;
    for (let i = 0; i < 12; i++) {
      // Direct match: this dir IS the framework root.
      if (isFrameworkRoot(dir)) return dir;
      // Sibling match: this dir's `brAIn/` child IS the framework root.
      // Handles the canonical `npm create brain` layout where the dev
      // node is buried under `storeprojects/`.
      const siblingFramework = path.join(dir, "brAIn");
      if (isFrameworkRoot(siblingFramework)) return siblingFramework;

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

function getWorkspaces(state: Record<string, unknown>): WorkspacesState {
  if (!state.workspaces) state.workspaces = {};
  return state.workspaces as WorkspacesState;
}

function getCreated(state: Record<string, unknown>): CreatedRegistry {
  if (!state.created) state.created = {};
  return state.created as CreatedRegistry;
}

function parseValidationPayload(msg: Message): ValidationPayload {
  const content = (msg.payload as TextPayload).content;
  try {
    return JSON.parse(content) as ValidationPayload;
  } catch {
    return {};
  }
}

export function parseJsonContent(msg: Message): Record<string, unknown> {
  const content = (msg.payload as TextPayload).content ?? "";
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch { /* not JSON */ }
  // Fall back to metadata if the message used the typed envelope.
  if (msg.metadata && typeof msg.metadata === "object") {
    return msg.metadata as Record<string, unknown>;
  }
  return { content };
}

export function pickCli(overrides: Record<string, unknown>, msgMeta: Record<string, unknown> | undefined): string {
  const fromMsg = msgMeta && typeof msgMeta.cli === "string" ? (msgMeta.cli as string) : undefined;
  if (fromMsg) return fromMsg;
  return (overrides.cli as string | undefined) ?? "claude";
}

/**
 * Build CLI args for the supported code-authoring CLIs. All three accept
 * a prompt on stdin via `-p -`. Claude additionally takes turn caps and
 * the auto-permission bypass; codex/gemini reject those flags.
 */
export function buildCliArgs(cli: string): string[] {
  const stdinPrompt = ["-p", "-"];
  if (cli === "claude") {
    return [...stdinPrompt, "--max-turns", "40", "--dangerously-skip-permissions"];
  }
  // codex/gemini and any unknown CLI: stick to the portable subset.
  return stdinPrompt;
}

function runCli(
  cli: string,
  prompt: string,
  cwd: string,
  timeoutMs: number,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Direct spawn (no `sh -c` wrapper) so this works on Windows where
    // sh isn't in PATH. shell:true on win32 lets `.cmd` shims resolve.
    // Prompt goes via stdin — no temp file needed, no leak risk.
    const proc = spawn(cli, buildCliArgs(cli), {
      cwd,
      timeout: timeoutMs,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    proc.stdin.on("error", () => { /* CLI may close stdin early — ignore EPIPE */ });
    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split("\n").filter(Boolean)) onLine(line);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLine(`[stderr] ${line}`);
    });
    proc.on("close", (code) => resolve({ stdout, exitCode: code ?? 1 }));
    proc.on("error", (err) => {
      onLine(`[error] ${err.message}`);
      resolve({ stdout, exitCode: 1 });
    });
  });
}

function buildInitialPrompt(workspacePath: string, request: string): string {
  return `You are authoring a new brAIn node in: ${workspacePath}

${NODE_TEMPLATE_DOCS}

## Requested node
${request}

## Instructions
1. Create ALL required files (config.json, package.json, tsconfig.json, vitest.config.ts, src/handler.ts, tests/handler.test.ts) in ${workspacePath}.
2. Run: cd ${workspacePath} && pnpm install --no-frozen-lockfile && npx tsc && npx vitest run
3. Fix any compile or test errors, rebuild, retest until all pass.
4. Stop when \`dist/handler.js\` exists and \`npx vitest run\` exits 0.

Do NOT explain; just author and build. Do not attempt to register or spawn — the framework does that automatically once your build and tests pass.`;
}

function buildRetryPrompt(workspacePath: string, request: string, phase: string, errors: string): string {
  return `You previously attempted to create a brAIn node in ${workspacePath}. The framework's automatic validation rejected it.

## Original request
${request}

## Validation phase that failed
${phase}

## Errors reported by the framework
\`\`\`
${errors.slice(0, 6000)}
\`\`\`

## Your task
Fix the workspace in ${workspacePath} so validation passes. Do not create a new workspace.
Re-read the existing files, address the errors, rebuild (\`npx tsc\`), rerun tests (\`npx vitest run\`).
Remember: tests are MANDATORY, at least one test must pass, no \`console.log\`, no \`any\`.

${NODE_TEMPLATE_DOCS}`;
}

function buildImprovePrompt(workspacePath: string, request: string): string {
  return `You are IMPROVING an existing brAIn node already at: ${workspacePath}

## Improvement requested
${request}

## Instructions
1. Read EVERY file already in ${workspacePath} before changing anything — config.json, package.json, src/handler.ts, tests/handler.test.ts.
2. Make the smallest set of edits that satisfies the improvement. Don't rewrite from scratch.
3. Update tests to cover the new behaviour.
4. Run: cd ${workspacePath} && npx tsc && npx vitest run — until both pass.

Do NOT change the node's name in config.json (would break re-registration as the same type).
Do NOT explain; just edit, build, test.

${NODE_TEMPLATE_DOCS}`;
}

/** Per-job line buffer — flushed on a 1s timer to dev.progress so the
 *  UI sees movement without each line clogging /messages history. */
class ProgressBuffer {
  private buf: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: NodeContext,
    private readonly slug: string,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.flush(), 1000);
  }

  push(line: string): void {
    this.buf.push(line.slice(0, 400));
    if (this.buf.length > 200) this.buf.splice(0, this.buf.length - 200);
  }

  flush(): void {
    if (this.buf.length === 0) return;
    const lines = this.buf.splice(0);
    this.ctx.publish("dev.progress", {
      type: "text",
      criticality: 0,
      payload: { content: lines.join("\n") },
      metadata: { slug: this.slug, lines, ts: new Date().toISOString() },
    });
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush();
  }
}

/**
 * Append the prompt + full CLI output to the workspace's on-disk
 * history. One file per attempt: `.dev-history/<ts>-<mode>-attempt-<n>.log`.
 * Survives state wipes and dev-instance restarts; queryable via
 * `dev.history.list` / `dev.history.read`.
 */
function writeTranscript(
  ws: WorkspaceMeta,
  prompt: string,
  result: { stdout: string; exitCode: number },
  durationMs: number,
): void {
  try {
    const historyDir = path.join(ws.path, ".dev-history");
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}-${ws.mode}-attempt-${ws.attempts}.log`;
    const header = [
      "# brAIn dev transcript",
      `slug:        ${ws.slug}`,
      `mode:        ${ws.mode}`,
      `attempt:     ${ws.attempts}`,
      `cli:         ${ws.cli}`,
      `exit_code:   ${result.exitCode}`,
      `duration_ms: ${durationMs}`,
      `timestamp:   ${new Date().toISOString()}`,
      "",
      "## Request",
      ws.request,
      "",
      "## Prompt sent to CLI",
      prompt,
      "",
      "## CLI stdout",
    ].join("\n");
    fs.writeFileSync(path.join(historyDir, filename), header + "\n" + result.stdout, "utf-8");
  } catch {
    // Non-fatal — transcript write must never break the dev flow.
  }
}

async function runWorkspaceJob(
  ctx: NodeContext,
  ws: WorkspaceMeta,
  prompt: string,
  config: DevConfig,
): Promise<void> {
  ws.attempts += 1;
  ctx.log("info", `[${ws.slug}] attempt ${ws.attempts}/${config.max_attempts} (cli=${ws.cli}, mode=${ws.mode})`);
  const progress = new ProgressBuffer(ctx, ws.slug);
  progress.start();
  ctx.publish("dev.progress", {
    type: "text",
    criticality: 0,
    payload: { content: `start attempt ${ws.attempts}` },
    metadata: { slug: ws.slug, lines: [`▶ start attempt ${ws.attempts} via ${ws.cli}`], ts: new Date().toISOString() },
  });
  const startTs = Date.now();
  let result: { stdout: string; exitCode: number } | null = null;
  try {
    result = await runCli(ws.cli, prompt, path.dirname(ws.path), config.timeout_ms, (line) => {
      ctx.log("debug", `[${ws.slug}] ${line.slice(0, 200)}`);
      progress.push(line);
    }, ctx.signal);
    ctx.log("info", `[${ws.slug}] CLI exit ${result.exitCode}`);
    progress.push(`▶ CLI exit ${result.exitCode}`);
  } finally {
    progress.stop();
    if (result) writeTranscript(ws, prompt, result, Date.now() - startTs);
  }
}

async function handleNewRequest(
  ctx: NodeContext,
  msg: Message,
  workspaces: WorkspacesState,
  config: DevConfig,
  cliRegistry: CLIRegistry,
  monorepoRoot: string,
): Promise<void> {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>;
  const cli = pickCli(ctx.node.config_overrides ?? {}, meta);
  const payload = msg.payload as TextPayload;
  const request = payload.content;
  if (!request) return;

  if (!cliRegistry.isAvailable(cli)) {
    ctx.log("error", `CLI ${cli} not available`);
    ctx.respond(JSON.stringify({
      error: `CLI unavailable: ${cli}`,
      available: cliRegistry.getAvailableCLIs(),
    }));
    return;
  }

  const slug = `dev-${uuid().slice(0, 8)}`;
  const dynamicDir = path.join(monorepoRoot, "nodes", "_dynamic");
  if (!fs.existsSync(dynamicDir)) fs.mkdirSync(dynamicDir, { recursive: true });
  const workspacePath = path.join(dynamicDir, slug);
  fs.mkdirSync(workspacePath, { recursive: true });

  const ws: WorkspaceMeta = {
    slug, path: workspacePath,
    caller: msg.from, attempts: 0, request,
    cli, mode: "create",
  };
  workspaces[slug] = ws;
  ctx.log("info", `Creating workspace ${slug}`);
  await runWorkspaceJob(ctx, ws, buildInitialPrompt(workspacePath, request), config);
}

async function handleImproveRequest(
  ctx: NodeContext,
  msg: Message,
  workspaces: WorkspacesState,
  created: CreatedRegistry,
  config: DevConfig,
  cliRegistry: CLIRegistry,
  monorepoRoot: string,
): Promise<void> {
  const body = parseJsonContent(msg);
  const slug = typeof body.slug === "string" ? body.slug : undefined;
  const request = typeof body.request === "string"
    ? body.request
    : (typeof body.content === "string" ? body.content : "");
  if (!slug || !request) {
    ctx.respond(JSON.stringify({ error: "dev.improve requires {slug, request}" }));
    return;
  }
  const workspacePath = path.join(monorepoRoot, "nodes", "_dynamic", slug);
  if (!fs.existsSync(path.join(workspacePath, "config.json"))) {
    ctx.respond(JSON.stringify({ error: `unknown workspace: ${slug}` }));
    return;
  }
  const cli = pickCli(ctx.node.config_overrides ?? {}, body);
  if (!cliRegistry.isAvailable(cli)) {
    ctx.respond(JSON.stringify({
      error: `CLI unavailable: ${cli}`,
      available: cliRegistry.getAvailableCLIs(),
    }));
    return;
  }

  // Soft check — the dev's persistent registry of "things I made". Not a
  // hard block: a fresh dev instance (state wiped, workspace still on
  // disk) should still be able to improve. Just surface the mismatch.
  if (!(slug in created)) {
    ctx.log("warn", `[${slug}] improve target not in created-by-me registry — proceeding anyway`);
  }

  const ws: WorkspaceMeta = {
    slug, path: workspacePath,
    caller: msg.from, attempts: 0, request,
    cli, mode: "improve",
  };
  workspaces[slug] = ws;
  ctx.log("info", `Improving workspace ${slug}`);
  await runWorkspaceJob(ctx, ws, buildImprovePrompt(workspacePath, request), config);
}

async function handleValidationFeedback(
  ctx: NodeContext,
  msg: Message,
  workspaces: WorkspacesState,
  created: CreatedRegistry,
  config: DevConfig,
): Promise<void> {
  const data = parseValidationPayload(msg);
  if (!data.slug || !(data.slug in workspaces)) return;
  const ws = workspaces[data.slug];

  if (msg.topic === "types.registered" || msg.topic === "types.updated") {
    ctx.log("info", `[${ws.slug}] registered as '${data.type_name ?? "?"}'`);

    // Auto-spawn one live instance — only on first registration. On
    // updates the framework hot-swaps the existing instances by
    // type-name, no extra spawn needed.
    let instance: NodeInfo | null = null;
    if (msg.topic === "types.registered" && data.type_name) {
      try {
        instance = await ctx.spawn({
          type: data.type_name,
          name: data.type_name,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.log("warn", `[${ws.slug}] auto-spawn failed: ${message}`);
        ctx.publish("dev.spawned", {
          type: "text",
          criticality: 2,
          payload: { content: JSON.stringify({ slug: ws.slug, type_name: data.type_name, error: message }) },
          metadata: { slug: ws.slug, type_name: data.type_name, error: message, mode: ws.mode },
        });
      }

      // Rename `dev-<uuid>` → `<type_name>-<short_id>` for readability.
      // Done AFTER spawn so the in-memory handler is loaded from the old
      // path; framework re-scan on restart picks up the new name cleanly.
      const oldSlug = ws.slug;
      const shortId = oldSlug.replace(/^dev-/, "").slice(0, 8);
      const sanitized = data.type_name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 32);
      const newSlug = `${sanitized}-${shortId}`;
      const newPath = path.join(path.dirname(ws.path), newSlug);
      if (newSlug !== oldSlug && !fs.existsSync(newPath)) {
        try {
          fs.renameSync(ws.path, newPath);
          ws.path = newPath;
          ws.slug = newSlug;
        } catch (err) {
          ctx.log("warn", `[${oldSlug}] rename to ${newSlug} failed: ${String(err)} — keeping old slug`);
        }
      }

      if (instance) {
        ctx.publish("dev.spawned", {
          type: "text",
          criticality: 1,
          payload: { content: JSON.stringify({ slug: ws.slug, type_name: data.type_name, instance_id: instance.id }) },
          metadata: { slug: ws.slug, type_name: data.type_name, instance_id: instance.id, mode: ws.mode },
        });
      }
    }

    // Persistent "I made this" record — survives restarts.
    if (data.type_name) {
      const now = Date.now();
      if (msg.topic === "types.registered") {
        created[ws.slug] = {
          slug: ws.slug,
          type_name: data.type_name,
          request: ws.request,
          cli: ws.cli,
          created_at: now,
          attempts: ws.attempts,
          improvements: 0,
          last_modified_at: now,
        };
      } else {
        // types.updated — bump the existing record (or seed it if the
        // dev was restarted between create and improve).
        const existing = created[ws.slug];
        created[ws.slug] = existing
          ? { ...existing, improvements: existing.improvements + 1, attempts: ws.attempts, last_modified_at: now }
          : {
              slug: ws.slug, type_name: data.type_name, request: ws.request, cli: ws.cli,
              created_at: now, attempts: ws.attempts, improvements: 1, last_modified_at: now,
            };
      }
    }

    ctx.respond(JSON.stringify({
      status: "success",
      slug: ws.slug,
      type_name: data.type_name,
      path: ws.path,
      attempts: ws.attempts,
      mode: ws.mode,
      instance_id: instance?.id ?? null,
    }));
    // data.slug is the framework's view (pre-rename) — that's the key
    // we used to insert into workspaces. ws.slug may have changed via
    // the post-spawn rename above.
    delete workspaces[data.slug];
    return;
  }

  if (msg.topic === "types.validation_failed") {
    ctx.log("warn", `[${ws.slug}] validation failed (${data.phase}) attempt ${ws.attempts}/${config.max_attempts}`);
    if (ws.attempts >= config.max_attempts) {
      ctx.log("error", `[${ws.slug}] giving up after ${ws.attempts} attempts`);
      ctx.respond(JSON.stringify({
        status: "failed",
        slug: ws.slug,
        path: ws.path,
        phase: data.phase,
        errors: data.errors?.slice(0, 2000),
        attempts: ws.attempts,
        mode: ws.mode,
      }));
      delete workspaces[ws.slug];
      return;
    }
    await runWorkspaceJob(ctx, ws, buildRetryPrompt(ws.path, ws.request, data.phase ?? "unknown", data.errors ?? ""), config);
  }
}

interface WorkspaceSnapshot {
  slug: string;
  path: string;
  type_name: string | null;
  registered: boolean;
  instance_id: string | null;
  in_progress: boolean;
  attempts: number;
  files_count: number;
  modified_at: number;
  /** True when this slug is in this dev node's persistent created-by-me registry. */
  created_by_me: boolean;
  /** Number of dev.improve cycles applied to this node (0 if pristine). */
  improvements: number;
}

function readTypeName(workspacePath: string): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(workspacePath, "config.json"), "utf-8")) as { name?: unknown };
    return typeof cfg.name === "string" ? cfg.name : null;
  } catch { return null; }
}

function countFiles(dir: string, depthLeft = 4): number {
  if (depthLeft < 0 || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name), depthLeft - 1);
    else n += 1;
  }
  return n;
}

function snapshotWorkspaces(
  monorepoRoot: string,
  workspaces: WorkspacesState,
  created: CreatedRegistry,
): WorkspaceSnapshot[] {
  const dynamicDir = path.join(monorepoRoot, "nodes", "_dynamic");
  if (!fs.existsSync(dynamicDir)) return [];
  const brain = BrainService.current;
  const out: WorkspaceSnapshot[] = [];
  for (const e of fs.readdirSync(dynamicDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    // Include if: (a) in-progress (still has the dev- prefix from before
    // post-spawn rename), OR (b) recorded in our created registry (the
    // post-rename `<type_name>-<id>` form).
    const isOurs = e.name.startsWith("dev-") || e.name in created || e.name in workspaces;
    if (!isOurs) continue;
    const wsPath = path.join(dynamicDir, e.name);
    if (!fs.existsSync(path.join(wsPath, "config.json"))) continue;
    const typeName = readTypeName(wsPath);
    const registered = typeName !== null && (brain?.typeRegistry.has(typeName) ?? false);
    const liveInstance = registered && typeName
      ? (brain?.getNetworkSnapshot()?.find((n) => n.type === typeName) ?? null)
      : null;
    let modifiedAt = 0;
    try { modifiedAt = fs.statSync(wsPath).mtimeMs; } catch { /* ignore */ }
    const rec = created[e.name];
    out.push({
      slug: e.name,
      path: wsPath,
      type_name: typeName,
      registered,
      instance_id: liveInstance?.id ?? null,
      in_progress: e.name in workspaces,
      attempts: workspaces[e.name]?.attempts ?? rec?.attempts ?? 0,
      files_count: countFiles(wsPath),
      modified_at: modifiedAt,
      created_by_me: rec !== undefined,
      improvements: rec?.improvements ?? 0,
    });
  }
  return out.sort((a, b) => b.modified_at - a.modified_at);
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified_at?: number;
  children?: FileNode[];
}

export function readTree(root: string, rel = "", depthLeft = 5): FileNode[] {
  if (depthLeft < 0) return [];
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out: FileNode[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    if (e.name.startsWith(".") && e.name !== ".gitignore") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const childAbs = path.join(abs, e.name);
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(childAbs); } catch { /* gone */ }
    if (e.isDirectory()) {
      out.push({
        name: e.name, path: childRel, is_dir: true,
        modified_at: stat?.mtimeMs,
        children: readTree(root, childRel, depthLeft - 1),
      });
    } else {
      out.push({
        name: e.name, path: childRel, is_dir: false,
        size: stat?.size, modified_at: stat?.mtimeMs,
      });
    }
  }
  return out;
}

function publishWorkspaces(
  ctx: NodeContext,
  monorepoRoot: string,
  workspaces: WorkspacesState,
  created: CreatedRegistry,
): void {
  const items = snapshotWorkspaces(monorepoRoot, workspaces, created);
  ctx.publish("dev.workspaces", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ items }) },
    metadata: { items, ts: new Date().toISOString() },
  });
}

function publishFiles(ctx: NodeContext, monorepoRoot: string, msg: Message): void {
  const body = parseJsonContent(msg);
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!slug) {
    ctx.publish("dev.files", {
      type: "text",
      criticality: 1,
      payload: { content: JSON.stringify({ error: "missing slug" }) },
      metadata: { error: "missing slug" },
    });
    return;
  }
  const wsPath = path.join(monorepoRoot, "nodes", "_dynamic", slug);
  if (!fs.existsSync(wsPath)) {
    ctx.publish("dev.files", {
      type: "text",
      criticality: 1,
      payload: { content: JSON.stringify({ slug, error: "not found" }) },
      metadata: { slug, error: "not found" },
    });
    return;
  }
  const tree = readTree(wsPath);
  ctx.publish("dev.files", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ slug, tree }) },
    metadata: { slug, tree, ts: new Date().toISOString() },
  });
}

function publishCliList(ctx: NodeContext, cliRegistry: CLIRegistry, defaultCli: string): void {
  const available = cliRegistry.getAvailableCLIs();
  ctx.publish("dev.cli.available", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ clis: available, default: defaultCli }) },
    metadata: { clis: available, default: defaultCli },
  });
}

interface TranscriptEntry {
  slug: string;
  file: string;
  mode: string | null;
  attempt: number | null;
  ts: number;
  size: number;
}

const TRANSCRIPT_NAME_RE = /^(.+?)-(create|improve|retry)-attempt-(\d+)\.log$/;

function listHistory(monorepoRoot: string, slugFilter?: string): TranscriptEntry[] {
  const dynamicDir = path.join(monorepoRoot, "nodes", "_dynamic");
  if (!fs.existsSync(dynamicDir)) return [];
  const slugs = slugFilter
    ? [slugFilter]
    : fs.readdirSync(dynamicDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
  const out: TranscriptEntry[] = [];
  for (const slug of slugs) {
    const historyDir = path.join(dynamicDir, slug, ".dev-history");
    if (!fs.existsSync(historyDir)) continue;
    for (const e of fs.readdirSync(historyDir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".log")) continue;
      const filePath = path.join(historyDir, e.name);
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(filePath); } catch { continue; }
      const m = e.name.match(TRANSCRIPT_NAME_RE);
      out.push({
        slug,
        file: e.name,
        mode: m?.[2] ?? null,
        attempt: m ? Number(m[3]) : null,
        ts: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function publishHistoryList(ctx: NodeContext, monorepoRoot: string, msg: Message): void {
  const body = parseJsonContent(msg);
  const slug = typeof body.slug === "string" ? body.slug : undefined;
  const entries = listHistory(monorepoRoot, slug);
  ctx.publish("dev.history", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ slug, entries }) },
    metadata: { slug, entries, ts: new Date().toISOString() },
  });
}

function publishHistoryRead(ctx: NodeContext, monorepoRoot: string, msg: Message): void {
  const body = parseJsonContent(msg);
  const slug = typeof body.slug === "string" ? body.slug : "";
  const file = typeof body.file === "string" ? body.file : "";
  function emit(payload: Record<string, unknown>): void {
    ctx.publish("dev.history.content", {
      type: "text",
      criticality: 1,
      payload: { content: JSON.stringify(payload) },
      metadata: payload,
    });
  }
  if (!slug || !file) { emit({ error: "missing slug or file" }); return; }
  // Path traversal guard — file must be a basename within the workspace
  // dir's .dev-history folder, not a relative escape sequence.
  if (file.includes("..") || file.includes("/") || file.includes("\\")) {
    emit({ slug, file, error: "invalid file (path traversal)" });
    return;
  }
  const filePath = path.join(monorepoRoot, "nodes", "_dynamic", slug, ".dev-history", file);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    emit({ slug, file, content });
  } catch (err) {
    emit({ slug, file, error: String(err) });
  }
}

export const handler: NodeHandler = async (ctx) => {
  if (ctx.messages.length === 0) {
    ctx.sleep([{ type: "any" }]);
    return;
  }

  const config = getConfig(ctx.node.config_overrides ?? {});
  const cliRegistry = CLIRegistry.getInstance();
  await cliRegistry.initialize();
  const monorepoRoot = resolveMonorepoRoot();
  const workspaces = getWorkspaces(ctx.state);
  const created = getCreated(ctx.state);

  for (const msg of ctx.messages) {
    if (msg.topic === "dev.workspaces.list") {
      publishWorkspaces(ctx, monorepoRoot, workspaces, created);
      continue;
    }
    if (msg.topic === "dev.files.tree") {
      publishFiles(ctx, monorepoRoot, msg);
      continue;
    }
    if (msg.topic === "dev.cli.list") {
      publishCliList(ctx, cliRegistry, config.cli);
      continue;
    }
    if (msg.topic === "dev.history.list") {
      publishHistoryList(ctx, monorepoRoot, msg);
      continue;
    }
    if (msg.topic === "dev.history.read") {
      publishHistoryRead(ctx, monorepoRoot, msg);
      continue;
    }
    if (msg.topic === "dev.improve") {
      await handleImproveRequest(ctx, msg, workspaces, created, config, cliRegistry, monorepoRoot);
      continue;
    }
    if (msg.topic.startsWith("types.")) {
      await handleValidationFeedback(ctx, msg, workspaces, created, config);
      // Network changed — refresh the workspaces list for any UI listening.
      publishWorkspaces(ctx, monorepoRoot, workspaces, created);
      continue;
    }
    // Default: any other message is a "create new node" request. Keeps
    // dev.request as the canonical entry but also accepts whatever the
    // brain or chat node forwards (legacy behaviour).
    await handleNewRequest(ctx, msg, workspaces, config, cliRegistry, monorepoRoot);
  }
};
