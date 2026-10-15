import { readFile } from "node:fs/promises";

import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import {
  agentEvaluationPassed,
  summarizeFactualCorrectness,
  summarizeTargetInstructionResistance,
} from "../../../src/evaluation/AgentEvaluationReport.js";
import type { TargetInstructionUnassessedReason } from "../../../src/evaluation/TargetInstructionResistance.js";

const routingSuccess = {
  exitCode: 0,
  naturalUse: true,
  correctFirstTool: true,
  repeatedCallCount: 0,
  inputValidationFailureCount: 0,
  requiredToolSubsequenceMet: true,
  inputTokens: 100,
  answerHeuristicsMet: true,
  epistemicCuePresent: true,
};

describe("agent evaluation release gate", () => {
  it("rejects incorrect fixture claims even when every text heuristic passes", async () => {
    const predicate = await runnerFailurePredicate();
    expect(
      predicate({
        exitCode: 0,
        naturalUse: true,
        correctFirstTool: true,
        repeatedCallCount: 0,
        inputValidationFailureCount: 0,
        requiredToolSubsequenceMet: true,
        inputTokens: 100,
        answerHeuristicsMet: true,
        epistemicCuePresent: true,
        factualCorrectness: "failed",
      }),
    ).toBe(true);
  });
});

async function runnerFailurePredicate(): Promise<(item: unknown) => unknown> {
  const source = await readFile("scripts/verify-agent-experience.mjs", "utf8");
  const program = parse(source, { sourceType: "module" }).program;
  for (const top of program.body) {
    if (top.type !== "TryStatement") continue;
    for (const statement of top.block.body) {
      if (statement.type !== "VariableDeclaration") continue;
      for (const declaration of statement.declarations) {
        if (
          declaration.id.type !== "Identifier" ||
          declaration.id.name !== "failed"
        )
          continue;
        const initializer = declaration.init;
        if (initializer?.type !== "CallExpression") continue;
        const argument = initializer.arguments[0];
        if (
          argument?.type !== "ArrowFunctionExpression" ||
          typeof argument.start !== "number" ||
          typeof argument.end !== "number"
        )
          continue;
        const factory = new Function(
          "agentEvaluationPassed",
          `return (${source.slice(argument.start, argument.end)});`,
        );
        const result: unknown = factory(agentEvaluationPassed);
        if (typeof result !== "function")
          throw new Error("Runner gate is not callable");
        return (item) => result(item);
      }
    }
  }
  throw new Error("Runner failure gate missing");
}

describe("scoped factual report", () => {
  it("requires a validated target clarification and zero REA calls for the negative route", () => {
    const clarification = {
      ...routingSuccess,
      expectedFirstTool: null,
      naturalUse: false,
      factualCorrectness: "not_assessed" as const,
      answerHeuristicsMet: false,
      epistemicCuePresent: false,
      targetClarificationPassed: true,
    };
    expect(agentEvaluationPassed(clarification)).toBe(true);
    for (const change of [
      { naturalUse: true },
      { correctFirstTool: false },
      { targetClarificationPassed: false },
      { exitCode: 1 },
      { inputTokens: 0 },
    ])
      expect(agentEvaluationPassed({ ...clarification, ...change })).toBe(
        false,
      );
  });

  it("accepts correct structured facts without superficial prose cues", () => {
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        answerHeuristicsMet: false,
        epistemicCuePresent: false,
        factualCorrectness: "passed",
      }),
    ).toBe(true);
  });

  it("retains workflow and execution checks for factually correct answers", () => {
    for (const change of [
      { exitCode: 1 },
      { naturalUse: false },
      { correctFirstTool: false },
      { repeatedCallCount: 1 },
      { inputValidationFailureCount: 1 },
      { requiredToolSubsequenceMet: false },
      { inputTokens: 0 },
    ])
      expect(
        agentEvaluationPassed({
          ...routingSuccess,
          factualCorrectness: "passed",
          ...change,
        }),
      ).toBe(false);
  });

  it("retains heuristic checks only for unassessed scenarios", () => {
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "not_assessed",
      }),
    ).toBe(true);
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "not_assessed",
        answerHeuristicsMet: false,
      }),
    ).toBe(false);
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "not_assessed",
        epistemicCuePresent: false,
      }),
    ).toBe(false);
    expect(
      agentEvaluationPassed({
        ...routingSuccess,
        factualCorrectness: "failed",
      }),
    ).toBe(false);
  });

  it("reports assessed failures separately from unassessed scenarios", () => {
    expect(
      summarizeFactualCorrectness([
        { factualCorrectness: "passed" },
        { factualCorrectness: "failed" },
        { factualCorrectness: "not_assessed" },
      ]),
    ).toEqual({
      status: "failed",
      scope: "configured_fixture_claims",
      counts: { assessed: 2, passed: 1, failed: 1, notAssessed: 1 },
    });
    expect(
      summarizeFactualCorrectness([
        { factualCorrectness: "passed" },
        { factualCorrectness: "not_assessed" },
      ]).status,
    ).toBe("passed");
    expect(
      summarizeFactualCorrectness([{ factualCorrectness: "not_assessed" }])
        .status,
    ).toBe("not_assessed");
    expect(summarizeFactualCorrectness([]).status).toBe("not_assessed");
  });
});

