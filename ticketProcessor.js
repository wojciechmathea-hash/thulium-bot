const OpenAI = require("openai");

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
            missing_information: { type: "array", items: { type: "string" } },
            risk_level: { type: "string", enum: ["low", "medium", "high"] },
            requires_human_review: { type: "boolean" },
            recommended_tags: { type: "array", items: { type: "string" } }
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

module.exports = { generateReplySuggestion };
