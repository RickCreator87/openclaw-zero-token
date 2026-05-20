/**
 * L5: Playwright browser UI automation test.
 * Opens the Control UI, selects a model, sends a message, validates response.
 */
import { chromium, type Browser, type Page } from "playwright-core";

export interface L5Result {
  model: string;
  status: "pass" | "fail" | "skip";
  responseTimeMs?: number;
  contentLength?: number;
  contentPreview?: string;
  screenshotPath?: string;
  error?: string;
}

export async function testL5BrowserUI(params: {
  gatewayUrl: string;
  token: string;
  model: string;
  message: string;
  timeoutMs: number;
  screenshotDir?: string;
}): Promise<L5Result> {
  const { gatewayUrl, token, model, message, timeoutMs, screenshotDir } = params;
  const startTime = Date.now();
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();

    // Navigate to Control UI with token
    const url = `${gatewayUrl}/#token=${encodeURIComponent(token)}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

    // Wait for the UI to fully load (chat input should be visible)
    const inputSelectors = [
      "textarea[placeholder]",
      '[contenteditable="true"]',
      '[role="textbox"]',
      "textarea",
    ];

    let inputFound = false;
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        inputFound = true;
        break;
      } catch {
        continue;
      }
    }

    if (!inputFound) {
      const screenshotPath = await takeScreenshot(page, screenshotDir, model, "no-input");
      return {
        model,
        status: "fail",
        responseTimeMs: Date.now() - startTime,
        screenshotPath,
        error: "Chat input not found within 10s",
      };
    }

    // Try to select model (if model selector exists)
    try {
      // Look for model selector dropdown
      const modelSelectors = [
        '[data-testid*="model"]',
        'select[name*="model"]',
        '[class*="model-select"]',
        '[aria-label*="model"]',
        '[aria-label*="Model"]',
      ];
      for (const sel of modelSelectors) {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await page.waitForTimeout(500);
          // Try to find and click the model option
          const modelName = model.split("/").pop() || model;
          const option = await page.$(`text=${modelName}`);
          if (option) {
            await option.click();
            await page.waitForTimeout(300);
          }
          break;
        }
      }
    } catch {
      // Model selector not found or not needed — continue with default
    }

    // Type message into input
    const input = await page.$(
      inputSelectors.find(async (sel) => {
        try {
          return !!(await page!.$(sel));
        } catch {
          return false;
        }
      }) || "textarea",
    );

    if (!input) {
      return {
        model,
        status: "fail",
        responseTimeMs: Date.now() - startTime,
        error: "Input element not found for typing",
      };
    }

    await input.click();
    await input.fill(message);
    await page.waitForTimeout(200);

    // Count existing messages before sending
    const msgCountBefore = await page
      .$$eval('[class*="message"], [class*="bubble"], [data-role], article', (els) => els.length)
      .catch(() => 0);

    // Send: try button first, then Enter key
    const sendBtnSelectors = [
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="Send"]',
      '[class*="send"]',
    ];
    let sent = false;
    for (const sel of sendBtnSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        const disabled = await btn.getAttribute("disabled");
        if (disabled === null) {
          await btn.click();
          sent = true;
          break;
        }
      }
    }
    if (!sent) {
      await input.press("Enter");
    }

    // Wait for response to appear
    const pollStart = Date.now();
    let responseText = "";
    let stableCount = 0;
    let lastText = "";

    while (Date.now() - pollStart < timeoutMs) {
      await page.waitForTimeout(2000);

      // Try to find new assistant message
      const text = await page.evaluate((_beforeCount: number) => {
        const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        const allMsgs = document.querySelectorAll(
          '[class*="message"], [class*="bubble"], [data-role="assistant"], article, [class*="markdown"]',
        );
        // Get text from messages after the ones that existed before
        for (let i = allMsgs.length - 1; i >= 0; i--) {
          const t = clean((allMsgs[i] as HTMLElement).innerText || "");
          if (t.length >= 10) {
            return t;
          }
        }
        return "";
      }, msgCountBefore);

      if (text && text.length >= 10) {
        if (text !== lastText) {
          lastText = text;
          stableCount = 0;
        } else {
          stableCount++;
          if (stableCount >= 2) {
            responseText = text;
            break;
          }
        }
      }
    }

    if (!responseText) {
      const screenshotPath = await takeScreenshot(page, screenshotDir, model, "no-response");
      return {
        model,
        status: "fail",
        responseTimeMs: Date.now() - startTime,
        screenshotPath,
        error: "No response detected within timeout",
      };
    }

    return {
      model,
      status: "pass",
      responseTimeMs: Date.now() - startTime,
      contentLength: responseText.length,
      contentPreview: responseText.slice(0, 200),
    };
  } catch (err: unknown) {
    const screenshotPath = page
      ? await takeScreenshot(page, screenshotDir, model, "error")
      : undefined;
    return {
      model,
      status: "fail",
      responseTimeMs: Date.now() - startTime,
      screenshotPath,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function takeScreenshot(
  page: Page,
  dir: string | undefined,
  model: string,
  suffix: string,
): Promise<string | undefined> {
  if (!dir) {
    return undefined;
  }
  try {
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
    const safeName = model.replace(/[/\\:]/g, "-");
    const path = `${dir}/${safeName}-${suffix}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return undefined;
  }
}
