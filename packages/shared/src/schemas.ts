import { z } from "zod";
import { permissionModeSchema } from "./permission";

export const sessionIdSchema = z.string().regex(/^ses_[0-9a-z]{8,}$/, "expected a session id");
export const messageIdSchema = z.string().regex(/^msg_[0-9a-z]{8,}$/, "expected a message id");
export const partIdSchema = z.string().regex(/^prt_[0-9a-z]{8,}$/, "expected a part id");
export const toolCallIdSchema = z.string().regex(/^call_[0-9a-z]{8,}$/, "expected a tool call id");

export const usageSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  reasoning: z.number().nonnegative().optional(),
});

export const toolOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("json"), value: z.unknown() }),
  z.object({
    kind: z.literal("diff"),
    diff: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        status: z.string(),
      }),
    ),
  }),
  z.object({ kind: z.literal("image"), mime: z.string(), data: z.string() }),
  z.object({
    kind: z.literal("terminal"),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
  }),
  z.object({ kind: z.literal("structured"), schema: z.string(), value: z.unknown() }),
]);

export type ToolOutput = z.infer<typeof toolOutputSchema>;

export const toolStateSchema = z.object({
  status: z.enum(["pending", "running", "completed", "error", "denied"]),
  input: z.unknown().optional(),
  output: toolOutputSchema.optional(),
  error: z.string().optional(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
});

export type ToolState = z.infer<typeof toolStateSchema>;

const partBase = {
  id: partIdSchema,
};

export const textPartSchema = z.object({
  ...partBase,
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
});

export const reasoningPartSchema = z.object({
  ...partBase,
  type: z.literal("reasoning"),
  text: z.string(),
  providerMetadata: z.unknown().optional(),
});

export const toolCallPartSchema = z.object({
  ...partBase,
  type: z.literal("tool-call"),
  callID: toolCallIdSchema,
  tool: z.string(),
  input: z.unknown(),
});

export const toolResultPartSchema = z.object({
  ...partBase,
  type: z.literal("tool-result"),
  callID: toolCallIdSchema,
  output: toolOutputSchema,
  state: toolStateSchema,
});

export const filePartSchema = z.object({
  ...partBase,
  type: z.literal("file"),
  mime: z.string(),
  url: z.string().optional(),
  filename: z.string().optional(),
});

export const stepStartPartSchema = z.object({
  ...partBase,
  type: z.literal("step-start"),
});

export const stepFinishPartSchema = z.object({
  ...partBase,
  type: z.literal("step-finish"),
  usage: usageSchema.optional(),
});

export const patchPartSchema = z.object({
  ...partBase,
  type: z.literal("patch"),
  path: z.string(),
  diff: z.string(),
});

export const snapshotPartSchema = z.object({
  ...partBase,
  type: z.literal("snapshot"),
  hash: z.string(),
  at: z.string(),
});

export const partSchema = z.discriminatedUnion("type", [
  textPartSchema,
  reasoningPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  filePartSchema,
  stepStartPartSchema,
  stepFinishPartSchema,
  patchPartSchema,
  snapshotPartSchema,
]);

export type Part = z.infer<typeof partSchema>;

export const messageSchema = z.object({
  id: messageIdSchema,
  sessionID: sessionIdSchema,
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(partSchema),
  createdAt: z.iso.datetime(),
  modelID: z.string().optional(),
  usage: usageSchema.optional(),
  error: z.string().optional(),
});

export type Message = z.infer<typeof messageSchema>;

export const sessionStatusSchema = z.enum([
  "idle",
  "running",
  "waiting_permission",
  "error",
  "archived",
]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSchema = z.object({
  id: sessionIdSchema,
  title: z.string(),
  cwd: z.string(),
  gitRoot: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
  model: z.string(),
  agent: z.string(),
  parentID: sessionIdSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: sessionStatusSchema,
  tokens: usageSchema,
  cost: z.number().nonnegative(),
  permissions: permissionModeSchema,
  metadata: z.record(z.string(), z.unknown()),
});

export type Session = z.infer<typeof sessionSchema>;
