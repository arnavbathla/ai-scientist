# ResearchOS — a general-purpose multi-agent AI Scientist

> **Hypothesize. Retrieve. Critique. Verify. Rank. Evolve. Synthesize.**
> A durable, long-horizon, multi-agent system that turns a research question into a grounded scientific proposal.

![Run page — three-pane view with agent rail, live event stream, hypotheses with Elo, evidence, sources](docs/screenshots/04-run.png)

---

## The problem

Real scientific research isn't a single prompt-and-response. It's a multi-week, multi-source, deeply iterative loop: scan the literature, surface candidate mechanisms, draft hypotheses, critique them, hunt for confirming/refuting evidence in real papers and databases, rank competing ideas against each other, refine the survivors, check for safety/ethics issues, and finally synthesize everything into a defensible, reference-backed write-up. Almost no AI system in the wild actually does this:

- **Chat assistants** can riff on a research idea but they forget on the next turn, can't run multi-day loops, won't go pull primary sources from PubMed/OpenAlex/Crossref, and don't track which claims are actually supported versus speculative.
- **Single-agent "deep research" tools** typically produce one long summary from a few web searches and stop. They don't iterate, they don't critique themselves with a separate agent, they don't rank competing hypotheses, and they don't survive a process restart.
- **Notebook-style workflows** (LangChain/LangGraph demos, etc.) demonstrate orchestration but rarely run for hours, almost never persist their full agent state, and lose progress the moment something crashes.

A general-purpose AI Scientist needs to be different in three concrete ways:

1. **Long-horizon.** It must run for hours-to-days on a single research question, compacting its own context as it grows, picking the next useful action dynamically rather than following a fixed script.
2. **Multi-agent and adversarial.** Different cognitive jobs — generating hypotheses, retrieving evidence, attacking your own hypotheses, ranking them head-to-head — need to be done by *different* specialized agents that can disagree with each other. A single agent talking to itself just produces confident, lightly-edited fiction.
3. **Durable and inspectable.** Every event, task, model call, source document, hypothesis, evidence row, ranking, debate, and checkpoint needs to be on disk in a database that you can query, audit, and resume from. Otherwise it isn't a research tool, it's a demo.

**ResearchOS is built around all three of those constraints.**

---

## What is ResearchOS

ResearchOS is a production-grade, end-to-end **multi-agent AI Scientist platform**. You give it a research question (and optional constraints, sources, and budgets); it runs a durable supervisor loop in the background and produces a fully-referenced research proposal with ranked hypotheses, evidence, debate transcripts, safety review, and a Markdown + PDF report — all stored relationally so you can browse and reproduce it later.

The same harness that drives a 30-second sanity-check run drives a multi-hour deep-dive on a hard question. Nothing about the loop is hard-coded to one domain: you can point it at cellular aging, catalyst design, RNA biology, condensed-matter physics, or any other question where the answer lives in published literature plus structured domain data.

### The thirteen agents

| Agent | Job |
|---|---|
| **InitializerAgent** | Parse the goal, normalize it, propose a multi-step retrieval + research plan, extract domain entities (genes, proteins, pathways, compounds, organisms). |
| **SafetyAgent** | Run a deterministic policy screen + LLM review at intake, after every generation pass, and on the final report. Block harmful goals; suggest safer reformulations. |
| **LiteratureRetrievalAgent** | Query PubMed (NCBI E-utilities), OpenAlex, and Crossref. Normalize, deduplicate by DOI/PMID/title, store as `SourceDocument`s, log every external call to `ToolCall`. |
| **DomainRetrievalAgent** | Pull structured domain data from ChEMBL (compounds), UniProt (proteins), and AlphaFold DB (structures) when relevant. |
| **GenerationAgent** | Propose new mechanistic hypotheses, each with explicit prior-knowledge basis, novelty/feasibility/impact priors, and falsification criteria. Validated by Zod. |
| **ProximityAgent** | Embed and cluster hypotheses by semantic similarity so duplicates collapse and complementary ideas get noticed. |
| **ReflectionAgent** | Critique each hypothesis: what's wrong with it, what's weak, what evidence is missing, what would change your mind. |
| **VerificationAgent** | For each claim in each hypothesis, search the actual source corpus and create `Evidence` rows tagged `supports` / `refutes` / `mixed` / `unsupported`. |
| **RankingAgent** | Run pairwise debate rounds between top hypotheses (real LLM judge, real arguments) and update Elo scores. Persisted as `DebateRound` + `Ranking` rows. |
| **EvolutionAgent** | Take top-ranked hypotheses and produce refined or combined offspring that fix weaknesses surfaced in critique and verification. |
| **CompletionAssessorAgent** | Decide whether the run has converged: confidence, gaps, recommended next action. Stops the loop or asks for another pass. |
| **MetaReviewAgent** | Synthesize everything into a 19-section final report (executive summary, prior work, hypotheses, evidence, methodology, risks, ethics, falsification, open questions, references, …). |
| **SupervisorAgent** | The conductor. Each tick: reload state, compact context, ask the assessor, pick the next agent, launch it under a Redis lock, verify the output, checkpoint, repeat. |

