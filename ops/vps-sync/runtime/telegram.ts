import { ensureProjectClaudeMd, run, runUserMessage } from "../runner";
import { getSettings, loadSettings } from "../config";
import { resetSession } from "../sessions";
import { transcribeAudioToText } from "../whisper";
import { decideRouterContract } from "./router_contract";
import { isLikelyContextualScoutFollowUp, markAssistantRoute, markScoutRoute } from "./router_state";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

// --- Markdown → Telegram HTML conversion (ported from nanobot) ---

function markdownToTelegramHtml(text: string): string {
  if (!text) return "";

  // 1. Extract and protect code blocks
  const codeBlocks: string[] = [];
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // 2. Extract and protect inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_m, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // 3. Strip markdown headers
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // 4. Strip blockquotes
  text = text.replace(/^>\s*(.*)$/gm, "$1");

  // 5. Escape HTML special characters
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 6. Links [text](url) — before bold/italic to handle nested cases
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 7. Bold **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");

  // 8. Italic _text_ (avoid matching inside words like some_var_name)
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1</i>");

  // 9. Strikethrough ~~text~~
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 10. Bullet lists
  text = text.replace(/^[-*]\s+/gm, "• ");

  // 11. Restore inline code with HTML tags
  for (let i = 0; i < inlineCodes.length; i++) {
    const escaped = inlineCodes[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(`\x00IC${i}\x00`, `<code>${escaped}</code>`);
  }

  // 12. Restore code blocks with HTML tags
  for (let i = 0; i < codeBlocks.length; i++) {
    const escaped = codeBlocks[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(`\x00CB${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  }

  return text;
}

// --- Telegram Bot API (raw fetch, zero deps) ---

const API_BASE = "https://api.telegram.org/bot";
const FILE_API_BASE = "https://api.telegram.org/file/bot";
const RUNTIME_HOME = process.env.TWIN_HOME_DIR ?? process.env.HOME ?? "/home/claudeclaw";
const RUNTIME_REPO_DIR = process.env.TWIN_REPO_DIR ?? `${RUNTIME_HOME}/sprut-agent-kit`;
const RUNTIME_TWIN_BASE_DIR = process.env.TWIN_BASE_DIR ?? `${RUNTIME_HOME}/twin-sync`;
const RUNTIME_TWIN_STATE_DIR = `${RUNTIME_TWIN_BASE_DIR}/state`;
const SCOUT_REQUEST_DIR = process.env.SCOUT_REQUEST_DIR ?? `${RUNTIME_HOME}/inbox/requests`;
function parseScoutDirList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,:;]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildScoutCheckedDirs(): string[] {
  const envDirs = parseScoutDirList(process.env.SCOUT_CHECKED_DIRS);
  const singleEnvDir = process.env.SCOUT_CHECKED_DIR?.trim() ?? "";
  const defaults = [
    `${RUNTIME_HOME}/checked/canonical`,
    "/home/claudeclaw/checked/canonical",
    "/home/adjutant/checked/canonical",
    `${RUNTIME_HOME}/checked/research`,
    "/home/claudeclaw/checked/research",
    "/home/adjutant/checked/research",
  ];
  const merged = [...envDirs, singleEnvDir, ...defaults].map((value) => value.trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

const SCOUT_CHECKED_DIRS = buildScoutCheckedDirs();
const SCOUT_FAST_PATH_MS = 30_000;
const SCOUT_FALLBACK_MS = 180_000;
const SCOUT_POLL_INTERVAL_MS = 3_000;
const SCOUT_RESEARCH_FAST_PATH_MS = 15_000;
const SCOUT_RESEARCH_ACK_WAIT_MS = 30_000;
const SCOUT_RESEARCH_LATE_DELIVERY_MS = 45 * 60_000;
const SCOUT_SCHEMA_VERSION = "1.0";
const SCOUT_REQUEST_SCHEMA_VERSION = "1.0";
const SCOUT_SEARCH_ENGINE_LABEL = process.env.SCOUT_SEARCH_ENGINE_LABEL ?? "Perplexity";
const TWIN_APPLY_PROPOSAL_SCRIPT =
  process.env.TWIN_APPLY_PROPOSAL_SCRIPT ??
  `${RUNTIME_REPO_DIR}/ops/twin-sync/bot-vps/apply_twin_proposal.py`;
const TWIN_CALLBACK_MAP_PATH =
  process.env.TWIN_CALLBACK_MAP_PATH ??
  `${RUNTIME_TWIN_BASE_DIR}/state/proposal-callback-map.json`;
const TWIN_MEMORY_EVENTS_PATH = `${RUNTIME_TWIN_STATE_DIR}/memory-events.jsonl`;
const TWIN_INTERACTIONS_PATH = `${RUNTIME_TWIN_STATE_DIR}/interactions.jsonl`;
const TWIN_DECISIONS_PATH = `${RUNTIME_TWIN_STATE_DIR}/proposal-decisions.jsonl`;
const ROUTER_GUARD_SCRIPT = `${RUNTIME_REPO_DIR}/ops/vps-sync/runtime/router_guard.py`;

interface TwinProposalDecision {
  decision: "approve" | "reject";
  proposalId: string;
  comment: string;
}

interface TwinProposalDecisionResult {
  ok?: boolean;
  decision?: string;
  proposal_id?: string;
  target_agent?: string;
  target_config?: string;
  applied_changes?: number;
  skipped_changes?: number;
  dry_run?: boolean;
  message?: string;
  notes?: string[];
}

interface TwinCallbackMapValue {
  proposal_id?: string;
  created_at?: string;
  expires_at?: string;
}

type TwinCallbackMap = Record<string, TwinCallbackMapValue>;

interface PreLlmGuardDecision {
  matched: boolean;
  scenario?: string;
  route?: "intercept_source" | "force_scout";
  task_type?: ScoutTaskType;
  instructions?: string;
  reason?: string;
}

interface LlmOwnershipDecision {
  addressed_to: "assistant" | "scout";
  confidence: number;
  reason: string;
}

interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  reply_to_message?: { message_id?: number; from?: TelegramUser };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  entities?: Array<{
    type: "mention" | "bot_command" | string;
    offset: number;
    length: number;
  }>;
  caption_entities?: Array<{
    type: "mention" | "bot_command" | string;
    offset: number;
    length: number;
  }>;
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  mime_type?: string;
  duration?: number;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  mime_type?: string;
  duration?: number;
  file_name?: string;
  file_size?: number;
}

interface TelegramChatMember {
  user: TelegramUser;
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
}

interface TelegramMyChatMemberUpdate {
  chat: { id: number; type: string; title?: string };
  from: TelegramUser;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  my_chat_member?: TelegramMyChatMemberUpdate;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramMe {
  id: number;
  username?: string;
  can_read_all_group_messages?: boolean;
}

interface TelegramFile {
  file_path?: string;
}

let telegramDebug = false;

function debugLog(message: string): void {
  if (!telegramDebug) return;
  console.log(`[Telegram][debug] ${message}`);
}

function normalizeTelegramText(text: string): string {
  return text.replace(/[\u2010-\u2015\u2212]/g, "-");
}

function getMessageTextAndEntities(message: TelegramMessage): {
  text: string;
  entities: TelegramMessage["entities"];
} {
  if (message.text) {
    return {
      text: normalizeTelegramText(message.text),
      entities: message.entities,
    };
  }

  if (message.caption) {
    return {
      text: normalizeTelegramText(message.caption),
      entities: message.caption_entities,
    };
  }

  return { text: "", entities: [] };
}

function isImageDocument(document?: TelegramDocument): boolean {
  return Boolean(document?.mime_type?.startsWith("image/"));
}

function isAudioDocument(document?: TelegramDocument): boolean {
  return Boolean(document?.mime_type?.startsWith("audio/"));
}

function pickLargestPhoto(photo: TelegramPhotoSize[]): TelegramPhotoSize {
  return [...photo].sort((a, b) => {
    const sizeA = a.file_size ?? a.width * a.height;
    const sizeB = b.file_size ?? b.width * b.height;
    return sizeB - sizeA;
  })[0];
}

function extensionFromMimeType(mimeType?: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    default:
      return "";
  }
}

function extensionFromAudioMimeType(mimeType?: string): string {
  switch (mimeType) {
    case "audio/mpeg":
      return ".mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/webm":
      return ".webm";
    default:
      return "";
  }
}

function extractTelegramCommand(text: string): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0];
  if (!firstToken.startsWith("/")) return null;
  return firstToken.split("@", 1)[0].toLowerCase();
}

function parseTwinProposalDecision(text: string): TwinProposalDecision | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(approve|reject)\s+([a-z0-9][a-z0-9._:-]{7,127})(?:\s+(.+))?$/i);
  if (!match) return null;
  const decision = match[1].toLowerCase() as "approve" | "reject";
  const proposalId = match[2];
  const comment = (match[3] ?? "").trim();
  return { decision, proposalId, comment };
}

async function executeTwinProposalDecision(payload: TwinProposalDecision): Promise<TwinProposalDecisionResult> {
  const args = [
    "python3",
    TWIN_APPLY_PROPOSAL_SCRIPT,
    "--proposal-id",
    payload.proposalId,
    "--decision",
    payload.decision,
  ];
  if (payload.comment) {
    args.push("--comment", payload.comment);
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `apply_twin_proposal failed with exit=${exitCode}`);
  }

  try {
    return JSON.parse(stdout) as TwinProposalDecisionResult;
  } catch {
    throw new Error(`invalid apply_twin_proposal output: ${stdout.slice(0, 300)}`);
  }
}

async function loadTwinCallbackMap(): Promise<TwinCallbackMap> {
  try {
    const raw = await readFile(TWIN_CALLBACK_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as TwinCallbackMap;
  } catch {
    return {};
  }
}

async function saveTwinCallbackMap(map: TwinCallbackMap): Promise<void> {
  await writeFile(TWIN_CALLBACK_MAP_PATH, JSON.stringify(map, null, 2), "utf8");
}

function isTwinRelatedQuery(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /брат|близнец|twin|openclaw|adjutant|адьютант|общал|обмен|синхр|proposal|памят/.test(normalized);
}

async function readJsonlTail(filePath: string, maxEntries: number): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const tail = lines.slice(-Math.max(1, maxEntries));
    const out: Array<Record<string, unknown>> = [];
    for (const line of tail) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          out.push(parsed as Record<string, unknown>);
        }
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch {
    return [];
  }
}

function formatTwinEventLine(event: Record<string, unknown>): string {
  const ts = typeof event.timestamp === "string" ? event.timestamp : "unknown-time";
  const agent = typeof event.agent_id === "string" ? event.agent_id : "unknown-agent";
  const domain = typeof event.domain === "string" ? event.domain : "unknown-domain";
  const factType = typeof event.fact_type === "string" ? event.fact_type : "fact";
  const payload = event.fact_payload && typeof event.fact_payload === "object" ? event.fact_payload : null;
  const preview = payload ? JSON.stringify(payload).slice(0, 140) : "";
  return `- ${ts} | ${agent} | ${domain}/${factType}${preview ? ` | ${preview}` : ""}`;
}

function formatTwinInteractionLine(item: Record<string, unknown>): string {
  const ts = typeof item.timestamp === "string" ? item.timestamp : "unknown-time";
  const from = typeof item.from_agent === "string" ? item.from_agent : "unknown";
  const to = typeof item.to_agent === "string" ? item.to_agent : "unknown";
  const title = typeof item.title === "string" ? item.title : "hint";
  const messagePreview = typeof item.message_preview === "string" ? item.message_preview : "";
  return `- ${ts} | ${from} -> ${to} | ${title}${messagePreview ? ` | ${messagePreview.slice(0, 120)}` : ""}`;
}

function formatTwinDecisionLine(item: Record<string, unknown>): string {
  const ts = typeof item.timestamp === "string" ? item.timestamp : "unknown-time";
  const decision = typeof item.decision === "string" ? item.decision : "unknown";
  const proposalId = typeof item.proposal_id === "string" ? item.proposal_id : "unknown-proposal";
  const applied = typeof item.applied_changes === "number" ? item.applied_changes : 0;
  const skipped = typeof item.skipped_changes === "number" ? item.skipped_changes : 0;
  return `- ${ts} | ${decision} | ${proposalId} | applied=${applied} skipped=${skipped}`;
}

async function buildTwinContextReport(maxPerSection = 5): Promise<string> {
  const [events, interactions, decisions] = await Promise.all([
    readJsonlTail(TWIN_MEMORY_EVENTS_PATH, maxPerSection),
    readJsonlTail(TWIN_INTERACTIONS_PATH, maxPerSection),
    readJsonlTail(TWIN_DECISIONS_PATH, maxPerSection),
  ]);

  const lines: string[] = [];
  lines.push("TwinSync context:");
  if (events.length > 0) {
    lines.push("Recent memory events:");
    lines.push(...events.map((event) => formatTwinEventLine(event)));
  } else {
    lines.push("Recent memory events: none");
  }
  if (interactions.length > 0) {
    lines.push("Recent twin interactions:");
    lines.push(...interactions.map((item) => formatTwinInteractionLine(item)));
  } else {
    lines.push("Recent twin interactions: none");
  }
  if (decisions.length > 0) {
    lines.push("Recent proposal decisions:");
    lines.push(...decisions.map((item) => formatTwinDecisionLine(item)));
  } else {
    lines.push("Recent proposal decisions: none");
  }
  return lines.join("\n");
}

function isIsoDateValid(value: string | undefined): boolean {
  if (!value) return false;
  return Number.isFinite(Date.parse(value));
}

function isTwinCallbackExpired(value: TwinCallbackMapValue | undefined): boolean {
  if (!value?.expires_at) return true;
  if (!isIsoDateValid(value.expires_at)) return true;
  const expiresMs = Date.parse(value.expires_at);
  return Date.now() > expiresMs;
}

type ScoutTaskType =
  | "weather_lookup"
  | "web_search"
  | "deep_research"
  | "analyze_topic"
  | "youtube_search"
  | "social_search"
  | "messenger_channels_search";

type ScoutRouteMode = "fast" | "research";

interface ScoutRoutingDecision {
  taskType: ScoutTaskType;
  instructions: string;
  routeMode: ScoutRouteMode;
}

function scoutEngineLabel(taskType: ScoutTaskType): string {
  if (taskType === "weather_lookup") return "wttr.in";
  return SCOUT_SEARCH_ENGINE_LABEL;
}

function isFreshQuestion(text: string, hasImage: boolean, hasVoice: boolean): boolean {
  if (hasImage || hasVoice) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const hardFreshMarkers = [
    "сейчас",
    "на сегодня",
    "актуал",
    "последн",
    "новый",
    "новая",
    "новое",
    "latest",
    "current",
    "right now",
    "this year",
  ];

  const ruQuestionStarts = ["какой", "какая", "какие", "какое", "что", "кто", "где", "когда", "сколько", "каков"];
  const enQuestionStarts = ["which", "what", "who", "where", "when", "how much", "how many"];
  const questionLike =
    normalized.includes("?") ||
    ruQuestionStarts.some((s) => normalized.startsWith(`${s} `) || normalized === s) ||
    enQuestionStarts.some((s) => normalized.startsWith(`${s} `) || normalized === s);

  return questionLike && hardFreshMarkers.some((m) => normalized.includes(m));
}

function requiresExternalFreshData(text: string, hasImage: boolean, hasVoice: boolean): boolean {
  return isFreshQuestion(text, hasImage, hasVoice);
}

function isProductSelectionQuery(text: string, hasImage: boolean, hasVoice: boolean): boolean {
  if (hasImage || hasVoice) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const selectionMarkers = [
    "лучший",
    "лучшие",
    "топ",
    "что выбрать",
    "какой выбрать",
    "сравни",
    "сравнение",
    "best",
    "top",
    "which one",
    "recommend",
  ];

  const productMarkers = [
    "бинокл",
    "тепловиз",
    "прицел",
    "оптик",
    "ноутбук",
    "смартфон",
    "камера",
    "модель",
    "бренд",
    "для охоты",
    "в горах",
    "gear",
    "equipment",
  ];

  const hasSelectionMarker = selectionMarkers.some((m) => normalized.includes(m));
  const hasProductMarker = productMarkers.some((m) => normalized.includes(m));
  return hasSelectionMarker && hasProductMarker;
}

function isExplicitScoutRequest(text: string, hasImage: boolean, hasVoice: boolean): boolean {
  if (hasImage || hasVoice) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (!/\bскаут\b|\bscout\b/i.test(normalized)) return false;

  const actionMarkers = [
    "спроси",
    "спросить",
    "позови",
    "вызови",
    "пусть ответит",
    "через скаута",
    "use scout",
    "ask scout",
    "route to scout",
  ];
  return actionMarkers.some((m) => normalized.includes(m));
}

function detectScoutTaskType(text: string, hasImage: boolean, hasVoice: boolean): ScoutRoutingDecision | null {
  if (hasImage || hasVoice) return null;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  const contains = (s: string): boolean => normalized.includes(s);

  const weatherPatterns = [
    /\bпогод[ауеы]\b/,
    /\bweather\b/,
    /\bпрогноз\b/,
    /\bтемператур[аы]\b/,
    /\bвлажност[ьи]\b/,
    /\bветер\b/,
    /^\/weather\b/,
  ];

  const webSearchPatterns = [
    /\bинтернет(е|у|ом)?\b/,
    /\bв\s+сети\b/,
    /\bнайди\b/,
    /\bпоищи\b/,
    /\bпоиск\b/,
    /\bзагугли\b/,
    /\bgoogle\b/,
    /\bгугл\b/,
    /\bweb\b/,
    /\bsearch\b/,
  ];

  const youtubePatterns = [
    /\byoutube\b/,
    /\bютуб\b/,
    /\bютьюб\b/,
    /\bвидео\b/,
    /\bканал(ы|ов|ам|ах)?\s+youtube\b/,
  ];

  const messengerChannelPatterns = [
    /\btelegram\b/,
    /\bтелеграм\b/,
    /\bтг\b/,
    /\bdiscord\b/,
    /\bдискорд\b/,
    /\bмессенджер(ы|ах|ов)?\b/,
    /\bканал(ы|ов|ам|ах)?\b/,
  ];

  const socialPatterns = [
    /\bсоцсет(и|ях|ям|ями)?\b/,
    /\bsocial\b/,
    /\bx\.com\b/,
    /\btwitter\b/,
    /\bтвиттер\b/,
    /\blinkedin\b/,
    /\breddit\b/,
    /\bреддит\b/,
    /\bпост(ы|ов|ами|ах)?\b/,
    /\bаккаунт(ы|ов|ами|ах)?\b/,
  ];

  const deepResearchPatterns = [
    /\bглубок(ий|ое|ая|о)\b/,
    /\bdeep research\b/,
    /\bисследуй\b/,
    /\bисследовани(е|я|й)\b/,
    /\bпроанализируй\b/,
    /\bсравни\b/,
    /\bподробн(о|ый|ая)\b/,
    /\bдетальн(о|ый|ая)\b/,
    /\bтенденци(и|я)\b/,
    /\bтренд(ы|ов)?\b/,
  ];

  if (
    contains("погод") ||
    contains("weather") ||
    contains("прогноз") ||
    contains("температур") ||
    contains("влажност") ||
    contains("ветер") ||
    normalized.startsWith("/weather")
  ) {
    return {
      taskType: "weather_lookup",
      instructions: "Collect weather data from trusted external sources and return concise factual summary.",
      routeMode: "fast",
    };
  }

  if (
    contains("глубок") ||
    contains("исследуй") ||
    contains("исследован") ||
    contains("проанализируй") ||
    contains("сравни") ||
    contains("подробн") ||
    contains("детальн") ||
    contains("тенденци") ||
    contains("тренд") ||
    contains("deep research")
  ) {
    return {
      taskType: "deep_research",
      instructions: "Run deep multi-source research, extract key findings and provide concise synthesis with citations.",
      routeMode: "research",
    };
  }
  if (isExplicitScoutRequest(text, hasImage, hasVoice)) {
    return {
      taskType: "web_search",
      instructions: "User explicitly requested Scout. Search the web and return concise factual answer with one best source.",
      routeMode: "fast",
    };
  }

  if (weatherPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      taskType: "weather_lookup",
      instructions: "Collect weather data from trusted external sources and return concise factual summary.",
      routeMode: "fast",
    };
  }
  if (deepResearchPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      taskType: "deep_research",
      instructions: "Run deep multi-source research, extract key findings and provide concise synthesis with citations.",
      routeMode: "research",
    };
  }
  if (isProductSelectionQuery(text, hasImage, hasVoice)) {
    return {
      taskType: "web_search",
      instructions: "Find up-to-date product comparison data and return concise recommendation with one best source.",
      routeMode: "fast",
    };
  }
  if (isFreshQuestion(text, hasImage, hasVoice)) {
    return {
      taskType: "web_search",
      instructions: "Search the web for up-to-date factual answer with concise summary and citations.",
      routeMode: "fast",
    };
  }
  if (webSearchPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      taskType: "web_search",
      instructions: "Search the web and return concise factual summary with top sources and citations.",
      routeMode: "fast",
    };
  }
  if (youtubePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      taskType: "youtube_search",
      instructions: "Find relevant YouTube videos/channels and return concise list with citations.",
      routeMode: "fast",
    };
  }
  if (messengerChannelPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      taskType: "messenger_channels_search",
      instructions: "Find relevant Telegram/Discord channels by topic and return concise list with citations.",
      routeMode: "fast",
    };
  }
  if (socialPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      taskType: "social_search",
      instructions: "Search social platforms (X/LinkedIn/Reddit) by topic and return concise list with citations.",
      routeMode: "fast",
    };
  }
  return null;
}

function scheduleScoutLateDelivery(params: {
  token: string;
  chatId: number;
  requestId: string;
  taskType: ScoutTaskType;
  label: string;
}): void {
  void (async () => {
    debugLog(
      `Late delivery scheduled: request_id=${params.requestId} task=${params.taskType} dirs=${SCOUT_CHECKED_DIRS.join(",")}`
    );
    const lateAnswer = await waitForScoutResponse(
      params.requestId,
      params.taskType,
      SCOUT_RESEARCH_LATE_DELIVERY_MS
    );
    if (!lateAnswer) {
      debugLog(`Late delivery expired without result: request_id=${params.requestId}`);
      return;
    }

    await sendMessage(
      params.token,
      params.chatId,
      `Результат исследования готов (late delivery):\nrequest_id: ${params.requestId}\n\n${lateAnswer.message}`
    );
  })().catch((err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Telegram] Scout late-delivery error for ${params.label}: ${errMsg}`);
  });
}

interface ScoutResultPayload {
  summary: string;
  location?: string;
  temperature_c?: number;
  wind_m_s?: number;
  humidity_pct?: number;
  [key: string]: unknown;
}

interface ScoutResponsePayload {
  schema_version: string;
  request_id: string;
  task_type: string;
  source_bot: string;
  created_at: string;
  observed_at?: string;
  status: "ok" | "error";
  result?: ScoutResultPayload;
  error_message?: string;
  confidence?: number;
  ttl_sec?: number;
  hash?: string;
}

interface ScoutResolvedResponse {
  message: string;
  payload?: ScoutResponsePayload;
  hasDetails: boolean;
}

interface ScoutChatCacheEntry {
  requestId: string;
  taskType: ScoutTaskType;
  answer: string;
  createdAtMs: number;
  hasDetails: boolean;
}

interface PendingScoutEntry {
  requestId: string;
  baseQuery: string;
  createdAtMs: number;
}

const SCOUT_CACHE_TTL_MS = 30 * 60_000;
const scoutLastResponseByChat = new Map<number, ScoutChatCacheEntry>();
const pendingScoutByChat = new Map<number, PendingScoutEntry>();

function trimInline(value: string, maxLen: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function firstUrlFromText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/i);
  return m ? m[0] : null;
}

