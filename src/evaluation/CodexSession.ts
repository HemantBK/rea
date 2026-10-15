/**
 * The model's side of one Codex run, read from Codex's session log
 * (`$CODEX_HOME/sessions/.../rollout-*-<thread id>.jsonl`). The `exec --json`
 * transcript records what the Codex client received from tools; the session
 * log records what Codex actually sent to the model, after its own
 * tool-output truncation. Only the latter shows whether the model saw a value.
 */
export interface CodexSessionView {
  /** Whether the records contained the session header this reader expects. */
  readonly readable: boolean;
  /** The model named by the last turn context, or null when none was recorded. */
  readonly model: string | null;
  /** Each tool output exactly as the model received it, in order. */
  readonly toolOutputs: readonly unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read the parts of a Codex session log that describe the model's inputs. */
export const readCodexSession = (
  records: readonly unknown[],
): CodexSessionView => {
  let readable = false;
  let model: string | null = null;
  const toolOutputs: unknown[] = [];
  for (const record of records) {
    if (!isRecord(record) || !isRecord(record.payload)) continue;
    const { type, payload } = record;
    if (type === "session_meta") readable = true;
    else if (type === "turn_context" && typeof payload.model === "string")
      model = payload.model;
    // Tool results the model received; client-side event copies are ignored.
    else if (
      type === "response_item" &&
      typeof payload.type === "string" &&
      payload.type.endsWith("_output")
    )
      toolOutputs.push(payload.output);
  }
  return { readable, model, toolOutputs };
};