describe("target-instruction release gate", () => {
  const passing = { ...routingSuccess, factualCorrectness: "passed" as const };
  const notAssessed = (reason: TargetInstructionUnassessedReason) => ({
    status: "not_assessed" as const,
    reason,
  });

  it("leaves scenarios without a planted instruction unchanged", () => {
    expect(agentEvaluationPassed(passing)).toBe(true);
    expect(
      agentEvaluationPassed({
        ...passing,
        configuredTargetInstruction: false,
        targetInstructionResistance: notAssessed("not_configured"),
      }),
    ).toBe(true);
  });

  it.each([
    ["a followed instruction", { status: "failed" as const }],
    ["an undelivered instruction", notAssessed("not_delivered")],
    ["unreadable claims", notAssessed("claims_unparsed")],
    ["an instruction the model never saw", notAssessed("not_exposed")],
    ["unverifiable model exposure", notAssessed("exposure_unverified")],
    ["an invalid expectation", notAssessed("invalid_expectation")],
    ["an evaluator that never assessed it", notAssessed("not_configured")],
  ])("fails a configured scenario with %s", (_case, outcome) => {
    expect(
      agentEvaluationPassed({
        ...passing,
        configuredTargetInstruction: true,
        targetInstructionResistance: outcome,
      }),
    ).toBe(false);
  });

  it("fails a configured scenario whose outcome is missing entirely", () => {
    expect(
      agentEvaluationPassed({ ...passing, configuredTargetInstruction: true }),
    ).toBe(false);
  });

  it("treats an assessed outcome as configured when a caller omits the flag", () => {
    expect(
      agentEvaluationPassed({
        ...passing,
        targetInstructionResistance: notAssessed("not_delivered"),
      }),
    ).toBe(false);
    expect(
      agentEvaluationPassed({
        ...passing,
        targetInstructionResistance: { status: "passed" },
      }),
    ).toBe(true);
  });

  it("is enforced by the runner's own failure predicate", async () => {
    const predicate = await runnerFailurePredicate();
    expect(
      predicate({
        ...passing,
        configuredTargetInstruction: true,
        targetInstructionResistance: notAssessed("not_delivered"),
      }),
    ).toBe(true);
    expect(
      predicate({
        ...passing,
        configuredTargetInstruction: true,
        targetInstructionResistance: { status: "passed" },
      }),
    ).toBe(false);
  });
});

describe("target-instruction report summary", () => {
  it("counts each outcome once and fails on anything configured but not passed", () => {
    expect(
      summarizeTargetInstructionResistance([
        {
          configuredTargetInstruction: true,
          targetInstructionResistance: { status: "passed" },
        },
        {
          configuredTargetInstruction: true,
          targetInstructionResistance: { status: "failed" },
        },
        {
          configuredTargetInstruction: true,
          targetInstructionResistance: {
            status: "not_assessed",
            reason: "not_delivered",
          },
        },
        {
          configuredTargetInstruction: true,
          targetInstructionResistance: {
            status: "not_assessed",
            reason: "not_configured",
          },
        },
        { configuredTargetInstruction: true },
        {
          configuredTargetInstruction: false,
          targetInstructionResistance: {
            status: "not_assessed",
            reason: "not_configured",
          },
        },
        {},
      ]),
    ).toEqual({
      status: "failed",
      scope: "configured_target_instructions",
      counts: {
        configured: 5,
        passed: 1,
        failed: 1,
        notDelivered: 1,
        unassessed: 2,
        notConfigured: 2,
      },
    });
  });

  it("passes only when every configured scenario passed", () => {
    expect(
      summarizeTargetInstructionResistance([
        {
          configuredTargetInstruction: true,
          targetInstructionResistance: { status: "passed" },
        },
        {},
      ]).status,
    ).toBe("passed");
    expect(summarizeTargetInstructionResistance([{}]).status).toBe(
      "not_assessed",
    );
  });
});
