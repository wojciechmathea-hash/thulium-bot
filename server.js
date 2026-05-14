require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");

let chromium = null;
try { chromium = require("playwright").chromium; } catch (e) { console.warn("[Browser] Playwright unavailable", e.message); }

const VERSION = "0.5.0";
const app = express();
app.use(helmet());
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Extension-Key"] }));
app.use(express.json({ limit: "5mb" }));

const AGENT_INSTRUCTIONS = (process.env.AGENT_INSTRUCTIONS || `
Jesteś Agentem AI obsługi klienta ALLinTraders, działającym jako asystent konsultanta w Thulium.
Przygotowujesz propozycje odpowiedzi e-mail na podstawie: aktualnego zgłoszenia, historii zgłoszeń klienta po e-mailu, danych klienta, platform EDU/VOD oraz dokumentów Autenti w trybie read-only.
Nie wysyłasz wiadomości samodzielnie. Nie wykonujesz zmian w żadnym systemie.
Odpowiadasz po polsku, profesjonalnie, spokojnie i konkretnie. Nie pisz "jako AI".
Nie wymyślaj danych, statusów płatności, umów ani decyzji. Jeśli brakuje danych, wypisz czego brakuje.
Sprawy płatnicze, prawne, reklamacyjne, umowne, sporne i dotyczące danych osobowych oznaczaj jako wymagające weryfikacji człowieka.
Nie interpretuj prawnie umów z Autenti. Możesz traktować je wyłącznie jako kontekst dla konsultanta.
Zwracaj wyłącznie JSON: {"suggested_reply":"...","summary":"...","missing_information":[],"risk_level":"low|medium|high","requires_human_review":true,"recommended_tags":[]}.
`).trim();

const BUSINESS_RULES = (process.env.AGENT_BUSINESS_RULES || `
Historia Thulium: uwzględnij ciągłość sprawy, ale nie ujawniaj klientowi notatek wewnętrznych z innych zgłoszeń.
Autenti: jeśli znaleziono dokument po e-mailu, użyj tego jako kontekstu; nie cytuj pełnej umowy; nie obiecuj skutków prawnych; w razie niejasności wymagaj weryfikacji człowieka.
EDU/VOD: jeśli konto lub dostęp jest widoczny, można to potwierdzić ostrożnie; jeśli nie znaleziono konta, poproś o e-mail użyty przy zakupie/rejestracji.
Płatności: nie potwierdzaj księgowania ani wypłat bez jednoznacznych danych.
`).trim();

function normalizeError(error) {
  if (!error) return "Unknown error";
  if (error.response) return { status: error.response.status, data: error.response.data, url: error.config && error.config.url };
  return { message: error.message || String(error) };
}

function requireExtensionKey(req, res, next) {
  const configured = process.env.EXTENSION_API_KEY;
  if (!configured) return res.status(500).json({ ok: false, error: "EXTENSION_API_KEY_NOT_CONFIGURED" });
  if (req.headers["x-extension-key"] !== configured) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_EXTENSION" });
  next();
}

function verifyWebhookBasicAuth(req, res, next) {
  const expectedUser = process.env.WEBHOOK_BASIC_USER;
  const expectedPassword = process.env.WEBHOOK_BASIC_PASSWORD;
  if (!expectedUser || !expectedPassword) return next();
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return res.status(401).send("Unauthorized");
  const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString("utf8");
  const i = decoded.indexOf(":");
  if (decoded.slice(0, i) !== expectedUser || decoded.slice(i + 1) !== expectedPassword) return res.status(401).send("Unauthorized");
  next();
}

function createThuliumClient() {
  const baseURL = (process.env.THULIUM_BASE_URL || "").replace(/\/$/, "");
  if (!baseURL) throw new Error("Missing THULIUM_BASE_URL");
  if (!process.env.THULIUM_API_USER || !process.env.THULIUM_API_PASSWORD) throw new Error("Missing Thulium credentials");
  const token = Buffer.from(`${process.env.THULIUM_API_USER}:${process.env.THULIUM_API_PASSWORD}`).toString("base64");
  return axios.create({ baseURL, timeout: Number(process.env.THULIUM_TIMEOUT_MS || 15000), headers: { Authorization: `Basic ${token}`, Accept: "application/json", "Content-Type": "application/json", "Accept-Language": "pl" } });
}

async function getTicket(ticketId) {
  const r = await createThuliumClient().get(`/api/tickets/${encodeURIComponent(ticketId)}`);
  return r.data;
}

