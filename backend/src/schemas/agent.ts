import { ExecutionResult } from "./execution";
import { Plan } from "./planner";
import { SQLValidationResult } from "./sql";
import { VisualizationSpec } from "./visualization";

export interface SemanticContextItem {
  type: string;
  entity: string;
  name: string;
  description: string;
  score: number;
}

export interface ResolvedFilter {
  field: string;
  op: string;
  value: unknown;
  source: string;
}

export interface AgentStatus {
  step: string;
  label: string;
  status: string;
  detail: string | null;
}

export interface AgentState {
  conversation_id: string;
  user_query: string;
  connection_id: string | null;

  intent: string | null;
  plan: Plan | null;

  semantic_context: SemanticContextItem[];

  resolved_kpis: string[];
  resolved_metrics: string[];
  resolved_dimensions: string[];
  resolved_entities: string[];
  resolved_filters: ResolvedFilter[];

  generated_sql: string | null;
  validated_sql: string | null;
  sql_validation: SQLValidationResult | null;

  execution_result: ExecutionResult | null;

  visualization: VisualizationSpec | null;

  response: Record<string, unknown> | null;

  errors: string[];
  retry_count: number;

  /** Wall-clock time of the whole run, set when it finishes. */
  total_time_ms: number;

  progress: AgentStatus[];
}

export function makeAgentState(conversationId: string, userQuery: string, connectionId: string | null): AgentState {
  return {
    conversation_id: conversationId,
    user_query: userQuery,
    connection_id: connectionId,
    intent: null,
    plan: null,
    semantic_context: [],
    resolved_kpis: [],
    resolved_metrics: [],
    resolved_dimensions: [],
    resolved_entities: [],
    resolved_filters: [],
    generated_sql: null,
    validated_sql: null,
    sql_validation: null,
    execution_result: null,
    visualization: null,
    response: null,
    errors: [],
    retry_count: 0,
    total_time_ms: 0,
    progress: [],
  };
}
