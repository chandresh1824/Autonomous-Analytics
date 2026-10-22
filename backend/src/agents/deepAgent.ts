import type OpenAI from "openai";
import { Settings } from "../core/config";
import { AppError } from "../core/exceptions";
import { getLogger, requestIdVar } from "../core/logging";
import { AgentState, AgentStatus, makeAgentState } from "../schemas/agent";
import { ChatMetadata, ChatResponse, SQLInfo, TableData } from "../schemas/chat";
import { QueryShapeResult } from "../schemas/queryShape";
import { GeneratedSQL } from "../schemas/sql";
import { ChatModel } from "../services/llm/client";
import { TRANSIENT_ERROR_MARKERS } from "../services/llm/structuredOutput";
import { DataSourceRegistry } from "../services/datasource/registry";
import { SemanticRetriever } from "../services/rag/retriever";
import { SemanticResolution } from "../services/semantic/resolver";
import { SQLValidationResult } from "../schemas/sql";
import { validateSql } from "../services/sql/validator";
import { DataSourceRouter, RouteResult } from "./dataSourceRouter";
import { ExecutionAgent } from "./executionAgent";
import { PlannerAgent, routingText, toQueryShape } from "./plannerAgent";
import { ResponseAgent } from "./responseAgent";
import { SemanticAgent } from "./semanticAgent";
import { SQLAgent } from "./sqlAgent";
import { SQLRepairAgent } from "./sqlRepairAgent";
import { VisualizationAgent } from "./visualizationAgent";

const logger = getLogger("agents.deepAgent");

const STEP_LABELS: Record<string, string> = {
  planning: "Understanding question",
  routing_data_source: "Finding data source",
  retrieving_semantic: "Finding semantic definitions",
  resolving_semantic: "Resolving KPI",
  generating_sql: "Generating SQL",
  validating_sql: "Validating SQL",
  executing: "Executing query",
  recommending_chart: "Selecting visualization",
  generating_response: "Preparing answer",
};

// Human-readable agent name per tool, used only for terminal/log
// attribution so a failure names exactly which agent produced it.
const AGENT_LABELS: Record<string, string> = {
  plan_query: "Planner Agent",
  resolve_semantics: "Semantic Agent (RAG)",
  generate_sql: "SQL Agent",
  validate_sql: "SQL Validator",
  repair_sql: "SQL Repair Agent",
  execute_query: "Execution Agent",
  recommend_visualization: "Visualization Agent",
  generate_response: "Response Agent",
};

// Which `state.progress` step a tool's failure should be recorded against.
const TOOL_PROGRESS_STEP: Record<string, string> = {
  plan_query: "planning",
  resolve_semantics: "resolving_semantic",
  generate_sql: "generating_sql",
  validate_sql: "validating_sql",
  repair_sql: "validating_sql",
  execute_query: "executing",
  recommend_visualization: "recommending_chart",
  generate_response: "generating_response",
};

// Safety net independent of the LLM orchestrator's own judgment: no single
// tool may run more than this many times in one request.
const MAX_TOOL_ATTEMPTS = 3;

// How many out-of-order tool calls the orchestrator gets (each is refused and
// told the correct next tool) before the run is stopped.
const MAX_OUT_OF_ORDER_CALLS = 6;

// A transient LM Studio/llama.cpp failure on the orchestrator's own
// tool-selection/response-reading turns gets the same bare-retry treatment
// every other LLM call in this pipeline gets. Also covers the model
// completing its turn without ever calling a single tool.
const ORCHESTRATOR_TRANSIENT_RETRIES = 2;

// How many times the orchestrator is told to continue when it ends its turn
// before the answer is ready - about one per pipeline step.
const MAX_ORCHESTRATOR_NUDGES = 8;

const SYSTEM_PROMPT =
  "You are the orchestrator for a natural-language analytics assistant. Answer " +
  "the user's question by calling the available tools, normally in this order: " +
  "plan_query -> resolve_semantics -> generate_sql -> validate_sql -> " +
  "(repair_sql, only if validate_sql reports the SQL is invalid, repeating " +
  "until it passes or you are told the maximum attempts are reached) -> " +
  "execute_query -> recommend_visualization -> generate_response.\n\n" +
  "Each tool's result tells you what to call next - follow that instruction. " +
  "If a tool's result starts with 'STOP:', do not call any more tools - your " +
  "final answer must just be that message (you may rephrase it, but keep the " +
  "same meaning and do not add anything the tool didn't say). If a result starts " +
  "with 'ERROR:', call the tool it names next. If it starts with 'DONE:', stop " +
  "calling tools and give a short final answer.\n\n" +
  "Never skip resolve_semantics or validate_sql, never call execute_query " +
  "before validate_sql has reported the SQL is valid, and never fabricate " +
  "SQL, table/column names, or data yourself - only use what the tools " +
  "return. Once generate_response has succeeded, give a short final answer " +
  "and stop - do not call any more tools.";

