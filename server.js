require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();

app.use(helmet());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Extension-Key"]
}));
app.use(express.json({ limit: "7mb" }));

const VERSION = "1.2.0-random-open-ticket";
const SENDER_VERSION = "v1.2.0-random-open-ticket";

const THULIUM = Object.freeze({
  statuses: "/api/ticket_statuses",
  ticketStatuses: "/api/ticket_statuses",
  categories: "/api/ticket_categories",
  queues: "/api/ticket_queues",
  ticketQueues: "/api/ticket_queues",
  agents: "/api/agents",
  agent: (login) => `/api/agents/${encodeURIComponent(login)}`,
  tickets: "/api/tickets",
  ticket: (id) => `/api/tickets/${encodeURIComponent(id)}`,
  agentResponse: (id) => `/api/tickets/${encodeURIComponent(id)}/agent_response`,
  comment: (id) => `/api/tickets/${encodeURIComponent(id)}/comment`,
  customerResponse: (id) => `/api/tickets/${encodeURIComponent(id)}/customer_response`
});

function normalizeError(error) {
  if (error && error.response) {
    return {
      status: error.response.status,
      data: error.response.data,
      url: error.config && error.config.url
    };
  }
  return { message: error && error.message ? error.message : String(error) };
}

function requireExtensionKey(req, res, next) {
  const configured = process.env.EXTENSION_API_KEY;
  if (!configured || configured === "change-me-long-random-token") {
    return res.status(500).json({ ok: false, error: "EXTENSION_API_KEY_NOT_CONFIGURED" });
  }
  const provided = req.headers["x-extension-key"];
  if (!provided || provided !== configured) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED_EXTENSION" });
  }
  next();
}

function writeAllowed(actionName) {
  const enabled = String(process.env.THULIUM_TICKET_WRITE_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    return {
      ok: false,
      error: "THULIUM_TICKET_WRITE_DISABLED",
      message: `Akcja ${actionName} jest zablokowana. Ustaw THULIUM_TICKET_WRITE_ENABLED=true w Render.`
    };
  }
  return { ok: true };
}

function createThuliumClient() {
  const baseURL = (process.env.THULIUM_BASE_URL || "").replace(/\/$/, "");
  if (!baseURL) throw new Error("Missing THULIUM_BASE_URL");
  if (!process.env.THULIUM_API_USER || !process.env.THULIUM_API_PASSWORD) {
    throw new Error("Missing THULIUM_API_USER or THULIUM_API_PASSWORD");
  }

  const token = Buffer.from(`${process.env.THULIUM_API_USER}:${process.env.THULIUM_API_PASSWORD}`).toString("base64");

  return axios.create({
    baseURL,
    timeout: Number(process.env.THULIUM_TIMEOUT_MS || 20000),
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "pl"
    }
  });
}

function arr(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "items", "results", "rows", "records", "tickets", "statuses", "queues", "categories"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.values(value).filter(item => item && typeof item === "object");
}

function itemId(item) {
  if (!item || typeof item !== "object") return null;
  return item.id ?? item.status_id ?? item.category_id ?? item.ticket_category_id ?? item.queue_id ?? item.ticket_queue_id ?? item.value ?? null;
}

function itemName(item) {
  if (!item || typeof item !== "object") return "";
  return item.name || item.title || item.label || item.value || item.status || item.category || item.queue || item.description || "";
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findByName(items, names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(norm).filter(Boolean);
  for (const item of arr(items)) {
    const n = norm(itemName(item));
    if (!n) continue;
    if (wanted.some(w => n === w || n.includes(w) || w.includes(n))) return item;
  }
  return null;
}

function findById(items, id) {
  if (id === null || id === undefined || id === "") return null;
  return arr(items).find(item => String(itemId(item)) === String(id)) || null;
}

function emailList(value) {
  const raw = Array.isArray(value) ? value.join(" ") : String(value || "");
  const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map(email => email.toLowerCase().trim()))];
}

function firstEmail(value) {
  return emailList(value)[0] || null;
}

async function getTicket(ticketId) {
  const client = createThuliumClient();
  const response = await client.get(THULIUM.ticket(ticketId));
  return response.data;
}

