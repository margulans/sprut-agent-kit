export type RouterAction =
  | "route_scout_explicit"
  | "route_assistant_explicit"
  | "intercept_local_clarification"
  | "intercept_cached_status"
  | "intercept_source_cached"
  | "intercept_source_no_cache"
  | "defer_guard_llm";

export interface RouterContractInput {
  text: string;
  hasImage: boolean;
  hasVoice: boolean;
  explicitScout: boolean;
  explicitAssistant: boolean;
  hasCachedScout: boolean;
  hasLocalClarification: boolean;
  sourceFollowUp: boolean;
  resultsFollowUp: boolean;
  statusFollowUp: boolean;
  contextualScoutFollowUp: boolean;
}

export interface RouterContractDecision {
  action: RouterAction;
  reason: string;
  confidence: number;
}

export function decideRouterContract(input: RouterContractInput): RouterContractDecision {
  if (input.explicitScout) {
    return {
      action: "route_scout_explicit",
      reason: "Explicit Scout command has highest priority.",
      confidence: 1,
    };
  }

  if (input.explicitAssistant) {
    return {
      action: "route_assistant_explicit",
      reason: "Explicit assistant-only intent bypasses Scout routing.",
      confidence: 1,
    };
  }

  if (input.hasLocalClarification && input.hasCachedScout) {
    return {
      action: "intercept_local_clarification",
      reason: "Short contextual follow-up can be answered from last Scout result.",
      confidence: 0.95,
    };
  }

  if (input.sourceFollowUp && input.hasCachedScout) {
    return {
      action: "intercept_source_cached",
      reason: "Source follow-up should return provenance from cache.",
      confidence: 0.95,
    };
  }

  if (input.sourceFollowUp && !input.hasCachedScout) {
    return {
      action: "intercept_source_no_cache",
      reason: "Source follow-up without cache should return deterministic fallback.",
      confidence: 0.95,
    };
  }

  if (input.hasCachedScout && (input.resultsFollowUp || input.statusFollowUp || input.contextualScoutFollowUp)) {
    return {
      action: "intercept_cached_status",
      reason: "Follow-up after Scout response should resolve from chat state/cache first.",
      confidence: 0.9,
    };
  }

  return {
    action: "defer_guard_llm",
    reason: "No explicit/stateful route; continue with guard and LLM ownership checks.",
    confidence: 0.6,
  };
}