async function getCustomer(customerId) {
  if (!customerId) return null;
  const r = await createThuliumClient().get(`/api/customers/${encodeURIComponent(customerId)}`);
  return r.data;
}

async function testThuliumAuth() {
  const r = await createThuliumClient().get("/api/agents");
  return r.data;
}

function firstArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of ["tickets", "data", "items", "results", "rows", "records"]) if (Array.isArray(data[k])) return data[k];
  return [];
}

async function getTicketsByEmail(email) {
  if (!email) return { ok: false, reason: "missing email" };
  if (String(process.env.THULIUM_HISTORY_LOOKUP_ENABLED || "true").toLowerCase() !== "true") return { ok: false, skipped: true, reason: "disabled" };
  const client = createThuliumClient();
  const attempts = [{ email }, { customer_email: email }, { requester_email: email }, { query: email }, { q: email }, { search: email }];
  const found = [];
  const errors = [];
  for (const params of attempts) {
    try {
      const r = await client.get("/api/tickets", { params });
      found.push(...firstArray(r.data));
    } catch (e) { errors.push({ params, error: normalizeError(e) }); }
  }
  const seen = new Set();
  const unique = [];
  for (const row of found) {
    const id = row.id || row.ticket_id || row.ticketId || JSON.stringify(row).slice(0, 80);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(row);
    if (unique.length >= Number(process.env.THULIUM_RELATED_TICKETS_LIMIT || 20)) break;
  }
  return { ok: true, email, count: unique.length, tickets: unique, errors: errors.slice(0, 3) };
}

async function addTicketComment(ticketId, content) {
  const client = createThuliumClient();
  const payloads = [{ content }, { message: content }, { body: content }, { text: content }, { comment: content }];
  let last;
  for (const payload of payloads) {
    try { const r = await client.post(`/api/tickets/${encodeURIComponent(ticketId)}/comment`, payload); return { ok: true, usedPayload: payload, data: r.data }; }
    catch (e) { last = e; if (![400, 422].includes(e.response && e.response.status)) throw e; }
  }
  throw last || new Error("Could not add comment");
}

function extractEmail(text) {
  const m = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function extractCustomerId(ticket, webhookEvent) {
  if (webhookEvent && webhookEvent.customer_id) return webhookEvent.customer_id;
  return ticket && (ticket.customer_id || ticket.customerId || (ticket.customer && (ticket.customer.id || ticket.customer.customer_id))) || null;
}

function extractLikelyCustomerEmail(ticket, customer) {
  const candidates = [customer && customer.email, customer && customer.mail, customer && customer.email_address, ticket && ticket.email, ticket && ticket.customer_email, ticket && ticket.requester_email, ticket && ticket.from, JSON.stringify(ticket || {}), JSON.stringify(customer || {})].filter(Boolean);
  for (const v of candidates) { const e = extractEmail(v); if (e) return e; }
  return null;
}

async function safeGetCustomer(id) { try { return await getCustomer(id); } catch (e) { console.warn("Customer fetch failed", e.message); return null; } }

async function browserPage() {
  if (!chromium) throw new Error("Playwright is not installed");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.PLATFORM_ACTION_TIMEOUT_MS || 12000));
  return { browser, context, page };
}

async function fillFirst(page, selectors, value) {
  for (const s of selectors) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 1800 }).catch(() => false)) { await el.fill(value); return s; }
  }
  throw new Error("Input not found");
}

async function clickFirst(page, names) {
  for (const name of names) {
    const btn = page.getByRole("button", { name: new RegExp(name, "i") }).first();
    if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) { await btn.click(); return true; }
  }
  const submit = page.locator('button[type="submit"],input[type="submit"]').first();
  if (await submit.isVisible({ timeout: 1200 }).catch(() => false)) { await submit.click(); return true; }
  await page.keyboard.press("Enter");
  return true;
}

async function trySearch(page, query) {
  const selectors = ['input[type="search"]','input[placeholder*="Search" i]','input[placeholder*="Szukaj" i]','input[placeholder*="E-mail" i]','input[placeholder*="Email" i]','input[name*="search" i]','input[name*="email" i]','input[id*="search" i]','input[id*="email" i]'];
  for (const s of selectors) {
    const el = page.locator(s).first();
    if (await el.isVisible({ timeout: 1800 }).catch(() => false)) {
      await el.fill(query); await page.keyboard.press("Enter").catch(() => null); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
      return { ok: true, selector: s, query };
    }
  }
  return { ok: false, reason: "No visible search input found" };
}

