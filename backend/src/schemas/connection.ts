import { z } from "zod";
import { MYSQL_CONNECTION_TYPE } from "../services/datasource/factory";

export const ConnectionCreateSchema = z.object({
  name: z.string(),
  // MySQL is the only engine this app connects to, so `type` is fixed rather
  // than chosen - it stays on the payload (and on the connections table) so
  // existing rows and clients keep a stable shape, and so a request that
  // names some other engine is rejected here with a clear error rather than
  // deeper down in the datasource factory.
  type: z.literal(MYSQL_CONNECTION_TYPE).default(MYSQL_CONNECTION_TYPE),
  host: z.string().nullable().optional(),
  port: z.number().int().nullable().optional(),
  database: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  ssl: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type ConnectionCreate = z.infer<typeof ConnectionCreateSchema>;

/** Draft test payload. When editing a saved connection the form leaves the
 * password blank ("keep unchanged"), so `connection_id` lets the test fall
 * back to that connection's stored password instead of trying none. */
export const ConnectionTestSchema = ConnectionCreateSchema.extend({
  connection_id: z.string().nullable().optional(),
});

export const ConnectionUpdateSchema = z.object({
  name: z.string().nullable().optional(),
  host: z.string().nullable().optional(),
  port: z.number().int().nullable().optional(),
  database: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  ssl: z.boolean().nullable().optional(),
  enabled: z.boolean().nullable().optional(),
});
export type ConnectionUpdate = z.infer<typeof ConnectionUpdateSchema>;

export interface ConnectionOut {
  id: string;
  name: string;
  // Always "mysql" for connections created through this app; typed as a
  // plain string because it is read back from the connections table, which
  // may still hold rows created before MySQL became the only engine.
  type: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  ssl: boolean;
  enabled: boolean;
  is_default: boolean;
  has_password: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}
