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
app.use(express.json({ limit: "2mb" }));

function normalizeError(error) {
  if (!error) return "Unknown error";

  if (error.response) {
    return {
      status: error.response.status,
      data: error.response.data,
      url: error.config && error.config.url
    };
  }

  return { message: error.message || String(error) };
}

function requireExtensionKey(req, res, next) {
  const configured = process.env.EXTENSION_API_KEY;

  if (!configured || configured === "change-me-long-random-token") {
    return res.status(500).json({
      ok: false,
      error: "EXTENSION_API_KEY_NOT_CONFIGURED"
    });
  }

  const provided = req.headers["x-extension-key"];

  if (!provided || provided !== configured) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED_EXTENSION"
    });
  }

  next();
}

function verifyWebhookBasicAuth(req, res, next) {
  const expectedUser = process.env.WEBHOOK_BASIC_USER;
  const expectedPassword = process.env.WEBHOOK_BASIC_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return next();
  }

  const header = req.headers.authorization || "";

  if (!header.startsWith("Basic ")) {
    return res.status(401).send("Unauthorized");
  }

  const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (user !== expectedUser || password !== expectedPassword) {
    return res.status(401).send("Unauthorized");
  }

  next();
}

function createThuliumClient() {
  const baseURL = (process.env.THULIUM_BASE_URL || "").replace(/\/$/, "");

  if (!baseURL) throw new Error("Missing THULIUM_BASE_URL");

  if (!process.env.THULIUM_API_USER || !process.env.THULIUM_API_PASSWORD) {
    throw new Error("Missing THULIUM_API_USER or THULIUM_API_PASSWORD");
  }

  const token = Buffer.from(
    `${process.env.THULIUM_API_USER}:${process.env.THULIUM_API_PASSWORD}`
  ).toString("base64");

  return axios.create({
    baseURL,
    timeout: 20000,
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "pl"
    }
  });
}

async function testThuliumAuth() {
  const client = createThuliumClient();
  const response = await client.get("/api/agents");
  return response.data;
}

async function getTicket(ticketId) {
  const client = createThuliumClient();
  const response = await client.get(`/api/tickets/${encodeURIComponent(ticketId)}`);
  return response.data;
}

async function getCustomer(customerId) {
  if (!customerId) return null;

  const client = createThuliumClient();
  const response = await client.get(`/api/customers/${encodeURIComponent(customerId)}`);
  return response.data;
}

async function addTicketComment(ticketId, content) {
  const client = createThuliumClient();

  const payloadCandidates = [
    { content },
    { message: content },
    { body: content },
    { text: content },
    { comment: content }
  ];

  let lastError;

  for (const payload of payloadCandidates) {
    try {
      const response = await client.post(
        `/api/tickets/${encodeURIComponent(ticketId)}/comment`,
        payload
      );

      return {
        ok: true,
        usedPayload: payload,
        data: response.data
      };
    } catch (error) {
      lastError = error;
      const status = error.response && error.response.status;

      if (![400, 422].includes(status)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Could not add ticket comment");
}

async function sendAgentResponse(ticketId, content) {
  const client = createThuliumClient();

  const payloadCandidates = [
    { content },
    { message: content },
    { body: content },
    { text: content },
    { response: content }
  ];

  let lastError;

  for (const payload of payloadCandidates) {
    try {
      const response = await client.post(
        `/api/tickets/${encodeURIComponent(ticketId)}/agent_response`,
        payload
      );

      return {
        ok: true,
        usedPayload: payload,
        data: response.data
      };
    } catch (error) {
      lastError = error;
      const status = error.response && error.response.status;

      if (![400, 422].includes(status)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Could not send agent response");
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function generateReplySuggestion({ ticket, customer, tone }) {
  const openai = getOpenAIClient();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          "Jesteś asystentem obsługi klienta ALLinTraders.",
          "Pomagasz konsultantom przygotowywać odpowiedzi e-mail do klientów w Thulium.",
          "Nie wysyłasz wiadomości samodzielnie, chyba że system wyraźnie uruchomi tryb agent_response.",
          "Jeżeli brakuje informacji, wskaż czego brakuje.",
          "Nie ujawniaj klientowi informacji technicznych, wewnętrznych ani danych innych klientów.",
          "Nie obiecuj wypłat, zwrotów, bonusów, zmian salda ani decyzji prawnych, jeśli nie wynika to jednoznacznie z danych.",
          "Sprawy płatnicze, reklamacyjne, prawne, sporne i dotyczące danych osobowych oznacz jako wymagające weryfikacji człowieka.",
          "Odpowiadaj po polsku, profesjonalnie, konkretnie i życzliwie."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction: "Przygotuj propozycję odpowiedzi do klienta na podstawie danych z Thulium.",
          tone,
          ticket,
          customer
        }, null, 2)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "thulium_reply_suggestion",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            suggested_reply: { type: "string" },
            summary: { type: "string" },
            missing_information: {
              type: "array",
              items: { type: "string" }
            },
            risk_level: {
              type: "string",
              enum: ["low", "medium", "high"]
            },
            requires_human_review: { type: "boolean" },
            recommended_tags: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: [
            "suggested_reply",
            "summary",
            "missing_information",
            "risk_level",
            "requires_human_review",
            "recommended_tags"
          ]
        }
      }
    }
  });

  return JSON.parse(response.output_text);
}

