/**
 * Anti-ban adaptive delay and provider interleaving.
 */

export interface AntiBanConfig {
  baseDelay: number; // seconds
  maxDelay: number; // seconds
  jitterMax: number; // seconds
}

const DEFAULT_CONFIG: AntiBanConfig = {
  baseDelay: Number(process.env.ZT_BASE_DELAY) || 15,
  maxDelay: Number(process.env.ZT_MAX_DELAY) || 120,
  jitterMax: 5,
};

export class AntiBanController {
  private currentDelay: number;
  private config: AntiBanConfig;
  retryCount = 0;
  rateLimitEvents = 0;

  constructor(config?: Partial<AntiBanConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentDelay = this.config.baseDelay;
  }

  /** Call after a successful request */
  onSuccess(): void {
    this.currentDelay = Math.max(this.config.baseDelay * 0.5, this.currentDelay * 0.7);
  }

  /** Call after rate limit / timeout / captcha */
  onRateLimit(): void {
    this.rateLimitEvents++;
    this.currentDelay = Math.min(this.config.maxDelay, this.currentDelay * 2);
  }

  /** Wait between requests with jitter */
  async wait(): Promise<void> {
    const jitter = Math.random() * this.config.jitterMax;
    const totalMs = (this.currentDelay + jitter) * 1000;
    console.log(
      `  [anti-ban] waiting ${(totalMs / 1000).toFixed(1)}s (base=${this.currentDelay.toFixed(1)}s)`,
    );
    await new Promise((r) => setTimeout(r, totalMs));
  }

  get delay(): number {
    return this.currentDelay;
  }

  /** Stats for report */
  get stats() {
    return {
      currentDelay: this.currentDelay,
      rateLimitEvents: this.rateLimitEvents,
      retryCount: this.retryCount,
    };
  }
}

/**
 * Interleave models so same-family providers are never consecutive.
 * Strategy: round-robin CN and EN providers.
 */
export function interleaveModels(models: string[]): string[] {
  const cn: string[] = [];
  const en: string[] = [];

  for (const m of models) {
    const provider = m.split("/")[0];
    const cnProviders = [
      "deepseek-web",
      "doubao-web",
      "qwen-web",
      "qwen-cn-web",
      "kimi-web",
      "glm-web",
      "xiaomimo-web",
    ];
    if (cnProviders.includes(provider)) {
      cn.push(m);
    } else {
      en.push(m);
    }
  }

  // Shuffle each group
  shuffle(cn);
  shuffle(en);

  // Interleave
  const result: string[] = [];
  const maxLen = Math.max(cn.length, en.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < cn.length) {
      result.push(cn[i]);
    }
    if (i < en.length) {
      result.push(en[i]);
    }
  }

  return result;
}

function shuffle(arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