### How that turns into a paper

```
goal ──► Initializer ──► Safety ─┐
                                 │ (blocked? → stop with safe alternatives)
                                 ▼
       ┌──────── Literature ─── DomainRetrieval ────────┐
       │                                                ▼
       │                   Generation ◄──┐         (real sources stored
       │                        │        │          with PMID/DOI/URL)
       │                        ▼        │
       │                   Proximity     │
       │                        │        │
       │                        ▼        │
       │                   Reflection    │ ◄── EvolutionAgent
       │                        │        │     produces refined
       │                        ▼        │     offspring from
       │                   Verification  │     top-ranked ideas
       │                        │        │
       │                        ▼        │
       │                    Ranking ─────┘
       │                        │ (Elo + debate rounds persisted)
       │                        ▼
       │             CompletionAssessor ──► (not done? loop back)
       │                        │
       │                        ▼
       └─────────────► MetaReview ──► Markdown + PDF + audit trail
```

The Supervisor isn't a fixed pipeline through those boxes — it picks the next move every tick based on what's actually missing (no sources yet? schedule Literature; few hypotheses? schedule Generation; lots of unsupported claims? schedule Verification; confident enough? schedule MetaReview).

---

## See it running

| | |
|---|---|
| **Run page — live three-pane view.** Left rail: status, phase, iteration, model, budgets, agent pipeline. Center: live SSE event stream with timestamps. Right rail: tabs for evidence, safety, sources, tasks. The selected hypothesis carries its Elo rank inline. | ![Run](docs/screenshots/04-run.png) |
| **Dashboard** showing all projects and the most recent runs at a glance. | ![Dashboard](docs/screenshots/02-dashboard.png) |
| **Project page** lists every run with status badges (running, paused, completed, completed_with_limit, blocked, failed). | ![Project](docs/screenshots/03-project.png) |
| **Sign in** — dark-first, monospace accents, restrained purple for the primary action. | ![Login](docs/screenshots/01-login.png) |
| **Settings → Models** — provider configuration and live health-check. | ![Settings](docs/screenshots/05-settings.png) |

---

## Highlights

- **Long-horizon harness, not a fixed pipeline.** A `SupervisorAgent` drives a durable loop: assess state → pick next agent → execute → verify output → checkpoint → repeat. Tasks are dynamic, not scripted.
- **13 specialized agents.** Initializer, Safety, LiteratureRetrieval, DomainRetrieval, Generation, Proximity, Reflection, Verification, Ranking (Elo), Evolution, CompletionAssessor, MetaReview, plus the Supervisor.
- **Real scientific sources.** PubMed (NCBI E-utilities), OpenAlex, Crossref, ChEMBL, UniProt, AlphaFold DB. Normalized, deduplicated, and logged in `ToolCall`.
- **Anthropic-first model layer.** Provider interface + router + `safeGenerateJSON` (parse → repair → Zod-validate). Every LLM call recorded in `ModelCall`.
- **Durable, resumable, inspectable.** Postgres-backed sessions, tasks, events, memories, checkpoints. Restart the worker, refresh the browser, kill the process: the run resumes (boot scan + periodic stale-session sweep).
- **Safety-first.** Deterministic policy screen + `SafetyAgent` review at intake, hypothesis-generation, and final-report time. Blocked runs offer safe alternatives.
- **Premium B&W UI.** Dark-first, sharp typography, monospace IDs, restrained purple accent for status/progress. Three-pane Run page with agent rail, live SSE event stream, and inspection drawer.
- **Markdown + PDF exports.** `pdfkit` + `markdown-it` for professional black-and-white reports with full references.

---

## Architecture

