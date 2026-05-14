require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const { processWebhookEvent, generateReplyForTicket } = require("./ticketProcessor");
const { requireExtensionKey, verifyWebhookBasicAuth } = require("./security");
const { testThuliumAuth } = require("./thuliumClient");

const app = express();

app.use(helmet());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Extension-Key"]
}));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "thulium-ai-agent",
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
      return res.status(400).json({
        ok: false,
        error: "MISSING_TICKET_ID"
      });
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

function normalizeError(error) {
  if (!error) return "Unknown error";

  if (error.response) {
    return {
      status: error.response.status,
      data: error.response.data,
      url: error.config && error.config.url
    };
  }

  return {
    message: error.message || String(error)
  };
}

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Thulium AI Agent backend listening on port ${port}`);
});
