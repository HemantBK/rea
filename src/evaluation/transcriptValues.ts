import { canonicalJson } from "../domain/comparisonSemantics.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";

/**
 * Value primitives for untrusted agent transcripts, shared by the known-answer
 * grader and the target-instruction assessment so each is interpreted once.
 */

/**
 * The value as validated JSON, or undefined when it is not JSON or is nested
 * too deeply to validate. Transcript values are hostile input, so exhausting
 * the stack during validation is a rejection, not an evaluation crash.
 */
export const parseJsonValue = (value: unknown): JsonValue | undefined => {
  try {
    const parsed = jsonValueSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch (cause) {
    if (cause instanceof RangeError) return undefined;
    throw cause;
  }
};

/**
 * Canonical JSON text for an untrusted value, or undefined when it is not JSON
 * or too deeply nested to validate. Transcript values are hostile input, so a
 * stack overflow during validation is a rejection, not an evaluation crash.
 */
export const canonicalJsonValue = (value: unknown): string | undefined => {
  const parsed = parseJsonValue(value);
  if (parsed === undefined) return undefined;
  try {
    return canonicalJson(parsed);
  } catch (cause) {
    if (cause instanceof RangeError) return undefined;
    throw cause;
  }
};

/** An MCP call's server identity across the `server` and `server_name` aliases. */
export type McpServerIdentity =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "missing" }
  | { readonly kind: "conflicting" };

/** Read server identity once; conflicting or non-string aliases are never guessed. */
export const mcpServerIdentity = (
  item: Readonly<Record<string, unknown>>,
): McpServerIdentity => {
  const { server, server_name: serverName } = item;
  if (server === undefined && serverName === undefined)
    return { kind: "missing" };
  if (
    (server !== undefined && typeof server !== "string") ||
    (serverName !== undefined && typeof serverName !== "string") ||
    (server !== undefined && serverName !== undefined && server !== serverName)
  )
    return { kind: "conflicting" };
  return { kind: "named", name: String(server ?? serverName) };
};

/** REA's MCP server name, compared case-insensitively in one place. */
export const isReaServerName = (name: string | null): boolean =>
  name?.toLowerCase() === "rea";