function getPendingScout(chatId: number): PendingScoutEntry | null {
  const pending = pendingScoutByChat.get(chatId);
  if (!pending) return null;
  if (Date.now() - pending.createdAtMs > SCOUT_FALLBACK_MS + 5 * 60_000) {
    pendingScoutByChat.delete(chatId);
    return null;
  }
  return pending;
}

function setPendingScout(chatId: number, requestId: string, baseQuery: string): void {
  pendingScoutByChat.set(chatId, {
    requestId,
    baseQuery,
    createdAtMs: Date.now(),
  });
}

function clearPendingScout(chatId: number, requestId?: string): void {
  const current = pendingScoutByChat.get(chatId);
  if (!current) return;
  if (requestId && current.requestId !== requestId) return;
  pendingScoutByChat.delete(chatId);
}

function isPendingScoutRefinementMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 140) return false;
  if (normalized.startsWith("/")) return false;
  if (/\bскаут\b|\bscout\b/i.test(normalized)) return false;
  if (isScoutSourceFollowUp(text) || isScoutResultsFollowUp(text) || isScoutStatusFollowUp(text)) return false;
  return (
    normalized.startsWith("для ") ||
    normalized.startsWith("а если") ||
    normalized.startsWith("и если") ||
    normalized.startsWith("с ") ||
    normalized.startsWith("без ") ||
    normalized.includes("ночн") ||
    normalized.includes("в горах") ||
    normalized.includes("для охоты")
  );
}