type ToolFn = () => Promise<string>;

interface ToolDef {
  name: string;
  description: string;
  fn: ToolFn;
}

interface ToolSet {
  tools: ToolDef[];
  /** The step still to run, or null once the run is finished (answered or
   * stopped) - lets the orchestrator loop tell an early-quitting model what
   * to call next. */
  pendingTool: () => string | null;
}

export interface DeepAgentDeps {
  /** Main model: query shape, semantic clarification, SQL, visualization, response. */
  chatModel: ChatModel;
  /** Planner model - see `getSemanticPlannerChatModel`. Defaults to `chatModel`. */
  plannerChatModel?: ChatModel;
  /** Drives the tool-calling orchestrator loop only - see
   * `getToolCallingChatModel`. Defaults to `chatModel`. */
  toolCallingChatModel?: ChatModel;
  /** SQL Agent + SQL Repair Agent model - see `getSqlChatModel`. Defaults to `chatModel`. */
  sqlChatModel?: ChatModel;
  /** RAG step: picks the data source (and its semantic model) for a question. */
  router: DataSourceRouter;
  /** Connects to the routed data source - used by the Execution Agent only. */
  datasourceRegistry: DataSourceRegistry;
  retriever: SemanticRetriever | null;
  settings: Settings;
}

/** Everything bound to the one data source a question was routed to. Built
 * by `resolve_semantics` once RAG has chosen the data source. */
interface SourceContext {
  route: RouteResult;
  semanticAgent: SemanticAgent;
  sqlAgent: SQLAgent;
  sqlRepairAgent: SQLRepairAgent;
}

/** What has completed so far in one run - see `nextPipelineTool`. */
export interface PipelineProgress {
  planned: boolean;
  resolved: boolean;
  sqlGenerated: boolean;
  /** validate_sql has run at least once. */
  validatedOnce: boolean;
  /** SQL was generated or repaired since the last validate_sql. */
  sqlNeedsValidation: boolean;
  sqlValid: boolean;
  executed: boolean;
  visualized: boolean;
  responded: boolean;
}

/**
 * The only tool the orchestrator may call next, or null once the response is
 * ready. Validation loops as validate_sql -> repair_sql -> validate_sql until
 * the SQL is valid (validate_sql itself STOPs the run when repairs run out).
 */
export function nextPipelineTool(p: PipelineProgress): string | null {
  if (!p.planned) return "plan_query";
  if (!p.resolved) return "resolve_semantics";
  if (!p.sqlGenerated) return "generate_sql";
  if (!p.sqlValid) return !p.validatedOnce || p.sqlNeedsValidation ? "validate_sql" : "repair_sql";
  if (!p.executed) return "execute_query";
  if (!p.visualized) return "recommend_visualization";
  if (!p.responded) return "generate_response";
  return null;
}

