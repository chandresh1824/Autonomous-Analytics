// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface SeriesSpec {
  field: string;
  label: string;
  /** combo charts only: how this series is drawn and on which value axis. */
  render?: 'bar' | 'line' | 'area' | null;
  axis?: 'left' | 'right' | null;
}

export type VisualizationType =
  | 'line'
  | 'area'
  | 'stacked_area'
  | 'bar'
  | 'horizontal_bar'
  | 'grouped_bar'
  | 'stacked_bar'
  | 'combo'
  | 'scatter'
  | 'pie'
  | 'donut'
  | 'radar'
  | 'radial_bar'
  | 'funnel'
  | 'treemap'
  | 'heatmap'
  | 'table'
  | 'kpi_card'
  | 'multi_chart';

export interface VisualizationSpec {
  type: VisualizationType;
  title: string;
  /** One short line on what the chart shows, displayed under its title. */
  description?: string | null;
  x_axis?: string | null;
  y_axis?: string | null;
  group_by?: string | null;
  series: SeriesSpec[];
  // Only set when type === 'multi_chart': several charts, each a different
  // view of the same result (e.g. a trend plus its period-over-period change,
  // or one chart per breakdown dimension).
  charts?: VisualizationSpec[];
}

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ChatMetadata {
  kpis: string[];
  metrics: string[];
  dimensions: string[];
  /** Database time for the query alone. */
  execution_time_ms: number;
  /** Whole answer, question to response. Absent on answers saved before it existed. */
  total_time_ms?: number;
  row_count: number;
}

export interface SQLInfo {
  query: string;
  visible: boolean;
}

export type AgentProgressStepName =
  | 'planning'
  | 'routing_data_source'
  | 'retrieving_semantic'
  | 'resolving_semantic'
  | 'generating_sql'
  | 'validating_sql'
  | 'executing'
  | 'recommending_chart'
  | 'generating_response';

export interface AgentProgressStep {
  step: string;
  label: string;
  status: 'success' | 'error';
  detail?: string | null;
}

export interface ChatResponse {
  conversation_id: string;
  message_id: string;
  request_id: string;
  status: 'success' | 'error';
  summary: string;
  insights: string[];
  visualization: VisualizationSpec | null;
  table: TableData | null;
  metadata: ChatMetadata;
  sql: SQLInfo | null;
  progress: AgentProgressStep[];
  errors: string[];
}

