/**
 * Natural conversation message pool for E2E testing.
 * CN messages for Chinese providers, EN for international providers.
 */

const CN_MESSAGES = [
  "请帮我用简单的语言解释一下什么是量子计算",
  "写一首关于春天的五言绝句",
  "北京有哪些适合周末去的公园？推荐三个",
  "帮我把这段话改得更正式一些：我觉得这个方案还行",
  "简单介绍一下光合作用的过程",
  "推荐三本适合初学者的Python编程书籍",
  "中国传统节日春节有哪些习俗？简要说明",
  "请解释一下TCP和UDP的主要区别",
  "帮我写一段面试自我介绍，要求简洁有力",
  "描述一下你理解的人工智能的发展趋势",
];

const EN_MESSAGES = [
  "Explain the concept of machine learning in simple terms",
  "Write a short poem about the ocean",
  "What are three tips for improving public speaking skills?",
  "Briefly describe how photosynthesis works",
  "What are the key differences between Python and JavaScript?",
  "Recommend three classic science fiction novels",
  "Explain the difference between REST and GraphQL APIs",
  "Write a brief motivational message for someone starting a new job",
  "What are the main causes of climate change?",
  "Describe the basics of how blockchain technology works",
];

// Provider → language mapping
const PROVIDER_LANG: Record<string, "cn" | "en"> = {
  "claude-web": "en",
  "chatgpt-web": "en",
  "deepseek-web": "cn",
  "doubao-web": "cn",
  "qwen-web": "cn",
  "qwen-cn-web": "cn",
  "kimi-web": "cn",
  "gemini-web": "en",
  "grok-web": "en",
  "glm-web": "cn",
  "glm-intl-web": "en",
  "perplexity-web": "en",
  "xiaomimo-web": "cn",
};

export class MessagePool {
  private usedCN = new Set<number>();
  private usedEN = new Set<number>();

  /** Pick a random message for the given provider, no repeat within a run. */
  pick(provider: string): string {
    const lang = PROVIDER_LANG[provider] ?? "en";
    const pool = lang === "cn" ? CN_MESSAGES : EN_MESSAGES;
    const used = lang === "cn" ? this.usedCN : this.usedEN;

    // Reset if exhausted
    if (used.size >= pool.length) {
      used.clear();
    }

    let idx: number;
    do {
      idx = Math.floor(Math.random() * pool.length);
    } while (used.has(idx));

    used.add(idx);
    return pool[idx];
  }

  /** Get language for a provider */
  static lang(provider: string): "cn" | "en" {
    return PROVIDER_LANG[provider] ?? "en";
  }
}
