/**
 * L3: WebSocket protocol test
 * Flow: connect → sessions.create (set model) → sessions.send (message) → collect events → done
 */
import { WebSocket } from "ws";

export interface L3Result {
  model: string;
  status: "pass" | "fail" | "skip";
  responseTimeMs?: number;
  contentLength?: number;
  contentPreview?: string;
  deltaCount?: number;
  error?: string;
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function testL3WebSocket(params: {
  wsUrl: string;
  token: string;
  model: string;
  message: string;
  timeoutMs: number;
}): Promise<L3Result> {
  const { wsUrl, token, model, message, timeoutMs } = params;
  const startTime = Date.now();
  const sessionKey = `e2e-${model.replace(/[/]/g, "-")}-${Date.now()}`;

  return new Promise<L3Result>((resolve) => {
    let resolved = false;
    const done = (result: L3Result) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({
        model,
        status: "fail",
        responseTimeMs: Date.now() - startTime,
        error: `Timeout (${timeoutMs}ms)`,
      });
    }, timeoutMs);

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: wsUrl.replace("ws://", "http://").replace("wss://", "https://").replace(/\/$/, ""),
      },
    });
    let accumulatedText = "";
    let deltaCount = 0;
    let _sessionCreated = false;
    const pendingReqs = new Map<string, string>();

    const send = (method: string, reqParams: Record<string, unknown>, purpose: string) => {
      const id = uuid();
      pendingReqs.set(id, purpose);
      ws.send(JSON.stringify({ type: "req", id, method, params: reqParams }));
    };

    ws.on("error", (err) =>
      done({ model, status: "fail", responseTimeMs: Date.now() - startTime, error: err.message }),
    );
    ws.on("close", () => {
      if (!resolved) {
        done({
          model,
          status: "fail",
          responseTimeMs: Date.now() - startTime,
          error: "Connection closed",
        });
      }
    });

    ws.on("message", (data) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : (data as string);
        const f = JSON.parse(raw);

        // Step 1: connect handshake
        if (f.type === "event" && f.event === "connect.challenge") {
          send(
            "connect",
            {
              minProtocol: 3,
              maxProtocol: 3,
              client: { id: "openclaw-tui", version: "1.0.0", mode: "cli", platform: "e2e" },
              role: "operator",
              scopes: ["operator.admin", "operator.read", "operator.write"],
              auth: { token },
            },
            "connect",
          );
          return;
        }

        // Step 2: connected → create session with model
        if (f.type === "res" && f.ok && f.payload?.type === "hello-ok") {
          send("sessions.create", { key: sessionKey, model }, "create-session");
          return;
        }

        // Handle responses
        if (f.type === "res" && f.id) {
          const purpose = pendingReqs.get(f.id);
          pendingReqs.delete(f.id);

          if (purpose === "create-session") {
            if (!f.ok) {
              console.log(`  [L3] sessions.create failed: ${f.error?.message}`);
            }
            _sessionCreated = true;
            // Subscribe to session events before sending
            send("sessions.messages.subscribe", { key: sessionKey }, "subscribe");
            return;
          }

          if (purpose === "subscribe") {
            // Now send the message
            send(
              "sessions.send",
              {
                key: sessionKey,
                message,
                idempotencyKey: uuid(),
              },
              "send-message",
            );
            return;
          }

          if (purpose === "send-message" && !f.ok) {
            done({
              model,
              status: "fail",
              responseTimeMs: Date.now() - startTime,
              error: f.error?.message || "sessions.send failed",
            });
            return;
          }
        }

        // Step 3: Collect streaming events
        if (f.type === "event") {
          // sessions.send uses different event names - check both patterns
          const payload = f.payload;
          const _eventSession = payload?.sessionKey || payload?.key;

          if ((f.event === "chat.delta" || f.event === "sessions.delta") && payload?.message) {
            deltaCount++;
            const content = payload.message.content;
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part.type === "text" && part.text) {
                  accumulatedText = part.text;
                }
              }
            }
          }

          if (
            f.event === "chat.final" ||
            f.event === "sessions.final" ||
            (f.event?.startsWith("sessions.") && payload?.state === "final")
          ) {
            let finalText = accumulatedText;
            const content = payload?.message?.content;
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part.type === "text" && part.text) {
                  finalText = part.text;
                }
              }
            }
            if (!finalText?.trim()) {
              done({
                model,
                status: "fail",
                responseTimeMs: Date.now() - startTime,
                deltaCount,
                error: "Empty response",
              });
              return;
            }
            done({
              model,
              status: "pass",
              responseTimeMs: Date.now() - startTime,
              contentLength: finalText.length,
              contentPreview: finalText.slice(0, 200),
              deltaCount,
            });
            return;
          }

          if (
            f.event === "chat.error" ||
            f.event === "sessions.error" ||
            (f.event?.startsWith("sessions.") && payload?.state === "error")
          ) {
            done({
              model,
              status: "fail",
              responseTimeMs: Date.now() - startTime,
              error: payload?.errorMessage || "Error event",
            });
            return;
          }
        }
      } catch {
        /* ignore parse errors */
      }
    });
  });
}