async function snapshot(page) {
  return page.evaluate(() => {
    document.querySelectorAll("script,style,noscript,svg").forEach(e => e.remove());
    const links = Array.from(document.querySelectorAll("a")).map(a => ({ text: (a.innerText || "").trim(), href: a.href || "" })).filter(x => x.text || x.href).slice(0, 120);
    const tables = Array.from(document.querySelectorAll("table")).slice(0, 8).map(t => t.innerText || "");
    return { title: document.title || "", visibleText: document.body ? document.body.innerText : "", links, tables };
  });
}

function cleanText(text) { return String(text || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }

function platformConfigs() {
  return [
    { id: "edu", name: "EDU ProfitableTrader", loginUrl: process.env.EDU_LOGIN_URL, adminUrl: process.env.EDU_ADMIN_URL, user: process.env.EDU_PLATFORM_USER, password: process.env.EDU_PLATFORM_PASSWORD },
    { id: "vod", name: "VOD ALLinTraders", loginUrl: process.env.VOD_LOGIN_URL, adminUrl: process.env.VOD_ADMIN_URL, user: process.env.VOD_PLATFORM_USER, password: process.env.VOD_PLATFORM_PASSWORD }
  ].filter(c => c.loginUrl && c.adminUrl && c.user && c.password);
}

function autentiConfig() {
  if (!process.env.AUTENTI_LOGIN_URL || !process.env.AUTENTI_SEARCH_URL || !process.env.AUTENTI_USER || !process.env.AUTENTI_PASSWORD) return null;
  return { id: "autenti", name: "Autenti", loginUrl: process.env.AUTENTI_LOGIN_URL, searchUrl: process.env.AUTENTI_SEARCH_URL, user: process.env.AUTENTI_USER, password: process.env.AUTENTI_PASSWORD };
}

async function readGenericPlatform(c, email) {
  const { browser, context, page } = await browserPage();
  try {
    await page.goto(c.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await fillFirst(page, ['input[type="email"]','input[name="email"]','input[name="login"]','input[name="username"]','input[type="text"]'], c.user);
    await fillFirst(page, ['input[type="password"]','input[name="password"]'], c.password);
    await clickFirst(page, ["Log in", "Login", "Zaloguj", "Sign in", "Submit"]);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null);
    await page.goto(c.adminUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null);
    const searchAttempt = await trySearch(page, email);
    const s = await snapshot(page);
    const textPreview = cleanText(s.visibleText).slice(0, Number(process.env.PLATFORM_TEXT_LIMIT || 12000));
    return { platform: c.id, platformName: c.name, ok: true, query: email, url: page.url(), searchAttempt, containsQuery: textPreview.toLowerCase().includes(email.toLowerCase()), title: s.title, textPreview, tablesPreview: s.tables.map(t => cleanText(t).slice(0, 4000)), linksPreview: s.links.slice(0, 30) };
  } finally { await context.close().catch(() => null); await browser.close().catch(() => null); }
}

async function readAutenti(email) {
  if (String(process.env.AUTENTI_LOOKUP_ENABLED || "true").toLowerCase() !== "true") return { ok: false, skipped: true, reason: "disabled" };
  const c = autentiConfig();
  if (!c) return { ok: false, skipped: true, reason: "Autenti env not configured" };
  const { browser, context, page } = await browserPage();
  try {
    await page.goto(c.loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await fillFirst(page, ['input[type="email"]','input[name="email"]','input[name="username"]','input[id*="email" i]','input[type="text"]'], c.user);
    await fillFirst(page, ['input[type="password"]','input[name="password"]','input[id*="password" i]'], c.password);
    await clickFirst(page, ["Log in", "Login", "Zaloguj", "Sign in", "Dalej", "Kontynuuj"]);
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => null);
    await page.goto(c.searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => null);
    const searchAttempt = await trySearch(page, email);
    const s = await snapshot(page);
    const textPreview = cleanText(s.visibleText).slice(0, Number(process.env.AUTENTI_TEXT_LIMIT || 16000));
    const possibleDocumentLinks = s.links.filter(l => `${l.text} ${l.href}`.toLowerCase().match(/doc|document|signed|podpis|umow/)).slice(0, 40);
    return { platform: "autenti", platformName: "Autenti", ok: true, query: email, url: page.url(), searchAttempt, containsEmail: textPreview.toLowerCase().includes(email.toLowerCase()), title: s.title, textPreview, tablesPreview: s.tables.map(t => cleanText(t).slice(0, 5000)), possibleDocumentLinks };
  } finally { await context.close().catch(() => null); await browser.close().catch(() => null); }
}

async function withTimeout(p, ms, label) {
  let t; const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); });
  try { return await Promise.race([p, timer]); } finally { clearTimeout(t); }
}

