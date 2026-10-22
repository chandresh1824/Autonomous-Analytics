import { z } from "zod";
import { VisualizationSpec } from "./visualization";

/** Longest question accepted from the chat UI. */
export const MAX_CHAT_MESSAGE_CHARS = 4000;

export const ChatRequestSchema = z.object({
  conversation_id: z.string().trim().min(1).nullish(),
  message: z
    .string()
    .trim()
    .min(1, "message is required")
    .max(MAX_CHAT_MESSAGE_CHARS, `message must be at most ${MAX_CHAT_MESSAGE_CHARS} characters`),
  // Accepted for API compatibility but ignored - see `ChatRequest`.
  connection_id: z.string().nullish(),
});

export interface ChatRequest {
  conversation_id?: string | null;
  message: string;
  // Accepted for API compatibility but not used to pick a connection - the
  // chat route always determines which connection a question belongs to via
  // RAG search across every connection's indexed catalog, never a
  // client-supplied id or a default connection.
  connection_id?: string | null;
}

export interface SQLInfo {
  query: string;
  visible: boolean;
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
  /** Whole answer, from question received to response ready. */
  total_time_ms: number;
  row_count: number;
}

export interface ChatResponse {
  conversation_id: string;
  message_id: string;
  request_id: string;
  status: string;
  summary: string;
  insights: string[];
  visualization: VisualizationSpec | null;
  table: TableData | null;
  metadata: ChatMetadata;
  sql: SQLInfo | null;
  progress: Record<string, unknown>[];
  errors: string[];
}

export function emptyChatMetadata(): ChatMetadata {
  return { kpis: [], metrics: [], dimensions: [], execution_time_ms: 0, total_time_ms: 0, row_count: 0 };
}