async function getTicketDictionariesClean() {
  const client = createThuliumClient();
  const result = {};
  for (const [key, endpoint] of Object.entries({
    statuses: THULIUM.statuses,
    categories: THULIUM.categories,
    queues: THULIUM.queues
  })) {
    try {
      const response = await client.get(endpoint);
      result[key] = { ok: true, endpoint, data: response.data };
    } catch (error) {
      result[key] = { ok: false, endpoint, data: [], error: normalizeError(error) };
    }
  }
  return result;
}

function categoryHints(text) {
  const t = norm(text);
  const rules = [
    { keys: ["faktura", "invoice", "paragon", "vat", "transakcja"], cats: ["faktura", "faktury", "ksiegowosc", "płatność", "platnosc"] },
    { keys: ["platnosc", "płatność", "paypal", "przelew", "blik", "karta", "payu"], cats: ["płatność", "platnosc", "płatności", "platnosci", "ksiegowosc"] },
    { keys: ["zwrot", "refund", "reklamacja", "chargeback"], cats: ["zwrot", "reklamacja", "płatność", "platnosc"] },
    { keys: ["licencja", "kod", "klucz", "license"], cats: ["licencje", "licencja", "kody"] },
    { keys: ["konto", "logowanie", "haslo", "hasło", "dostep", "dostęp"], cats: ["konto", "dostęp", "dostep", "techniczne"] },
    { keys: ["subskrypcja", "abonament", "rata", "raty"], cats: ["subskrypcja", "raty", "płatność", "platnosc"] },
    { keys: ["allintool", "narzedzie", "narzędzie", "tool"], cats: ["allintool", "narzędzia", "narzedzia", "techniczne"] },
    { keys: ["newsletter", "mailing"], cats: ["newsletter", "mailing"] },
    { keys: ["umowa", "autenti", "dokument", "podpis"], cats: ["umowa", "autenti", "dokumenty"] }
  ];

  const out = [];
  for (const rule of rules) {
    if (rule.keys.some(k => t.includes(norm(k)))) out.push(...rule.cats);
  }
  return [...new Set(out)];
}

function chooseCategory(categories, { categoryId = null, categoryName = null, content = "", ticket = null } = {}) {
  const items = arr(categories);

  if (!items.length) {
    return { error: "CATEGORIES_NOT_LOADED", message: "Nie udało się pobrać kategorii z Thulium." };
  }

  if (categoryId) {
    const found = findById(items, categoryId);
    return found || { error: "CATEGORY_ID_NOT_FOUND", message: `Kategoria ID ${categoryId} nie istnieje w Thulium.` };
  }

  if (categoryName) {
    const found = findByName(items, categoryName);
    return found || { error: "CATEGORY_NAME_NOT_FOUND", message: `Kategoria "${categoryName}" nie istnieje w Thulium.` };
  }

  const text = `${content}\n${JSON.stringify(ticket || {})}`;
  for (const hint of categoryHints(text)) {
    const found = findByName(items, hint);
    if (found) return found;
  }

  return items[0] || null;
}

function buildUpdatePayload({ status, category }) {
  const payload = {};

  if (status && itemId(status) !== null) payload.status_id = itemId(status);
  if (category && !category.error && itemId(category) !== null) {
    payload.category_id = itemId(category);
    payload.ticket_category_id = itemId(category);
  }

  return payload;
}

