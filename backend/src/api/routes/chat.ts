import { randomUUID } from "node:crypto";
import { Response, Router } from "express";
import { DataSourceRouter } from "../../agents/dataSourceRouter";
import { DeepAgent } from "../../agents/deepAgent";
import { currentUserId } from "../../core/auth";
import { conversationIdVar, getLogger, requestIdVar } from "../../core/logging";
import { ConversationNotFoundError } from "../../repositories/conversationRepository";
import { AgentStatus } from "../../schemas/agent";
import { ChatRequestSchema, ChatResponse, emptyChatMetadata } from "../../schemas/chat";
import { DataSourceRegistry } from "../../services/datasource/registry";
import { asyncHandler } from "../asyncHandler";
import { HttpError } from "../errorHandler";
import {
  getChatModelDep,
  getConnectionRepository,
  getConversationRepository,
  getDatasourceRegistry,
  getRagAgentDep,
  getSemanticPlannerChatModelDep,
  getSemanticRepository,
  getSettingsDep,
  getSqlChatModelDep,
  getToolCallingChatModelDep,
} from "../dependencies";

const logger = getLogger("api.routes.chat");
export const chatRouter = Router();

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorChatResponse(conversationId: string, message: string): ChatResponse {
  return {
    conversation_id: conversationId,
    message_id: randomUUID(),
    request_id: requestIdVar.get(),
    status: "error",
    summary: message,
    insights: [],
    visualization: null,
    table: null,
    metadata: emptyChatMetadata(),
    sql: null,
    progress: [],
    errors: [message],
  };
}

/**
 * One request's DeepAgent. The data source is NOT chosen here: the agent's
 * planner runs first, then RAG routing (`DataSourceRouter`) picks the data
 * source from the planner's subject, dimensions and filters, and the Execution Agent only
 * connects - via `datasourceRegistry`, using the `connections` row whose id
 * is that data source id - once valid SQL exists for it. A client-supplied
 * `connection_id` is never used.
 */
function buildDeepAgent(datasourceRegistry: DataSourceRegistry): DeepAgent {
  const settings = getSettingsDep();
  const ragAgent = getRagAgentDep();
  const plannerChatModel = getSemanticPlannerChatModelDep();
  const router = new DataSourceRouter(getConnectionRepository(), getSemanticRepository(), ragAgent, plannerChatModel, {
    scoreThreshold: settings.connectionRoutingScoreThreshold,
    margin: settings.connectionRoutingMargin,
  });
  return new DeepAgent({
    chatModel: getChatModelDep(),
    plannerChatModel,
    toolCallingChatModel: getToolCallingChatModelDep(),
    sqlChatModel: getSqlChatModelDep(),
    router,
    datasourceRegistry,
    retriever: ragAgent.retriever,
    settings,
  });
}

/** The signed-in user's conversation (created when new). Another user's
 * conversation id is reported as not found rather than appended to. */
async function getOwnConversation(res: Response, conversationId: string | null | undefined, title: string) {
  try {
    return await getConversationRepository().getOrCreate(currentUserId(res), conversationId, title);
  } catch (err) {
    if (err instanceof ConversationNotFoundError) throw new HttpError(404, "Conversation not found");
    throw err;
  }
}

chatRouter.post(
  "/api/chat",
  asyncHandler(async (req, res) => {
    const payload = ChatRequestSchema.parse(req.body);
    requestIdVar.set(randomUUID());
    const conversationRepository = getConversationRepository();

    const conversation = await getOwnConversation(res, payload.conversation_id, payload.message);
    conversationIdVar.set(conversation.id);
    await conversationRepository.addMessage(conversation.id, "user", { message: payload.message });

    const datasourceRegistry = getDatasourceRegistry();
    const deepAgent = buildDeepAgent(datasourceRegistry);
    let state;
    try {
      state = await deepAgent.run(conversation.id, payload.message);
    } finally {
      await datasourceRegistry.closeAll();
    }
    const response = deepAgent.toChatResponse(state, randomUUID());

    await conversationRepository.addMessage(conversation.id, "assistant", response);
    res.json(response);
  })
);

/**
 * Same pipeline as `POST /api/chat`, but emits each real `AgentStatus` over
 * Server-Sent Events as the pipeline reaches it (event: "progress"), instead
 * of only returning the full progress trail once everything is done. The
 * final payload always arrives as event: "result".
 */
chatRouter.post(
  "/api/chat/stream",
  asyncHandler(async (req, res) => {
    const payload = ChatRequestSchema.parse(req.body);
    requestIdVar.set(randomUUID());
    const conversationRepository = getConversationRepository();

    const conversation = await getOwnConversation(res, payload.conversation_id, payload.message);
    conversationIdVar.set(conversation.id);
    await conversationRepository.addMessage(conversation.id, "user", { message: payload.message });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const onProgress = async (status: AgentStatus): Promise<void> => {
      res.write(sseEvent("progress", status));
    };

    const datasourceRegistry = getDatasourceRegistry();
    const deepAgent = buildDeepAgent(datasourceRegistry);
    try {
      const state = await deepAgent.run(conversation.id, payload.message, onProgress);
      const response = deepAgent.toChatResponse(state, randomUUID());
      await conversationRepository.addMessage(conversation.id, "assistant", response);
      res.write(sseEvent("result", response));
    } catch (exc) {
      logger.exception("deep_agent_stream_failed", { error: String(exc) });
      const fallback = errorChatResponse(conversation.id, "An unexpected error occurred while processing your question.");
      await conversationRepository.addMessage(conversation.id, "assistant", fallback).catch((err) =>
        logger.exception("chat_stream_fallback_save_failed", { error: String(err) })
      );
      res.write(sseEvent("result", fallback));
    } finally {
      await datasourceRegistry.closeAll();
      res.end();
    }
  })
);

chatRouter.get(
  "/api/chat/conversations",
  asyncHandler(async (_req, res) => {
    const conversationRepository = getConversationRepository();
    const conversations = await conversationRepository.listConversations(currentUserId(res));
    res.json(
      conversations.map((c) => ({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at }))
    );
  })
);

chatRouter.get(
  "/api/chat/conversations/:conversationId/messages",
  asyncHandler(async (req, res) => {
    const conversationRepository = getConversationRepository();
    const messages = await conversationRepository.getMessages(currentUserId(res), req.params.conversationId);
    if (!messages) throw new HttpError(404, "Conversation not found");
    res.json(
      messages.map((m) => ({ id: m.id, role: m.role, content: JSON.parse(m.content_json), created_at: m.created_at }))
    );
  })
);

chatRouter.delete(
  "/api/chat/conversations/:conversationId",
  asyncHandler(async (req, res) => {
    const conversationRepository = getConversationRepository();
    const deleted = await conversationRepository.delete(currentUserId(res), req.params.conversationId);
    if (!deleted) throw new HttpError(404, "Conversation not found");
    res.status(204).end();
  })
);
