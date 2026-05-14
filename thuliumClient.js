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

module.exports = {
  requireExtensionKey,
  verifyWebhookBasicAuth
};
