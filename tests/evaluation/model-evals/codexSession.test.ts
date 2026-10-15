import { describe, expect, it } from "vitest";

import { readCodexSession } from "../../../src/evaluation/CodexSession.js";

describe("Codex session log reading", () => {
  it("reads the model and every tool output the model received", () => {
    expect(
      readCodexSession([
        {
          type: "session_meta",
          payload: { id: "thread-1", cli_version: "0.162.1" },
        },
        { type: "turn_context", payload: { model: "gpt-early" } },
        {
          type: "response_item",
          payload: { type: "custom_tool_call", call_id: "a", input: "..." },
        },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "a",
            output: [{ type: "input_text", text: "seen" }],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "b",
            output: "also seen",
          },
        },
        { type: "turn_context", payload: { model: "gpt-late" } },
      ]),
    ).toEqual({
      readable: true,
      model: "gpt-late",
      toolOutputs: [[{ type: "input_text", text: "seen" }], "also seen"],
    });
  });

  it("ignores client-side event copies, which are not what the model received", () => {
    expect(
      readCodexSession([
        { type: "session_meta", payload: {} },
        {
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: { type: "mcp_tool_call", result: "full client result" },
          },
        },
      ]).toolOutputs,
    ).toEqual([]);
  });

  it("is unreadable without a session header and tolerates malformed records", () => {
    expect(
      readCodexSession([
        42,
        null,
        "x",
        { type: "response_item" },
        { payload: [] },
      ]),
    ).toEqual({
      readable: false,
      model: null,
      toolOutputs: [],
    });
  });
});