async function closeAndCategorize({ ticketId, ticket, content, categoryId = null, categoryName = null, dryRun = false }) {
  const allowed = dryRun ? { ok: true } : writeAllowed("closeAndCategorize");
  if (!allowed.ok) return allowed;

  const dictionaries = await getTicketDictionariesClean();
  const statuses = arr(dictionaries.statuses && dictionaries.statuses.data);
  const categories = arr(dictionaries.categories && dictionaries.categories.data);

  const closedStatus = findByName(statuses, ["Zamknięte", "Zamkniete", "Closed", "Close"]);
  if (!closedStatus) {
    return {
      ok: false,
      error: "CLOSED_STATUS_NOT_FOUND",
      message: "Nie znaleziono statusu Zamknięte w istniejących statusach Thulium.",
      availableStatuses: statuses.map(s => ({ id: itemId(s), name: itemName(s) }))
    };
  }

  const category = chooseCategory(categories, { categoryId, categoryName, content, ticket });
  if (category && category.error) {
    return {
      ok: false,
      error: category.error,
      message: category.message,
      availableCategories: categories.map(c => ({ id: itemId(c), name: itemName(c) }))
    };
  }

  const update = buildUpdatePayload({ status: closedStatus, category });

  const base = {
    ok: true,
    dryRun,
    endpoint: THULIUM.ticket(ticketId),
    proposedStatus: { id: itemId(closedStatus), name: itemName(closedStatus), raw: closedStatus },
    proposedCategory: category ? { id: itemId(category), name: itemName(category), raw: category } : null,
    update
  };

  if (dryRun) return base;

  const client = createThuliumClient();
  const response = await client.put(THULIUM.ticket(ticketId), update);
  return { ...base, updated: response.data };
}

function fallbackAgentLogin() {
  return process.env.THULIUM_AGENT_LOGIN || process.env.THULIUM_API_USER || "CHATGPT";
}

function cleanAgentLogin(value) {
  return String(value || "").trim();
}

function resolveAgentLogin(agentLoginOverride = null) {
  const login = cleanAgentLogin(agentLoginOverride) || fallbackAgentLogin();
  if (!login) {
    throw new Error("Missing agent login. Provide agentLogin from extension or THULIUM_AGENT_LOGIN in Render.");
  }
  return login;
}

function bodyType() {
  const value = String(process.env.THULIUM_AGENT_RESPONSE_BODY_TYPE || "PLAIN").toUpperCase();
  return value === "HTML" ? "HTML" : "PLAIN";
}

async function sendAgentResponseExact({ ticketId, content, agentLoginOverride = null }) {
  const allowed = writeAllowed("sendAgentResponseExact");
  if (!allowed.ok) return allowed;

  const client = createThuliumClient();
  const endpoint = THULIUM.agentResponse(ticketId);

  const payload = {
    body: content,
    body_type: bodyType(),
    user_login: resolveAgentLogin(agentLoginOverride)
  };

  const attempts = [];

  try {
    const response = await client.post(endpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "pl"
      }
    });
    return {
      ok: true,
      senderVersion: SENDER_VERSION,
      endpoint,
      usedPayload: payload,
      contentType: "application/json",
      data: response.data
    };
  } catch (error) {
    attempts.push({ endpoint, payload, contentType: "application/json", error: normalizeError(error) });
  }

  const params = new URLSearchParams();
  params.set("body", content);
  params.set("body_type", bodyType());
  params.set("user_login", agentLogin());

  try {
    const response = await client.post(endpoint, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Accept-Language": "pl"
      }
    });
    return {
      ok: true,
      senderVersion: SENDER_VERSION,
      endpoint,
      usedPayload: { body: content, body_type: bodyType(), user_login: resolveAgentLogin(agentLoginOverride) },
      contentType: "application/x-www-form-urlencoded",
      data: response.data
    };
  } catch (error) {
    attempts.push({
      endpoint,
      payload: { body: content, body_type: bodyType(), user_login: resolveAgentLogin(agentLoginOverride) },
      contentType: "application/x-www-form-urlencoded",
      error: normalizeError(error)
    });
  }

  return {
    ok: false,
    senderVersion: SENDER_VERSION,
    error: "AGENT_RESPONSE_REJECTED_EXACT_PDF_PAYLOAD",
    message: "Thulium odrzucił dokładny payload z dokumentacji: body, user_login, body_type. Ticket NIE został zamknięty.",
    endpoint,
    requiredPayloadShape: { body: "treść", body_type: "PLAIN|HTML", user_login: resolveAgentLogin(agentLoginOverride) },
    attempts
  };
}

