import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(scriptsDir, "..");
const pluginSdkDist = path.resolve(root, "dist/plugin-sdk");

/** 仅跑 Zero Token web stream 相关单元测试，不依赖 browser-playwright 与主 vitest 多项目配置。 */
export default defineConfig({
  resolve: {
    // extensions/browser（被若干 web-stream 间接引用）使用 openclaw/plugin-sdk/*；
    // 根包未在 node_modules 下挂名为 openclaw 的链接时，Vite 需显式别名到 dist。
    alias: [
      {
        find: /^openclaw\/plugin-sdk\/(.+)$/,
        replacement: `${pluginSdkDist}/$1.js`,
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      "src/zero-token/streams/web-stream-factories.test.ts",
      "src/zero-token/streams/doubao-web-stream.test.ts",
    ],
  },
});
