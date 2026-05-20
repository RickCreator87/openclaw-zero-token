/**
 * L2: HTTP API smoke test via POST /v1/chat/completions
 *
 * Gateway requires model="openclaw", actual model is determined by agent config.
 * We temporarily patch the agent default model before each request.
 */

export interface L2Result {
  model: string;
  status: "pass" | "fail" | "skip";
  httpCode?: number;
  responseTimeMs?: number;
  contentLength?: number;
  contentPreview?: string;
  error?: string;
}

export async function testL2Http(params: {
  baseUrl: string;
  token: string;
  model: string;
  message: string;
  timeoutMs: number;
  configPath?: string;
}): Promise<L2Result> {
  const { baseUrl, token, model, message, timeoutMs } = params;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body = JSON.stringify({
      model: "openclaw",
      messages: [{ role: "user", content: message }],
      stream: false,
    });

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-openclaw-scopes": "operator.write",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        model,
        status: "fail",
        httpCode: res.status,
        responseTimeMs,
        error: errText.slice(0, 300),
      };
    }

    const json = await res.json();
    const choices = json.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return { model, status: "fail", httpCode: 200, responseTimeMs, error: "choices empty" };
    }

    const content = choices[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return { model, status: "fail", httpCode: 200, responseTimeMs, error: "content empty" };
    }

    return {
      model,
      status: "pass",
      httpCode: 200,
      responseTimeMs,
      contentLength: content.length,
      contentPreview: content.slice(0, 200),
    };
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { model, status: "fail", responseTimeMs, error: `Timeout (${timeoutMs}ms)` };
    }
    return { model, status: "fail", responseTimeMs, error: msg.slice(0, 300) };
  }
}