async function sendFinal({ ticketId, content, categoryId = null, categoryName = null, closeTicket = true, dryRun = false, agentLogin = null }) {
  if (!ticketId) throw new Error("Missing ticketId");
  if (!content) throw new Error("Missing content");

  const ticket = await getTicket(ticketId);

  const preview = closeTicket
    ? await closeAndCategorize({ ticketId, ticket, content, categoryId, categoryName, dryRun: true })
    : { ok: true, skipped: true, reason: "closeTicket=false" };

  if (closeTicket && !preview.ok) {
    return {
      ok: false,
      ticketId,
      error: "CLOSE_OR_CATEGORY_PREFLIGHT_FAILED",
      message: "Nie wysyłam odpowiedzi, bo nie udało się potwierdzić statusu/kategorii.",
      actionPreview: preview
    };
  }

  if (dryRun) {
    return { ok: true, dryRun: true, ticketId, content, actionPreview: preview };
  }

  const sendResult = await sendAgentResponseExact({ ticketId, content, agentLoginOverride: agentLogin });

  if (!sendResult.ok) {
    return {
      ok: false,
      ticketId,
      error: "SEND_REPLY_FAILED_TICKET_NOT_CLOSED",
      message: "Nie wysłano odpowiedzi, więc ticket NIE został zamknięty ani zmieniony.",
      sendResult
    };
  }

  const actionResult = closeTicket
    ? await closeAndCategorize({ ticketId, ticket, content, categoryId, categoryName, dryRun: false })
    : { ok: true, skipped: true, reason: "closeTicket=false" };

  return {
    ok: true,
    ticketId,
    senderVersion: SENDER_VERSION,
    sendResult,
    actionResult,
    message: "Wysłano odpowiedź dokładnym payloadem z PDF, potem zamknięto ticket i ustawiono kategorię."
  };
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Number(process.env.OPENAI_TIMEOUT_MS || 45000) });
}

async function generateAiReply({ ticket, tone = "professional", customerEmails = [] }) {
  const openai = getOpenAIClient();
  const system = `
Jesteś asystentem obsługi klienta ALLinTraders.
Odpowiadasz na ostatnią wiadomość klienta w aktualnym tickecie.
Cała historia ticketu i inne dane są tylko kontekstem.
Zwróć wyłącznie JSON: suggested_reply, summary, missing_information, risk_level, requires_human_review, recommended_tags.
`.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ tone, customerEmails, ticket }, null, 2) }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "reply",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            suggested_reply: { type: "string" },
            summary: { type: "string" },
            missing_information: { type: "array", items: { type: "string" } },
            risk_level: { type: "string", enum: ["low", "medium", "high"] },
            requires_human_review: { type: "boolean" },
            recommended_tags: { type: "array", items: { type: "string" } }
          },
          required: ["suggested_reply", "summary", "missing_information", "risk_level", "requires_human_review", "recommended_tags"]
        }
      }
    }
  });

  return JSON.parse(response.output_text);
}