async function runPreLlmGuard(text: string, hasImage: boolean, hasVoice: boolean): Promise<PreLlmGuardDecision | null> {
  try {
    const encoded = Buffer.from(text, "utf8").toString("base64");
    const proc = Bun.spawn(
      [
        "python3",
        ROUTER_GUARD_SCRIPT,
        "--text-b64",
        encoded,
        "--has-image",
        hasImage ? "1" : "0",
        "--has-voice",
        hasVoice ? "1" : "0",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    if (exitCode !== 0) {
      debugLog(`Pre-LLM guard failed: ${stderr.trim() || `exit=${exitCode}`}`);
      return null;
    }
    const parsed = JSON.parse(stdout) as PreLlmGuardDecision;
    return parsed;
  } catch (err) {
    debugLog(`Pre-LLM guard error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function parseFirstJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // continue
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = trimmed.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

async function runLlmOwnershipCheck(text: string): Promise<LlmOwnershipDecision | null> {
  const routerPrompt =
    `You are a routing verifier for Telegram assistant.\n` +
    `Classify whether this user message is addressed to internal assistant memory/context or should go to external Scout web research.\n\n` +
    `Rules:\n` +
    `- Return addressed_to=scout for requests needing fresh/current facts, prices, latest models, official/now status, web lookup, or explicit Scout mention.\n` +
    `- Return addressed_to=assistant only for stable explanations, personal context, workflow/process requests, or tasks solvable without fresh external data.\n` +
    `- Be conservative: when unsure, pick scout.\n\n` +
    `Output strictly JSON only:\n` +
    `{"addressed_to":"assistant|scout","confidence":0.0,"reason":"short reason"}\n\n` +
    `User message:\n${text}`;

  try {
    const result = await run("telegram", routerPrompt);
    if (result.exitCode !== 0) return null;
    const parsed = parseFirstJsonObject(result.stdout || "");
    if (!parsed) return null;

    const addressed = parsed.addressed_to;
    const confidence = Number(parsed.confidence);
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    if (addressed !== "assistant" && addressed !== "scout") return null;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    return {
      addressed_to: addressed,
      confidence,
      reason: reason || "no reason",
    };
  } catch {
    return null;
  }
}

function scoutResultToLines(payload: ScoutResponsePayload): { lines: string[]; hasDetails: boolean } {
  const result = payload.result;
  if (!result || typeof result !== "object") return { lines: [], hasDetails: false };

  const pickItems = (key: string): Array<Record<string, unknown>> => {
    const raw = result[key];
    if (!Array.isArray(raw)) return [];
    return raw.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  };

  const items =
    pickItems("results").length > 0
      ? pickItems("results")
      : pickItems("videos").length > 0
        ? pickItems("videos")
        : pickItems("channels").length > 0
          ? pickItems("channels")
          : pickItems("posts");

  const topItems = items
    .map((item) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!url) return null;
      const titleRaw =
        typeof item.title === "string"
          ? item.title
          : typeof item.subreddit === "string"
            ? `[r/${item.subreddit}] post`
            : "Источник";
      const title = trimInline(titleRaw, 120);
      const snippet = typeof item.snippet === "string" ? trimInline(item.snippet, 180) : "";
      return snippet ? `- ${title}\n  ${url}\n  ${snippet}` : `- ${title}\n  ${url}`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 5);

  if (topItems.length > 0) {
    return { lines: ["Топ результатов:", ...topItems], hasDetails: true };
  }

  const citationsRaw = result.citations;
  if (Array.isArray(citationsRaw)) {
    const citations = citationsRaw
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .slice(0, 5);
    if (citations.length > 0) {
      return { lines: ["Источники:", ...citations.map((url) => `- ${url}`)], hasDetails: true };
    }
  }

  return { lines: [], hasDetails: false };
}

function getSourcePriority(url: string): number {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "apple.com" || host.endsWith(".apple.com")) return 100;
    if (host === "samsung.com" || host.endsWith(".samsung.com")) return 100;
    if (host.includes("gsmarena.com")) return 85;
    if (host.endsWith(".wikipedia.org")) return 80;
    if (host.includes("reuters.com") || host.includes("bloomberg.com")) return 75;
    if (host.includes("theverge.com") || host.includes("arstechnica.com") || host.includes("9to5mac.com")) return 70;
    if (host.includes("nanoreview.net")) return 20;
    return 10;
  } catch {
    return 0;
  }
}

function isMarketplaceHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("market.yandex.") ||
      host.includes("yandex.market") ||
      host.includes("ozon.") ||
      host.includes("wildberries.") ||
      host.includes("aliexpress.") ||
      host.includes("avito.") ||
      host.includes("dns-shop.") ||
      host.includes("rozetka.") ||
      host.includes("re-store.") ||
      host.includes("jabko.") ||
      host.includes("my-apple-store.")
    );
  } catch {
    return false;
  }
}

function isShoppingIntent(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("купить") ||
    q.includes("заказать") ||
    q.includes("магазин") ||
    q.includes("скидк") ||
    q.includes("промокод") ||
    q.includes("маркет")
  );
}

function hasPromoSignals(text: string): boolean {
  const v = text.toLowerCase();
  return v.includes("промокод") || v.includes("скидк") || v.includes("первый заказ") || v.includes("buy now");
}

function pickBestSource(payload: ScoutResponsePayload): { title: string; url: string; snippet: string } | null {
  const result = payload.result;
  if (!result || typeof result !== "object") return null;
  const resultsRaw = result.results;
  if (!Array.isArray(resultsRaw)) return null;

  let best: { title: string; url: string; snippet: string; score: number } | null = null;
  for (const item of resultsRaw) {
    if (!item || typeof item !== "object") continue;
    const url = typeof (item as Record<string, unknown>).url === "string" ? String((item as Record<string, unknown>).url).trim() : "";
    if (!url) continue;
    const titleRaw =
      typeof (item as Record<string, unknown>).title === "string"
        ? String((item as Record<string, unknown>).title)
        : "Источник";
    const snippetRaw =
      typeof (item as Record<string, unknown>).snippet === "string"
        ? String((item as Record<string, unknown>).snippet)
        : "";
    const queryText = typeof result.query === "string" ? result.query.toLowerCase() : "";
    const titleLower = titleRaw.toLowerCase();
    let score = getSourcePriority(url) + (snippetRaw.length > 20 ? 5 : 0);
    if (!isShoppingIntent(queryText) && isMarketplaceHost(url)) score -= 80;
    if (!isShoppingIntent(queryText) && hasPromoSignals(`${titleRaw} ${snippetRaw}`)) score -= 60;
    const isOfficialPriceQuery =
      (queryText.includes("официаль") || queryText.includes("official")) &&
      (queryText.includes("цена") || queryText.includes("price"));
    if (isOfficialPriceQuery && isMarketplaceHost(url)) score -= 60;
    if (isOfficialPriceQuery && (url.includes("apple.com/") || url.includes("samsung.com/"))) score += 40;
    if (queryText.includes("samsung") || queryText.includes("самсунг")) {
      if (titleLower.includes("fold")) score += 20;
      if (titleLower.includes("all-samsung") || titleLower.includes("все модели")) score -= 15;
    }
    if (!best || score > best.score) {
      best = { title: trimInline(titleRaw, 140), url, snippet: trimInline(snippetRaw, 240), score };
    }
  }
  if (!best) return null;
  return { title: best.title, url: best.url, snippet: best.snippet };
}

function isLowSignalSummary(summary: string): boolean {
  const normalized = summary.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  return (
    /найдено\s+\d+\s+результат/i.test(normalized) ||
    /результат[а-я]*\s+по\s+запросу/i.test(normalized) ||
    /вот\s+что\s+я\s+наш(е|ё)л/i.test(normalized)
  );
}

function extractPriceHint(text: string): string | null {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const rangeThousands = normalized.match(
    /(?:от\s*)?\$?\s*([0-9]{1,3})\s*(?:-|–|—|до)\s*\$?\s*([0-9]{1,3})\s*(?:тыс(?:яч|\.|)?|k)\b(?:\s*(?:usd|доллар(?:ов|а)?))?/i
  );
  if (rangeThousands) {
    const from = Number(rangeThousands[1]);
    const to = Number(rangeThousands[2]);
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0) {
      return `$${from} 000-$${to} 000`;
    }
  }

  const singleThousands = normalized.match(
    /(?:от|до|около|примерно)?\s*\$?\s*([0-9]{1,3})\s*(?:тыс(?:яч|\.|)?|k)\b(?:\s*(?:usd|доллар(?:ов|а)?))?/i
  );
  if (singleThousands) {
    const value = Number(singleThousands[1]);
    if (Number.isFinite(value) && value > 0) return `$${value} 000`;
  }

  const exactAmount = normalized.match(
    /(?:\$|usd|доллар(?:ов|а)?)\s*([0-9]{1,3}(?:[ \.,][0-9]{3})+)/i
  );
  if (exactAmount) {
    const compact = exactAmount[1].replace(/[^\d]/g, "");
    if (compact.length >= 4) return `$${Number(compact).toLocaleString("en-US").replace(/,/g, " ")}`;
  }

  return null;
}

function enrichScoutQueryForHumanoidRobots(query: string): string {
  const normalized = query.toLowerCase();
  const mentionsRobot = normalized.includes("робот");
  const isVacuumExplicit = normalized.includes("пылесос");
  const hasHumanoidHint = normalized.includes("гуманоид") || normalized.includes("человекоподоб");
  const hasHomeHint = normalized.includes("для дома") || normalized.includes("домаш");
  if (!mentionsRobot || isVacuumExplicit || hasHumanoidHint) return query;
  if (hasHomeHint || normalized.includes("китайск")) {
    return `${query} гуманоидный человекоподобный не робот-пылесос`;
  }
  return query;
}

function composeWebSearchAnswer(
  summary: string,
  best: { title: string; url: string; snippet: string },
  query: string
): string {
  const summaryClean = summary.replace(/\s+/g, " ").trim();
  const queryLower = query.toLowerCase();
  const isPriceQuestion = queryLower.includes("цена") || queryLower.includes("стоим") || queryLower.includes("price");
  const priceHint = extractPriceHint(`${best.title} ${best.snippet}`);
  const summaryHasSignal = summaryClean.length > 0 && !isLowSignalSummary(summaryClean);

  if (isPriceQuestion && priceHint) {
    const tail = summaryHasSignal ? ` Дополнительно по источникам: ${summaryClean}` : "";
    return trimInline(
      `По найденным данным ориентир по цене: ${priceHint}. Это оценка по открытым источникам, финальная коммерческая цена может отличаться.${tail}`,
      420
    );
  }

  if (priceHint) {
    return trimInline(`По найденным данным ориентир по цене: ${priceHint}.`, 420);
  }
  if (summaryHasSignal) return trimInline(`По найденным данным: ${summaryClean}`, 420);
  const snippetClean = (best.snippet || "").replace(/\s+/g, " ").trim();
  if (snippetClean.length >= 40) {
    return trimInline(`По найденным данным: ${snippetClean}`, 420);
  }
  return trimInline(
    "По найденным данным: по этому запросу сейчас недостаточно достоверных деталей для развернутого вывода.",
    420
  );
}

function formatWebSearchMessage(payload: ScoutResponsePayload): { message: string; hasDetails: boolean } | null {
  const result = payload.result;
  const summary = result?.summary;
  if (!summary || typeof summary !== "string" || !summary.trim()) return null;
  const best = pickBestSource(payload);
  const checkedSourcesCount = Array.isArray(result?.results)
    ? result.results.length
    : Array.isArray(result?.citations)
      ? result.citations.length
      : 0;
  const checkedSourcesLine =
    checkedSourcesCount > 0 ? `Проверено ${checkedSourcesCount} источников` : "Проверено источников: n/a";

  if (!best) {
    return {
      message: `${checkedSourcesLine}\n\n${trimInline(summary.trim(), 420)}\n\nЛучший источник: n/a`,
      hasDetails: false,
    };
  }
  const query = typeof result?.query === "string" ? result.query : "";
  const concise = composeWebSearchAnswer(summary.trim(), best, query);
  return {
    message:
      `${checkedSourcesLine}\n\n` +
      `${concise}\n\n` +
      `Лучший источник:\n${best.title}\n${best.url}`,
    hasDetails: true,
  };
}

function formatScoutOkMessage(payload: ScoutResponsePayload): { message: string; hasDetails: boolean } | null {
  const summary = payload.result?.summary;
  if (!summary || typeof summary !== "string" || !summary.trim()) return null;

  if (payload.task_type === "web_search") {
    return formatWebSearchMessage(payload);
  }

  const base = summary.trim();
  const extra = scoutResultToLines(payload);
  if (!extra.hasDetails) return { message: base, hasDetails: false };
  return { message: `${base}\n\n${extra.lines.join("\n")}`, hasDetails: true };
}

function isScoutResultsFollowUp(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 160) return false;
  return (
    /(где|покажи|дай|пришли).*(результат|ссылк|источник)/i.test(normalized) ||
    /(результат|ссылк|источник).*(где|покажи|дай|пришли)/i.test(normalized) ||
    /(что|какой)\s+с\s+результат(ом|ами)?(\s+поиска)?/i.test(normalized) ||
    /статус\s+(поиска|скаута|scout)/i.test(normalized) ||
    /^sources?\??$/i.test(normalized) ||
    /^links?\??$/i.test(normalized)
  );
}

function isScoutStatusFollowUp(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 220) return false;
  return (
    /(что|как)\s+со?\s+скаут(ом|а)?/i.test(normalized) ||
    /(что|как)\s+с\s+результат(ом|ами)?(\s+поиска)?/i.test(normalized) ||
    /где\s+результат(\s+поиска)?/i.test(normalized) ||
    /статус\s+(скаута|поиска|scout)/i.test(normalized)
  );
}

function isScoutSourceFollowUp(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 200) return false;
  const hasWord = (pattern: RegExp): boolean => pattern.test(normalized);
  const hasSourceWord =
    normalized.includes("источник") ||
    normalized.includes("информац") ||
    normalized.includes("данн") ||
    normalized.includes("source") ||
    normalized.includes("citation") ||
    normalized.includes("provenance");
  const hasKnowledgeWord =
    hasWord(/\bзна(е|ё)шь\b/i) ||
    hasWord(/\bузнал(а|и)?\b/i) ||
    hasWord(/\bкого\b/i) ||
    hasWord(/\bкто\b/i);
  const hasHowWord = hasWord(/\bоткуда\b/i) || hasWord(/\bкак\b/i) || hasWord(/\bкто\b/i);
  return (
    /(откуда|какой|какие|где).*(инфо|информация|данные|источник|источники)/i.test(normalized) ||
    /(откуда\s+ты\s+зна(е|ё)шь|как\s+ты\s+узнал|как\s+ты\s+это\s+узнал|как\s+тебе\s+это\s+известно)/i.test(
      normalized
    ) ||
    /(кто\s+тебе\s+сказал|кто\s+это\s+сказал)/i.test(normalized) ||
    (hasHowWord && (hasSourceWord || hasKnowledgeWord)) ||
    /(source|sources|provenance|citation|citations)/i.test(normalized)
  );
}

function normalizeScoutQuery(rawText: string): string {
  let query = rawText.trim();
  query = query.replace(/^(позови|вызови|спроси)\s+(у\s+)?скаута[,:.\s-]*/i, "");
  query = query.replace(/^(ask|use|route to)\s+scout[,:.\s-]*/i, "");
  query = query.trim();
  return query || rawText.trim();
}

function enrichScoutQueryForOfficialPrice(query: string): string {
  const normalized = query.toLowerCase();
  const wantsOfficialPrice =
    (normalized.includes("официаль") || normalized.includes("official")) &&
    (normalized.includes("цена") || normalized.includes("price"));
  if (!wantsOfficialPrice) return query;

  if (normalized.includes("macbook") || normalized.includes("apple")) {
    return `${query} site:apple.com`;
  }
  if (normalized.includes("samsung") || normalized.includes("самсунг")) {
    return `${query} site:samsung.com`;
  }
  return query;
}

function getRecentScoutCache(chatId: number): ScoutChatCacheEntry | null {
  const cached = scoutLastResponseByChat.get(chatId);
  if (!cached) return null;
  if (Date.now() - cached.createdAtMs > SCOUT_CACHE_TTL_MS) {
    scoutLastResponseByChat.delete(chatId);
    return null;
  }
  return cached;
}

function saveScoutCache(chatId: number, requestId: string, taskType: ScoutTaskType, resolved: ScoutResolvedResponse): void {
  scoutLastResponseByChat.set(chatId, {
    requestId,
    taskType,
    answer: resolved.message,
    createdAtMs: Date.now(),
    hasDetails: resolved.hasDetails,
  });
  clearPendingScout(chatId, requestId);
}

async function createScoutRequest(params: {
  chatId: number;
  userId?: number;
  label: string;
  text: string;
  taskType: ScoutTaskType;
  instructions: string;
}): Promise<{ requestId: string; path: string }> {
  await mkdir(SCOUT_REQUEST_DIR, { recursive: true });
  const requestId = `${params.taskType}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const filePath = join(SCOUT_REQUEST_DIR, `${requestId}.json`);
  const payload = {
    schema_version: SCOUT_REQUEST_SCHEMA_VERSION,
    request_id: requestId,
    task_type: params.taskType,
    source_bot: "adjutant",
    source: "adjutant_telegram",
    provenance: "owner_direct",
    trust_level: "trusted_owner",
    created_at: new Date().toISOString(),
    chat_id: params.chatId,
    user_id: params.userId ?? null,
    user_label: params.label,
    query: params.text,
    instructions: params.instructions,
  };
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { requestId, path: filePath };
}

function parseNestedScoutPayload(rawJson: string): ScoutResponsePayload | null {
  try {
    const obj = JSON.parse(rawJson) as Record<string, unknown>;
    if (typeof obj.schema_version === "string" && typeof obj.request_id === "string") {
      return obj as unknown as ScoutResponsePayload;
    }

    const content = obj.content;
    if (typeof content === "string") {
      const nested = JSON.parse(content) as Record<string, unknown>;
      if (typeof nested.schema_version === "string" && typeof nested.request_id === "string") {
        return nested as unknown as ScoutResponsePayload;
      }
    }
  } catch {
    // Not a valid scout payload.
  }
  return null;
}

function isIsoDateString(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validateScoutPayload(
  payload: ScoutResponsePayload,
  expectedRequestId: string,
  expectedTaskType: ScoutTaskType
): ScoutResolvedResponse | null {
  if (payload.schema_version !== SCOUT_SCHEMA_VERSION) return null;
  if (payload.request_id !== expectedRequestId) return null;
  if (payload.task_type !== expectedTaskType) return null;
  if (!payload.source_bot || typeof payload.source_bot !== "string") return null;
  if (!payload.created_at || !isIsoDateString(payload.created_at)) return null;

  if (payload.observed_at && !isIsoDateString(payload.observed_at)) return null;
  if (typeof payload.ttl_sec === "number" && (payload.ttl_sec <= 0 || payload.ttl_sec > 3600)) return null;
  if (typeof payload.confidence === "number" && (payload.confidence < 0 || payload.confidence > 1)) return null;
  if (payload.hash && !/^sha256:[a-fA-F0-9]{64}$/.test(payload.hash)) return null;

  if (payload.status === "ok") {
    const formatted = formatScoutOkMessage(payload);
    if (!formatted) return null;
    return { message: formatted.message, payload, hasDetails: formatted.hasDetails };
  }

  if (payload.status === "error") {
    const msg = typeof payload.error_message === "string" ? payload.error_message.trim() : "";
    return {
      message: msg ? `Скаут вернул ошибку: ${msg}` : "Скаут вернул ошибку без деталей.",
      payload,
      hasDetails: false,
    };
  }

  return null;
}

async function findScoutResponse(
  requestId: string,
  expectedTaskType: ScoutTaskType
): Promise<ScoutResolvedResponse | null> {
  for (const dir of SCOUT_CHECKED_DIRS) {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const body = await readFile(join(dir, file), "utf8");
        const payload = parseNestedScoutPayload(body);
        if (!payload) continue;
        const validatedResponse = validateScoutPayload(payload, requestId, expectedTaskType);
        if (validatedResponse) return validatedResponse;
      }
    } catch {
      // Directory might not exist yet.
      debugLog(`Scout checked dir not available yet: ${dir}`);
    }
  }
  return null;
}

async function waitForScoutResponse(
  requestId: string,
  expectedTaskType: ScoutTaskType,
  timeoutMs: number
): Promise<ScoutResolvedResponse | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await findScoutResponse(requestId, expectedTaskType);
    if (response) return response;
    await Bun.sleep(SCOUT_POLL_INTERVAL_MS);
  }
  return null;
}

async function executeScoutFlow(params: {
  token: string;
  chatId: number;
  userId?: number;
  label: string;
  rawText: string;
  decision: ScoutRoutingDecision;
}): Promise<void> {
  const preparedQuery = enrichScoutQueryForHumanoidRobots(
    enrichScoutQueryForOfficialPrice(normalizeScoutQuery(params.rawText))
  );
  const req = await createScoutRequest({
    chatId: params.chatId,
    userId: params.userId,
    label: params.label,
    text: preparedQuery,
    taskType: params.decision.taskType,
    instructions: params.decision.instructions,
  });
  markScoutRoute(params.chatId, req.requestId);
  setPendingScout(params.chatId, req.requestId, preparedQuery);
  await sendMessage(
    params.token,
    params.chatId,
    `Принял, запрашиваю у Скаута...\nпоисковик: ${scoutEngineLabel(params.decision.taskType)}\nrequest_id: ${req.requestId}`
  );

  if (params.decision.routeMode === "research") {
    const initialResponse = await waitForScoutResponse(req.requestId, params.decision.taskType, SCOUT_RESEARCH_FAST_PATH_MS);
    if (initialResponse) {
      saveScoutCache(params.chatId, req.requestId, params.decision.taskType, initialResponse);
      await sendMessage(params.token, params.chatId, initialResponse.message);
      return;
    }

    await sendMessage(
      params.token,
      params.chatId,
      "Запрос тяжёлый, запускаю обычный трек исследования. Пришлю результат отдельно, как только будет готов."
    );

    const ackResponse = await waitForScoutResponse(req.requestId, params.decision.taskType, SCOUT_RESEARCH_ACK_WAIT_MS);
    if (ackResponse) {
      saveScoutCache(params.chatId, req.requestId, params.decision.taskType, ackResponse);
      await sendMessage(params.token, params.chatId, ackResponse.message);
      return;
    }

    scheduleScoutLateDelivery({
      token: params.token,
      chatId: params.chatId,
      requestId: req.requestId,
      taskType: params.decision.taskType,
      label: params.label,
    });
    await sendMessage(
      params.token,
      params.chatId,
      `Исследование продолжается. Дошлю ответ, когда данные пройдут контур Scout -> Sanitizer -> checked.\nrequest_id: ${req.requestId}`
    );
    return;
  }

  const fastPathResponse = await waitForScoutResponse(req.requestId, params.decision.taskType, SCOUT_FAST_PATH_MS);
  if (fastPathResponse) {
    saveScoutCache(params.chatId, req.requestId, params.decision.taskType, fastPathResponse);
    await sendMessage(params.token, params.chatId, fastPathResponse.message);
    return;
  }

  await sendMessage(params.token, params.chatId, "Скаут ещё собирает данные. Подожду до 3 минут...");
  const fallbackResponse = await waitForScoutResponse(
    req.requestId,
    params.decision.taskType,
    SCOUT_FALLBACK_MS - SCOUT_FAST_PATH_MS
  );
  if (fallbackResponse) {
    saveScoutCache(params.chatId, req.requestId, params.decision.taskType, fallbackResponse);
    await sendMessage(params.token, params.chatId, fallbackResponse.message);
    return;
  }

  scheduleScoutLateDelivery({
    token: params.token,
    chatId: params.chatId,
    requestId: req.requestId,
    taskType: params.decision.taskType,
    label: params.label,
  });
  clearPendingScout(params.chatId, req.requestId);
  await sendMessage(
    params.token,
    params.chatId,
    `Таймаут: Скаут не вернул данные за 3 минуты. Продолжаю ждать в фоне и пришлю результат позже.\nrequest_id: ${req.requestId}`
  );
}

function isExplicitAssistantOnlyRequest(text: string, hasImage: boolean, hasVoice: boolean): boolean {
  if (hasImage || hasVoice) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/\bскаут\b|\bscout\b/i.test(normalized)) return false;

  const assistantOnlyMarkers = [
    "объясни",
    "объяснение",
    "переведи",
    "перефразируй",
    "сократи текст",
    "суммаризируй",
    "резюмируй",
    "написать текст",
    "напиши текст",
    "помоги сформулировать",
    "исправь текст",
    "проверь грамматику",
    "составь план",
    "придумай",
    "сделай промпт",
    "перепиши",
    "как лучше сформулировать",
  ];

  return assistantOnlyMarkers.some((marker) => normalized.includes(marker));
}

