import { ensureProjectClaudeMd, run, runUserMessage } from "../runner";
import { getSettings, loadSettings } from "../config";
import { resetSession } from "../sessions";
import { transcribeAudioToText } from "../whisper";
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
const SCOUT_REQUEST_DIR = process.env.SCOUT_REQUEST_DIR ?? `${RUNTIME_HOME}/inbox/requests`;
const SCOUT_CHECKED_DIRS = [
  process.env.SCOUT_CHECKED_DIR ?? `${RUNTIME_HOME}/checked/canonical`,
];
const SCOUT_FAST_PATH_MS = 30_000;
const SCOUT_FALLBACK_MS = 180_000;
const SCOUT_POLL_INTERVAL_MS = 3_000;
const SCOUT_RESEARCH_FAST_PATH_MS = 15_000;
const SCOUT_RESEARCH_ACK_WAIT_MS = 30_000;
const SCOUT_RESEARCH_LATE_DELIVERY_MS = 45 * 60_000;
const SCOUT_SCHEMA_VERSION = "1.0";
const SCOUT_REQUEST_SCHEMA_VERSION = "1.0";
const TWIN_APPLY_PROPOSAL_SCRIPT =
  process.env.TWIN_APPLY_PROPOSAL_SCRIPT ??
  `${RUNTIME_REPO_DIR}/ops/twin-sync/bot-vps/apply_twin_proposal.py`;
const TWIN_CALLBACK_MAP_PATH =
  process.env.TWIN_CALLBACK_MAP_PATH ??
  `${RUNTIME_TWIN_BASE_DIR}/state/proposal-callback-map.json`;

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
    const lateAnswer = await waitForScoutResponse(
      params.requestId,
      params.taskType,
      SCOUT_RESEARCH_LATE_DELIVERY_MS
    );
    if (!lateAnswer) return;

    await sendMessage(
      params.token,
      params.chatId,
      `Результат исследования готов (late delivery):\nrequest_id: ${params.requestId}\n\n${lateAnswer}`
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
): string | null {
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
    const summary = payload.result?.summary;
    if (!summary || typeof summary !== "string" || !summary.trim()) return null;
    return summary.trim();
  }

  if (payload.status === "error") {
    const msg = typeof payload.error_message === "string" ? payload.error_message.trim() : "";
    return msg ? `Скаут вернул ошибку: ${msg}` : "Скаут вернул ошибку без деталей.";
  }

  return null;
}

async function findScoutResponse(requestId: string, expectedTaskType: ScoutTaskType): Promise<string | null> {
  for (const dir of SCOUT_CHECKED_DIRS) {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const body = await readFile(join(dir, file), "utf8");
        const payload = parseNestedScoutPayload(body);
        if (!payload) continue;
        const validatedAnswer = validateScoutPayload(payload, requestId, expectedTaskType);
        if (validatedAnswer) return validatedAnswer;
      }
    } catch {
      // Directory might not exist yet.
    }
  }
  return null;
}

async function waitForScoutResponse(
  requestId: string,
  expectedTaskType: ScoutTaskType,
  timeoutMs: number
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const answer = await findScoutResponse(requestId, expectedTaskType);
    if (answer) return answer;
    await Bun.sleep(SCOUT_POLL_INTERVAL_MS);
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

  const scoutDecision = text.trim() ? detectScoutTaskType(text, hasImage, hasVoice) : null;
  const forceFreshWebSearch = text.trim() && isFreshQuestion(text, hasImage, hasVoice);
  const effectiveScoutDecision =
    scoutDecision ??
    (forceFreshWebSearch
      ? {
          taskType: "web_search" as ScoutTaskType,
          instructions: "Search the web for up-to-date factual answer with concise summary and citations.",
          routeMode: "fast" as ScoutRouteMode,
        }
      : null);

  if (effectiveScoutDecision) {
    try {
      const req = await createScoutRequest({
        chatId,
        userId,
        label,
        text,
        taskType: effectiveScoutDecision.taskType,
        instructions: effectiveScoutDecision.instructions,
      });
      await sendMessage(config.token, chatId, `Принял, запрашиваю у Скаута...\nrequest_id: ${req.requestId}`);

      if (effectiveScoutDecision.routeMode === "research") {
        const initialResponse = await waitForScoutResponse(
          req.requestId,
          effectiveScoutDecision.taskType,
          SCOUT_RESEARCH_FAST_PATH_MS
        );
        if (initialResponse) {
          await sendMessage(config.token, chatId, initialResponse);
          return;
        }

        await sendMessage(
          config.token,
          chatId,
          "Запрос тяжёлый, запускаю обычный трек исследования. Пришлю результат отдельно, как только будет готов."
        );

        const ackResponse = await waitForScoutResponse(
          req.requestId,
          effectiveScoutDecision.taskType,
          SCOUT_RESEARCH_ACK_WAIT_MS
        );
        if (ackResponse) {
          await sendMessage(config.token, chatId, ackResponse);
          return;
        }

        scheduleScoutLateDelivery({
          token: config.token,
          chatId,
          requestId: req.requestId,
          taskType: effectiveScoutDecision.taskType,
          label,
        });
        await sendMessage(
          config.token,
          chatId,
          `Исследование продолжается. Дошлю ответ, когда данные пройдут контур Scout -> Sanitizer -> checked.\nrequest_id: ${req.requestId}`
        );
        return;
      }

      const fastPathResponse = await waitForScoutResponse(
        req.requestId,
        effectiveScoutDecision.taskType,
        SCOUT_FAST_PATH_MS
      );
      if (fastPathResponse) {
        await sendMessage(config.token, chatId, fastPathResponse);
        return;
      }

      await sendMessage(config.token, chatId, "Скаут ещё собирает данные. Подожду до 3 минут...");
      const fallbackResponse = await waitForScoutResponse(
        req.requestId,
        effectiveScoutDecision.taskType,
        SCOUT_FALLBACK_MS - SCOUT_FAST_PATH_MS
      );
      if (fallbackResponse) {
        await sendMessage(config.token, chatId, fallbackResponse);
        return;
      }

      await sendMessage(
        config.token,
        chatId,
        "Таймаут: Скаут не вернул данные за 3 минуты. Попробуй повторить запрос."
      );
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] Scout flow error for ${label}: ${errMsg}`);
      await sendMessage(config.token, chatId, `Ошибка маршрутизации в Скаут: ${errMsg}`);
      return;
    }
  }

  if (text.trim() && requiresExternalFreshData(text, hasImage, hasVoice)) {
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