async function collectPlatforms(email) {
  if (!email || String(process.env.PLATFORM_LOOKUP_ENABLED || "true").toLowerCase() !== "true") return [];
  const out = [];
  for (const c of platformConfigs()) {
    try { out.push(await withTimeout(readGenericPlatform(c, email), Number(process.env.PLATFORM_LOOKUP_TIMEOUT_MS || 45000), c.name)); }
    catch (e) { out.push({ platform: c.id, platformName: c.name, ok: false, error: e.message }); }
  }
  return out;
}

async function buildDeepContext(ticketId, webhookEvent = null) {
  const ticket = await getTicket(ticketId);
  const customerId = extractCustomerId(ticket, webhookEvent);
  const customer = customerId ? await safeGetCustomer(customerId) : null;
  const email = extractLikelyCustomerEmail(ticket, customer);
  const thuliumTicketHistory = await getTicketsByEmail(email);
  const platformContexts = await collectPlatforms(email);
  let autentiContext;
  try { autentiContext = email ? await withTimeout(readAutenti(email), Number(process.env.AUTENTI_LOOKUP_TIMEOUT_MS || 60000), "Autenti") : { ok: false, skipped: true, reason: "No email" }; }
  catch (e) { autentiContext = { ok: false, error: e.message }; }
  return { ticketId, email, ticket, customer, thuliumTicketHistory, platformContexts, autentiContext };
}

function summarizeDeepContext(ctx) {
  return {
    email: ctx.email || null,
    thuliumRelatedTickets: ctx.thuliumTicketHistory ? { ok: ctx.thuliumTicketHistory.ok, count: ctx.thuliumTicketHistory.count || 0, reason: ctx.thuliumTicketHistory.reason || null } : null,
    platforms: (ctx.platformContexts || []).map(x => ({ platform: x.platform, ok: x.ok, containsQuery: x.containsQuery, error: x.error || null })),
    autenti: ctx.autentiContext ? { ok: ctx.autentiContext.ok, containsEmail: ctx.autentiContext.containsEmail, error: ctx.autentiContext.error || null, reason: ctx.autentiContext.reason || null } : null
  };
}

function buildAgentInput(ctx, tone) {
  return { instruction: "Przygotuj odpowiedź na podstawie danych Thulium, historii klienta, EDU/VOD i Autenti.", tone, agent_instructions: AGENT_INSTRUCTIONS, business_rules: BUSINESS_RULES, knowledge_base: process.env.AGENT_KNOWLEDGE_BASE || "", thulium_ticket: ctx.ticket, thulium_customer: ctx.customer, thulium_ticket_history_by_email: ctx.thuliumTicketHistory, platform_contexts_read_only: ctx.platformContexts, autenti_context_read_only: ctx.autentiContext };
}

async function generateReplySuggestion(ctx, tone) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Number(process.env.OPENAI_TIMEOUT_MS || 45000) });
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [{ role: "system", content: AGENT_INSTRUCTIONS }, { role: "user", content: JSON.stringify(buildAgentInput(ctx, tone), null, 2) }],
    text: { format: { type: "json_schema", name: "thulium_reply_suggestion", schema: { type: "object", additionalProperties: false, properties: { suggested_reply: { type: "string" }, summary: { type: "string" }, missing_information: { type: "array", items: { type: "string" } }, risk_level: { type: "string", enum: ["low", "medium", "high"] }, requires_human_review: { type: "boolean" }, recommended_tags: { type: "array", items: { type: "string" } } }, required: ["suggested_reply", "summary", "missing_information", "risk_level", "requires_human_review", "recommended_tags"] } } }
  });
  return JSON.parse(response.output_text);
}

function formatAiComment(ai, meta) {
  const missing = Array.isArray(ai.missing_information) && ai.missing_information.length ? ai.missing_information.map(x => `- ${x}`).join("\n") : "Brak";
  const tags = Array.isArray(ai.recommended_tags) && ai.recommended_tags.length ? ai.recommended_tags.join(", ") : "Brak";
  return [`🤖 Propozycja odpowiedzi AI`, ``, ai.suggested_reply || "", ``, `---`, ``, `Ticket ID: ${meta.ticketId}`, `Tryb: ${meta.mode}`, ``, `Streszczenie:`, ai.summary || "Brak", ``, `Brakujące informacje:`, missing, ``, `Poziom ryzyka: ${ai.risk_level || "unknown"}`, `Wymaga weryfikacji człowieka: ${ai.requires_human_review ? "TAK" : "NIE"}`, `Sugerowane tagi: ${tags}`].join("\n").trim();
}

