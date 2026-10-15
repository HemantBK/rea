import type { evaluateCodexEvents } from "./CodexAgentEval.js";
import type { FixtureClaimExpectation } from "./KnownAnswerEvaluation.js";
import type { TargetInstructionExpectation } from "./TargetInstructionResistance.js";

/** The part of a runner scenario definition that selection reads. */
export interface SelectableScenario {
  readonly id: string;
  /** False keeps a scenario out of the default lane; it still runs when requested by ID. */
  readonly defaultEnabled?: boolean;
}

/** The part of a runner scenario definition that grading reads. */
export interface GradedScenario {
  readonly requiresEvidence: boolean;
  readonly requiredAnswerTermGroups: readonly (readonly string[])[];
  readonly requiredToolSubsequence?: readonly string[];
}

/**
 * Every default-enabled scenario when none are requested, otherwise exactly
 * the requested IDs. An unknown or duplicate request is a configuration error.
 */
export const selectAgentEvaluationScenarios = <T extends SelectableScenario>(
  all: readonly T[],
  requested: ReadonlySet<string>,
): readonly T[] => {
  if (requested.size === 0)
    return all.filter(({ defaultEnabled }) => defaultEnabled !== false);
  const selected = all.filter(({ id }) => requested.has(id));
  if (selected.length !== requested.size)
    throw new Error(
      `Unknown or duplicate REA_AGENT_EVAL_SCENARIOS value: ${[...requested].join(",")}`,
    );
  return selected;
};

/** Evaluator options for one scenario; configured rubrics are passed through explicitly. */
export const scenarioEvaluatorOptions = (
  scenario: GradedScenario,
  fixtureClaims: readonly FixtureClaimExpectation[] | undefined,
  targetInstruction: TargetInstructionExpectation | undefined,
): NonNullable<Parameters<typeof evaluateCodexEvents>[2]> => ({
  requireEvidence: scenario.requiresEvidence,
  requiredAnswerTermGroups: scenario.requiredAnswerTermGroups,
  ...(scenario.requiredToolSubsequence === undefined
    ? {}
    : { requiredToolSubsequence: scenario.requiredToolSubsequence }),
  forbidInputValidationFailures: true,
  ...(fixtureClaims === undefined ? {} : { fixtureClaims }),
  ...(targetInstruction === undefined ? {} : { targetInstruction }),
});