function isoDay(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A DB date/datetime value (Date or string) as 'YYYY-MM-DD', or null. */
function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

/** First day a resolved date filter can match, as 'YYYY-MM-DD' (null when the
 * filter's shape doesn't bound it from below). */
export function periodStart(op: string, value: unknown, now: Date): string | null {
  if (op === "between" && Array.isArray(value)) return toIsoDate(String(value[0]));
  if ((op === "gte" || op === "gt") && typeof value === "string") return toIsoDate(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const start = new Date(now);
  if (op === "last_n_days") start.setDate(start.getDate() - n);
  else if (op === "last_n_months") start.setMonth(start.getMonth() - n);
  else if (op === "last_n_years") start.setFullYear(start.getFullYear() - n);
  else return null;
  return isoDay(start);
}

function describePeriod(op: string, value: unknown): string {
  if (op === "between" && Array.isArray(value)) return `between ${value[0]} and ${value[1]}`;
  if (op === "gte" || op === "gt") return `from ${value} onward`;
  if (op === "last_n_days") return `in the last ${value} days`;
  if (op === "last_n_months") return `in the last ${value} months`;
  if (op === "last_n_years") return `in the last ${value} years`;
  return `for ${JSON.stringify(value)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Central orchestrator. Each pipeline stage (Planner, RAG data-source
 * routing + Semantic Resolver, SQL Agent, Validator, SQL Repair, Executor,
 * Visualization, Response) is exposed as an OpenAI-style tool operating on a
 * shared, per-request `AgentState` - an LLM tool-calling loop decides which
 * tool to call and in what order, rather than a hardcoded sequence. Every
 * tool still does exactly what its deterministic/LLM-grounded logic always
 * did internally (e.g. `SQLBuilder` never lets an LLM invent schema); only
 * the *ordering* decision is made by the LLM.
 *
 * The data source is not known up front:
 * 1. `plan_query` - the Planner derives intent and a retrieval query from the
 *    question alone (no catalog, no database).
 * 2. `resolve_semantics` - RAG searches every published catalog with that
 *    retrieval query, picks the best-matching data source (its id, semantic
 *    model and matched KPIs/measures/dimensions), then resolves the question
 *    against that one model.
 * 3. SQL is generated and validated against that model.
 * 4. `execute_query` - the Execution Agent looks up the `connections` row
 *    whose id is the routed `data_source_id` and only then connects.
 *
 * So no database connection is opened unless RAG found a matching data
 * source and valid SQL was produced for it.
 *
 * This requires the configured chat model to reliably support native
 * OpenAI-style tool/function calling (see `services/llm/client.ts`) - a
 * capability Azure OpenAI's chat-completions models support robustly, and LM
 * Studio supports too as long as the loaded local model's own chat template
 * implements it. If the loaded model never actually emits a tool call,
 * `run()`'s own retry/fallback below produces an honest, actionable error
 * rather than surfacing a hallucinated transcript.
 */
export class DeepAgent {
  private readonly chatModel: ChatModel;
  private readonly toolCallingChatModel: ChatModel;
  private readonly sqlChatModel: ChatModel;
  private readonly router: DataSourceRouter;
  private readonly retriever: SemanticRetriever | null;
  private readonly settings: Settings;
  private readonly planner: PlannerAgent;
  private readonly executionAgent: ExecutionAgent;
  private readonly visualizationAgent: VisualizationAgent;
  private readonly responseAgent: ResponseAgent;
  private onProgress: ((status: AgentStatus) => Promise<void>) | null = null;

  constructor(deps: DeepAgentDeps) {
    this.chatModel = deps.chatModel;
    this.toolCallingChatModel = deps.toolCallingChatModel ?? deps.chatModel;
    this.sqlChatModel = deps.sqlChatModel ?? deps.chatModel;
    this.router = deps.router;
    this.retriever = deps.retriever;
    this.settings = deps.settings;
    this.planner = new PlannerAgent(deps.plannerChatModel ?? deps.chatModel);
    this.executionAgent = new ExecutionAgent(deps.datasourceRegistry, deps.settings.maxQueryRows, deps.settings.queryTimeoutSeconds);
    this.visualizationAgent = new VisualizationAgent(deps.chatModel);
    this.responseAgent = new ResponseAgent(deps.chatModel);
  }

  /** Builds the agents that work against one data source's semantic model. */
  private bindSource(route: RouteResult): SourceContext {
    return {
      route,
      semanticAgent: new SemanticAgent(route.model, this.chatModel, this.retriever, {
        scoreThreshold: this.settings.ragScoreThreshold,
        kpiPreferenceMargin: this.settings.kpiPreferenceMargin,
      }),
      sqlAgent: new SQLAgent(route.model, this.sqlChatModel, this.settings.maxQueryRows),
      sqlRepairAgent: new SQLRepairAgent(route.model, this.sqlChatModel, this.settings.maxQueryRows),
    };
  }

  private async logStep(state: AgentState, step: string, status = "success", detail: string | null = null): Promise<void> {
    const statusObj: AgentStatus = { step, label: STEP_LABELS[step] ?? step, status, detail };
    state.progress.push(statusObj);
    if (this.onProgress) {
      try {
        await this.onProgress(statusObj);
      } catch (exc) {
        logger.exception("on_progress_callback_failed", { error: String(exc) });
      }
    }
  }

  /** Wraps a pipeline-step tool so any exception it raises is logged with a
   * clear agent label, and enforces MAX_TOOL_ATTEMPTS. */
  private guard(state: AgentState, toolName: string, fn: ToolFn, callCounts: Record<string, number>): ToolFn {
    const agentLabel = AGENT_LABELS[toolName] ?? toolName;
    const progressStep = TOOL_PROGRESS_STEP[toolName] ?? toolName;

    return async (): Promise<string> => {
      callCounts[toolName] = (callCounts[toolName] ?? 0) + 1;
      if (callCounts[toolName] > MAX_TOOL_ATTEMPTS) {
        const message = `${agentLabel} could not resolve this after ${MAX_TOOL_ATTEMPTS} attempts. Please rephrase your question - for example, name the specific KPI, dimension, or time range you mean - and try again.`;
        state.errors.push(message);
        await this.logStep(state, progressStep, "error", message);
        logger.warning("agent_step_max_attempts_exceeded", { agent: agentLabel, tool: toolName, attempts: callCounts[toolName] - 1 });
        return `STOP: ${message}`;
      }

      logger.info("agent_step_started", { agent: agentLabel, tool: toolName });
      const started = Date.now();
      try {
        const result = await fn();
        logger.info("agent_step_completed", { agent: agentLabel, tool: toolName, elapsed_ms: Date.now() - started, result });
        return result;
      } catch (exc) {
        if (exc instanceof AppError) {
          state.errors.push(exc.message);
          await this.logStep(state, progressStep, "error", exc.message);
          logger.error("agent_step_failed", { agent: agentLabel, tool: toolName, error_type: exc.constructor.name, error: exc.message });
          return `STOP: ${exc.message}`;
        }
        const message = `${agentLabel} hit an unexpected error while processing your question.`;
        state.errors.push(message);
        await this.logStep(state, progressStep, "error", String(exc));
        logger.exception("agent_step_failed", {
          agent: agentLabel,
          tool: toolName,
          error_type: (exc as Error)?.constructor?.name,
          // Provider/LLM errors carry the actual cause (e.g. LM Studio's
          // "model has crashed"); without it the log can't be diagnosed.
          error: String((exc as Error)?.message ?? exc).slice(0, 1000),
          status: (exc as { status?: number })?.status,
        });
        return `STOP: ${message}`;
      }
    };
  }

  /**
   * Works out why a query came back empty when the cause is a date filter that
   * lies past the end of the data (e.g. "this year" when the newest record is
   * from last December) - otherwise "no results" gives the user no way to tell
   * a wrong question from missing data. Returns null when it can't tell, or
   * when the data does cover the period (so something else filtered it out).
   */
  private async explainEmptyResult(source: SourceContext, resolution: SemanticResolution): Promise<string | null> {
    try {
      for (const filter of resolution.filters) {
        const found = source.route.model.findDimension(filter.field);
        if (!found || !/date|time/i.test(found[1].datatype)) continue;
        const start = periodStart(filter.op, filter.value, new Date());
        if (start === null) continue;

        const [entity, dim] = found;
        const latestResult = await this.executionAgent.execute(
          source.route.dataSourceId,
          `SELECT MAX(DATE(t0.\`${dim.column_name}\`)) AS latest FROM \`${entity.table_name}\` t0 WHERE t0.\`${dim.column_name}\` <= NOW()`
        );
        const latest = toIsoDate(latestResult.rows[0]?.latest);
        if (latest === null || start <= latest) continue;
        return (
          `No data found for ${filter.field} ${describePeriod(filter.op, filter.value)}. ` +
          `The data available only runs up to ${latest} - try asking about a period on or before that date.`
        );
      }
    } catch (exc) {
      logger.warning("explain_empty_result_failed", { error: String(exc) });
    }
    return null;
  }

  private buildTools(state: AgentState, userQuery: string): ToolSet {
    interface Scratch {
      source: SourceContext | null;
      resolution: SemanticResolution | null;
      validation: SQLValidationResult | null;
      headline: string | null;
      shape: QueryShapeResult | null;
      /** SQL was generated/repaired since the last validate_sql. */
      sqlNeedsValidation: boolean;
      visualized: boolean;
      /** Why the query came back empty, when that could be worked out. */
      emptyResultNote: string | null;
      /** Set once any tool returned STOP - the run is over. */
      stopMessage: string | null;
      outOfOrderCalls: number;
    }
    const scratch: Scratch = {
      source: null,
      resolution: null,
      validation: null,
      headline: null,
      shape: null,
      sqlNeedsValidation: false,
      visualized: false,
      emptyResultNote: null,
      stopMessage: null,
      outOfOrderCalls: 0,
    };
    const callCounts: Record<string, number> = {};

    /** The only tool that may run next, derived from what has actually
     * completed - null once the response is ready. */
    const expectedNextTool = (): string | null =>
      nextPipelineTool({
        planned: state.plan !== null,
        resolved: scratch.resolution !== null,
        sqlGenerated: state.generated_sql !== null,
        validatedOnce: scratch.validation !== null,
        sqlNeedsValidation: scratch.sqlNeedsValidation,
        sqlValid: state.validated_sql !== null,
        executed: state.execution_result !== null,
        visualized: scratch.visualized,
        responded: state.response !== null,
      });

    /**
     * Keeps the LLM orchestrator on the pipeline's order. The model still
     * chooses every call, but a call that isn't the next step (e.g.
     * plan_query again after validate_sql) is refused without running and the
     * model is told which tool is next; any call after a STOP just repeats
     * the STOP. Persistent misordering ends the run instead of looping.
     */
    const sequenced = (name: string, fn: ToolFn): ToolFn => async () => {
      if (scratch.stopMessage !== null) return `STOP: ${scratch.stopMessage}`;
      const expected = expectedNextTool();
      if (expected === null) {
        return "DONE: the answer is ready. Do not call any more tools - give a short final answer now.";
      }
      if (name !== expected) {
        scratch.outOfOrderCalls += 1;
        logger.warning("agent_tool_out_of_order", { tool: name, expected, count: scratch.outOfOrderCalls });
        if (scratch.outOfOrderCalls > MAX_OUT_OF_ORDER_CALLS) {
          const message = "The assistant could not complete the analysis steps in order. Please try again.";
          state.errors.push(message);
          scratch.stopMessage = message;
          return `STOP: ${message}`;
        }
        return `ERROR: ${name} cannot run now - it is not the next step. Call ${expected} next.`;
      }
      const result = await fn();
      if (result.startsWith("STOP:")) scratch.stopMessage = result.slice("STOP:".length).trim();
      return result;
    };

    const planQuery: ToolFn = async () => {
      const plan = await this.planner.plan(userQuery);
      state.plan = plan;
      state.intent = plan.intent;
      logger.info("planner_output", { user_query: userQuery, ...plan });
      await this.logStep(state, "planning");
      if (plan.intent !== "analytics_query") {
        const message = plan.reason || "This question cannot be answered with the concepts currently defined in the semantic model.";
        state.errors.push(message);
        await this.logStep(state, "resolving_semantic", "error", message);
        return `STOP: ${message}`;
      }

      // The Planner's single call now also carries the query shape.
      const shape = toQueryShape(plan);
      scratch.shape = shape;
      return (
        `Plan created. intent=${plan.intent} subject=${JSON.stringify(plan.subject)} analysis_pattern=${shape.analysis_pattern} ` +
        `dimensions=${JSON.stringify(shape.dimensions)} filters=${JSON.stringify(shape.filters)} ` +
        `trend_granularity=${shape.trend_granularity}. Call resolve_semantics next.`
      );
    };

    const resolveSemantics: ToolFn = async () => {
      if (state.plan === null || scratch.shape === null) return "ERROR: call plan_query first.";

      // RAG: find the data source whose catalog matches the question, from
      // the plan's subject, dimensions and filters (see `routingText`).
      // Routed once per request - a retried resolve_semantics reuses the
      // same data source.
      if (scratch.source === null) {
        let route: RouteResult;
        try {
          route = await this.router.route(routingText(state.plan), userQuery);
        } catch (exc) {
          if (!(exc instanceof AppError)) throw exc;
          state.errors.push(exc.message);
          await this.logStep(state, "routing_data_source", "error", exc.message);
          return `STOP: ${exc.message}`;
        }
        scratch.source = this.bindSource(route);
        state.connection_id = route.dataSourceId;
        const matched = route.matches.slice(0, 3).map((h) => h.name).filter(Boolean).join(", ");
        await this.logStep(state, "routing_data_source", "success", matched ? `${route.dataSourceName} (matched: ${matched})` : route.dataSourceName);
      }
      const source = scratch.source;

      const [resolution, semanticContext] = await source.semanticAgent.run(state.plan);
      state.semantic_context = semanticContext;
      scratch.resolution = resolution;
      await this.logStep(state, "retrieving_semantic");
      state.resolved_kpis = resolution.kpis;
      state.resolved_metrics = resolution.metrics;
      state.resolved_dimensions = resolution.dimensions;
      state.resolved_entities = resolution.entities;
      state.resolved_filters = resolution.filters;

      const nothingResolved = !resolution.metrics.length && !resolution.dimensions.length && !resolution.filters.length;
      if (resolution.unresolved.length || nothingResolved) {
        const message = await source.semanticAgent.clarify(resolution.unresolved);
        state.errors.push(message);
        await this.logStep(state, "resolving_semantic", "error", message);
        return `STOP: ${message}`;
      }
      await this.logStep(state, "resolving_semantic");
      return (
        `Resolved kpis=${JSON.stringify(resolution.kpis)} metrics=${JSON.stringify(resolution.metrics)} ` +
        `dimensions=${JSON.stringify(resolution.dimensions)}. Call generate_sql next.`
      );
    };

    const generateSql: ToolFn = async () => {
      if (scratch.resolution === null || scratch.source === null) return "ERROR: call resolve_semantics first.";
      const generated = await scratch.source.sqlAgent.generate(userQuery, scratch.resolution, scratch.resolution.filters, scratch.shape);
      state.generated_sql = generated.sql;
      scratch.sqlNeedsValidation = true;
      await this.logStep(state, "generating_sql");
      return `SQL generated:\n${generated.sql}\nCall validate_sql next.`;
    };

    const validateSqlTool: ToolFn = async () => {
      if (state.generated_sql === null || scratch.source === null) return "ERROR: call generate_sql first.";
      const source = scratch.source;
      scratch.sqlNeedsValidation = false;
      const validation = validateSql(state.generated_sql, source.route.model, {
        maxRows: this.settings.maxQueryRows,
        resolution: scratch.resolution,
      });
      scratch.validation = validation;
      if (!validation.valid) {
        const detail = validation.errors.join("; ");
        await this.logStep(state, "validating_sql", "error", detail);
        const remaining = this.settings.maxSqlRepairAttempts - state.retry_count;
        if (remaining <= 0) {
          // The deterministic builder can't bucket by time - for a trend it
          // would answer a different question, so it's not used then.
          const fallback =
            scratch.resolution && !scratch.shape?.trend_granularity
              ? source.sqlAgent.tryDeterministic(scratch.resolution, scratch.resolution.filters)
              : null;
          if (fallback && scratch.resolution) {
            const fallbackValidation = validateSql(fallback.sql, source.route.model, {
              maxRows: this.settings.maxQueryRows,
              resolution: scratch.resolution,
            });
            if (fallbackValidation.valid) {
              logger.info("sql_deterministic_fallback_recovered", { validation_errors: validation.errors });
              scratch.validation = fallbackValidation;
              state.sql_validation = fallbackValidation;
              state.validated_sql = fallbackValidation.sql;
              state.generated_sql = fallback.sql;
              await this.logStep(state, "validating_sql");
              return "SQL is valid (recovered via deterministic fallback). Call execute_query next.";
            }
          }
          const message = `The question could not be turned into a valid query (${detail}). Please rephrase your question - for example, name the specific KPI, dimension, or time range you mean - and try again.`;
          state.errors.push(message);
          return `STOP: ${message}`;
        }
        return `SQL invalid: ${detail}. Call repair_sql to fix it (${remaining} attempt(s) remaining).`;
      }
      state.sql_validation = validation;
      state.validated_sql = validation.sql;
      await this.logStep(state, "validating_sql");
      return "SQL is valid. Call execute_query next.";
    };

    const repairSql: ToolFn = async () => {
      if (scratch.validation === null || scratch.validation.valid || scratch.source === null) {
        return "ERROR: nothing to repair - call validate_sql first.";
      }
      if (state.retry_count >= this.settings.maxSqlRepairAttempts) {
        return "ERROR: maximum SQL repair attempts already reached - call validate_sql, not repair_sql, again.";
      }
      state.retry_count += 1;
      logger.info("sql_repair_attempt", { attempt: state.retry_count, errors: scratch.validation.errors });
      const generated: GeneratedSQL = await scratch.source.sqlRepairAgent.repair(
        state.generated_sql,
        scratch.resolution!,
        scratch.validation.errors,
        scratch.resolution!.filters,
        scratch.shape
      );
      state.generated_sql = generated.sql;
      scratch.sqlNeedsValidation = true;
      return "SQL repaired. Call validate_sql again to check it.";
    };

    const executeQuery: ToolFn = async () => {
      if (state.validated_sql === null || scratch.source === null) {
        return "ERROR: call validate_sql first and ensure it reported the SQL is valid.";
      }
      // The SQL was generated and validated against this data source's model,
      // so it must run against exactly that connection.
      const executionResult = await this.executionAgent.execute(scratch.source.route.dataSourceId, state.validated_sql);
      // A NULL grouping value is a real group ("no hub center"); shown as
      // "(blank)" it gets a chart label and table text instead of a bare dash.
      if (state.resolved_metrics.length) {
        const groupColumns = new Set(state.resolved_dimensions.map((d) => d.toLowerCase()));
        for (const row of executionResult.rows) {
          for (const column of Object.keys(row)) {
            if (row[column] === null && groupColumns.has(column.toLowerCase())) row[column] = "(blank)";
          }
        }
      }
      state.execution_result = executionResult;
      if (executionResult.row_count === 0 && scratch.resolution) {
        scratch.emptyResultNote = await this.explainEmptyResult(scratch.source, scratch.resolution);
      }
      await this.logStep(state, "executing");
      scratch.headline =
        (state.resolved_kpis[0] || state.resolved_metrics[0] || state.resolved_dimensions[0] || state.resolved_entities[0]) ?? "Results";
      return `Query executed: ${executionResult.row_count} row(s). Call recommend_visualization next.`;
    };

    const recommendVisualization: ToolFn = async () => {
      if (state.execution_result === null) return "ERROR: call execute_query first.";
      state.visualization = await this.visualizationAgent.recommend(state.execution_result, scratch.headline ?? "Results", {
        userQuery,
        sql: state.validated_sql,
        analysisPattern: scratch.shape?.analysis_pattern ?? null,
        granularity: scratch.shape?.trend_granularity ?? null,
        comparePrevious: scratch.shape?.period_over_period ?? false,
        rankLimit: scratch.shape?.rank_limit ?? null,
        dimensions: state.resolved_dimensions,
        metrics: state.resolved_metrics,
      });
      scratch.visualized = true;
      await this.logStep(state, "recommending_chart");
      return "Visualization selected. Call generate_response next.";
    };

    const generateResponse: ToolFn = async () => {
      if (state.execution_result === null) return "ERROR: call execute_query first.";
      const responsePayload = await this.responseAgent.respond(
        userQuery,
        scratch.headline ?? "Results",
        state.resolved_dimensions,
        state.execution_result,
        scratch.emptyResultNote,
        scratch.shape?.analysis_pattern === "ranking" ? scratch.shape.rank_limit : null,
        {
          period: describeQuestionPeriod(state),
          analysisPattern: scratch.shape?.analysis_pattern ?? null,
          granularity: scratch.shape?.trend_granularity ?? null,
          comparePrevious: scratch.shape?.period_over_period ?? false,
        }
      );
      state.response = responsePayload;
      await this.logStep(state, "generating_response");
      return `Response ready: ${responsePayload.summary} This was the final step - give a short final answer now.`;
    };

    const tools: ToolDef[] = [
      {
        name: "plan_query",
        description:
          "Analyze the user's question to determine intent, a retrieval instruction for the semantic catalog, the analysis shape, and any breakdown dimensions/filters. Always call this first.",
        fn: sequenced("plan_query", this.guard(state, "plan_query", planQuery, callCounts)),
      },
      {
        name: "resolve_semantics",
        description:
          "Find the data source whose semantic catalog matches the question (RAG search), then resolve the plan's phrases into that catalog's KPIs, measures and dimensions. Call after plan_query.",
        fn: sequenced("resolve_semantics", this.guard(state, "resolve_semantics", resolveSemantics, callCounts)),
      },
      {
        name: "generate_sql",
        description: "Generate SQL from the resolved semantic concepts. Call after resolve_semantics succeeds.",
        fn: sequenced("generate_sql", this.guard(state, "generate_sql", generateSql, callCounts)),
      },
      {
        name: "validate_sql",
        description: "Validate the generated SQL against the semantic model and safety rules. Call after generate_sql.",
        fn: sequenced("validate_sql", this.guard(state, "validate_sql", validateSqlTool, callCounts)),
      },
      {
        name: "repair_sql",
        description: "Repair invalid SQL using the reported validation errors. Only call after validate_sql reports the SQL is invalid.",
        fn: sequenced("repair_sql", this.guard(state, "repair_sql", repairSql, callCounts)),
      },
      {
        name: "execute_query",
        description: "Execute the validated SQL against the data source. Call only after validate_sql reports the SQL is valid.",
        fn: sequenced("execute_query", this.guard(state, "execute_query", executeQuery, callCounts)),
      },
      {
        name: "recommend_visualization",
        description: "Pick a chart type for the query result. Call after execute_query.",
        fn: sequenced("recommend_visualization", this.guard(state, "recommend_visualization", recommendVisualization, callCounts)),
      },
      {
        name: "generate_response",
        description: "Write the final business-friendly answer from the executed result. Call last.",
        fn: sequenced("generate_response", this.guard(state, "generate_response", generateResponse, callCounts)),
      },
    ];
    return { tools, pendingTool: () => (scratch.stopMessage !== null ? null : expectedNextTool()) };
  }

  private static toOpenAiTools(tools: ToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: "object", properties: {}, required: [] },
      },
    }));
  }

  /** Runs the tool-calling orchestrator loop for one attempt: alternates
   * calling the chat model (which decides the next tool, if any) and
   * executing whatever tool(s) it asked for, until it stops calling tools or
   * the iteration cap is hit. Returns the final assistant message content,
   * and whether at least one tool call was ever made. */
  private async runOrchestratorLoop(
    toolSet: ToolSet,
    userQuery: string
  ): Promise<{ finalMessage: string | null; anyToolCalled: boolean }> {
    const { tools } = toolSet;
    const toolByName = new Map(tools.map((t) => [t.name, t]));
    const openAiTools = DeepAgent.toOpenAiTools(tools);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userQuery },
    ];

    const maxIterations = 4 * tools.length + 4;
    let anyToolCalled = false;
    let nudges = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.toolCallingChatModel.client.chat.completions.create({
        model: this.toolCallingChatModel.model,
        temperature: 0.1,
        messages,
        tools: openAiTools,
        tool_choice: "auto",
      });
      const message = response.choices[0].message;
      messages.push(message);

      const toolCalls = message.tool_calls ?? [];
      if (!toolCalls.length) {
        // Small tool-calling models often end their turn early (e.g. right
        // after plan_query). The model still makes every call - it's just
        // told which step is outstanding and asked to continue.
        const pending = toolSet.pendingTool();
        if (pending !== null && nudges < MAX_ORCHESTRATOR_NUDGES) {
          nudges += 1;
          logger.warning("orchestrator_stopped_early_nudged", { pending_tool: pending, nudge: nudges });
          messages.push({
            role: "user",
            content: `The answer is not ready yet - do not reply with text. Call the ${pending} tool now.`,
          });
          continue;
        }
        const content = typeof message.content === "string" ? message.content : null;
        return { finalMessage: content, anyToolCalled };
      }

      anyToolCalled = true;
      for (const call of toolCalls) {
        const tool = toolByName.get(call.function.name);
        const result = tool ? await tool.fn() : `ERROR: unknown tool '${call.function.name}'`;
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    return { finalMessage: null, anyToolCalled };
  }

  async run(
    conversationId: string,
    userQuery: string,
    onProgress: ((status: AgentStatus) => Promise<void>) | null = null
  ): Promise<AgentState> {
    this.onProgress = onProgress;
    logger.info("deep_agent_run_started", { conversation_id: conversationId, user_query: userQuery });
    const started = Date.now();

    // connection_id stays null until resolve_semantics routes the question.
    let state = makeAgentState(conversationId, userQuery, null);
    let finalMessage: string | null = null;

    try {
      for (let attempt = 0; attempt <= ORCHESTRATOR_TRANSIENT_RETRIES; attempt++) {
        // A fresh AgentState/tool set on every attempt - this failure mode
        // has only ever been observed on the orchestrator's very first turn.
        state = makeAgentState(conversationId, userQuery, null);
        const toolSet = this.buildTools(state, userQuery);
        try {
          const result = await this.runOrchestratorLoop(toolSet, userQuery);
          finalMessage = result.finalMessage;
          if (state.progress.length || attempt >= ORCHESTRATOR_TRANSIENT_RETRIES) {
            break;
          }
          logger.warning("deep_agent_orchestrator_no_tool_calls_retry", { attempt });
          await sleep(500 * (attempt + 1));
          continue;
        } catch (exc) {
          if (exc instanceof AppError) {
            state.errors.push(exc.message);
            logger.error("deep_agent_error", { error: exc.message });
            return state;
          }
          const text = String((exc as Error)?.message ?? exc).toLowerCase();
          const isTransient = TRANSIENT_ERROR_MARKERS.some((marker) => text.includes(marker));
          if (attempt >= ORCHESTRATOR_TRANSIENT_RETRIES || !isTransient) {
            logger.exception("deep_agent_unexpected_error", { error: String(exc) });
            state.errors.push("An unexpected error occurred while processing your question.");
            return state;
          }
          logger.warning("deep_agent_orchestrator_transient_retry", { attempt, error: String(exc) });
          await sleep(500 * (attempt + 1));
        }
      }
    } finally {
      state.total_time_ms = Date.now() - started;
      logger.info("deep_agent_run_finished", {
        conversation_id: conversationId,
        elapsed_ms: Date.now() - started,
        data_source_id: state.connection_id,
        steps: state.progress.map((p) => p.step),
        errors: state.errors,
      });
    }

    if (state.response === null && !state.errors.length) {
      let fallback: string | null = null;
      if (!state.progress.length) {
        // No tool was ever called, not even plan_query - the model's own
        // final message here isn't a genuine answer, it's the model
        // narrating the pipeline as prose instead of actually running it.
        fallback =
          "The configured language model did not call any tools to answer this " +
          "question, so no query was actually run - the text it produced instead " +
          "is not based on real data and has been discarded. This usually means " +
          "the configured model/provider doesn't reliably support function/tool " +
          "calling. If you're using LM Studio, try a model fine-tuned for tool use " +
          "and confirm tool-use/function-calling support is enabled for it there; " +
          "for guaranteed tool-calling support, configure LLM_PROVIDER=azure_openai " +
          "instead (see the README's Azure OpenAI configuration section).";
      } else if (finalMessage && finalMessage.trim()) {
        fallback = finalMessage.trim();
      }
      state.errors.push(fallback || "The assistant could not complete this request.");
    }
    return state;
  }

  toChatResponse(state: AgentState, messageId: string): ChatResponse {
    const status = state.errors.length ? "error" : "success";
    const response = state.response as { summary?: string; insights?: string[] } | null;
    const summary = response?.summary || (state.errors[0] ?? "");
    const insights = response?.insights ?? [];

    let table: TableData | null = null;
    if (state.execution_result) {
      table = { columns: state.execution_result.columns.map((c) => c.name), rows: state.execution_result.rows };
    }

    const metadata: ChatMetadata = {
      kpis: state.resolved_kpis,
      metrics: state.resolved_metrics,
      dimensions: state.resolved_dimensions,
      execution_time_ms: state.execution_result?.execution_time_ms ?? 0,
      total_time_ms: state.total_time_ms,
      row_count: state.execution_result?.row_count ?? 0,
    };

    const sqlInfo: SQLInfo | null = state.validated_sql ? { query: state.validated_sql, visible: true } : null;

    return {
      conversation_id: state.conversation_id,
      message_id: messageId,
      request_id: requestIdVar.get(),
      status,
      summary: summary || "",
      insights,
      visualization: state.visualization,
      table,
      metadata,
      sql: sqlInfo,
      progress: state.progress as unknown as Record<string, unknown>[],
      errors: state.errors,
    };
  }
}

/** The question's period in words plus its exact dates, for the Response
 * Agent (e.g. "last quarter (2026-07-01 to 2026-09-30)"). Null when the
 * question named no period. */
function describeQuestionPeriod(state: AgentState): string | null {
  const plan = state.plan;
  if (!plan?.time.phrase) return null;
  const range = plan.time_range;
  if (!range) return plan.time.phrase;
  const value = range.value;
  const dates =
    range.op === "between" && Array.isArray(value)
      ? `${value[0]} to ${value[1]}`
      : range.op === "gte"
        ? `from ${String(value)} to date`
        : range.op.startsWith("last_n_")
          ? `the last ${String(value)} ${range.op.slice("last_n_".length)} up to today`
          : `${range.op} ${JSON.stringify(value)}`;
  return `${plan.time.phrase} (${dates})`;
}
