<div align="center">

# ResearchOS

### A general-purpose, multi-agent AI Scientist with a Cursor-style chat workspace

**Hypothesize · Retrieve · Critique · Verify · Rank · Evolve · Synthesize**

A durable, long-horizon, multi-agent system that turns a research question into a grounded, reference-backed scientific proposal — and lets you steer the run live, the same way you steer a Cursor agent.

</div>

<br />

<p align="center">
  <img src="docs/screenshots/05-run-chat.png" alt="ResearchOS Run page — Cursor-style chat thread with the live multi-agent event stream, mid-run composer, skip/finish/stop controls" width="100%" />
</p>

<br />

---

## The problem

Real scientific research isn't a single prompt-and-response. It's a multi-day, multi-source, iterative loop: scan the literature, surface candidate mechanisms, draft hypotheses, critique them, hunt for confirming and refuting evidence in real papers and databases, rank competing ideas head-to-head, refine the survivors, and finally synthesize everything into a defensible, reference-backed write-up.

Almost no AI system in the wild actually does this end-to-end:

- **Chat assistants** can riff on a research idea, but they forget on the next turn, can't run multi-day loops, won't go pull primary sources from PubMed / OpenAlex / Crossref, and don't track which claims are actually supported versus speculative.
- **Single-agent "deep research" tools** typically produce one long summary from a few web searches and stop. They don't iterate, don't critique themselves with a separate agent, don't rank competing hypotheses, and don't survive a process restart.
- **Notebook-style multi-agent demos** (LangChain, LangGraph, AutoGen, etc.) show orchestration but rarely run for hours, almost never persist their full agent state to a real database, lose progress the moment something crashes, and give you no way to steer the run mid-flight short of killing the process.

A general-purpose AI Scientist needs four properties that none of those have together:

1. **Long-horizon.** It must run for hours-to-days on a single research question, compacting its own context as it grows, picking the next useful action dynamically rather than following a fixed script.
2. **Multi-agent and adversarial.** Different cognitive jobs — generating hypotheses, retrieving evidence, attacking your own hypotheses, ranking them head-to-head — need to be done by *different* specialized agents that can disagree with each other. A single agent talking to itself just produces confident, lightly-edited fiction.
3. **Durable and inspectable.** Every event, task, model call, source document, hypothesis, evidence row, ranking, debate, and checkpoint needs to be on disk in a real database that you can query, audit, and resume from.
4. **Steerable in real time.** The scientist running the run needs to be able to inject follow-up instructions, skip a step, disable an agent, hard-abort a stuck LLM call, extend the budget, or stop the loop early — without restarting the run or losing state.

**ResearchOS is built around all four of those constraints.**

<br />

---

## What is ResearchOS

ResearchOS is a production-grade, end-to-end **multi-agent AI Scientist platform** with a **Cursor-style chat workspace**. You give it a research question; it runs a durable supervisor loop in the background, streams every agent event back to your browser as a chat thread, and produces a fully-referenced research proposal with ranked hypotheses, evidence, debate transcripts, and a Markdown + PDF report — all stored relationally so you can browse, audit, and reproduce it later.

While the run is alive you can:

- **Send a follow-up message** that every downstream agent reads as a durable instruction.
- **Press Stop** to hard-abort the in-flight LLM call mid-stream.
- **Skip the current step** or **disable an agent** for the rest of the run (`/skip <agent>` or the per-agent button).
- **Extend the run** by `+30 min` / `+10 iters`, or **finish now** to terminate the loop and trigger the final report.
- **Attach Skills** — reusable markdown instructions that get injected into every agent's system prompt for that run.

The same harness drives a 30-second sanity-check run and a multi-hour deep-dive on a hard question. Nothing about the loop is hard-coded to one domain.

### The twelve agents