export interface ChatRequest {
  conversation_id?: string;
  message: string;
  connection_id?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface UserMessageContent {
  message: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: UserMessageContent | ChatResponse;
  created_at: string;
}

// The ordered list of progress steps used to drive the "agent thinking"
// simulation while a chat request is in flight.
export const AGENT_PROGRESS_STEPS: { step: AgentProgressStepName; label: string }[] = [
  { step: 'planning', label: 'Understanding question' },
  { step: 'routing_data_source', label: 'Finding data source' },
  { step: 'retrieving_semantic', label: 'Finding semantic definitions' },
  { step: 'resolving_semantic', label: 'Resolving KPI' },
  { step: 'generating_sql', label: 'Generating SQL' },
  { step: 'validating_sql', label: 'Validating SQL' },
  { step: 'executing', label: 'Executing query' },
  { step: 'recommending_chart', label: 'Selecting visualization' },
  { step: 'generating_response', label: 'Preparing answer' },
];

// ---------------------------------------------------------------------------
// Dashboard (pinned widgets)
// ---------------------------------------------------------------------------

/** A saved snapshot of one chat response, pinned onto the Dashboard - not a
 * live re-run query, so it renders instantly and never changes once pinned. */
export interface PinnedWidget {
  id: string;
  title: string;
  question: string;
  conversation_id: string | null;
  message_id: string | null;
  summary: string;
  insights: string[];
  visualization: VisualizationSpec | null;
  table: TableData | null;
  metadata: ChatMetadata;
  sql: SQLInfo | null;
  created_at: string;
}

export interface PinnedWidgetCreate {
  title?: string;
  question: string;
  conversation_id?: string | null;
  message_id?: string | null;
  summary: string;
  insights: string[];
  visualization: VisualizationSpec | null;
  table: TableData | null;
  metadata: ChatMetadata;
  sql: SQLInfo | null;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

// MySQL is the only database engine this app connects to.
export type ConnectionType = 'mysql';

export const MYSQL_CONNECTION_TYPE: ConnectionType = 'mysql';
export const MYSQL_DEFAULT_PORT = 3306;

export interface ConnectionOut {
  id: string;
  name: string;
  type: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  ssl: boolean;
  enabled: boolean;
  is_default: boolean;
  /** True when an (encrypted) password is stored server-side. The password
   * itself is never returned by the API. */
  has_password: boolean;
}

export interface ConnectionCreate {
  name: string;
  type: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  ssl?: boolean;
  enabled?: boolean;
}

/** Draft test payload. `connection_id` makes a blank password fall back to
 * that saved connection's stored password (used when testing while editing). */
export interface ConnectionTestPayload extends ConnectionCreate {
  connection_id?: string | null;
}

export interface ConnectionUpdate {
  name?: string | null;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  ssl?: boolean | null;
  enabled?: boolean | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Semantic Model
// ---------------------------------------------------------------------------

export interface ReferenceDefinition {
  target_entity: string;
  target_key: string;
  cardinality: string;
  role?: string | null;
  /** Descriptive metadata only ('single' | 'both') - never consulted by SQL generation. */
  cross_filter_direction: string;
}

export interface Dimension {
  name: string;
  column_name: string;
  datatype: string;
  description: string;
  synonyms: string[];
  reference?: ReferenceDefinition | null;
}

export interface Measure {
  name: string;
  expression: string;
  aggregation: string;
  datatype: string;
  format?: string | null;
  description?: string | null;
  synonyms: string[];
}

export interface Entity {
  name: string;
  table_name: string;
  description: string;
  primary_keys: string[];
  dimensions: Dimension[];
  measures: Measure[];
}

// condition | reference_condition | group -- rendered/edited as raw JSON
export type FilterNode = Record<string, unknown>;

export interface Metric {
  id: string;
  name: string;
  description: string;
  base_measure: string;
  filters: FilterNode[];
  filter_logic: FilterNode | null;
  supported_dimensions: string[];
  format?: string | null;
}

export interface KPI {
  id: string;
  name: string;
  description: string;
  formula: string;
  metric_ids: string[];
  required_grouping_dimensions: string[];
  supported_dimensions: string[];
  default_filters: FilterNode[];
  default_filter_logic: FilterNode | null;
  enabled: boolean;
}

export interface SemanticModel {
  version: string;
  data_source_id?: string | null;
  entities: Entity[];
  metrics: Metric[];
  kpis: KPI[];
}

export interface SemanticModelVersion {
  id: string;
  version_number: number;
  // 'archived' is a previously-published version automatically superseded
  // by a newer publish - it's kept for history, but never used by chat/RAG
  // retrieval again once demoted.
  status: 'draft' | 'published' | 'archived';
  created_at: string;
}

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Only set by the /import response (the draft version just created). */
  version_id?: string | null;
}

export interface PublishResult {
  id: string;
  status: string;
}

export interface IndexResult {
  indexed_documents: number;
}

export interface DatasourceColumnInfo {
  name: string;
  datatype: string;
}

export interface DatasourceTableInfo {
  table_name: string;
  column_count: number;
  columns: DatasourceColumnInfo[];
}

export interface RelationshipSuggestion {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  cardinality: string;
  reason: string;
  source: 'database' | 'llm';
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export interface HealthStatus {
  status: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface LogEntry {
  timestamp: string;
  level: LogLevel | string;
  logger: string;
  message: string;
  request_id: string;
  conversation_id: string;
  exception?: string;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  detail?: string | { msg: string }[] | string;
}
