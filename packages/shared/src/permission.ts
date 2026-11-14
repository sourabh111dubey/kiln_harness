import { z } from "zod";

export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "custom",
]);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionDecisionSchema = z.enum(["allow", "ask", "deny"]);

export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

export const permissionScopeSchema = z.enum(["session", "project", "user"]);

export type PermissionScope = z.infer<typeof permissionScopeSchema>;

export const permissionRuleSchema = z.object({
  tool: z.string().min(1),
  pattern: z.string().optional(),
  decision: permissionDecisionSchema,
  scope: permissionScopeSchema.default("session"),
});

export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export interface PermissionRequest {
  id: string;
  sessionID: string;
  tool: string;
  input: unknown;
  reason?: string;
  createdAt: string;
}

export interface PermissionResolution {
  requestID: string;
  decision: PermissionDecision;
  resolvedAt: string;
  resolvedBy: "user" | "policy" | "plugin";
}
