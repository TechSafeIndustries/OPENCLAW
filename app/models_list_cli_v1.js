// app/models_list_cli_v1.js
// Verifies Moonshot/Kimi auth via OpenAI-compatible /v1/chat/completions.
// Moonshot does NOT reliably support GET /v1/models (often returns 404 url.not_found).

const OpenAI = require("openai");

function env(name) {
  return process.env[name] && String(process.env[name]).trim();
}

(async () => {
  const apiKey = env("MOONSHOT_API_KEY") || env("KIMI_API_KEY") || "";
  const baseURL = env("KIMI_BASE_URL") || "https://api.moonshot.ai/v1";
  const model = env("KIMI_MODEL") || "kimi-k2-turbo-preview";

  if (!apiKey) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error:
            "KIMI_API_KEY_MISSING: set MOONSHOT_API_KEY (or KIMI_API_KEY) in environment.",
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const client = new OpenAI({ apiKey, baseURL });

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          base_url: baseURL,
          model,
          test: "chat.completions.ping",
          usage: resp.usage || null,
        },
        null,
        2
      )
    );
  } catch (e) {
    const msg =
      (e && e.response && e.response.data && JSON.stringify(e.response.data)) ||
      (e && e.message) ||
      String(e);

    console.log(
      JSON.stringify(
        {
          ok: false,
          base_url: baseURL,
          model,
          error: `KIMI_API_CALL_FAILED: ${msg}`,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
})();