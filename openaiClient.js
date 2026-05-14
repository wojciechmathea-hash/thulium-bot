const axios = require("axios");

function createThuliumClient() {
  const baseURL = (process.env.THULIUM_BASE_URL || "").replace(/\/$/, "");

  if (!baseURL) {
    throw new Error("Missing THULIUM_BASE_URL");
  }

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

module.exports = {
  createThuliumClient,
  testThuliumAuth,
  getTicket,
  getCustomer,
  addTicketComment,
  sendAgentResponse
};
