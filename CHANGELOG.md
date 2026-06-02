# Changelog

## 1.0.0 (2026-06-02)


### Features

* add BrainService and tools for node management and lifecycle orchestration ([6bab251](https://github.com/tibzejoker/brAIn-essentials/commit/6bab2510efe2d13c6d7725b45e4259959191b42a))
* add end-to-end tests for multi-service chain and enhance resilience handling ([ac4fb5b](https://github.com/tibzejoker/brAIn-essentials/commit/ac4fb5bed056d4d61e2ccba7d734e950f70c7231))
* add end-to-end tests for secret retrieval and workflows, enhance BrainService global access ([2e1d069](https://github.com/tibzejoker/brAIn-essentials/commit/2e1d069cf8bffa5ed257421d9c32b5a1b0202fa7))
* add file editing and searching tools for line-based operations ([fd09829](https://github.com/tibzejoker/brAIn-essentials/commit/fd09829f7ff963c9a004aa3594b58a756fa012c4))
* add logging functionality for nodes with retrieval endpoint and UI integration ([6baf446](https://github.com/tibzejoker/brAIn-essentials/commit/6baf44629ed95ca84929f234c59ebc758229819e))
* add service map generation to enhance task delegation and provide usage examples ([a3ea08d](https://github.com/tibzejoker/brAIn-essentials/commit/a3ea08d5d3e5aaf0c2c088e8a5f5fce833b18cd1))
* add type definitions for node configuration and events to enhance type safety and clarity ([9c727ae](https://github.com/tibzejoker/brAIn-essentials/commit/9c727ae5973693e429f7f8af18e84fa1e109949e))
* add UI for configuration management and conversation state control ([7d5643e](https://github.com/tibzejoker/brAIn-essentials/commit/7d5643e4c6eeaa3e41145ed36ee3069ba3f49b99))
* **attention:** new node bridging intent correlator → brAIn bus ([87706b1](https://github.com/tibzejoker/brAIn-essentials/commit/87706b161d3078fb4d1be31589ff01d6499f3089))
* **brain:** collapse 3 LLM-bound inputs into a single brain_input port ([#18](https://github.com/tibzejoker/brAIn-essentials/issues/18)) ([a870ceb](https://github.com/tibzejoker/brAIn-essentials/commit/a870cebc3c3b2d8bb698540fc175b7d6ca2d6cb8))
* **brain:** drop sleep/wake UI + unified model/CLI picker; developer node uses shared CLIRegistry.run; richer template ([#13](https://github.com/tibzejoker/brAIn-essentials/issues/13)) ([99b148f](https://github.com/tibzejoker/brAIn-essentials/commit/99b148fa7cdf445bf48911f4888b9c204d30495a))
* **brain:** use framework `stop` tool + sharpen routing prompt ([7327eb8](https://github.com/tibzejoker/brAIn-essentials/commit/7327eb81df481631bdd41cd1ab69b1675ed1a3b3))
* chat.reset cross-channel reset + dev node UI template ([#14](https://github.com/tibzejoker/brAIn-essentials/issues/14)) ([2c65ee0](https://github.com/tibzejoker/brAIn-essentials/commit/2c65ee04c51dd87305cb5fcb56b483eb135eaa84))
* **developer/template:** add per-node SQLite scaffold (better-sqlite3 + db.ts helper) ([341d484](https://github.com/tibzejoker/brAIn-essentials/commit/341d48478eafb1ffd3fb9f38640b87fcfcb4538e))
* **developer:** delete dynamic nodes + list every _dynamic workspace ([#23](https://github.com/tibzejoker/brAIn-essentials/issues/23)) ([24b6a78](https://github.com/tibzejoker/brAIn-essentials/commit/24b6a78c5d2bbe7f72e8a93f85c800f45f7bd52f))
* **developer:** file viewer + per-file git history + UI overhaul ([c1eb58a](https://github.com/tibzejoker/brAIn-essentials/commit/c1eb58aef278bce37a95ac743ceb79f0e4cda00c))
* **developer:** list/improve/files topics + auto-spawn + UI ([6aca112](https://github.com/tibzejoker/brAIn-essentials/commit/6aca1121f3f8f0d4600ae42d37bba054768e246f))
* **developer:** on-disk transcript history + spawn-fail fix (NOT NULL description) ([98fd927](https://github.com/tibzejoker/brAIn-essentials/commit/98fd927d34015f28f04660ed917f15f26a37512e))
* **developer:** ship a real on-disk scaffold — copy first, prompt the CLI to edit ([584eaba](https://github.com/tibzejoker/brAIn-essentials/commit/584eaba8e80b9e77794316f9f1390d18d8ee5bcb))
* enhance autonomy features for proactive behavior and self-improvement ([a9567a2](https://github.com/tibzejoker/brAIn-essentials/commit/a9567a261f37aa78346121663887a6a988e7f08a))
* enhance command execution with streaming output and improve topic selection in UI ([9befb0a](https://github.com/tibzejoker/brAIn-essentials/commit/9befb0aebe80e582f32f41646a91d30ffc3288e9))
* enhance conversation handling with wake and budget notifications, and improve sleep management ([eef5988](https://github.com/tibzejoker/brAIn-essentials/commit/eef5988adf0ac5d4000b90ffe0cfc37b2d0c9e88))
* enhance LLM response handling and improve message formatting ([5f52ff8](https://github.com/tibzejoker/brAIn-essentials/commit/5f52ff89148c58f1d07b52b199d394c3b4156de1))
* enhance message routing and tool call parsing with dynamic response handling ([b11f3d9](https://github.com/tibzejoker/brAIn-essentials/commit/b11f3d9579b7599169ec5e9317002b397a45f227))
* enhance node management with lifecycle orchestration and mailbox support ([bc572c2](https://github.com/tibzejoker/brAIn-essentials/commit/bc572c25aa61eca9bbf9f9b17982f52194ec0674))
* enhance node registration and spawning process with improved logging and error handling ([204f2ff](https://github.com/tibzejoker/brAIn-essentials/commit/204f2ff3b58902b09d7ced1b3456cfae28217200))
* implement BaseRunner class for lifecycle management and execution strategies ([95ab0cd](https://github.com/tibzejoker/brAIn-essentials/commit/95ab0cde4fe321cbf9f10cbfbf2128c3cdaf30d7))
* implement developer node for dynamic type creation with runtime configuration ([bdf6ca5](https://github.com/tibzejoker/brAIn-essentials/commit/bdf6ca5df302745a2563a6d553013c265b857721))
* implement developer node for dynamic type creation with runtime configuration ([558f89e](https://github.com/tibzejoker/brAIn-essentials/commit/558f89e4bfcd492a6b90b21652a0940f1fad1bdb))
* implement memory consolidator node for autonomous memory maintenance and cleanup ([f2d377b](https://github.com/tibzejoker/brAIn-essentials/commit/f2d377b6f8a43890c226a8d843799e047d519cfd))
* improve handling of LLM responses by refining text and reasoning extraction ([739e2c8](https://github.com/tibzejoker/brAIn-essentials/commit/739e2c86c1ec7363142d8fb19b6df91f8a1368d8))
* initialize voice-web project with TypeScript, Vite, and backend integration ([e110dbf](https://github.com/tibzejoker/brAIn-essentials/commit/e110dbf1422077dce21b6f68b6df13e22fbce04f))
* **llm:** add tool call support and use framework llm use everywhere ([f776069](https://github.com/tibzejoker/brAIn-essentials/commit/f776069c2df2cd02870c6f384d0c9dc9c8f0ead6))
* **mcp:** framework-level MCP exposure — per-node + federated HTTP ([38a7ca3](https://github.com/tibzejoker/brAIn-essentials/commit/38a7ca3c7751d2921a41279ce98118181702e5df))
* **mcp:** persist spawned_by, mcp-config federation hub, mcp-export ([1d16fa0](https://github.com/tibzejoker/brAIn-essentials/commit/1d16fa033b8172df1465b3bedfcbc61303825d45))
* **mcp:** split mcp-host into mcp-config (manager) + mcp-server (one per server) ([62f4b1d](https://github.com/tibzejoker/brAIn-essentials/commit/62f4b1d7d12c5e619fdfb6ec37f064882bc748ab))
* persist conversation history across iterations and manage context overflow ([ffb0350](https://github.com/tibzejoker/brAIn-essentials/commit/ffb0350127be23fe366491f1f56124be2ee015cb))
* refactor response handling to use ctx.respond and update default publishes order ([7b672ae](https://github.com/tibzejoker/brAIn-essentials/commit/7b672ae94a8098b07aa55eeca636f7fcf25c8ad9))
* refine autonomy guidelines for proactive behavior and memory usage ([1464791](https://github.com/tibzejoker/brAIn-essentials/commit/14647914adbf50ae78f0c73481f7141e0d24fc7e))
* **runner,nodes:** preemption mid-handler — for real ([a4c9dd3](https://github.com/tibzejoker/brAIn-essentials/commit/a4c9dd31ad8170d3643a64d781291b41dc4fb77f))
* **seeds:** ship chat, default, and echo-pingpong templates ([17ec259](https://github.com/tibzejoker/brAIn-essentials/commit/17ec2599381edf3b59ee0a0caee1bd5fd6b1f024))
* **skills:** brain auto-use, dev-template note, bundled skills ([#22](https://github.com/tibzejoker/brAIn-essentials/issues/22)) ([499aa98](https://github.com/tibzejoker/brAIn-essentials/commit/499aa98530737ee87d3140799794bcf50881ad3d))
* update CLI configuration and enhance node creation process with improved error handling ([eeb6b76](https://github.com/tibzejoker/brAIn-essentials/commit/eeb6b76ff81233a8cc3d47a7c1501f36b61f19f7))
* update model version to "ollama/gemma4:e4b" in configuration files ([d722d7a](https://github.com/tibzejoker/brAIn-essentials/commit/d722d7a44b94a51a27d1336da9e8fccef90e01ce))


### Bug Fixes

* **brain:** bind brain_input to brain.input, not brain.* ([#19](https://github.com/tibzejoker/brAIn-essentials/issues/19)) ([917d304](https://github.com/tibzejoker/brAIn-essentials/commit/917d304a32b6747a35871dbc538eedaf014e3394))
* **brain:** correct port schemas + rename user_response → brain_response ([#17](https://github.com/tibzejoker/brAIn-essentials/issues/17)) ([d409593](https://github.com/tibzejoker/brAIn-essentials/commit/d409593db2d00f135d0be3170a7df1d0a7933b6c))
* **brain:** drop legacy chat.input filters — the brain is the sole NLU gateway ([c6239a5](https://github.com/tibzejoker/brAIn-essentials/commit/c6239a5c8fb512f6272ab44d76835a16694ab76c))
* **brain:** explicit single-letter-during-game routing — "q" is a guess, not quit ([d767336](https://github.com/tibzejoker/brAIn-essentials/commit/d767336506e9ce25f0c090c43aab9d26f92d9d4e))
* **brain:** inject active-game state into the LLM context so single-letter inputs route as guesses ([66504f2](https://github.com/tibzejoker/brAIn-essentials/commit/66504f2b15491851f45e00178e10b77aa4add680))
* **brain:** split human input from callbacks in the iteration context ([7910f4c](https://github.com/tibzejoker/brAIn-essentials/commit/7910f4cbf54fe8c55e9b886b45ba7fa27454120f))
* **brain:** stop stringifying past tool calls into assistant.content ([#20](https://github.com/tibzejoker/brAIn-essentials/issues/20)) ([84ace3a](https://github.com/tibzejoker/brAIn-essentials/commit/84ace3a9a759f1244e0100f7a4da2f7cadfd3c04))
* **brain:** stop the LLM from butting into active games on chat.input ([08bf31e](https://github.com/tibzejoker/brAIn-essentials/commit/08bf31eed7bee0d5bace410cf6afc15d78aa733d))
* **brain:** trim conversation window 40 → 8 — local models lose tool-calling reliability past ~10 turns ([43b0757](https://github.com/tibzejoker/brAIn-essentials/commit/43b07577b79a37cb04cd975caef562b93254c272))
* **developer:** Windows + per-CLI flags + post-spawn rename + created-by-me registry ([0d5414d](https://github.com/tibzejoker/brAIn-essentials/commit/0d5414d2a135e0c01d826ab1078f67023a115131))
* drop brain.output vestige from brain + seeds ([#15](https://github.com/tibzejoker/brAIn-essentials/issues/15)) ([6b1f778](https://github.com/tibzejoker/brAIn-essentials/commit/6b1f7784c45949929c16dd0b370e72f3806b63e7))
* **mcp-server:** store OAuth tokens under the framework data root ([#12](https://github.com/tibzejoker/brAIn-essentials/issues/12)) ([810451e](https://github.com/tibzejoker/brAIn-essentials/commit/810451e75a337e436c1f1701b309a68f862e7eba))
* **runner:** bootstrap nodes with no subscriptions on start ([ca0ef0c](https://github.com/tibzejoker/brAIn-essentials/commit/ca0ef0ca198e106259122814ec345a2f30427d36))
* **seeds:** wire echo-pingpong through chat.input / chat.response ([2f7ac97](https://github.com/tibzejoker/brAIn-essentials/commit/2f7ac978f86d38062dbe19b897a42b7acc854dbf))


### Reverts

* **brain:** drop activeGames state cache — keep the brain game-agnostic ([80e2852](https://github.com/tibzejoker/brAIn-essentials/commit/80e285274e7623ffae0a0d256db652ace5c04abd))