```
+----------------+        +-----------------+        +-----------------+
|   Next.js 15   |        |  BullMQ Worker  |        |   PostgreSQL    |
|   (App Router) |  <-->  | research-runs   |  <-->  |   (Prisma)      |
|   SSE stream   |        | SupervisorAgent |        |  20 models      |
+----------------+        +-----------------+        +-----------------+
        |                          |                          ^
        |                          v                          |
        |                  +-------+--------+                  |
        |                  |   12 Agents    |                  |
        |                  |  + Tools       |                  |
        |                  +-------+--------+                  |
        |                          |                          |
        |                          v                          |
        |                  +----------------+                  |
        |                  |  Anthropic API |                  |
        |                  |  PubMed/OpenAlex|                 |
        |                  |  Crossref/ChEMBL|                 |
        |                  |  UniProt/AlphaFold|               |
        |                  +----------------+                  |
        |                                                      |
        +---------------- /api/runs/:id/stream ----------------+
                          (Server-Sent Events)
                                  |
                              +---+----+
                              |  Redis |  (BullMQ queue + run locks)
                              +--------+
```

### The Long-Horizon Harness

The run-loop is intentionally not a static pipeline. Each iteration:

1. **Reload state.** Run row, session row, last checkpoint, recent events.
2. **Compact context.** Older events are summarized into `AgentMemory` rows so prompts stay bounded.
3. **Assess completion.** `CompletionAssessorAgent` produces a `CompletionAssessment` with confidence, gaps, recommended next action.
4. **Pick next action.** `SupervisorAgent.pickNextAction` decides which agent to schedule based on state, gaps, budgets, blocked safety flags, etc.
5. **Execute the agent.** Inside a Redis lock per run; agent emits `AgentEvent`s and produces structured output validated by Zod.
6. **Verify the output.** Per-agent verification predicates (e.g. "literature created ≥ N sources", "ranking moved Elo for top hypothesis", etc.). Failures retry up to N times with self-critique.
7. **Checkpoint.** Periodically writes `AgentCheckpoint` snapshots so a fresh worker can resume mid-run.
8. **Heartbeat.** The session row keeps a `lastHeartbeatAt`; on worker boot, stale sessions get re-enqueued.

This is what makes a run survive every kind of interruption: nothing useful lives only in process memory.

---

## Repository Layout

```
/app                     Next.js App Router pages + API routes
  (auth)/                /login, /register
  (app)/                 Dashboard, Projects, Runs, Settings (protected)
  api/                   REST + SSE endpoints
/src
  components/            UI (shadcn/ui + custom)
  lib/
    agents/
      core/              Harness, supervisor, memory, checkpoint, task ledger
      scientist/         The 13 specialized agents
    auth/                NextAuth v5 config, session helpers, error helpers
    db/                  Prisma client singleton
    export/              Markdown + PDF exporters
    models/              Provider interface, AnthropicProvider, router, safe JSON
    runs/                Run lifecycle service (create/pause/resume/cancel)
    safety/              Deterministic policy screen
    sources/             PubMed, OpenAlex, Crossref, ChEMBL, UniProt, AlphaFold
    tools/               Generic ToolCall logger
    utils/               env, logger, ids, cn
  workers/               BullMQ worker entrypoint
  types/                 Ambient typings (NextAuth augment, etc.)
/prisma                  schema.prisma, seed.ts
/tests                   Vitest unit + integration tests
docker-compose.yml       Postgres + Redis
.env.example             All required environment variables
```

---

## Prerequisites

- **Node.js ≥ 20**
- **pnpm 9.x** (enforced via `packageManager` in `package.json`)
- **Docker Desktop** (for Postgres + Redis via `docker compose`)
- **Anthropic API key** (real key required; the system never invents fake LLM outputs)

The bundled `docker-compose.yml` exposes Postgres on **host port 55432** and Redis on **host port 56379** to avoid clashing with anything you already have on the standard ports.

---

## Quick Start

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

Open <http://localhost:3000>, log in with `demo@researchos.local` / `password123`, and start a run from the demo project.

---

## Environment Variables

See `.env.example`. The important ones:

| Variable             | Required | Purpose                                                |
| -------------------- | -------- | ------------------------------------------------------ |
| `DATABASE_URL`       | yes      | Postgres connection string                             |
| `REDIS_URL`          | yes      | Redis connection string (BullMQ + run locks)           |
| `NEXTAUTH_SECRET`    | yes      | NextAuth session secret                                |
| `NEXTAUTH_URL`       | yes      | e.g. `http://localhost:3000`                           |
| `ANTHROPIC_API_KEY`  | yes      | Anthropic API key                                      |
| `ANTHROPIC_MODEL_*`  | no       | Override default models per purpose                    |
| `OPENALEX_MAILTO`    | rec.     | Polite pool for OpenAlex (use your email)              |
| `NCBI_API_KEY`       | no       | Higher rate limit for PubMed E-utilities               |
| `CROSSREF_MAILTO`    | no       | Polite pool for Crossref                               |
| `RATE_LIMIT_RPM`     | no       | Per-user API rate limit (default 60)                   |
| `LOG_LEVEL`          | no       | `info`, `debug`, etc.                                  |