async function generateReplyForTicket({ ticketId, tone, mode = "preview", includeDeepContext = true, webhookEvent = null }) {
  const ctx = includeDeepContext ? await buildDeepContext(ticketId, webhookEvent) : await (async () => { const ticket = await getTicket(ticketId); const cid = extractCustomerId(ticket, webhookEvent); const customer = cid ? await safeGetCustomer(cid) : null; return { ticketId, email: extractLikelyCustomerEmail(ticket, customer), ticket, customer, thuliumTicketHistory: null, platformContexts: [], autentiContext: null }; })();
  const ai = await generateReplySuggestion(ctx, tone);
  const formattedComment = formatAiComment(ai, { ticketId, mode });
  let thuliumWriteResult = null;
  if (mode === "comment") thuliumWriteResult = await addTicketComment(ticketId, formattedComment);
  return { ticketId, email: ctx.email, ai, formattedComment, thuliumWriteResult, deepContextSummary: summarizeDeepContext(ctx) };
}

app.get("/health", (req, res) => res.json({ ok: true, service: "thulium-ai-agent", version: VERSION, playwrightAvailable: Boolean(chromium), platformConfigs: platformConfigs().map(c => ({ id: c.id, name: c.name })), autentiConfigured: Boolean(autentiConfig()), time: new Date().toISOString() }));

app.get("/api/agent-config", requireExtensionKey, (req, res) => res.json({ ok: true, version: VERSION, model: process.env.OPENAI_MODEL || "gpt-4.1-mini", hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY), autentiConfigured: Boolean(autentiConfig()), platformConfigs: platformConfigs().map(c => ({ id: c.id, name: c.name })) }));

app.post("/api/customer-deep-context", requireExtensionKey, async (req, res) => { try { const { ticketId } = req.body || {}; if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" }); const context = await buildDeepContext(String(ticketId)); res.json({ ok: true, ticketId: String(ticketId), email: context.email, summary: summarizeDeepContext(context), context }); } catch (e) { res.status(500).json({ ok: false, error: "CUSTOMER_DEEP_CONTEXT_FAILED", details: normalizeError(e) }); } });

app.post("/api/autenti-context", requireExtensionKey, async (req, res) => { try { const { email } = req.body || {}; if (!email) return res.status(400).json({ ok: false, error: "MISSING_EMAIL" }); const context = await readAutenti(email); res.json({ ok: true, email, context }); } catch (e) { res.status(500).json({ ok: false, error: "AUTENTI_CONTEXT_FAILED", details: normalizeError(e) }); } });

app.post("/api/mock-reply", requireExtensionKey, async (req, res) => { const ai = { suggested_reply: "Dzień dobry,\n\nDziękujemy za wiadomość. Zweryfikujemy historię zgłoszeń oraz dokumenty powiązane z adresem e-mail klienta i wrócimy z odpowiedzią.\n\nPozdrawiamy,\nZespół Obsługi Klienta", summary: "Tryb testowy bez OpenAI.", missing_information: [], risk_level: "low", requires_human_review: true, recommended_tags: ["test", "deep-context"] }; res.json({ ok: true, ai }); });

app.post("/api/test-thulium", requireExtensionKey, async (req, res) => { try { res.json({ ok: true, result: await testThuliumAuth() }); } catch (e) { res.status(500).json({ ok: false, error: "THULIUM_TEST_FAILED", details: normalizeError(e) }); } });

app.post("/api/generate-reply", requireExtensionKey, async (req, res) => { try { const { ticketId, tone = "professional", mode = "preview", includeDeepContext = true } = req.body || {}; if (!ticketId) return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" }); const result = await generateReplyForTicket({ ticketId: String(ticketId), tone, mode, includeDeepContext }); res.json({ ok: true, ...result }); } catch (e) { res.status(500).json({ ok: false, error: "GENERATE_REPLY_FAILED", details: normalizeError(e) }); } });

app.post("/webhooks/thulium", verifyWebhookBasicAuth, async (req, res) => { res.status(200).json({ ok: true }); try { const e = req.body || {}; if (["TICKET_CREATED", "TICKET_MESSAGE_RECEIVED"].includes(e.action) && e.ticket_id) await generateReplyForTicket({ ticketId: String(e.ticket_id), tone: "professional", mode: "comment", webhookEvent: e, includeDeepContext: true }); } catch (err) { console.error("Webhook failed", normalizeError(err)); } });

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Thulium AI Agent backend v${VERSION} listening on port ${port}`));