function maybeAnswerLocalScoutClarification(text: string, cached: ScoutChatCacheEntry | null): string | null {
  if (!cached) return null;
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 220) return null;

  const asksHumanoid = /^(это|то есть|т\.?е\.?)\s+.*гуманоид/i.test(normalized) || normalized.includes("гуманоид");
  if (asksHumanoid) {
    const cachedLower = cached.answer.toLowerCase();
    if (cachedLower.includes("гуманоид") || cachedLower.includes("человекоподоб")) {
      return "Да, это гуманоидные (человекоподобные) роботы.";
    }
    if (cachedLower.includes("робот-пылесос") || cachedLower.includes("пылесос")) {
      return "Нет, в последнем ответе речь шла не о гуманоидных роботах, а о роботах-пылесосах.";
    }
    return "По последнему ответу это не подтверждено явно. Могу уточнить формулировку без нового запроса в Скаут.";
  }

  return null;
}

async function callApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Telegram API ${method}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const normalized = normalizeTelegramText(text).replace(/\[react:[^\]\r\n]+\]/gi, "");
  const html = markdownToTelegramHtml(normalized);
  const MAX_LEN = 4096;
  for (let i = 0; i < html.length; i += MAX_LEN) {
    try {
      await callApi(token, "sendMessage", {
        chat_id: chatId,
        text: html.slice(i, i + MAX_LEN),
        parse_mode: "HTML",
      });
    } catch {
      // Fallback to plain text if HTML parsing fails
      await callApi(token, "sendMessage", {
        chat_id: chatId,
        text: normalized.slice(i, i + MAX_LEN),
      });
    }
  }
}

