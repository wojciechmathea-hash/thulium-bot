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

const VERSION = "1.0.1-clean";
const SENDER_VERSION = "v1.0.1-exact-pdf-payload";

const THULIUM = Object.freeze({
  statuses: "/api/ticket_statuses",
  categories: "/api/ticket_categories",
  queues: "/api/ticket_queues",
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

function agentLogin() {
  return process.env.THULIUM_AGENT_LOGIN || process.env.THULIUM_API_USER || "CHATGPT";
}

function bodyType() {
  const value = String(process.env.THULIUM_AGENT_RESPONSE_BODY_TYPE || "PLAIN").toUpperCase();
  return value === "HTML" ? "HTML" : "PLAIN";
}

async function sendAgentResponseExact({ ticketId, content }) {
  const allowed = writeAllowed("sendAgentResponseExact");
  if (!allowed.ok) return allowed;

  const client = createThuliumClient();
  const endpoint = THULIUM.agentResponse(ticketId);

  const payload = {
    body: content,
    body_type: bodyType(),
    user_login: agentLogin()
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
      usedPayload: { body: content, body_type: bodyType(), user_login: agentLogin() },
      contentType: "application/x-www-form-urlencoded",
      data: response.data
    };
  } catch (error) {
    attempts.push({
      endpoint,
      payload: { body: content, body_type: bodyType(), user_login: agentLogin() },
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
    requiredPayloadShape: { body: "treść", body_type: "PLAIN|HTML", user_login: agentLogin() },
    attempts
  };
}

async function sendFinal({ ticketId, content, categoryId = null, categoryName = null, closeTicket = true, dryRun = false }) {
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

  const sendResult = await sendAgentResponseExact({ ticketId, content });

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
      user_login: agentLogin()
    },
    writeEnabled: String(process.env.THULIUM_TICKET_WRITE_ENABLED || "false").toLowerCase() === "true",
    endpoints: THULIUM,
    time: new Date().toISOString()
  });
});

app.get("/api/agent-config", requireExtensionKey, (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    senderVersion: SENDER_VERSION,
    thuliumAgentLogin: agentLogin(),
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
    const { ticketId, content, categoryId = null, categoryName = null, closeTicket = true, dryRun = false } = req.body || {};
    const result = await sendFinal({
      ticketId: String(ticketId || ""),
      content: String(content || "").trim(),
      categoryId,
      categoryName,
      closeTicket,
      dryRun
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