| Agent | Job |
|---|---|
| **InitializerAgent** | Parse the goal, normalize it, propose a multi-step retrieval + research plan, extract domain entities (genes, proteins, pathways, compounds, organisms). |
| **LiteratureRetrievalAgent** | Query PubMed (NCBI E-utilities), OpenAlex, and Crossref. Normalize, deduplicate by DOI / PMID / title, store as `SourceDocument`s, log every external call to `ToolCall`. |
| **DomainRetrievalAgent** | Pull structured domain data from ChEMBL (compounds), UniProt (proteins), and AlphaFold DB (structures) when relevant. |
| **GenerationAgent** | Propose new mechanistic hypotheses, each with explicit prior-knowledge basis, novelty / feasibility / impact priors, and falsification criteria. Validated by Zod. |
| **ProximityAgent** | Embed and cluster hypotheses by semantic similarity so duplicates collapse and complementary ideas get noticed. |
| **ReflectionAgent** | Critique each hypothesis: what's wrong, what's weak, what evidence is missing, what would change your mind. |
| **VerificationAgent** | For each claim in each hypothesis, search the actual source corpus and create `Evidence` rows tagged `supports` / `refutes` / `mixed` / `unsupported`. |
| **RankingAgent** | Run pairwise debate rounds between top hypotheses (real LLM judge, real arguments) and update Elo scores. Persisted as `DebateRound` + `Ranking` rows. |
| **EvolutionAgent** | Take top-ranked hypotheses and produce refined or combined offspring that fix weaknesses surfaced in critique and verification. |
| **CompletionAssessorAgent** | Decide whether the run has converged: confidence, gaps, recommended next action. Stops the loop or asks for another pass. |
| **MetaReviewAgent** | Synthesize everything into a 19-section final report (executive summary, prior work, hypotheses, evidence, methodology, risks, ethics, falsification, open questions, references, …). |
| **SupervisorAgent** | The conductor. Each tick: reload state, compact context, ask the assessor, pick the next agent, launch it under a Redis lock, verify the output, checkpoint, repeat. Honors `disabledAgents` and `skipCurrent` set by the user mid-run. |

### How a goal becomes a paper

```
goal ──► Initializer ──► Literature ─── DomainRetrieval ────────┐
                                                                ▼
                              Generation ◄──┐         (real sources stored
                                   │        │          with PMID/DOI/URL)
                                   ▼        │
                              Proximity     │
                                   │        │
                                   ▼        │
                              Reflection    │ ◄── EvolutionAgent
                                   │        │     refines / combines
                                   ▼        │     the top-ranked ideas
                              Verification  │
                                   │        │
                                   ▼        │
                               Ranking ─────┘
                                   │  (Elo + debate rounds persisted)
                                   ▼
                        CompletionAssessor ──► (not done? loop back)
                                   │
                                   ▼
                            MetaReview ──► Markdown + PDF + full audit trail
```

The Supervisor isn't a fixed pipeline through those boxes — it picks the next move every tick based on what's actually missing (no sources yet → schedule Literature; few hypotheses → schedule Generation; many unsupported claims → schedule Verification; confident enough → schedule MetaReview), what the user disabled, and what follow-up instructions the user dropped into the chat.

<br />

---

## The Cursor-style workspace

```
+----------------+                          +-----------------+        +-----------------+
|   Next.js 15   |  ←──── SSE events ────   |  BullMQ Worker  |  ←──→  |   PostgreSQL    |
|   App Router   |                          | research-runs   |        |   (Prisma)      |
+--------+-------+                          | SupervisorAgent |        +-----------------+
         │   ⇡ user composer                +-----------------+
         │       │                                  ⇡
         │       │ POST /messages                   │  Pub/Sub
         │       │ POST /interrupt                  │  research:control:run:<id>
         │       │ POST /skip                       │
         │       │ PATCH /config                    │
         │       ▼                                  │
         └─────► API ─────► publishControl ──► Redis ──► subscribeControl in harness
                                                                  │
                                                                  ▼
                                                       AbortController.abort()
                                                       on the in-flight Anthropic
                                                       streaming response.
```

