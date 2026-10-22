export interface ConnectionRow {
  id: string;
  name: string;
  type: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  password_encrypted: string | null;
  ssl: number;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface SemanticModelVersionRow {
  id: string;
  data_source_id: string | null;
  version_number: number;
  content_json: string;
  status: string;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  user_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content_json: string;
  created_at: string;
}

export interface PinnedWidgetRow {
  id: string;
  user_id: string | null;
  sort_order: number | null;
  title: string;
  question: string;
  conversation_id: string | null;
  message_id: string | null;
  snapshot_json: string;
  created_at: string;
}