async function sendTyping(token: string, chatId: number): Promise<void> {
  await callApi(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

function extractReactionDirective(text: string): { cleanedText: string; reactionEmoji: string | null } {
  let reactionEmoji: string | null = null;
  const cleanedText = text
    .replace(/\[react:([^\]\r\n]+)\]/gi, (_match, raw) => {
      const candidate = String(raw).trim();
      if (!reactionEmoji && candidate) reactionEmoji = candidate;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedText, reactionEmoji };
}

async function sendReaction(token: string, chatId: number, messageId: number, emoji: string): Promise<void> {
  await callApi(token, "setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
  });
}

let botUsername: string | null = null;
let botId: number | null = null;

function groupTriggerReason(message: TelegramMessage): string | null {
  if (botId && message.reply_to_message?.from?.id === botId) return "reply_to_bot";
  const { text, entities } = getMessageTextAndEntities(message);
  if (!text) return null;
  const lowerText = text.toLowerCase();
  if (botUsername && lowerText.includes(`@${botUsername.toLowerCase()}`)) return "text_contains_mention";

  for (const entity of entities ?? []) {
    const value = text.slice(entity.offset, entity.offset + entity.length);
    if (entity.type === "mention" && botUsername && value.toLowerCase() === `@${botUsername.toLowerCase()}`) {
      return "mention_entity_matches_bot";
    }
    if (entity.type === "mention" && !botUsername) return "mention_entity_before_botname_loaded";
    if (entity.type === "bot_command") {
      if (!value.includes("@")) return "bare_bot_command";
      if (!botUsername) return "scoped_command_before_botname_loaded";
      if (botUsername && value.toLowerCase().endsWith(`@${botUsername.toLowerCase()}`)) return "scoped_command_matches_bot";
    }
  }

  return null;
}

async function downloadImageFromMessage(token: string, message: TelegramMessage): Promise<string | null> {
  const photo = message.photo && message.photo.length > 0 ? pickLargestPhoto(message.photo) : null;
  const imageDocument = isImageDocument(message.document) ? message.document : null;
  const fileId = photo?.file_id ?? imageDocument?.file_id;
  if (!fileId) return null;

  const fileMeta = await callApi<{ ok: boolean; result: TelegramFile }>(token, "getFile", { file_id: fileId });
  if (!fileMeta.ok || !fileMeta.result.file_path) return null;

  const remotePath = fileMeta.result.file_path;
  const downloadUrl = `${FILE_API_BASE}${token}/${remotePath}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);

  const dir = join(process.cwd(), ".claude", "claudeclaw", "inbox", "telegram");
  await mkdir(dir, { recursive: true });

  const remoteExt = extname(remotePath);
  const docExt = extname(imageDocument?.file_name ?? "");
  const mimeExt = extensionFromMimeType(imageDocument?.mime_type);
  const ext = remoteExt || docExt || mimeExt || ".jpg";
  const filename = `${message.chat.id}-${message.message_id}-${Date.now()}${ext}`;
  const localPath = join(dir, filename);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  return localPath;
}

async function downloadVoiceFromMessage(token: string, message: TelegramMessage): Promise<string | null> {
  const audioDocument = isAudioDocument(message.document) ? message.document : null;
  const audioLike = message.voice ?? message.audio ?? audioDocument;
  const fileId = audioLike?.file_id;
  if (!fileId) return null;

  const fileMeta = await callApi<{ ok: boolean; result: TelegramFile }>(token, "getFile", { file_id: fileId });
  if (!fileMeta.ok || !fileMeta.result.file_path) return null;

  const remotePath = fileMeta.result.file_path;
  const downloadUrl = `${FILE_API_BASE}${token}/${remotePath}`;
  debugLog(
    `Voice download: fileId=${fileId} remotePath=${remotePath} mime=${audioLike.mime_type ?? "unknown"} expectedSize=${audioLike.file_size ?? "unknown"}`
  );
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);

  const dir = join(process.cwd(), ".claude", "claudeclaw", "inbox", "telegram");
  await mkdir(dir, { recursive: true });

  const remoteExt = extname(remotePath);
  const docExt = extname(message.document?.file_name ?? "");
  const audioExt = extname(message.audio?.file_name ?? "");
  const mimeExt = extensionFromAudioMimeType(audioLike.mime_type);
  const ext = remoteExt || docExt || audioExt || mimeExt || ".ogg";
  const filename = `${message.chat.id}-${message.message_id}-${Date.now()}${ext}`;
  const localPath = join(dir, filename);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  const header = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  const oggMagic =
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53;
  debugLog(
    `Voice download: wrote ${bytes.length} bytes to ${localPath} ext=${ext} header=${header || "empty"} oggMagic=${oggMagic}`
  );
  return localPath;
}

async function handleMyChatMember(update: TelegramMyChatMemberUpdate): Promise<void> {
  const config = getSettings().telegram;
  const chat = update.chat;
  if (!botUsername && update.new_chat_member.user.username) botUsername = update.new_chat_member.user.username;
  if (!botId) botId = update.new_chat_member.user.id;
  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;
  const isGroup = chat.type === "group" || chat.type === "supergroup";
  const wasOut = oldStatus === "left" || oldStatus === "kicked";
  const isIn = newStatus === "member" || newStatus === "administrator";

  if (!isGroup || !wasOut || !isIn) return;

  const chatName = chat.title ?? String(chat.id);
  console.log(`[Telegram] Added to ${chat.type}: ${chatName} (${chat.id}) by ${update.from.id}`);

  const addedBy = update.from.username ?? `${update.from.first_name} (${update.from.id})`;
  const eventPrompt =
    `[Telegram system event] I was added to a ${chat.type}.\n` +
    `Group title: ${chatName}\n` +
    `Group id: ${chat.id}\n` +
    `Added by: ${addedBy}\n` +
    "Write a short first message for the group. It should confirm I was added and explain how to trigger me.";

  try {
    const result = await run("telegram", eventPrompt);
    if (result.exitCode !== 0) {
      await sendMessage(config.token, chat.id, "I was added to this group. Mention me with a command to start.");
      return;
    }
    await sendMessage(config.token, chat.id, result.stdout || "I was added to this group.");
  } catch (err) {
    console.error(`[Telegram] group-added event error: ${err instanceof Error ? err.message : err}`);
    await sendMessage(config.token, chat.id, "I was added to this group. Mention me with a command to start.");
  }
}

// --- Message handler ---

async function handleMessage(message: TelegramMessage): Promise<void> {
  const config = getSettings().telegram;
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const { text } = getMessageTextAndEntities(message);
  const chatType = message.chat.type;
  const isPrivate = chatType === "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const hasImage = Boolean((message.photo && message.photo.length > 0) || isImageDocument(message.document));
  const hasVoice = Boolean(message.voice || message.audio || isAudioDocument(message.document));

  if (!isPrivate && !isGroup) return;

  const triggerReason = isGroup ? groupTriggerReason(message) : "private_chat";
  if (isGroup && !triggerReason) {
    debugLog(
      `Skip group message chat=${chatId} from=${userId ?? "unknown"} reason=no_trigger text="${(text ?? "").slice(0, 80)}"`
    );
    return;
  }
  debugLog(
    `Handle message chat=${chatId} type=${chatType} from=${userId ?? "unknown"} reason=${triggerReason} text="${(text ?? "").slice(0, 80)}"`
  );

  if (userId && config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
    if (isPrivate) {
      await sendMessage(config.token, chatId, "Unauthorized.");
    } else {
      console.log(`[Telegram] Ignored group message from unauthorized user ${userId} in chat ${chatId}`);
      debugLog(`Skip group message chat=${chatId} from=${userId} reason=unauthorized_user`);
    }
    return;
  }

  if (!text.trim() && !hasImage && !hasVoice) {
    debugLog(`Skip message chat=${chatId} from=${userId ?? "unknown"} reason=empty_text`);
    return;
  }

  const command = text ? extractTelegramCommand(text) : null;
  if (command === "/start") {
    await sendMessage(
      config.token,
      chatId,
      "Hello! Send me a message and I'll respond using Claude.\nUse /reset to start a fresh session."
    );
    return;
  }

  if (command === "/ping") {
    await sendMessage(config.token, chatId, "pong");
    return;
  }

  if (command === "/reset") {
    await resetSession();
    await sendMessage(config.token, chatId, "Global session reset. Next message starts fresh.");
    return;
  }

  if (command === "/twin") {
    await sendMessage(
      config.token,
      chatId,
      "Twin commands:\n" +
      "- approve <proposal_id> [comment]\n" +
      "- reject <proposal_id> [comment]\n" +
      "Example: approve proposal-claudeclaw-to-openclaw-1234567890 looks_good"
    );
    return;
  }

  if (command === "/twinlog") {
    const report = await buildTwinContextReport(8);
    await sendMessage(config.token, chatId, report);
    return;
  }

  const twinDecision = text ? parseTwinProposalDecision(text) : null;
  if (twinDecision) {
    try {
      const result = await executeTwinProposalDecision(twinDecision);
      const applied = result.applied_changes ?? 0;
      const skipped = result.skipped_changes ?? 0;
      const target = result.target_agent ?? "unknown";
      const msg =
        `Twin proposal ${twinDecision.decision}: ${twinDecision.proposalId}\n` +
        `target: ${target}\n` +
        `applied: ${applied}, skipped: ${skipped}\n` +
        `${result.message ? `info: ${result.message}\n` : ""}` +
        `${Array.isArray(result.notes) && result.notes.length > 0 ? `notes:\n- ${result.notes.join("\n- ")}` : ""}`;
      await sendMessage(config.token, chatId, msg.trim());
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await sendMessage(config.token, chatId, `Twin proposal error: ${errMsg}`);
      return;
    }
  }

  // Secretary: detect reply to a bot alert message → treat as custom reply
  const replyToMsgId = message.reply_to_message?.message_id;
  if (replyToMsgId && text && botId && message.reply_to_message?.from?.id === botId) {
    try {
      const lookupResp = await fetch(`http://127.0.0.1:9999/pending/by-bot-msg/${replyToMsgId}`);
      if (lookupResp.ok) {
        const item = await lookupResp.json() as { id?: string } | null;
        if (item?.id) {
          await fetch(`http://127.0.0.1:9999/confirm/${item.id}/custom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          await sendMessage(config.token, chatId, `✅ Sent custom reply + pattern learned.`);
          return;
        }
      }
    } catch {
      // fall through to normal handling if secretary endpoint unreachable
    }
  }

  const label = message.from?.username ?? String(userId ?? "unknown");
  const mediaParts = [hasImage ? "image" : "", hasVoice ? "voice" : ""].filter(Boolean);
  const mediaSuffix = mediaParts.length > 0 ? ` [${mediaParts.join("+")}]` : "";
  console.log(
    `[${new Date().toLocaleTimeString()}] Telegram ${label}${mediaSuffix}: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`
  );

  const cachedScout = getRecentScoutCache(chatId);
  const pendingScout = getPendingScout(chatId);

  if (text.trim() && pendingScout && isPendingScoutRefinementMessage(text)) {
    try {
      await executeScoutFlow({
        token: config.token,
        chatId,
        userId,
        label,
        rawText: `Позови Скаута. ${pendingScout.baseQuery}. Уточнение: ${text}`,
        decision: {
          taskType: "web_search",
          instructions:
            "User sent refinement while previous Scout request is still pending. Re-run with refinement merged into original intent and return one best source.",
          routeMode: "fast",
        },
      });
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] Pending refinement Scout flow error for ${label}: ${errMsg}`);
      await sendMessage(config.token, chatId, `Ошибка уточнения Scout-запроса: ${errMsg}`);
      return;
    }
  }
  const explicitScout = text.trim() ? isExplicitScoutRequest(text, hasImage, hasVoice) : false;
  const explicitAssistantOnly = text.trim() ? isExplicitAssistantOnlyRequest(text, hasImage, hasVoice) : false;
  const guardDecision =
    text.trim() && !explicitAssistantOnly && !explicitScout ? await runPreLlmGuard(text, hasImage, hasVoice) : null;
  const isSourceFollowUp =
    (Boolean(guardDecision?.matched && guardDecision.route === "intercept_source") || isScoutSourceFollowUp(text)) &&
    !explicitAssistantOnly;
  const resultsFollowUp = text.trim() ? isScoutResultsFollowUp(text) : false;
  const statusFollowUp = text.trim() ? isScoutStatusFollowUp(text) : false;
  const localClarification = maybeAnswerLocalScoutClarification(text, cachedScout);
  const contextualScoutFollowUp = text.trim() ? isLikelyContextualScoutFollowUp(text, chatId) : false;
  const routerDecision = decideRouterContract({
    text,
    hasImage,
    hasVoice,
    explicitScout,
    explicitAssistant: explicitAssistantOnly,
    hasCachedScout: Boolean(cachedScout),
    hasLocalClarification: Boolean(localClarification),
    sourceFollowUp: isSourceFollowUp,
    resultsFollowUp,
    statusFollowUp,
    contextualScoutFollowUp,
  });

  switch (routerDecision.action) {
    case "route_scout_explicit": {
      try {
        await executeScoutFlow({
          token: config.token,
          chatId,
          userId,
          label,
          rawText: text,
          decision: {
            taskType: "web_search",
            instructions: "User explicitly requested Scout. Search web and return expanded answer with one best source.",
            routeMode: "fast",
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram] Explicit Scout flow error for ${label}: ${errMsg}`);
        await sendMessage(config.token, chatId, `Ошибка маршрутизации в Скаут: ${errMsg}`);
      }
      return;
    }
    case "intercept_local_clarification": {
      if (localClarification) {
        await sendMessage(config.token, chatId, localClarification);
        return;
      }
      break;
    }
    case "intercept_cached_status": {
      if (cachedScout) {
        await sendMessage(
          config.token,
          chatId,
          `Статус Scout: последний результат доступен.\nrequest_id: ${cachedScout.requestId}\n\n${cachedScout.answer}`
        );
        return;
      }
      await sendMessage(
        config.token,
        chatId,
        "Статус Scout: в этой сессии нет сохранённого последнего результата.\n" +
          "Напиши: `Позови Скаута ...` — и я запущу новый запрос сразу."
      );
      return;
    }
    case "intercept_source_cached": {
      if (cachedScout) {
        const sourceUrl = firstUrlFromText(cachedScout.answer);
        const sourcePart = sourceUrl ? `\nЛучший источник:\n${sourceUrl}` : "";
        await sendMessage(
          config.token,
          chatId,
          `Источник: внешний контур Scout (не обучающие данные).\nrequest_id: ${cachedScout.requestId}${sourcePart}`
        );
      }
      return;
    }
    case "intercept_source_no_cache": {
      await sendMessage(
        config.token,
        chatId,
        "Я не знаю и не могу точно назвать источник. Но точно не от Скаута (в этой сессии нет последнего Scout-ответа).\n" +
          "Напиши: `Позови Скаута ...` — и я сразу верну ответ с лучшей ссылкой и request_id."
      );
      return;
    }
    case "route_assistant_explicit":
    case "defer_guard_llm":
    default:
      break;
  }

  const scoutDecision = text.trim() && !explicitAssistantOnly ? detectScoutTaskType(text, hasImage, hasVoice) : null;
  const forceFreshWebSearch = text.trim() && !explicitAssistantOnly && isFreshQuestion(text, hasImage, hasVoice);
  const forceScoutByGuard = Boolean(guardDecision?.matched && guardDecision.route === "force_scout");
  const guardTaskType = guardDecision?.task_type ?? "web_search";
  const guardInstructions =
    guardDecision?.instructions ||
    "Search the web for up-to-date factual answer with expanded response and one best source.";

  // Hard deterministic path: explicit Python-guard Scout routing bypasses ownership/LLM checks.
  if (forceScoutByGuard) {
    try {
      await executeScoutFlow({
        token: config.token,
        chatId,
        userId,
        label,
        rawText: text,
        decision: {
          taskType: guardTaskType,
          instructions: guardInstructions,
          routeMode: "fast",
        },
      });
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] Scout guard flow error for ${label}: ${errMsg}`);
      await sendMessage(config.token, chatId, `Ошибка маршрутизации в Скаут: ${errMsg}`);
      return;
    }
  }

  const ownershipDecision =
    text.trim() && !hasImage && !hasVoice && !isSourceFollowUp && !forceScoutByGuard && !explicitAssistantOnly
      ? await runLlmOwnershipCheck(text)
      : null;
  const forceScoutByOwnership =
    Boolean(ownershipDecision && ownershipDecision.addressed_to === "scout" && ownershipDecision.confidence >= 0.55);
  const ownershipInstructions =
    "Routing verified by LLM: request should go to Scout web research. Return expanded answer with one best source.";
  const effectiveScoutDecision =
    (forceScoutByGuard || forceScoutByOwnership
      ? {
          taskType: forceScoutByOwnership ? ("web_search" as ScoutTaskType) : guardTaskType,
          instructions: forceScoutByOwnership ? ownershipInstructions : guardInstructions,
          routeMode: "fast" as ScoutRouteMode,
        }
      : scoutDecision) ??
    (forceFreshWebSearch
      ? {
          taskType: "web_search" as ScoutTaskType,
          instructions: "Search the web for up-to-date factual answer with concise summary and citations.",
          routeMode: "fast" as ScoutRouteMode,
        }
      : null);

  if (effectiveScoutDecision) {
    try {
      await executeScoutFlow({
        token: config.token,
        chatId,
        userId,
        label,
        rawText: text,
        decision: effectiveScoutDecision,
      });
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] Scout flow error for ${label}: ${errMsg}`);
      await sendMessage(config.token, chatId, `Ошибка маршрутизации в Скаут: ${errMsg}`);
      return;
    }
  }

  if (text.trim() && !explicitAssistantOnly && requiresExternalFreshData(text, hasImage, hasVoice)) {
    await sendMessage(
      config.token,
      chatId,
      "Не отвечаю из памяти на актуальные факты. Нужен внешний контур Scout. " +
        "Переформулируй запрос или добавь: 'найди в интернете ...'."
    );
    return;
  }

  // Keep typing indicator alive while queued/running
  const typingInterval = setInterval(() => sendTyping(config.token, chatId), 4000);

  try {
    await sendTyping(config.token, chatId);
    let imagePath: string | null = null;
    let voicePath: string | null = null;
    let voiceTranscript: string | null = null;
    if (hasImage) {
      try {
        imagePath = await downloadImageFromMessage(config.token, message);
      } catch (err) {
        console.error(`[Telegram] Failed to download image for ${label}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (hasVoice) {
      try {
        voicePath = await downloadVoiceFromMessage(config.token, message);
      } catch (err) {
        console.error(`[Telegram] Failed to download voice for ${label}: ${err instanceof Error ? err.message : err}`);
      }

      if (voicePath) {
        try {
          debugLog(`Voice file saved: path=${voicePath}`);
          voiceTranscript = await transcribeAudioToText(voicePath, {
            debug: telegramDebug,
            log: (message) => debugLog(message),
          });
        } catch (err) {
          console.error(`[Telegram] Failed to transcribe voice for ${label}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const promptParts = ["[InputProvenance: owner_direct]", "[TrustLevel: trusted_owner]", `[Telegram from ${label}]`];
    if (text.trim() && isTwinRelatedQuery(text)) {
      const twinContext = await buildTwinContextReport(6);
      promptParts.push(`[TwinSyncContext]\n${twinContext}`);
    }
    if (text.trim()) promptParts.push(`Message: ${text}`);
    if (imagePath) {
      promptParts.push(`Image path: ${imagePath}`);
      promptParts.push("The user attached an image. Inspect this image file directly before answering.");
    } else if (hasImage) {
      promptParts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
    }
    if (voiceTranscript) {
      promptParts.push(`Voice transcript: ${voiceTranscript}`);
      promptParts.push("The user attached voice audio. Use the transcript as their spoken message.");
    } else if (hasVoice) {
      promptParts.push(
        "The user attached voice audio, but it could not be transcribed. Respond and ask them to resend a clearer clip."
      );
    }
    promptParts.push(
      "ЖЁСТКОЕ ПРАВИЛО: если нет подтверждённого инструмента для SSH — не имитируй его вывод, честно скажи что не знаешь."
    );
    promptParts.push(
      "ЖЁСТКОЕ ПРАВИЛО: Scout работает на 89.167.81.12 — не проверяй другие хосты без явного указания."
    );
    const prefixedPrompt = promptParts.join("\n");
    const result = await runUserMessage("telegram", prefixedPrompt);

    if (result.exitCode !== 0) {
      await sendMessage(config.token, chatId, `Error (exit ${result.exitCode}): ${result.stderr || "Unknown error"}`);
    } else {
      const { cleanedText, reactionEmoji } = extractReactionDirective(result.stdout || "");
      if (reactionEmoji) {
        await sendReaction(config.token, chatId, message.message_id, reactionEmoji).catch((err) => {
          console.error(`[Telegram] Failed to send reaction for ${label}: ${err instanceof Error ? err.message : err}`);
        });
      }
      markAssistantRoute(chatId);
      await sendMessage(config.token, chatId, cleanedText || "(empty response)");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Telegram] Error for ${label}: ${errMsg}`);
    await sendMessage(config.token, chatId, `Error: ${errMsg}`);
  } finally {
    clearInterval(typingInterval);
  }
}

// --- Callback query handler ---

async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const config = getSettings().telegram;
  const data = query.data ?? "";

  // Secretary pattern: "sec_yes_<8hex>" or "sec_no_<8hex>"
  const secMatch = data.match(/^sec_(yes|no)_([0-9a-f]{8})$/);
  if (secMatch) {
    const action = secMatch[1];
    const pendingId = secMatch[2];
    let answerText = "⚠️ Server error";
    try {
      const resp = await fetch(`http://127.0.0.1:9999/confirm/${pendingId}/${action}`);
      const result = await resp.json() as { ok: boolean };
      answerText = action === "yes" && result.ok ? "✅ Đã gửi!" : result.ok ? "❌ Dismissed" : "⚠️ Not found";
      if (query.message) {
        const statusLine = action === "yes" ? "\n\n✅ Sent" : "\n\n❌ Dismissed";
        const newText = (query.message.text ?? "").replace(/\n\nReply:.*$/s, statusLine);
        await callApi(config.token, "editMessageText", {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          text: newText,
        }).catch(() => {});
      }
    } catch {
      // server not running or error
    }
    await callApi(config.token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: answerText,
    }).catch(() => {});
    return;
  }

  const twinMatch = data.match(/^twin_(yes|no)_([a-f0-9]{12})$/);
  if (twinMatch) {
    const action = twinMatch[1] === "yes" ? "approve" : "reject";
    const token = twinMatch[2];
    let answerText = "⚠️ Twin action failed";
    try {
      const callbackMap = await loadTwinCallbackMap();
      const mapped = callbackMap[token];
      const proposalId = mapped?.proposal_id;
      if (!proposalId || isTwinCallbackExpired(mapped)) {
        if (mapped) {
          delete callbackMap[token];
          await saveTwinCallbackMap(callbackMap);
        }
        answerText = "⚠️ Proposal token expired";
      } else {
        const result = await executeTwinProposalDecision({
          decision: action,
          proposalId,
          comment: `telegram_callback:${query.from.id}`,
        });
        delete callbackMap[token];
        await saveTwinCallbackMap(callbackMap);
        if (result.ok) {
          answerText = action === "approve" ? "✅ Approved" : "❌ Rejected";
          if (query.message) {
            const summary =
              action === "approve"
                ? `\n\n✅ Approved: ${proposalId}`
                : `\n\n❌ Rejected: ${proposalId}`;
            const baseText = query.message.text ?? "";
            const updatedText = `${baseText}${summary}`.slice(0, 3900);
            await callApi(config.token, "editMessageText", {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              text: updatedText,
            }).catch(() => {});
          }
        } else {
          answerText = "⚠️ Twin apply returned non-ok";
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      answerText = `⚠️ ${errMsg.slice(0, 100)}`;
    }

    await callApi(config.token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: answerText,
    }).catch(() => {});
    return;
  }

  // Default: ack with no text
  await callApi(config.token, "answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});
}

// --- Polling loop ---

let running = true;

async function poll(): Promise<void> {
  const config = getSettings().telegram;
  let offset = 0;
  try {
    const me = await callApi<{ ok: boolean; result: TelegramMe }>(config.token, "getMe");
    if (me.ok) {
      botUsername = me.result.username ?? null;
      botId = me.result.id;
      console.log(`  Bot: ${botUsername ? `@${botUsername}` : botId}`);
      console.log(`  Group privacy: ${me.result.can_read_all_group_messages ? "disabled (reads all messages)" : "enabled (commands & mentions only)"}`);
    }
  } catch (err) {
    console.error(`[Telegram] getMe failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("Telegram bot started (long polling)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (telegramDebug) console.log("  Debug: enabled");

  while (running) {
    try {
      const data = await callApi<{ ok: boolean; result: TelegramUpdate[] }>(
        config.token,
        "getUpdates",
        { offset, timeout: 30, allowed_updates: ["message", "my_chat_member", "callback_query"] }
      );

      if (!data.ok || !data.result.length) continue;

      for (const update of data.result) {
        debugLog(
          `Update ${update.update_id} keys=${Object.keys(update).join(",")}`
        );
        offset = update.update_id + 1;
        const incomingMessages = [
          update.message,
          update.edited_message,
          update.channel_post,
          update.edited_channel_post,
        ].filter((m): m is TelegramMessage => Boolean(m));
        for (const incoming of incomingMessages) {
          handleMessage(incoming).catch((err) => {
            console.error(`[Telegram] Unhandled: ${err}`);
          });
        }
        if (update.my_chat_member) {
          handleMyChatMember(update.my_chat_member).catch((err) => {
            console.error(`[Telegram] my_chat_member unhandled: ${err}`);
          });
        }
        if (update.callback_query) {
          handleCallbackQuery(update.callback_query).catch((err) => {
            console.error(`[Telegram] callback_query unhandled: ${err}`);
          });
        }
      }
    } catch (err) {
      if (!running) break;
      console.error(`[Telegram] Poll error: ${err instanceof Error ? err.message : err}`);
      await Bun.sleep(5000);
    }
  }
}

// --- Exports ---

/** Send a message to a specific chat (used by heartbeat forwarding) */
export { sendMessage };

process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

/** Start polling in-process (called by start.ts when token is configured) */
export function startPolling(debug = false): void {
  telegramDebug = debug;
  (async () => {
    await ensureProjectClaudeMd();
    await poll();
  })().catch((err) => {
    console.error(`[Telegram] Fatal: ${err}`);
  });
}

/** Standalone entry point (bun run src/index.ts telegram) */
export async function telegram() {
  await loadSettings();
  await ensureProjectClaudeMd();
  await poll();
}
