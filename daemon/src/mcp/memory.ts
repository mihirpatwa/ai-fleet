// In-process MCP server exposing the memory store to a spawned agent. Built
// fresh per spawn so the caller agent + project are captured in closures —
// that's how memory.add / memory.pin are caller-enforced (no shared env race
// across concurrent agents).
import { z } from 'zod';
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import type { FleetDb } from '../db.js';
import { addMemory, listMemories, searchMemories } from '../memory.js';

const ADDERS = new Set(['retrospector', 'scribe']);

const ok = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }] });
const deny = (m: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: m }) }],
  isError: true,
});

export interface MemoryMcpCtx {
  db: FleetDb;
  agent: string;
  projectRoot: string;
  taskId: string;
  shadow: boolean;
}

export function createMemoryMcp(ctx: MemoryMcpCtx): McpSdkServerConfigWithInstance {
  const { db, agent, projectRoot, shadow } = ctx;
  return createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools: [
      tool(
        'search',
        'Search learned memories (FTS5 + tag overlap + confidence). Call this before planning, with tags relevant to the task.',
        {
          query: z.string().optional(),
          tags: z.array(z.string()).optional(),
          agent: z.string().optional(),
          project_root: z.string().optional(),
          top_k: z.number().int().optional(),
        },
        async (a) =>
          ok(
            searchMemories(db, {
              ...(a.query ? { query: a.query } : {}),
              ...(a.tags ? { tags: a.tags } : {}),
              agent: a.agent ?? agent,
              projectRoot: a.project_root ?? projectRoot,
              topK: a.top_k ?? 5,
            }),
          ),
      ),
      tool(
        'add',
        'Record a lesson learned. Restricted to the retrospector and scribe agents.',
        {
          agent: z.string().optional(),
          tags: z.array(z.string()).optional(),
          context: z.string().optional(),
          lesson: z.any(),
          confidence: z.number().optional(),
          project_root: z.string().optional(),
        },
        async (a) => {
          if (!ADDERS.has(agent)) {
            return deny(`memory.add denied for caller '${agent}' (retrospector/scribe only)`);
          }
          return ok(
            addMemory(
              db,
              {
                projectRoot: a.project_root ?? projectRoot,
                agent: a.agent ?? agent,
                ...(a.tags ? { tags: a.tags } : {}),
                ...(a.context ? { context: a.context } : {}),
                lesson: a.lesson,
                ...(typeof a.confidence === 'number' ? { confidence: a.confidence } : {}),
              },
              { shadow },
            ),
          );
        },
      ),
      tool(
        'list',
        'List stored memories for a project.',
        {
          project_root: z.string().optional(),
          agent: z.string().optional(),
          limit: z.number().int().optional(),
        },
        async (a) =>
          ok(
            listMemories(db, {
              projectRoot: a.project_root ?? projectRoot,
              ...(a.agent ? { agent: a.agent } : {}),
              limit: a.limit ?? 20,
            }),
          ),
      ),
      tool(
        'pin',
        'Pin or unpin a memory. Dashboard-only — not callable by agents.',
        { id: z.string(), pinned: z.boolean() },
        async () => deny('memory.pin is dashboard-only'),
      ),
    ],
  });
}
