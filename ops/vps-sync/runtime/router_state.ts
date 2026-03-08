export type ChatRouteOwner = "scout" | "assistant";

interface RouterChatState {
  lastRoute: ChatRouteOwner;
  lastScoutRequestId?: string;
  updatedAtMs: number;
}

const ROUTER_STATE_TTL_MS = 30 * 60_000;
const chatState = new Map<number, RouterChatState>();

export function getRouterChatState(chatId: number): RouterChatState | null {
  const current = chatState.get(chatId);
  if (!current) return null;
  if (Date.now() - current.updatedAtMs > ROUTER_STATE_TTL_MS) {
    chatState.delete(chatId);
    return null;
  }
  return current;
}

export function markScoutRoute(chatId: number, requestId: string): void {
  chatState.set(chatId, {
    lastRoute: "scout",
    lastScoutRequestId: requestId,
    updatedAtMs: Date.now(),
  });
}

export function markAssistantRoute(chatId: number): void {
  chatState.set(chatId, {
    lastRoute: "assistant",
    updatedAtMs: Date.now(),
  });
}

export function isLikelyContextualScoutFollowUp(text: string, chatId: number): boolean {
  const state = getRouterChatState(chatId);
  if (!state || state.lastRoute !== "scout") return false;

  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 140) return false;

  const contextualStarts = [
    "это",
    "а ",
    "и ",
    "что ",
    "как ",
    "сколько",
    "где ",
    "когда ",
    "кто ",
    "почему",
    "какой",
    "какая",
    "какие",
    "то есть",
    "имел в виду",
    "имею в виду",
  ];
  const hasQuestion = normalized.includes("?");
  const hasContextualStart = contextualStarts.some((prefix) => normalized.startsWith(prefix));
  return hasQuestion || hasContextualStart;
}
