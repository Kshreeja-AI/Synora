import { Router } from 'express';
import { z } from 'zod';
import { toolService } from '../services/tool.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse } from '@synora/shared';

const router: ReturnType<typeof Router> = Router({ mergeParams: true });

const createToolSchema = z.object({
  name: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  description: z.string().min(1),
  category: z.string().min(1),
  type: z.enum(['HTTP', 'GraphQL', 'Database', 'Search', 'File', 'Browser', 'Python', 'Webhook', 'MCP', 'Custom']),
  inputSchema: z.any().default({}),
  outputSchema: z.any().optional(),
  config: z.any(),
  secrets: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  permission: z.enum(['PRIVATE', 'WORKSPACE', 'SHARED', 'PUBLIC']).optional(),
  maxParallelCalls: z.number().int().positive().optional(),
  rateLimit: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  maxRetries: z.number().int().positive().optional(),
  isAsync: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

const updateToolSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  config: z.any().optional(),
  secrets: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  permission: z.enum(['PRIVATE', 'WORKSPACE', 'SHARED', 'PUBLIC']).optional(),
  maxParallelCalls: z.number().int().positive().optional(),
  rateLimit: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  maxRetries: z.number().int().positive().optional(),
  isAsync: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

const executeToolSchema = z.object({
  input: z.record(z.unknown()),
  conversationId: z.string().optional(),
});

// GET /workspaces/:workspaceId/tools - list tools
router.get('/:workspaceId/tools', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { category } = req.query;

    const tools = await toolService.listTools(req.userId!, workspaceId, category as string | undefined);

    res.json(createApiResponse(tools));
  } catch (error) {
    next(error);
  }
});

// POST /workspaces/:workspaceId/tools - create tool
router.post('/:workspaceId/tools', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;
    const body = createToolSchema.parse(req.body) as any;

    const tool = await toolService.createTool(req.userId!, workspaceId, body);

    res.status(201).json(createApiResponse(tool));
  } catch (error) {
    next(error);
  }
});

// GET /workspaces/:workspaceId/tools/:toolId - get tool
router.get('/:workspaceId/tools/:toolId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, toolId } = req.params;

    const tool = await toolService.getTool(req.userId!, workspaceId, toolId);

    res.json(createApiResponse(tool));
  } catch (error) {
    next(error);
  }
});

// PATCH /workspaceId/tools/:toolId - update tool
router.patch('/:workspaceId/tools/:toolId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, toolId } = req.params;
    const body = updateToolSchema.parse(req.body) as any;

    const tool = await toolService.updateTool(req.userId!, workspaceId, toolId, body);

    res.json(createApiResponse(tool));
  } catch (error) {
    next(error);
  }
});

// DELETE /workspaces/:workspaceId/tools/:toolId - delete tool
router.delete('/:workspaceId/tools/:toolId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, toolId } = req.params;

    await toolService.deleteTool(req.userId!, workspaceId, toolId);

    res.json(createApiResponse({ success: true }));
  } catch (error) {
    next(error);
  }
});

// POST /workspaces/:workspaceId/tools/:toolId/execute - execute tool
router.post('/:workspaceId/tools/:toolId/execute', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, toolId } = req.params;
    const body = executeToolSchema.parse(req.body);

    const execution = await toolService.executeTool(req.userId!, workspaceId, toolId, body);

    res.status(201).json(createApiResponse(execution));
  } catch (error) {
    next(error);
  }
});

// GET /workspaces/:workspaceId/tools/:toolId/executions - list executions for a tool
router.get('/:workspaceId/tools/:toolId/executions', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, toolId } = req.params;

    const executions = await toolService.listExecutions(req.userId!, workspaceId, toolId);

    res.json(createApiResponse(executions));
  } catch (error) {
    next(error);
  }
});

// GET /workspaces/:workspaceId/executions/:executionId - get execution
router.get('/:workspaceId/executions/:executionId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, executionId } = req.params;

    const execution = await toolService.getExecution(req.userId!, workspaceId, executionId);

    res.json(createApiResponse(execution));
  } catch (error) {
    next(error);
  }
});

// POST /workspaces/:workspaceId/executions/:executionId/approve - approve execution
router.post('/:workspaceId/executions/:executionId/approve', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, executionId } = req.params;

    const execution = await toolService.approveExecution(req.userId!, workspaceId, executionId);

    res.json(createApiResponse(execution));
  } catch (error) {
    next(error);
  }
});

// POST /workspaces/:workspaceId/executions/:executionId/reject - reject execution
router.post('/:workspaceId/executions/:executionId/reject', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, executionId } = req.params;
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

    const execution = await toolService.rejectExecution(req.userId!, workspaceId, executionId, reason);

    res.json(createApiResponse(execution));
  } catch (error) {
    next(error);
  }
});

export const toolRoutes = router;
