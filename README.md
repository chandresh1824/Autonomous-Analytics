# GenAI Analytics Deep Agent

> **Backend implementations:** the original Python/FastAPI backend lives in
> `backend/`. A TypeScript/Node.js/Express port with identical functionality,
> API contract, and Deep Agent pipeline (same LLM-driven multi-agent
> orchestration, now via the OpenAI SDK's native tool-calling instead of
> LangChain) lives in `backend-ts/` — see `backend-ts/README.md` for its own
> quickstart and a rundown of the few implementation substitutions (e.g.
> `node-sql-parser` in place of `sqlglot`). The rest of this document
> (architecture, environment variables, LLM provider setup) describes the
> pipeline conceptually and applies to both; paths referencing `backend/`
> below are specific to the Python implementation.

A natural-language analytics assistant. Ask a business question in plain English
("Show resolved volume by priority for the last 6 months") and get back a
grounded answer: a business-friendly summary, a chart, a data table, and
(optionally) the exact SQL that was run — all generated through a semantic
model, never by letting an LLM invent tables, columns, joins or KPI formulas.

## Architecture

```
React Chat UI
      |
      v
FastAPI  (backend/app/api)
      |
      v
Deep Agent Orchestrator            (backend/app/agents/deep_agent.py)
      |
      +-- Planner Agent             -> intent / KPI / dimensions / date range (LLM, no SQL)
      +-- Semantic Agent            -> RAG retrieval + Semantic Resolver
      +-- SQL Agent                 -> deterministic compiler from the semantic model,
      |                                 with a grounded LLM fallback for shapes it can't handle
      +-- SQL Validator              -> read-only, schema-membership checked, row-capped
      +-- SQL Repair Agent           -> bounded retries (MAX_SQL_REPAIR_ATTEMPTS) on failure
      +-- Datasource Resolver/Registry -> connection -> live MySQL DataSource
      +-- Execution Agent            -> runs the validated SQL, typed result
      +-- Visualization Agent        -> deterministic chart-type recommendation
      +-- Response Agent             -> business-friendly summary + insights (LLM, with a
                                         deterministic fallback if the LLM is unreachable)
      |
      v
React UI (chart / table / SQL / summary)
```

Every one of the boxes above is its own module (`backend/app/agents/`,
`backend/app/services/`) with a typed `AgentState` carried through the whole
run (`backend/app/schemas/agent.py`) — nothing is a single giant prompt. Each
stage is exposed to the Deep Agent Orchestrator as a LangChain tool
(`langchain.agents.create_agent`); a tool-calling LLM turn decides which
stage to call next (normally the fixed order shown above, with the SQL Agent
<-> Validator <-> Repair loop bounded by `MAX_SQL_REPAIR_ATTEMPTS`), while
every stage's own deterministic/LLM-grounded logic (e.g. the SQL compiler
never lets an LLM invent schema) is unchanged either way. **This requires
the configured chat model to reliably support native tool/function
calling** — see **LLM provider configuration** below for what that means in
practice and how to pick a provider that supports it.

The semantic model - entities, dimensions, measures, metrics and KPIs
(including KPI business rules like default filters and reference conditions) -
is **data**, not code: nothing about "Priority" or "Resolved Volume" is
hardcoded anywhere in the Python source. Each connection's model (and its
version history) lives entirely in the application database; nothing is
auto-seeded from a JSON file - a new connection starts with no semantic model
until one is generated, uploaded, or imported through the API/UI.

## Prerequisites

- Python 3.11+
- Node.js 18+ (tested with 20/22)
- An LLM provider, selected via `LLM_PROVIDER` in `backend/.env` (see **LLM
  provider configuration** below) — either:
  - [LM Studio](https://lmstudio.ai/) running locally (`LLM_PROVIDER=lmstudio`,
    the default), with a chat-capable model loaded that supports native
    tool/function calling (see **Model choice** below), or
  - an Azure OpenAI resource (`LLM_PROVIDER=azure_openai`) with a chat
    deployment that supports tool calling (e.g. gpt-4o, gpt-4.1)
- (Optional) Docker + Docker Compose, if you want to run via containers

## LLM provider configuration

DeepAgent's orchestrator (`backend/app/agents/deep_agent.py`) uses a
LangChain tool-calling agent to decide which pipeline stage to run next -
this **requires the configured chat model to reliably support native
OpenAI-style tool/function calling**, not just plain JSON output. The
provider is selected purely by `LLM_PROVIDER` in `backend/.env` — no code
change needed either way (see `backend/app/services/llm/client.py`).

### LM Studio (`LLM_PROVIDER=lmstudio`, default)

1. Open LM Studio, load a model, and start the local server (Developer tab ->
   Start Server). Note the exact model id shown by `GET http://localhost:1234/v1/models`.