- **The run page is a single chat thread.** Each `AgentEvent` becomes a colored bubble; user follow-ups render as right-aligned plain bubbles. No tabs to manage, no modal flows for the common case.
- **The composer is the single point of control.** Type a follow-up and press enter. Or type `/skip EvolutionAgent`, `/extend 30`, `/finish`, or `/pause` — slash commands map straight onto the same APIs the buttons use.
- **The "Stop" button is a hard abort.** It plumbs `AbortSignal` all the way through the model provider into the Anthropic SDK so it actually cancels the LLM call mid-stream, not just "after the next token".
- **The Extend menu is one click for the three things you actually want mid-run** — `+30 min runtime`, `+10 iterations`, or `Finish now` (lower the iteration cap so the supervisor terminates and the meta-review writes a partial report on what's been done).
- **The agent rail collapses into the header.** Each agent has a small Skip button on hover so disabling a specific stage for the rest of the run is one click.
- **The right-side inspector is a slide-over.** Evidence, sources, tasks. Hidden until you ask for it so the chat takes the full width.

<br />

---

## Skills

Skills are reusable markdown instructions you author once and attach to as many runs as you like. Every active skill gets injected into **every** agent's system prompt for that run via `composeSystem` — so a single "Mechanism first" skill influences how `GenerationAgent` proposes hypotheses, how `ReflectionAgent` critiques them, how `RankingAgent` debates them, and how `MetaReviewAgent` writes them up.

Two scopes:

- **Global** skills apply to runs in any project.
- **Project-scoped** skills are only offered as toggles on runs inside that project.

You manage them at `/skills` and toggle them per-run from the composer chip selector.

<p align="center">
  <img src="docs/screenshots/03-skills.png" alt="Skills page — three example skills: Mechanism first, Translatable to humans, Cite three sources, each shown as a card with name, description, scope badge, and body preview" width="100%" />
</p>

<br />

---

## Screenshots

### Dashboard

A single composer above the project list. Describe a research goal, optionally pick a project and skills, press `Launch run` (or `⌘↵`). One click from blank page to a running multi-agent loop.

<p align="center">
  <img src="docs/screenshots/02-dashboard.png" alt="Dashboard with the new one-shot NewRunComposer at the top, projects below, and recent runs list" width="100%" />
</p>

<br />

### Run page — Cursor-style chat workspace

The active phase, status, model, elapsed time, and the `Extend / Stop / Cancel / Duplicate / Inspector` controls live in a compact header. Everything else is the chat thread. The composer at the bottom carries the skill chips, the slash-command palette, the `skip step` and `finish now` shortcuts, and the red **Stop** button (visible while the run is active).

<p align="center">
  <img src="docs/screenshots/05-run-chat.png" alt="Run page — Cursor-style chat thread with the live multi-agent event stream as colored bubbles, the composer with skill chips and slash commands, and the Stop button" width="100%" />
</p>

<br />

### Project page

Each project lists its runs with status badges (`running` / `paused` / `completed` / `completed_with_limit` / `failed`).

<p align="center">
  <img src="docs/screenshots/04-project.png" alt="Project page with run list and a New run button" width="100%" />
</p>

<br />

### Sign in

Dark-first design, monospace accents, restrained purple for the primary action.

<p align="center">
  <img src="docs/screenshots/01-login.png" alt="Sign-in page" width="100%" />
</p>

<br />

### Settings → Models

Provider configuration with an in-app health check that verifies the Anthropic key is wired correctly.

<p align="center">
  <img src="docs/screenshots/06-settings-models.png" alt="Model settings page" width="100%" />
</p>

<br />

### Settings → Sources

Registry of all scientific source tools (PubMed, OpenAlex, Crossref, ChEMBL, UniProt, AlphaFold DB) with their default per-run limits.

<p align="center">
  <img src="docs/screenshots/07-settings-sources.png" alt="Sources settings page" width="100%" />
</p>

<br />

---

## Highlights

- **Cursor-style chat workspace.** Single-thread event stream, slash commands, skill chips, real hard-abort. No tab-switching for the common case.
- **Long-horizon harness, not a fixed pipeline.** A `SupervisorAgent` drives a durable loop: assess state → pick next agent → execute → verify output → checkpoint → repeat. Tasks are dynamic, not scripted.
- **Twelve specialized agents.** Initializer, LiteratureRetrieval, DomainRetrieval, Generation, Proximity, Reflection, Verification, Ranking (Elo), Evolution, CompletionAssessor, MetaReview, plus the Supervisor.
- **Mid-run controls.** `POST /api/runs/:id/messages` (follow-up), `POST /api/runs/:id/skip` (skip step or disable agent), `POST /api/runs/:id/interrupt` (hard abort), `PATCH /api/runs/:id/config` (extend or finish-now). Every control is also exposed in the chat composer and as a slash command.
- **Real Anthropic AbortSignal.** The provider plumbs `AbortSignal` into `@anthropic-ai/sdk` so the Stop button actually cancels the streaming response mid-token, not just after the next sample.
- **Redis Pub/Sub control channel.** A worker process running on a different machine still receives interrupts the moment the user clicks Stop. Local `EventEmitter` fallback for tests / single-process dev.
- **Skills library.** Reusable markdown instructions injected into every agent's system prompt via `composeSystem`. Scoped global or project. Toggle per-run from the composer.
- **Real scientific sources.** PubMed (NCBI E-utilities), OpenAlex, Crossref, ChEMBL, UniProt, AlphaFold DB. Normalized, deduplicated, and logged in `ToolCall`.
- **Durable, resumable, inspectable.** Postgres-backed sessions, tasks, events, memories, checkpoints. Restart the worker, refresh the browser, kill the process: the run resumes (boot scan + periodic stale-session sweep).
- **Anthropic-first model layer.** Provider interface + router + `safeGenerateJSON` (parse → repair → Zod-validate). Every LLM call recorded in `ModelCall`.
- **Premium B&W UI.** Dark-first, sharp typography, monospace IDs, restrained purple accent for status and progress.
- **Markdown + PDF exports.** `pdfkit` + `markdown-it` for professional black-and-white reports with full references.

<br />

---

## How mid-run controls work

```
User clicks Stop                       Worker harness
       │                                    ▲
       ▼                                    │
POST /api/runs/:id/interrupt                │ subscribeControl(runId)
       │                                    │
       ▼                                    │
service.interruptRun                        │
   ├─ emit AgentEvent (task_aborted)        │
   └─ publishControl({type:'interrupt'}) ───┘
                                            │
                                            ▼
                        currentAbortController.abort() ──► AnthropicProvider
                                                            generateText/JSON
                                                            cancels the
                                                            in-flight fetch.
                                            │
                                            ▼
                              harness catches AbortError, emits task_aborted,
                              session continues with the next supervisor tick.
```

The same channel carries `skip` (`agentName` optional, used to disable an agent for the rest of the run), `config_updated` (so the next supervisor tick re-reads `maxIterations` / `maxRuntimeMinutes`), and `user_message` (so the next agent re-reads recent `user_instruction` memories).

User follow-up messages are written as both:

1. An `AgentEvent` of type `user_message` (so the chat thread renders it).
2. An `AgentMemory` row of type `user_instruction` with `importanceScore: 0.95` (so `composeSystem` surfaces it in every downstream agent's prompt).

<br />

---

## Architecture

```
+----------------+        +-----------------+        +-----------------+
|   Next.js 15   |        |  BullMQ Worker  |        |   PostgreSQL    |
|   (App Router) |  <-->  | research-runs   |  <-->  |   (Prisma)      |
|   SSE stream   |        | SupervisorAgent |        |                 |
+----------------+        +-----------------+        +-----------------+
        |                          |                          ^
        |                          v                          |
        |                  +-------+--------+                  |
        |                  | 12 specialist  |                  |
        |                  |    Agents      |                  |
        |                  +-------+--------+                  |
        |                          |                          |
        |                          v                          |
        |          +-----------------------------+             |
        |          |       Anthropic API         |             |
        |          |    PubMed / OpenAlex        |             |
        |          |   Crossref / ChEMBL         |             |
        |          |   UniProt / AlphaFold       |             |
        |          +-----------------------------+             |
        |                                                      |
        +---------------- /api/runs/:id/stream ----------------+
                          (Server-Sent Events)
                                  |
                              +---+----+
                              |  Redis | — BullMQ queue + per-run locks + pubsub control
                              +--------+
```

### The long-horizon harness, step by step

1. **Reload state.** Run row (including `disabledAgents` and `skipCurrent`), session row, last checkpoint, recent events.
2. **Compact context.** Older events are summarized into `AgentMemory` rows so prompts stay bounded.
3. **Assess completion.** `CompletionAssessorAgent` produces a `CompletionAssessment` with confidence, gaps, and a recommended next action.
4. **Pick the next action.** `SupervisorAgent.pickNextAction` decides which agent to schedule based on state, gaps, budgets, and `disabledAgents` (each gate is bypassed if the agent is disabled).
5. **Execute the agent.** Inside a Redis lock per run; the agent emits `AgentEvent`s, calls Anthropic with the run's `AbortSignal`, and produces structured output validated by Zod. Skill body and recent user instructions are auto-injected into the agent's system prompt by `runAgentJson`.
6. **Honor user controls.** Control messages from `publishControl` are subscribed once per session. Interrupt or skip aborts the current step cleanly (`task_aborted` event); config changes are picked up on the next supervisor tick.
7. **Verify the output.** Per-agent verification predicates (e.g. *"literature created ≥ N sources"*, *"ranking moved Elo for top hypothesis"*). Failures retry up to N times with self-critique.
8. **Checkpoint.** Periodically writes `AgentCheckpoint` snapshots so a fresh worker can resume mid-run.
9. **Heartbeat.** The session row keeps a `lastHeartbeatAt`; on worker boot (and every ~40 s thereafter) stale sessions get re-enqueued.

This is what makes a run survive every kind of interruption: nothing useful lives only in process memory.

<br />

---

## Repository layout

```
/app                     Next.js App Router pages + API routes
  (auth)/                /login, /register
  (app)/                 Dashboard, Projects, Runs, Skills, Settings (protected)
  api/                   REST + SSE endpoints
    runs/[id]/
      messages           Mid-run follow-up message (user_message)
      interrupt          Hard-abort the in-flight LLM call
      skip               Skip current step / disable agent / re-enable
      config             PATCH maxIterations, maxRuntimeMinutes, addIterations, addRuntimeMinutes, finishNow
      skills             GET/PUT active skills for this run
    skills/              CRUD for the Skill library
/src
  components/
    new-run-composer.tsx Cursor-style one-click NewRunComposer for the dashboard
    skills/              Skill library UI (page + editor)
    run/                 run-view.tsx (chat thread), agent-rail, hypothesis-list, report-preview
    ui/                  shadcn/ui primitives
  lib/
    agents/
      core/
        harness.ts       The supervisor loop; subscribes to control channel
        supervisor.ts    pickNextAction; honors disabledAgents
        skills.ts        buildSkillsBlock, buildUserInstructionsBlock, composeSystem
        prompt.ts        runAgentJson — every agent's single LLM entry point
        events.ts        Event type taxonomy
      scientist/         The 12 specialized agents
    auth/                NextAuth v5 config, session helpers
    db/                  Prisma client singleton
    export/              Markdown + PDF exporters
    models/              Provider interface + AnthropicProvider (with AbortSignal), router, safe JSON
    queue/               BullMQ + Redis client singletons
    realtime/control.ts  Redis Pub/Sub control bus + local EventEmitter fallback
    runs/service.ts      Run lifecycle: create, pause, resume, cancel, updateRunConfig, skipStep, interruptRun, appendRunMessage
    skills/service.ts    Skill CRUD + setRunSkills/getActiveRunSkills
    sources/             PubMed, OpenAlex, Crossref, ChEMBL, UniProt, AlphaFold
    tools/               Generic ToolCall logger
    utils/               env, logger, ids, cn
  workers/               BullMQ worker entrypoint
/prisma                  schema.prisma, seed.ts, migrations
/scripts                 acceptance.sh, acceptance-smoke.sh, take_screenshots.py
/tests
  *.test.ts              Vitest unit + integration tests
  e2e/full-loop.spec.ts  Playwright end-to-end run loop test
/docs/screenshots        Images embedded above
docker-compose.yml       Postgres + Redis
.env.example             All required environment variables
```

<br />

---

## Prerequisites

- **Node.js ≥ 20**
- **pnpm 9.x** (enforced via `packageManager` in `package.json`)
- **Docker Desktop** (for Postgres + Redis via `docker compose`)
- **Anthropic API key** (real key required; the system never fabricates LLM outputs)

The bundled `docker-compose.yml` exposes Postgres on **host port 55432** and Redis on **host port 56379** so it never clashes with anything you already have on the standard ports.

<br />

---

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY and (optionally) NEXTAUTH_SECRET

# 3. Bring up Postgres + Redis
docker compose up -d

# 4. Apply database schema
pnpm db:migrate:dev

# 5. Seed a demo user (demo@researchos.local / password123) + sample project
pnpm db:seed

# 6. Run the dev server and the background worker in two terminals
pnpm dev       # Terminal 1: Next.js on :3000
pnpm worker    # Terminal 2: BullMQ worker (processes research-runs)
```

Open <http://localhost:3000>, log in with `demo@researchos.local` / `password123`, type a research goal into the dashboard composer, and press `Launch run`.

<br />

---

## Environment variables

See `.env.example`. The important ones:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `REDIS_URL` | yes | Redis connection string (BullMQ + run locks + control pubsub) |
| `NEXTAUTH_SECRET` | yes | NextAuth session secret |
| `NEXTAUTH_URL` | yes | e.g. `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key |
| `ANTHROPIC_MODEL` | no | Override the default model (default `claude-sonnet-4-5`) |
| `OPENALEX_EMAIL` | rec. | Polite pool for OpenAlex |
| `NCBI_API_KEY` | no | Higher rate limit for PubMed E-utilities |

Secrets never reach the browser. All third-party API keys are read server-side only.

<br />

---

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server with Turbopack on `:3000` |
| `pnpm worker` | BullMQ worker that drives the SupervisorAgent loop |
| `pnpm build` | `prisma generate` + `next build` |
| `pnpm start` | Production Next.js server |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit + integration test suite |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:e2e` | Playwright end-to-end full-loop spec |
| `pnpm db:migrate` | `prisma migrate deploy` (production) |
| `pnpm db:migrate:dev` | `prisma migrate dev` (development) |
| `pnpm db:seed` | Seed demo user + sample project |
| `pnpm db:reset` | Drop + recreate + re-migrate the database |
| `scripts/acceptance-smoke.sh` | Curl-based smoke check of every Cursor-style API surface |
| `scripts/acceptance.sh` | Full acceptance: register → skill → run → follow-up → skip → interrupt → finish → assert final report |

<br />

---

## Using the app

### 1. Register / log in

Visit `/register` to create an account, or use the seeded demo user.

### 2. Add skills (optional but recommended)

Go to `/skills` and create reusable instructions you want every agent on the run to honor — e.g. *"Mechanism first"*, *"Translatable to humans"*, *"Cite three sources per claim"*. Scope them global or to a specific project.

### 3. Start a research run

From the dashboard, type a goal into the composer, optionally pick a project and toggle skills via the chip selector, and press `Launch run` (or `⌘↵`). The run is enqueued onto BullMQ; the worker picks it up and the SupervisorAgent takes over.

### 4. Steer the run live

On the run page:

- **Send a follow-up.** Type into the composer and press Enter. The message becomes a high-importance memory that every downstream agent reads.
- **Stop.** Hard-abort the in-flight LLM call mid-stream.
- **Skip.** `skip step` button or `/skip` to skip just this step. `/skip EvolutionAgent` (or the per-agent button on the rail) to disable an agent for the rest of the run.
- **Extend.** `Extend ▾` menu — `+30 min runtime`, `+10 iterations`, or `Finish now`.
- **Open the inspector.** Right-side slide-over with Evidence / Sources / Tasks tabs when you want the structured detail.

Close the browser. Walk away. The run continues. When you return, the entire state is reconstructed from Postgres + replayed events.

### 5. Pause / resume / cancel

From the run header. Pause sets the next supervisor tick to `paused`, resume re-enqueues a job, cancel marks the run terminal.

### 6. Final report

When the `CompletionAssessor` decides the run is done (or `Finish now` is triggered), the `MetaReviewAgent` writes a `FinalReport`:

- **Markdown** body with all 19 sections (executive summary, problem, prior work, hypotheses, evidence, methodology, risks, ethics, future work, references, …).
- **PDF** export via `/api/runs/:id/export/pdf` — clean B&W, professional layout, full references.
- **Markdown** export via `/api/runs/:id/export/markdown`.

<br />

---

## Mid-run control API

| Endpoint | Method | Body | Effect |
| --- | --- | --- | --- |
| `/api/runs/:id/messages` | POST | `{ content }` | Writes a `user_message` event + `user_instruction` memory; surfaces in every downstream agent's system prompt. |
| `/api/runs/:id/interrupt` | POST | `{ reason? }` | Publishes a control-channel `interrupt`; the harness `AbortController.abort()`s the current step. |
| `/api/runs/:id/skip` | POST | `{ agentName?, currentOnly?, enable? }` | If `agentName`: toggle that agent on `disabledAgents`. If `currentOnly`: skip just the in-flight step. |
| `/api/runs/:id/config` | PATCH | `{ maxIterations?, maxRuntimeMinutes?, addIterations?, addRuntimeMinutes?, maxSources?, maxHypotheses?, finishNow? }` | Mutates run config; the supervisor re-reads on every tick. |
| `/api/runs/:id/skills` | GET / PUT | `{ skillIds: string[] }` | List / replace the set of skills active for this run. |
| `/api/skills` | GET / POST | Skill body | List or create skills. |
| `/api/skills/:id` | GET / PATCH / DELETE | Skill body | Read / update / delete a skill. |

All endpoints require the user to own the run; cross-user access returns 403.

<br />

---

## Tests

`pnpm test` runs the Vitest suite (48 tests, ~1 s):

| Suite | Coverage |
| --- | --- |
| `tests/safe-json.test.ts` | `extractJsonObject`, `safeGenerateJSON` repair + retry behavior |
| `tests/supervisor.test.ts` | Supervisor picks the correct next action and honors `disabledAgents` |
| `tests/ranking-elo.test.ts` | Elo update math used by `RankingAgent` |
| `tests/sources-dedupe.test.ts` | Cross-source document deduplication by DOI / PMID / title |
| `tests/markdown-export.test.ts` | PDF rendering produces a non-empty valid `%PDF-` buffer |
| `tests/verification-predicates.test.ts` | Per-agent post-execution verification predicates |
| `tests/run-service.test.ts` | Run lifecycle: create / access control / pause / resume / cancel |
| `tests/skills.test.ts` | Skill CRUD + `composeSystem` injection into agent prompts |
| `tests/control-channel.test.ts` | Redis Pub/Sub control bus + AbortSignal abort path |
| `tests/skip.test.ts` | `skipStep` flips `disabledAgents` and supervisor honors the disabled list |
| `tests/messages.test.ts` | `appendRunMessage` writes both an event and a `user_instruction` memory |
| `tests/runs-config.test.ts` | `updateRunConfig` honors absolute and delta patches plus `finishNow` |

`pnpm test:e2e` runs `tests/e2e/full-loop.spec.ts` (Playwright), which exercises the full chat-style flow end to end: register → create a skill → launch a run from the dashboard composer → send a follow-up → press Stop → `/skip <agent>` → `Finish now` → assert terminal status.

<br />

---

## Verified end-to-end

ResearchOS has been driven end-to-end against the real Anthropic API + real PubMed / OpenAlex / Crossref + Postgres + Redis, exercising every Cursor-style control:

- Register + login + project + skill + run-with-skillIds — all via the new API.
- The harness emitted the full ordered chain: `Run created → session_started → InitializerAgent.task_started → InitializerAgent.task_completed → LiteratureRetrievalAgent.task_started → LiteratureRetrievalAgent.task_completed → GenerationAgent.task_started → …`.
- A mid-run `POST /messages` ("Focus on mitochondrial mechanisms.") was written as both an event and a `user_instruction` memory and surfaced in subsequent agent prompts.
- A `POST /skip { agentName: "EvolutionAgent" }` added it to `disabledAgents`; the supervisor stopped scheduling that phase.
- A `POST /interrupt` aborted the in-flight Anthropic streaming call; the harness recorded `task_aborted` and continued.
- A `PATCH /config { finishNow: true }` lowered `maxIterations` to the current iteration; the harness emitted `budget_limit` and routed to `MetaReviewAgent`.
- `MetaReviewAgent.final_report_ready` produced a multi-KB Markdown report stored in `FinalReport`; the run terminated with status `completed_with_limit`.

Durability was previously verified by **killing the entire worker process tree mid-run**, waiting past the stale-session threshold, and restarting `pnpm worker`. The new worker reloaded the latest checkpoint and continued the run through Ranking → Evolution → MetaReview to completion.

<br />

---

## Adding a new model provider

1. Implement the `ModelProvider` interface in `src/lib/models/` (including the `signal?: AbortSignal` plumbing so the Stop button keeps working).
2. Register it in `src/lib/models/router.ts` for one or more agent purposes (`reasoning`, `summarization`, `hypothesisGeneration`, `critique`, `ranking`, `metaReview`, …).
3. Add env vars for credentials/models in `.env.example` and `src/lib/utils/env.ts`.
4. All calls automatically log to `ModelCall` via the provider base class.

## Adding a new scientific source

1. Create `src/lib/sources/<name>.ts` exporting a `search(input): Promise<SearchResult>` function.
2. Normalize records into `SourceDocument`-shaped objects (PMID / DOI / URL / title / abstract / year / authors).
3. Export it from `src/lib/sources/index.ts`.
4. Wire it into `LiteratureRetrievalAgent` (general) or `DomainRetrievalAgent` (domain-specific).
5. All HTTP calls go through `lib/sources/http.ts` (retry + timeout + ToolCall logging).

<br />

---

## Troubleshooting

### `prisma migrate` fails with `P1010: User denied access`

A host Postgres on `:5432` is intercepting the connection. The bundled `docker-compose.yml` already maps to `55432`; make sure your `DATABASE_URL` uses port **55432**:

```
postgresql://researchos:researchos@localhost:55432/researchos?schema=public
```

### Worker logs `safeJSON: extract failed` and retries

Expected: the harness automatically repairs malformed JSON from the model. After retries it falls back to a stricter prompt and either succeeds or marks the task `failed` for the supervisor to handle.

### A run is `running` but nothing is happening

1. Check the worker is up: `ps aux | grep workers/index`.
2. Check Redis: `docker compose logs redis`.
3. The session has a `lastHeartbeatAt`; if it hasn't moved in > 60 s and the worker is alive, look at recent `AgentEvent`s for `error` severity entries.
4. On worker boot (and every ~40 s thereafter) stale sessions are automatically re-enqueued.

### Anthropic 429 / overloaded

The provider already retries with backoff and the harness tolerates transient model failures. If sustained, lower concurrency in `src/workers/index.ts` or upgrade your Anthropic tier.

### Stop / Skip / Interrupt buttons don't seem to do anything

`REDIS_URL` is required for the control channel to span the API → worker process boundary. Without it, controls only propagate inside the same Node process (fine for unit tests, not for production). Confirm Redis is up: `docker compose ps`.

<br />

---

## License

MIT. See [`LICENSE`](LICENSE).
