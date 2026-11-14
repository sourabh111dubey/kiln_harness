import { z } from "zod";
import {
  messageIdSchema,
  messageSchema,
  partSchema,
  sessionIdSchema,
  sessionSchema,
  toolCallIdSchema,
  toolOutputSchema,
  usageSchema,
} from "./schemas";

export const permissionRequestSchema = z.object({
  id: z.string(),
  sessionID: sessionIdSchema,
  tool: z.string(),
  input: z.unknown(),
  reason: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type PermissionRequestRecord = z.infer<typeof permissionRequestSchema>;

export const kilncraftEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.created"),
    session: sessionSchema,
  }),
  z.object({
    type: z.literal("session.updated"),
    patch: sessionSchema.partial(),
  }),
  z.object({
    type: z.literal("session.status"),
    status: sessionSchema.shape.status,
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("message.created"),
    message: messageSchema,
  }),
  z.object({
    type: z.literal("message.part.updated"),
    messageID: messageIdSchema,
    part: partSchema,
  }),
  z.object({
    type: z.literal("message.completed"),
    messageID: messageIdSchema,
    usage: usageSchema,
    cost: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("tool.call"),
    callID: toolCallIdSchema,
    tool: z.string(),
    input: z.unknown(),
    sessionID: sessionIdSchema,
  }),
  z.object({
    type: z.literal("tool.result"),
    callID: toolCallIdSchema,
    output: toolOutputSchema,
  }),
  z.object({
    type: z.literal("permission.requested"),
    request: permissionRequestSchema,
  }),
  z.object({
    type: z.literal("permission.resolved"),
    requestID: z.string(),
    decision: z.enum(["allow", "ask", "deny"]),
  }),
  z.object({
    type: z.literal("turn.start"),
    turn: z.number().int().nonnegative(),
    prompt: z.string(),
  }),
  z.object({
    type: z.literal("turn.end"),
    turn: z.number().int().nonnegative(),
    stopReason: z.string(),
    usage: usageSchema,
  }),
  z.object({
    type: z.literal("compaction.started"),
    reason: z.string(),
    tokensBefore: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("compaction.completed"),
    summary: z.string(),
    tokensAfter: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("checkpoint.created"),
    hash: z.string(),
    label: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    error: z.object({
      code: z.string(),
      message: z.string(),
      recoverable: z.boolean(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
    recoverable: z.boolean(),
  }),
  z.object({
    type: z.literal("session.archived"),
    sessionID: sessionIdSchema,
  }),
]);

export type KilncraftEvent = z.infer<typeof kilncraftEventSchema>;