function normalizeTicketStatusName(value) {
  return norm(value)
    .replace(/\bstatus\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ticketStatusName(row) {
  return itemName(row) || row.status_name || row.ticket_status_name || row.name || row.status || "";
}

function ticketLooksOpen(row, openStatusIds = new Set(), openStatusNames = []) {
  if (!row || typeof row !== "object") return false;

  const statusId = row.status_id ?? row.ticket_status_id ?? row.statusId ?? row.status;
  if (statusId !== null && statusId !== undefined && openStatusIds.has(String(statusId))) return true;

  const rawStatus = [
    row.status,
    row.status_name,
    row.ticket_status,
    row.ticket_status_name,
    row.state,
    row.name
  ].filter(Boolean).join(" ");

  const normalized = normalizeTicketStatusName(rawStatus);
  if (openStatusNames.some(name => normalized === name || normalized.includes(name))) return true;

  const full = normalizeTicketStatusName(JSON.stringify(row));
  return ["nowy", "open", "otwarty", "new"].some(name => full.includes(name)) &&
    !["zamkniete", "zamknięte", "closed", "close"].some(name => full.includes(name));
}

function ticketIdFromRow(row) {
  if (!row || typeof row !== "object") return null;
  return row.id ?? row.ticket_id ?? row.ticketId ?? row.ticket ?? null;
}

async function loadTicketStatuses() {
  const client = createThuliumClient();
  try {
    const response = await client.get(THULIUM.ticketStatuses || THULIUM.statuses);
    const statuses = arr(response.data);
    return { ok: true, statuses, raw: response.data };
  } catch (error) {
    return { ok: false, statuses: [], error: normalizeError(error) };
  }
}

function pickOpenStatuses(statuses) {
  const preferredNames = ["nowy", "open", "otwarty", "new"];
  const closedNames = ["zamkniete", "zamknięte", "closed", "close"];

  const open = arr(statuses).filter(status => {
    const name = normalizeTicketStatusName(ticketStatusName(status));
    if (!name) return false;
    if (closedNames.some(closed => name.includes(closed))) return false;
    return preferredNames.some(openName => name === openName || name.includes(openName));
  });

  return open;
}

async function fetchTicketsWithParams(params) {
  const client = createThuliumClient();
  const response = await client.get(THULIUM.tickets, { params });
  return response.data;
}

async function loadOpenTicketCandidates({ limit = 100, queueIds = [], excludeIds = [] } = {}) {
  const statusesResult = await loadTicketStatuses();
  const openStatuses = pickOpenStatuses(statusesResult.statuses);
  const openStatusIds = new Set(openStatuses.map(item => itemId(item)).filter(v => v !== null && v !== undefined).map(String));
  const openStatusNames = openStatuses.map(ticketStatusName).map(normalizeTicketStatusName).filter(Boolean);

  const queryAttempts = [];

  for (const status of openStatuses) {
    const id = itemId(status);
    const name = ticketStatusName(status);

    if (id !== null && id !== undefined && id !== "") {
      queryAttempts.push({ status_id: id, limit });
      queryAttempts.push({ ticket_status_id: id, limit });
    }

    if (name) {
      queryAttempts.push({ status: name, limit });
      queryAttempts.push({ status_name: name, limit });
    }
  }

  // Exact list endpoint from Thulium API: GET /api/tickets. If filters differ between installations,
  // this fallback loads the list and filters on our side.
  queryAttempts.push({ limit });
  queryAttempts.push({});

  const seenAttempts = new Set();
  const seenTickets = new Set();
  const candidates = [];
  const errors = [];

  for (const baseParams of queryAttempts) {
    const variants = queueIds.length
      ? queueIds.flatMap(queueId => [
          { ...baseParams, ticket_queue_id: queueId },
          { ...baseParams, queue_id: queueId }
        ])
      : [baseParams];

    for (const params of variants) {
      const key = JSON.stringify(params);
      if (seenAttempts.has(key)) continue;
      seenAttempts.add(key);

      try {
        const data = await fetchTicketsWithParams(params);
        const rows = arr(data);

        for (const row of rows) {
          const id = ticketIdFromRow(row);
          if (!id) continue;
          if (excludeIds.map(String).includes(String(id))) continue;
          if (seenTickets.has(String(id))) continue;

          if (ticketLooksOpen(row, openStatusIds, openStatusNames) || !openStatuses.length) {
            seenTickets.add(String(id));
            candidates.push(row);
          }
        }
      } catch (error) {
        errors.push({ params, error: normalizeError(error) });
      }

      if (candidates.length >= Number(limit)) break;
    }

    if (candidates.length >= Number(limit)) break;
  }

  return {
    statusesResult,
    openStatuses,
    candidates,
    errors,
    queryAttempts: [...seenAttempts].map(item => JSON.parse(item))
  };
}



app.get("/api/random-open-ticket", requireExtensionKey, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const queueIds = String(req.query.queueIds || "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
    const excludeIds = String(req.query.excludeIds || "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);

    const result = await loadOpenTicketCandidates({ limit, queueIds, excludeIds });

    if (!result.candidates.length) {
      return res.status(404).json({
        ok: false,
        error: "NO_OPEN_TICKETS_FOUND",
        message: "Nie znaleziono otwartego ticketu przez GET /api/tickets i statusy z GET /api/ticket_statuses.",
        openStatuses: result.openStatuses.map(status => ({ id: itemId(status), name: ticketStatusName(status), raw: status })),
        errors: result.errors.slice(0, 8),
        queryAttempts: result.queryAttempts.slice(0, 12)
      });
    }

    const picked = result.candidates[Math.floor(Math.random() * result.candidates.length)];
    const ticketId = ticketIdFromRow(picked);

    res.json({
      ok: true,
      endpointSource: {
        tickets: THULIUM.tickets,
        statuses: THULIUM.ticketStatuses || THULIUM.statuses
      },
      ticketId: String(ticketId),
      ticket: picked,
      poolSize: result.candidates.length,
      openStatuses: result.openStatuses.map(status => ({ id: itemId(status), name: ticketStatusName(status) })),
      queryAttempts: result.queryAttempts.slice(0, 12)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "RANDOM_OPEN_TICKET_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/random-open-ticket", requireExtensionKey, async (req, res) => {
  try {
    const { limit = 100, queueIds = [], excludeIds = [] } = req.body || {};
    const result = await loadOpenTicketCandidates({ limit, queueIds, excludeIds });

    if (!result.candidates.length) {
      return res.status(404).json({
        ok: false,
        error: "NO_OPEN_TICKETS_FOUND",
        message: "Nie znaleziono otwartego ticketu przez GET /api/tickets i statusy z GET /api/ticket_statuses.",
        openStatuses: result.openStatuses.map(status => ({ id: itemId(status), name: ticketStatusName(status), raw: status })),
        errors: result.errors.slice(0, 8),
        queryAttempts: result.queryAttempts.slice(0, 12)
      });
    }

    const picked = result.candidates[Math.floor(Math.random() * result.candidates.length)];
    const ticketId = ticketIdFromRow(picked);

    res.json({
      ok: true,
      endpointSource: {
        tickets: THULIUM.tickets,
        statuses: THULIUM.ticketStatuses || THULIUM.statuses
      },
      ticketId: String(ticketId),
      ticket: picked,
      poolSize: result.candidates.length,
      openStatuses: result.openStatuses.map(status => ({ id: itemId(status), name: ticketStatusName(status) })),
      queryAttempts: result.queryAttempts.slice(0, 12)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "RANDOM_OPEN_TICKET_FAILED", details: normalizeError(error) });
  }
});


app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "thulium-ai-agent",
    version: VERSION,
    auditedBuild: true,
    cleanBuild: true,
    senderVersion: SENDER_VERSION,
    exactPdfPayload: true,
    exactPayloadShape: {
      body: "string",
      body_type: "PLAIN|HTML",
      user_login: fallbackAgentLogin()
    },
    perUserAgentLogin: true,
    randomOpenTicket: true,
    agentSource: "extension agentLogin > THULIUM_AGENT_LOGIN fallback",
    writeEnabled: String(process.env.THULIUM_TICKET_WRITE_ENABLED || "false").toLowerCase() === "true",
    endpoints: THULIUM,
    time: new Date().toISOString()
  });
});


app.get("/api/agents", requireExtensionKey, async (req, res) => {
  try {
    const client = createThuliumClient();
    const response = await client.get(THULIUM.agents);
    const agents = arr(response.data).map(agent => ({
      id: itemId(agent),
      login: agent.login || agent.agent_login || agent.username || "",
      name: agent.name || "",
      surname: agent.surname || "",
      email: agent.email || "",
      active: agent.active ?? agent.is_active ?? null,
      raw: agent
    })).filter(agent => agent.login);

    res.json({ ok: true, endpoint: THULIUM.agents, count: agents.length, agents });
  } catch (error) {
    res.status(500).json({ ok: false, error: "AGENTS_LOAD_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/agent-resolve", requireExtensionKey, async (req, res) => {
  try {
    const { login, email, name } = req.body || {};
    const wantedLogin = cleanAgentLogin(login);

    const client = createThuliumClient();

    if (wantedLogin) {
      try {
        const response = await client.get(THULIUM.agent(wantedLogin));
        const agent = response.data;
        return res.json({
          ok: true,
          source: "login",
          agentLogin: agent.login || wantedLogin,
          agent
        });
      } catch (error) {
        // Fall through to list matching below.
      }
    }

    const response = await client.get(THULIUM.agents);
    const agents = arr(response.data);
    const wantedEmail = String(email || "").trim().toLowerCase();
    const wantedName = norm(name);

    let found = null;

    if (wantedEmail) {
      found = agents.find(agent => String(agent.email || "").trim().toLowerCase() === wantedEmail);
    }

    if (!found && wantedName) {
      found = agents.find(agent => {
        const combined = norm(`${agent.name || ""} ${agent.surname || ""} ${agent.login || ""}`);
        return combined && (combined.includes(wantedName) || wantedName.includes(combined));
      });
    }

    if (!found) {
      return res.status(404).json({
        ok: false,
        error: "AGENT_NOT_FOUND",
        message: "Nie udało się dopasować zalogowanego użytkownika do agenta Thulium.",
        provided: { login, email, name },
        availableAgents: agents.map(agent => ({
          login: agent.login,
          name: agent.name,
          surname: agent.surname,
          email: agent.email,
          active: agent.active
        }))
      });
    }

    res.json({
      ok: true,
      source: wantedEmail ? "email" : "name",
      agentLogin: found.login,
      agent: found
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "AGENT_RESOLVE_FAILED", details: normalizeError(error) });
  }
});


app.get("/api/agent-config", requireExtensionKey, (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    senderVersion: SENDER_VERSION,
    thuliumAgentLoginFallback: fallbackAgentLogin(),
    perUserAgentLogin: true,
    thuliumBodyType: bodyType()
  });
});

app.get("/api/ticket-dictionaries", requireExtensionKey, async (req, res) => {
  try {
    const dictionaries = await getTicketDictionariesClean();
    res.json({ ok: true, dictionaries });
  } catch (error) {
    res.status(500).json({ ok: false, error: "TICKET_DICTIONARIES_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/ticket-load", requireExtensionKey, async (req, res) => {
  try {
    const { ticketId } = req.body || {};
    if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" });
    const ticket = await getTicket(String(ticketId));
    res.json({ ok: true, ticketId: String(ticketId), ticket });
  } catch (error) {
    res.status(500).json({ ok: false, error: "TICKET_LOAD_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/customer-deep-context", requireExtensionKey, async (req, res) => {
  try {
    const { ticketId, extraEmails = [] } = req.body || {};
    if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" });
    const ticket = await getTicket(String(ticketId));
    const emails = emailList([JSON.stringify(ticket), ...(Array.isArray(extraEmails) ? extraEmails : [extraEmails])].join(" "));
    res.json({
      ok: true,
      ticketId: String(ticketId),
      primaryEmail: emails[0] || null,
      customerEmails: emails,
      summary: { primaryEmail: emails[0] || null, customerEmails: emails, note: "Clean build: ticket context loaded." },
      context: { ticket }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "CUSTOMER_DEEP_CONTEXT_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/ticket-search", requireExtensionKey, async (req, res) => {
  try {
    const { email, text, status, queueId, limit = 30 } = req.body || {};
    const client = createThuliumClient();
    const attempts = [];
    const values = [email, text].filter(Boolean);
    for (const value of values) {
      attempts.push({ query: value }, { q: value }, { search: value });
      if (firstEmail(value)) attempts.push({ email: value }, { customer_email: value }, { requester_email: value });
    }
    if (status) attempts.push({ status });
    if (queueId) attempts.push({ ticket_queue_id: queueId });
    if (!attempts.length) attempts.push({});

    const found = [];
    const errors = [];
    const seen = new Set();
    for (const params of attempts) {
      try {
        const response = await client.get(THULIUM.tickets, { params });
        for (const row of arr(response.data)) {
          const id = row.id || row.ticket_id || row.ticketId || JSON.stringify(row).slice(0, 120);
          if (!seen.has(id)) {
            seen.add(id);
            found.push(row);
            if (found.length >= Number(limit)) break;
          }
        }
      } catch (error) {
        errors.push({ params, error: normalizeError(error) });
      }
      if (found.length >= Number(limit)) break;
    }

    res.json({ ok: true, count: found.length, tickets: found, errors: errors.slice(0, 5) });
  } catch (error) {
    res.status(500).json({ ok: false, error: "TICKET_SEARCH_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/generate-reply", requireExtensionKey, async (req, res) => {
  try {
    const { ticketId, tone = "professional", extraEmails = [] } = req.body || {};
    if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" });
    const ticket = await getTicket(String(ticketId));
    const customerEmails = emailList([JSON.stringify(ticket), ...(Array.isArray(extraEmails) ? extraEmails : [extraEmails])].join(" "));
    const ai = await generateAiReply({ ticket, tone, customerEmails });
    const dictionaries = await getTicketDictionariesClean();
    const category = chooseCategory(arr(dictionaries.categories && dictionaries.categories.data), { content: ai.suggested_reply, ticket });
    const status = findByName(arr(dictionaries.statuses && dictionaries.statuses.data), ["Zamknięte", "Zamkniete", "Closed", "Close"]);
    res.json({
      ok: true,
      ticketId: String(ticketId),
      customerEmails,
      ai,
      ticketActionHints: {
        closedStatus: status ? { id: itemId(status), name: itemName(status), raw: status } : null,
        category: category && !category.error ? { id: itemId(category), name: itemName(category), raw: category } : null
      },
      senderVersion: SENDER_VERSION
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "GENERATE_REPLY_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/mock-reply", requireExtensionKey, async (req, res) => {
  const { ticketId = "test", extraEmails = [] } = req.body || {};
  const emails = emailList(extraEmails);
  res.json({
    ok: true,
    ticketId: String(ticketId),
    customerEmails: emails,
    ai: {
      suggested_reply: "Dzień dobry,\n\nDziękujemy za wiadomość. Sprawdzimy zgłoszenie i wrócimy z informacją.\n\nPozdrawiamy,\nZespół Obsługi Klienta",
      summary: "Tryb testowy.",
      missing_information: [],
      risk_level: "low",
      requires_human_review: true,
      recommended_tags: ["test"]
    },
    senderVersion: SENDER_VERSION
  });
});

app.post("/api/ticket-update", requireExtensionKey, async (req, res) => {
  try {
    const { ticketId, update = {}, dryRun = true } = req.body || {};
    if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" });
    if (dryRun) return res.json({ ok: true, dryRun: true, ticketId: String(ticketId), update });
    const allowed = writeAllowed("ticket-update");
    if (!allowed.ok) return res.status(403).json(allowed);
    const client = createThuliumClient();
    const response = await client.put(THULIUM.ticket(ticketId), update);
    res.json({ ok: true, data: response.data });
  } catch (error) {
    res.status(500).json({ ok: false, error: "TICKET_UPDATE_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/ticket-comment", requireExtensionKey, async (req, res) => {
  try {
    const { ticketId, content, dryRun = true } = req.body || {};
    if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" });
    if (!content) return res.status(400).json({ ok: false, error: "MISSING_CONTENT" });
    if (dryRun) return res.json({ ok: true, dryRun: true, ticketId: String(ticketId), content });
    const allowed = writeAllowed("ticket-comment");
    if (!allowed.ok) return res.status(403).json(allowed);
    const client = createThuliumClient();
    const response = await client.post(THULIUM.comment(ticketId), { content });
    res.json({ ok: true, data: response.data });
  } catch (error) {
    res.status(500).json({ ok: false, error: "TICKET_COMMENT_FAILED", details: normalizeError(error) });
  }
});

app.post("/api/ticket-send-final", requireExtensionKey, async (req, res) => {
  try {
    const {
      ticketId,
      content,
      categoryId = null,
      categoryName = null,
      closeTicket = true,
      dryRun = false,
      agentLogin = null
    } = req.body || {};

    const result = await sendFinal({
      ticketId: String(ticketId || ""),
      content: String(content || "").trim(),
      categoryId,
      categoryName,
      closeTicket,
      dryRun,
      agentLogin
    });

    if (!result.ok) return res.status(500).json(result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "TICKET_SEND_FINAL_FAILED", details: normalizeError(error) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Thulium AI Agent backend ${VERSION} listening on port ${port}`);
});