function extractCustomerId(ticket, webhookEvent) {
  if (webhookEvent && webhookEvent.customer_id) return webhookEvent.customer_id;
  if (!ticket || typeof ticket !== "object") return null;

  return (
    ticket.customer_id ||
    ticket.customerId ||
    (ticket.customer && (ticket.customer.id || ticket.customer.customer_id)) ||
    null
  );
}

async function safeGetCustomer(customerId) {
  try {
    return await getCustomer(customerId);
  } catch (error) {
    console.warn("Could not fetch customer", customerId, error.message);
    return null;
  }
}

function formatAiComment(ai, meta = {}) {
  const missing = Array.isArray(ai.missing_information) && ai.missing_information.length
    ? ai.missing_information.map(item => `- ${item}`).join("\n")
    : "Brak";

  const tags = Array.isArray(ai.recommended_tags) && ai.recommended_tags.length
    ? ai.recommended_tags.join(", ")
    : "Brak";

  return [
    "🤖 Propozycja odpowiedzi AI",
    "",
    ai.suggested_reply || "",
    "",
    "---",
    "",
    `Ticket ID: ${meta.ticketId || "brak"}`,
    `Tryb: ${meta.mode || "preview"}`,
    "",
    "Streszczenie:",
    ai.summary || "Brak",
    "",
    "Brakujące informacje:",
    missing,
    "",
    `Poziom ryzyka: ${ai.risk_level || "unknown"}`,
    `Wymaga weryfikacji człowieka: ${ai.requires_human_review ? "TAK" : "NIE"}`,
    `Sugerowane tagi: ${tags}`
  ].join("\n").trim();
}

async function generateReplyForTicket({ ticketId, tone, mode = "preview", webhookEvent = null }) {
  const ticket = await getTicket(ticketId);
  const customerId = extractCustomerId(ticket, webhookEvent);
  const customer = customerId ? await safeGetCustomer(customerId) : null;

  const ai = await generateReplySuggestion({ ticket, customer, tone });
  const formattedComment = formatAiComment(ai, { ticketId, mode, webhookEvent });

  let thuliumWriteResult = null;

  if (mode === "comment") {
    thuliumWriteResult = await addTicketComment(ticketId, formattedComment);
  }

  if (mode === "agent_response") {
    if (ai.requires_human_review || ai.risk_level !== "low") {
      thuliumWriteResult = await addTicketComment(
        ticketId,
        formattedComment + "\n\n⚠️ Nie wysłano automatycznie, ponieważ AI oznaczyło sprawę jako wymagającą weryfikacji."
      );
    } else {
      thuliumWriteResult = await sendAgentResponse(ticketId, ai.suggested_reply);
    }
  }

  return { ticketId, ai, formattedComment, thuliumWriteResult };
}

const ALLOWED_WEBHOOK_ACTIONS = new Set(["TICKET_CREATED", "TICKET_MESSAGE_RECEIVED"]);

async function processWebhookEvent(event) {
  if (!event || !ALLOWED_WEBHOOK_ACTIONS.has(event.action)) {
    return { skipped: true, reason: "Unsupported webhook action" };
  }

  const ticketId = event.ticket_id;

  if (!ticketId) {
    return { skipped: true, reason: "Missing ticket_id" };
  }

  return generateReplyForTicket({
    ticketId: String(ticketId),
    tone: "professional",
    mode: "comment",
    webhookEvent: event
  });
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "thulium-ai-agent",
    version: "0.2.0",
    time: new Date().toISOString()
  });
});

app.post("/api/test-thulium", requireExtensionKey, async (req, res) => {
  try {
    const result = await testThuliumAuth();
    res.json({ ok: true, result });
  } catch (error) {
    console.error("Thulium test failed:", normalizeError(error));
    res.status(500).json({
      ok: false,
      error: "THULIUM_TEST_FAILED",
      details: normalizeError(error)
    });
  }
});

app.post("/api/generate-reply", requireExtensionKey, async (req, res) => {
  try {
    const { ticketId, tone = "professional", mode = "preview" } = req.body || {};

    if (!ticketId) {
      return res.status(400).json({ ok: false, error: "MISSING_TICKET_ID" });
    }

    const result = await generateReplyForTicket({
      ticketId: String(ticketId),
      tone,
      mode
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Generate reply failed:", normalizeError(error));
    res.status(500).json({
      ok: false,
      error: "GENERATE_REPLY_FAILED",
      details: normalizeError(error)
    });
  }
});

app.post("/webhooks/thulium", verifyWebhookBasicAuth, async (req, res) => {
  const event = req.body || {};
  res.status(200).json({ ok: true });

  try {
    await processWebhookEvent(event);
  } catch (error) {
    console.error("Webhook processing failed:", normalizeError(error), event);
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Thulium AI Agent backend listening on port ${port}`);
});