2. Set `LM_STUDIO_MODEL` in `backend/.env` to that exact id (e.g. `phi-4-mini-3.8b`).
   The app never hardcodes a model name — it reads this from the environment.
3. (Optional) load an embedding model too and set `LM_STUDIO_EMBEDDING_MODEL`
   — if none is loaded, RAG indexing/search silently degrades to a local
   hashing-based embedding fallback so nothing crashes, it's just less
   semantically accurate.

**Model choice / tool-calling support**: this app was originally verified
end-to-end against LM Studio with a small local model (`phi-4-mini-3.8b`,
~3.8B params) for its own JSON-structured-output calls, but **not every
local model's chat template implements native tool calling**, which the
orchestrator itself needs — a model that doesn't will make the orchestrator
report "The configured language model did not call any tools to answer this
question...". If you see that, either:

- load a local model whose chat template supports tool calling (e.g. a
  Qwen2.5-Instruct, Llama-3.1-Instruct, or Hermes-2-Pro class model — check
  the model card), or
- switch to `LLM_PROVIDER=azure_openai` (below) for guaranteed tool-calling
  support.

Even with tool calling working, a small model can still be imprecise about
*only* extracting the dimensions the user actually asked for (e.g. it may
add an extra grouping dimension you didn't request) - this never causes
hallucinated SQL (the SQL Agent and validator are grounded in the semantic
model regardless), it only affects which dimensions get included in the
breakdown. A stronger instruction-following model improves this if you have
the hardware for it.

LM Studio's server only supports `response_format.type` of `json_schema` or
`text` (not OpenAI's `json_object`) — the LLM client already accounts for
this (see **Troubleshooting** if you see 400 errors mentioning `response_format`).

### Azure OpenAI (`LLM_PROVIDER=azure_openai`)

Recommended whenever you want guaranteed, reliable tool-calling support
without depending on a local model's chat template.

1. In `backend/.env`, set `LLM_PROVIDER=azure_openai`.
2. Set `AZURE_OPENAI_ENDPOINT` to your resource's base URL (e.g.
   `https://my-resource.openai.azure.com`) and `AZURE_OPENAI_API_KEY` to a
   valid key for it.
3. Set `AZURE_OPENAI_CHAT_DEPLOYMENT` to the **deployment name** (not the
   underlying model name) of a chat-completions deployment that supports
   tool calling - a gpt-4o or gpt-4.1 class deployment is a safe choice.
4. (Optional) set `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` to a separate
   embeddings deployment name (e.g. a `text-embedding-3-small` deployment)
   for RAG indexing/search. If left blank, `AZURE_OPENAI_CHAT_DEPLOYMENT` is
   reused for embeddings too, which only works if that deployment is itself
   an embeddings model — leave both LM Studio embedding settings and this
   one unset if you'd rather fall back to the local hashing-based embedding.
5. (Optional) `AZURE_OPENAI_API_VERSION` defaults to `2024-08-01-preview`;
   override it to match what your resource/deployment requires.

LM Studio and Azure OpenAI settings can both stay populated in `backend/.env`
at the same time - only `LLM_PROVIDER` decides which one is actually used.

## Environment variables

Copy `.env.example` to `backend/.env` and adjust as needed:

```
cp .env.example backend/.env
```

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `lmstudio` (default) or `azure_openai` — see **LLM provider configuration** |
| `LM_STUDIO_BASE_URL` | LM Studio's OpenAI-compatible base URL (default `http://localhost:1234/v1`) |
| `LM_STUDIO_MODEL` | Exact loaded chat model id (required when `LLM_PROVIDER=lmstudio` — left blank by default on purpose) |
| `LM_STUDIO_EMBEDDING_MODEL` | Exact loaded embedding model id (optional) |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource base URL (required when `LLM_PROVIDER=azure_openai`) |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key (required when `LLM_PROVIDER=azure_openai`) |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI REST API version (default `2024-08-01-preview`) |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat-completions deployment name, must support tool calling (required when `LLM_PROVIDER=azure_openai`) |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embeddings deployment name (optional — falls back to `AZURE_OPENAI_CHAT_DEPLOYMENT`) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Application metadata DB — a MySQL database (Amazon RDS in production) holding connections, semantic model versions, conversations and pinned widgets |
| `VECTOR_STORE_PATH` | Where the local RAG vector index is persisted |
| `MAX_QUERY_ROWS` / `QUERY_TIMEOUT_SECONDS` / `MAX_SQL_REPAIR_ATTEMPTS` | Safety limits |

## Backend startup

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv\Scripts\activate.bat on cmd
pip install -r requirements.txt
cp ../.env.example .env         # then edit LM_STUDIO_MODEL etc.
uvicorn app.main:app --reload --port 8000
```

On startup the app connects to the MySQL metadata database configured by the
`DB_*` variables and creates its tables if they do not already exist. That is
the entire schema process — there is no separate migration step, and re-running
is a no-op. Create the database itself once beforehand (`CREATE DATABASE ...`);
the application user only needs rights on that schema.

A fresh install starts with **no datasource connections** — every connection is
one you create. Add one under Settings (or `POST /api/connections`), then use
"Create semantic model" in the Settings UI (or `POST
/api/semantic-model/generate` then `/import` and `/{version_id}/publish`) to
build a semantic model against it. Until both exist, chat returns "No datasource
connection is configured or enabled."

Verify: `curl http://localhost:8000/api/health` -> `{"status":"ok"}`.

## Frontend startup

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL (Vite default `http://localhost:5173`). The app
talks to the backend at `VITE_API_BASE_URL` (defaults to
`http://localhost:8000`) — override it in `frontend/.env.development.local`
if your backend runs elsewhere.

## Docker startup

```bash
docker compose up --build
```

This starts `backend` (port 8000) and `frontend` (port 5173, nginx serving
the built app). LM Studio is **not** containerized — it must already be
running on the host; the backend container reaches it via
`host.docker.internal`, which `docker-compose.yml` wires up already.

## Semantic model import / versioning

- `GET /api/semantic-model` — the current working version (draft or published)
- `POST /api/semantic-model/upload` (multipart `file`) or `/import` (JSON body)
  — saves a **new draft** version; it does not go live automatically
- `GET /api/semantic-model/versions` — list all versions with status
- `POST /api/semantic-model/{version_id}/publish` — makes a version active
  (this is what the chat pipeline and RAG index are grounded in)
- `POST /api/semantic-model/generate?connection_id=...` — discovers a
  datasource's schema and asks the LLM to draft entities/dimensions/measures;
  returned for human review only, never auto-published (save it via `/import`
  once you're happy with it)

## Vector indexing (RAG)

`POST /api/semantic-model/index` embeds every entity/dimension/measure/
metric/KPI description + synonym (metadata only, never raw rows) into a local
JSON-backed vector store (`backend/app/services/rag/vector_store.py`) used as
a similarity-search fallback when exact-name/synonym/description matching
can't resolve a phrase. Re-run this after publishing a new semantic model
version.

## Datasource configuration

Settings -> Connections in the UI, or directly via `/api/connections`.
MySQL is the only supported database engine — see
`backend/src/services/datasource/`. Passwords are encrypted at rest
(Fernet, derived from `SECRET_KEY`) and are never returned to the frontend.

## KPI configuration

Settings -> KPI Definitions, or `/api/kpis`. KPIs are part of the semantic
model hierarchy (KPI -> Metric -> Measure -> Dimensions -> filters), so KPI
edits are saved as a new semantic-model draft version; call
`POST /api/kpis/publish` to make them active.

## Example queries

```
Show resolved volume by priority.
Show cases by severity.                          (severity is a synonym for Priority)
Show resolved cases for the last 6 months.
Show resolved volume by priority for the last 6 months.
```

## Testing

```bash
cd backend
source .venv/Scripts/activate
pytest -q
```

167 tests across `tests/unit` (semantic model, planner, RAG, SQL generation
and validation, executor, visualization), `tests/integration` (API/CRUD
routes against a throwaway MySQL app DB), and `tests/agent` (full Planner ->
Semantic -> SQL -> Validator -> Executor -> Visualization -> Response
pipeline, using a fake deterministic LLM client so it runs without LM Studio).

This has also been manually verified end-to-end against a **real** running
LM Studio instance (see **LLM provider configuration** above) for the example
queries above, including the severity->Priority synonym resolution and the
KPI's default filters / reference-condition exclusion (web-service-only
assignees, `Error Log`/`Copied Child` subcategories) being correctly applied
in the generated SQL.

## Troubleshooting

- **400 Bad Request from LM Studio mentioning `response_format`**: your
  LM Studio version may be too old to support `json_schema` response
  formatting. Update LM Studio, or as a workaround pin an older client — but
  this is not exercised as a supported path.
- **Chat returns "No datasource connection is configured or enabled"**: check
  Settings -> Connections; ensure a connection is enabled and marked default.
- **Chat returns a clarification message instead of an answer**: the question
  used a term the semantic model doesn't define (and no synonym/RAG match was
  found above the similarity threshold) — by design the app never guesses at
  schema it doesn't know about. Add a synonym or dimension to the semantic
  model, or rephrase.
- **RAG search feels imprecise**: make sure an embedding model is loaded in
  LM Studio and `LM_STUDIO_EMBEDDING_MODEL` is set; otherwise the app falls
  back to a coarse hashing-based embedding (still functional, less accurate).
- **Docker backend can't reach LM Studio**: confirm LM Studio's server is
  bound to all interfaces (not just `127.0.0.1`) if you need Docker's
  `host.docker.internal` to reach it, and check `LM_STUDIO_BASE_URL` in
  `docker-compose.yml`.