Secrets never reach the browser. All third-party API keys are read server-side only.

---

## Scripts

| Script                | What it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `pnpm dev`            | Next.js dev server with Turbopack on `:3000`                       |
| `pnpm worker`         | BullMQ worker that drives the SupervisorAgent loop                 |
| `pnpm build`          | `prisma generate` + `next build`                                   |
| `pnpm start`          | Production Next.js server                                          |
| `pnpm lint`           | ESLint                                                             |
| `pnpm test`           | Vitest run                                                         |
| `pnpm test:watch`     | Vitest in watch mode                                               |
| `pnpm db:migrate`     | `prisma migrate deploy` (production)                               |
| `pnpm db:migrate:dev` | `prisma migrate dev` (development)                                 |
| `pnpm db:seed`        | Seed demo user + sample project                                    |
| `pnpm db:reset`       | Drop + recreate + re-migrate the database                          |

---

## Using the App

### 1. Register / Log In

Visit `/register` to create an account, or use the seeded demo user.

### 2. Create a Project

Projects group runs. Each project has a name, optional description, and the runs you've started.

### 3. Start a Research Run

From a project page, click **New Run**, enter:

- **Goal** (the scientific question)
- **Constraints** (optional)
- **Hypothesis budget** (default 12)
- **Iteration budget** (default 40)
- **Time budget** (minutes, default 60)
- **Allowed sources** (defaults to all enabled sources)

The run is enqueued onto BullMQ; the worker picks it up and the SupervisorAgent takes over.

### 4. Watch It Run

The **Run page** has three panes:

- **Left rail.** Current iteration, status, confidence, gaps, budgets, the agent currently active. Color-coded agent list with last activity.
- **Center.** Live event stream (SSE) with timestamps, agent names, structured payloads. Drawer per event with full JSON.
- **Right rail.** Tabs for **Hypotheses**, **Sources**, **Evidence**, **Rankings**, **Safety**, **Checkpoints**, **Tasks**, **Memory**.

Close the browser. Walk away. The run continues. When you return, the entire state is reconstructed from Postgres + the latest events replay.

### 5. Pause / Resume / Cancel

From the run header. Pause sets the next supervisor tick to `paused`, resume re-enqueues a job, cancel marks the run terminal.

### 6. Final Report

When the CompletionAssessor decides the run is done (confidence ≥ threshold, gaps minimal, budget remaining or exhausted with quality), the `MetaReviewAgent` writes a `FinalReport`:

- **Markdown** body with all 19 specified sections (executive summary, problem, prior work, hypotheses, evidence, methodology, risks, ethics, future work, references, etc.).
- **PDF** export via `/api/runs/:id/export/pdf` — clean B&W, professional layout, full references.
- **Markdown** export via `/api/runs/:id/export/markdown`.

---

## Safety Model

- **Deterministic policy screen** runs first on every goal (keyword + intent patterns for known-harmful domains).
- **`SafetyAgent` model review** runs at intake, after generation, and on the final report.
- **Blocked goals** never reach the science agents. The run is stopped with `blocked` status and the user is shown the policy reason plus suggested safer reformulations.
- **All safety decisions are stored** as `SafetyFlag` rows for audit.
- **The Supervisor refuses to schedule** any further work if a `blocked` flag exists for the run.

---

## Adding a New Model Provider

1. Implement the `ModelProvider` interface in `src/lib/models/`.
2. Register it in `src/lib/models/router.ts` for one or more of the 10 purposes (`reasoning`, `safety`, `summarization`, `hypothesisGeneration`, `critique`, `ranking`, `metaReview`, etc.).
3. Add env vars for credentials/models in `.env.example` and `src/lib/utils/env.ts`.
4. All calls automatically log to `ModelCall` via the provider base class.

---

## Adding a New Scientific Source

1. Create `src/lib/sources/<name>.ts` exporting a `search(input): Promise<SearchResult>` function.
2. Normalize records into `SourceDocument`-shaped objects (PMID/DOI/URL/title/abstract/year/authors).
3. Export from `src/lib/sources/index.ts`.
4. Wire it into `LiteratureRetrievalAgent` (general) or `DomainRetrievalAgent` (domain-specific) and reference it in the run's `allowedSources` array.
5. All HTTP calls go through `lib/sources/http.ts` (retry + timeout + ToolCall logging).

