# Backend — GenAI Analytics Deep Agent (TypeScript / Express)

Node.js + Express + TypeScript port of the original FastAPI/Python backend
(still available under `../backend` until you've validated this one). Same
API contract (routes, request/response shapes, SSE chat streaming), same
multi-agent Deep Agent pipeline, same deterministic SQL generation/validation
guarantees - rewritten idiomatically for the Node ecosystem rather than
transliterated line-by-line from Python.

## Layout

```
src/
├── index.ts               entry point: startup (metadata DB init / table creation), HTTP listen
├── app.ts                 Express app factory (CORS, JSON body parsing, routers, error handler)
├── api/routes/             chat, connections, semantic-model, kpis, metrics, health, logs
├── agents/                 deepAgent (OpenAI tool-calling orchestrator) + one module per pipeline stage,
│                            each exposed to the orchestrator as an OpenAI-style function tool
├── schemas/                Zod schemas + TS types — the typed contracts between every layer
├── services/
│   ├── llm/                OpenAI SDK client factories (pointed at LM Studio's OpenAI-compatible
│   │                       server, or Azure OpenAI) + generateStructured() JSON-mode helper
│   ├── semantic/            parser/validator/resolver/generator
│   ├── rag/                 embeddings/indexer/retriever/vectorStore
│   ├── sql/                 generator (deterministic compiler)/validator (node-sql-parser AST)/sanitizer
│   ├── datasource/          DataSource interface + mysql + registry
│   └── visualization/       deterministic chart-type recommender
├── repositories/            mysql2-backed repos (connections, semantic model versions, KPIs,
│                            metrics, conversations) backing the app's MySQL metadata DB
└── prompts/                 system prompts for each LLM-backed agent (copied verbatim from the
                             Python backend - pure text, no Python-specific content)
```

## Quickstart

```bash
npm install
cp .env.example .env   # edit LM_STUDIO_MODEL to match what's loaded in LM Studio
npm run dev            # tsx watch, or: npm run build && npm start
```

Server listens on `BACKEND_PORT` (default 8000). On boot it connects to the
MySQL metadata database given by the `DB_*` variables and creates its tables if
they are missing — the whole schema process, idempotent on every restart. No
connections are auto-registered: every datasource is one you add under Settings.

## Notable technology substitutions from the Python backend

Same functionality and behavior throughout; a few implementation details
were swapped for their natural Node equivalents:

- **LangChain's `create_agent` tool-calling loop** → a small hand-rolled
  orchestrator loop directly against the `openai` SDK's native
  `tools`/`tool_calls` function-calling API (`agents/deepAgent.ts`). Same
  mechanism (OpenAI-style tool calling), same guard/retry/STOP semantics,
  no LangChain/LangGraph dependency needed.
- **sqlglot** (SQL parsing/validation) → `node-sql-parser`, an AST-based SQL
  parser, run in its MySQL dialect mode (`services/sql/mysqlSyntax.ts`).
  `services/sql/validator.ts` walks its AST the same way the Python code
  walked sqlglot's.
- **FAISS vector store** → a dependency-free brute-force cosine-similarity
  JSON store (`services/rag/vectorStore.ts`), matching the *exact* scoring
  semantics of the Python backend's own `LocalJSONVectorStore` fallback (FAISS's
  exact `IndexFlatIP` over normalized vectors produces numerically identical
  results at this corpus size - a few thousand semantic-model documents per
  data source - so nothing is lost by not shipping a native FAISS binding).
- **SQLAlchemy** (async ORM) → this app's own metadata store
  (connections/semantic-model-versions/conversations/messages) uses `mysql2`
  directly against MySQL, and so does every business datasource, behind the
  shared `DataSource` interface - the same shape `services/datasource/base.py`
  defined. MySQL is the only engine supported on either side.
- **`cryptography.fernet`** (connection password encryption at rest) → Node's
  built-in `crypto` (AES-256-GCM keyed from `SECRET_KEY`). Not binary-compatible
  with a Fernet-encrypted secret from an existing Python-backend database -
  re-enter any saved connection passwords once after switching.
- Per-request timeout enforcement is best-effort (a query already carries its
  own `LIMIT`/row cap regardless); see `services/datasource/mysqlDataSource.ts`
  for how the `mysql2` driver's timeout is applied.

## Manual smoke-testing notes

There is no automated test suite ported yet (the Python backend's `pytest`
suite under `../backend/tests` used `unittest`/`pytest-asyncio` fixtures that
don't carry over directly - a `vitest` suite following the same structure,
using a scripted fake `ChatModel`, would be the natural next step). The core
deterministic pipeline (semantic resolution, SQL generation, SQL validation,
MySQL execution) and the full HTTP API (including the tool-calling
orchestrator loop against a mock OpenAI-compatible server) were both manually
verified end-to-end against the real `semantic_model.json` and seeded sample
database while building this port.
