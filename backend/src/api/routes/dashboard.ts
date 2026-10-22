import { Router } from "express";
import { currentUserId } from "../../core/auth";
import { PinnedWidgetCreateSchema, PinnedWidgetOrderSchema } from "../../schemas/pinnedWidget";
import { asyncHandler } from "../asyncHandler";
import { getPinnedWidgetRepository } from "../dependencies";
import { HttpError } from "../errorHandler";

export const dashboardRouter = Router();

/** Widgets pinned from the chat UI - each a saved snapshot of one chat
 * response, not a live re-run query (see `PinnedWidgetCreateSchema`). */
dashboardRouter.get(
  "/api/dashboard/widgets",
  asyncHandler(async (_req, res) => {
    const repo = getPinnedWidgetRepository();
    res.json(await repo.list(currentUserId(res)));
  })
);

dashboardRouter.post(
  "/api/dashboard/widgets",
  asyncHandler(async (req, res) => {
    const payload = PinnedWidgetCreateSchema.parse(req.body);
    const repo = getPinnedWidgetRepository();
    res.status(201).json(await repo.create(currentUserId(res), payload));
  })
);

/** Saves the drag-and-drop order of the user's dashboard. Registered before
 * the `:widgetId` routes so "order" is never taken for an id. */
dashboardRouter.put(
  "/api/dashboard/widgets/order",
  asyncHandler(async (req, res) => {
    const { ids } = PinnedWidgetOrderSchema.parse(req.body);
    await getPinnedWidgetRepository().saveOrder(currentUserId(res), ids);
    res.status(204).end();
  })
);

dashboardRouter.delete(
  "/api/dashboard/widgets/:widgetId",
  asyncHandler(async (req, res) => {
    const repo = getPinnedWidgetRepository();
    const deleted = await repo.delete(currentUserId(res), req.params.widgetId);
    if (!deleted) throw new HttpError(404, "Pinned widget not found");
    res.status(204).end();
  })
);