---

## Tests

`pnpm test` runs the full Vitest suite:

| Suite                                 | Coverage                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `tests/safe-json.test.ts`             | `extractJsonObject`, `safeGenerateJSON` repair + retry behavior                                     |
| `tests/safety-policy.test.ts`         | Deterministic safety policy screen (block / warn / allow)                                           |
| `tests/sources-dedupe.test.ts`        | Cross-source document deduplication by DOI/PMID/title                                               |
| `tests/markdown-export.test.ts`       | PDF rendering produces non-empty valid `%PDF-` buffer                                               |
| `tests/supervisor.test.ts`            | Supervisor picks correct next action across states (init, safety, blocked, mid-run, finalize)       |
| `tests/ranking-elo.test.ts`           | Elo update math used by `RankingAgent`                                                              |
| `tests/run-service.test.ts`           | Run lifecycle service: create / access control / pause / resume / cancel                            |
| `tests/verification-predicates.test.ts` | Per-agent post-execution verification predicates (literature, generation, ranking, etc.)          |

---

## Verified end-to-end

ResearchOS was built against a 28-step acceptance test that has to run with a real Anthropic key, real PubMed / OpenAlex / Crossref calls, and a real Postgres + Redis. The reference run used the goal:

> "Identify the most promising mechanistic targets for slowing cellular aging in humans, focusing on validated longevity pathways such as senescence clearance, mitochondrial dysfunction, telomere attrition, and proteostasis loss. Prioritize hypotheses with strong human translational potential."

Outcome:

- Status: `completed_with_limit` (iteration budget hit, MetaReview rendered a partial report).
- **6 hypotheses** ranked by Elo via real LLM-judged debate rounds. Top: *"Sequential proteostasis-mitochondrial dysfunction cascade as a druggable senescence checkpoint"* (Elo **1031**).
- **19 source documents** (real Crossref papers with DOIs), **16 evidence rows** linking specific claims back to specific sources, **4 debate rounds**, **27 checkpoints** across two worker lifetimes.
- **24.8 KB Markdown report** + **16-page PDF** with full references, exported via `/api/runs/:id/export/markdown` and `/api/runs/:id/export/pdf`.

Durability was verified by **killing the entire worker process tree mid-run**, waiting past the stale-session threshold, and restarting `pnpm worker`. Boot log:

```
{"msg":"researchos worker starting","anthropicConfigured":true, ...}
{"msg":"found stale sessions to resume","count":1, ...}
{"msg":"resumed stale session","runId":"cmpdjkd4m000lm6gmh2p952n6","label":"boot"}
```

The new worker reloaded the latest checkpoint and continued the run through Ranking → Evolution → MetaReview to completion. **The same harness is what makes a multi-hour run survive every kind of interruption.**

---

## Troubleshooting

### `prisma migrate` fails with `P1010: User denied access`

A host Postgres on `:5432` is intercepting the connection. The bundled `docker-compose.yml` already maps to `55432`; ensure your `DATABASE_URL` uses port **55432**:

```
postgresql://researchos:researchos@localhost:55432/researchos?schema=public
```

### `pnpm install` errors with `EPERM ... corepack`

Run the install once with elevated permissions to let corepack populate its cache, then subsequent installs work normally.

### Worker logs `safeJSON: extract failed` and retries

This is expected: the harness automatically repairs malformed JSON from the model. After two retries it falls back to a stricter prompt and either succeeds or marks the task `failed` for the supervisor to handle.

### `useSearchParams() should be wrapped in a suspense boundary`

Already handled — `/login` wraps its form in `<Suspense>`. If you add a new client page that reads search params, do the same.

### A run is "running" but nothing is happening

1. Check the worker is up: `ps aux | grep workers/index`.
2. Check Redis: `docker compose logs redis`.
3. The session has a `lastHeartbeatAt`; if it hasn't moved in > 60s and the worker is alive, look at recent `AgentEvent`s for `error` severity entries.
4. On worker boot, stale sessions are automatically re-enqueued via `src/lib/agents/core/resume.ts`.

### Anthropic 429 / overloaded

The provider already retries with backoff and the harness tolerates transient model failures. If sustained, lower concurrency in `src/workers/index.ts` or upgrade your tier.

---

## License

MIT
