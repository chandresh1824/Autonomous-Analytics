# System overview

Autonomous Analytics lets a business user ask a question about company data in plain English and get
back a written answer, a table and a chart. Behind the answer the backend plans the question, finds
the matching business definition (KPI), writes a read-only SQL query, checks it, runs it on the right
database and summarises the result. Written 2026-10-21 from the code in this folder.

## Who uses it and for what

| User | Does |
|---|---|
| Business user | Asks questions in the Chat page ("Closed case count by service line"), reads the answer, pins charts to the Dashboard. |
| Model owner | Maintains the semantic model in Settings: tables, columns, measures, metrics and KPIs, with a draft, review and publish step. |
| Administrator | Registers source databases (connections), checks logs, deploys and monitors the service. |

## What it does

* Chat with live progress. The answer arrives as summary, numbered insights, a result table and a chart,
  with the SQL shown. Conversations are saved per user.
* Reads from several databases. Each database has its own semantic model, and the question is routed to
  the right one automatically.
* Business definitions live in the model, not the code. A KPI such as "Closed Case Volume" carries its
  own filters (state, excluded subcategories), so everyone gets the same number.
* Model management. Generate a draft from a database schema with the LLM, edit tables, dimensions,
  measures, metrics and KPIs (wizard or editor), validate, publish.
* Read-only by design. Only a single validated SELECT is ever run, with a row cap and a time limit.
* Sign-in with Microsoft Entra ID. Every API call except the health check needs a valid token.

## Parts

| Part | Technology | Where it runs |
|---|---|---|
| Frontend | React, Vite, MSAL; served as static files by nginx | container, port 80 (host 5173 in compose) |
| Backend | Node 22, Express, TypeScript | container, port 8000 |
| App database | MySQL | external; you provide it |
| Source databases | MySQL | external; added in the UI |
| LLM server | LM Studio (default) or Azure OpenAI | external; you provide it |
| Sign-in | Microsoft Entra ID app registration | external; you provide it |
| Vector index | one JSON file | volume `backend_data` mounted at `/app/data` |

How the parts connect, and the request pipeline in detail, are in `architecture.MD`.

## Deploying

1. Create the app database (empty) and a user with create and write rights. Tables are created on first start.
2. Register an Entra ID app for a single-page application. Add the frontend's public URL as a redirect URI.
3. Run an LLM server that has the chat models and one embeddings model loaded (see the model settings below).
4. Set the environment (next section) and run `docker compose up --build` from the project root, or
   build the two images yourself.
5. Open the frontend, sign in, add a source database under Settings, generate or import a semantic
   model, publish it. Chat works after the model is published and indexed.

`docker-compose.yml` has two gaps to fix before it works as shipped: the backend service is not given
`AZURE_ENTRA_TENANT_ID` and `AZURE_ENTRA_CLIENT_ID` (without them every API call returns 401), and
nothing proxies the API, so the browser calls the backend directly at `VITE_API_BASE_URL`.

## Key settings

Backend (read at container start):

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | App database. Required. |
| `SECRET_KEY` | Encrypts stored source-database passwords. Required; never change it after connections exist. |
| `AZURE_ENTRA_TENANT_ID`, `AZURE_ENTRA_CLIENT_ID` | Token verification. Required. |
| `FRONTEND_URL` | The one origin CORS allows. |
| `LLM_PROVIDER` | `lmstudio` or `azure_openai`. |
| `LM_STUDIO_BASE_URL`, `LM_STUDIO_MODEL`, `SEMANTIC_PLANNER_MODEL`, `TOOL_CALLING_MODEL`, `SQL_AGENT_MODEL`, `LM_STUDIO_EMBEDDING_MODEL` | LLM endpoint and the four chat roles plus embeddings. |
| `MAX_QUERY_ROWS`, `QUERY_TIMEOUT_SECONDS`, `MAX_SQL_REPAIR_ATTEMPTS`, `LLM_TIMEOUT_SECONDS` | Limits: 1000 rows, 30 s, 2 repairs, 180 s per model call. |
| `KPI_PREFERENCE_MARGIN` | How strongly a KPI is preferred over its metric in matching (default -0.05). |
| `LOG_LEVEL`, `APP_ENV`, `BACKEND_HOST`, `BACKEND_PORT`, `VECTOR_STORE_PATH` | Logging, environment label, bind address and port, index folder. |

Frontend (fixed when the image is built): `VITE_API_BASE_URL`, `VITE_AZURE_ENTRA_TENANT_ID`,
`VITE_AZURE_ENTRA_CLIENT_ID`, `VITE_AZURE_ENTRA_AUTHORITY`, `VITE_AZURE_ENTRA_REDIRECT_URI`.

## Operating it

* **Health:** `GET /api/health` returns `{"status":"ok"}` without a login. It only proves the process
  is up; it does not test the database or the LLM server.
* **Logs:** JSON lines on stdout (`timestamp`, `level`, `logger`, `message`, `request_id`,
  `conversation_id`). Useful messages: `startup_complete`, `server_listening`, `agent_step_completed`
  (has `elapsed_ms` per step), `sql_repair_attempt`, `deep_agent_run_finished`,
  `startup_rag_index_heal_failed`, `connection_password_decrypt_failed`. Recent lines are also served
  by `GET /api/logs`.
* **Speed:** a question takes roughly 1 to 5 minutes on a local model, because the planner, tool-calling,
  SQL, repair, visualization and response steps are each a model call. Set proxy and read timeouts of
  at least 5 minutes and turn off response buffering for the chat stream.
* **Backups:** back up the app database, above all `semantic_model_versions` (publishing deletes the
  previous published model) and `connections`. The vector index can be rebuilt; the image does not
  include it, so a new container rebuilds it at start and needs the embeddings endpoint.
* **Scaling:** run one backend replica. The vector index is a file written by the process that rebuilds
  it, and search is brute force.
* **Shutdown:** `SIGTERM` stops accepting requests and waits for open ones. Give the container a stop
  grace period longer than a typical answer.
* **No migrations:** the app creates missing tables only. A changed column must be applied by hand.

## Security

* Sign-in is Microsoft Entra ID. The backend checks signature, issuer, audience and expiry on every call.
* SQL is validated as a single read-only SELECT before it runs, and capped in rows and time.
* Source database passwords are stored encrypted and never sent to the browser.
* `.env` files are excluded from the images and from git. Provide secrets through your platform's secret store.
* Conversations and pinned widgets are private to the user; connections, models, KPIs and metrics are shared.

## Known limits

* Answers depend on the quality of the semantic model and on the LLM. The model should be reviewed
  before publishing, and KPI descriptions should use the words people actually ask with.
* Some queries are slow or fail when the LLM keeps producing SQL that fails validation.
* The written summary can contain wrong arithmetic or invented context (for example a date range that
  was not asked for). Treat the table, not the sentence, as the source of truth.
* The full list of known code limitations is in section 10 of `architecture.MD`.

## Files in this folder

| File | Content |
|---|---|
| `system overview.MD` | This document: purpose, parts, deployment, operations. |
| `architecture.MD` | How the code is organised and how a question is answered. |
| `autonomous_analytics_runbook.html` | Open in a browser: flowcharts of startup and the question pipeline, configuration tables, failure table. |
| `README.md` | Older notes from when the backend was ported to TypeScript. |
