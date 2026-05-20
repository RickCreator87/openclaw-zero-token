import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../config/config.js";
import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { ensureCustomApiRegistered } from "./custom-api-registry.js";
import { getWebStreamFactory } from "./web-stream-factories.js";

export function registerProviderStreamForModel<TApi extends Api>(params: {
  model: Model<TApi>;
  cfg?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): StreamFn | undefined {
  const streamFn = resolveProviderStreamFn({
    provider: params.model.provider,
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    env: params.env,
    context: {
      config: params.cfg,
      agentDir: params.agentDir,
      workspaceDir: params.workspaceDir,
      provider: params.model.provider,
      modelId: params.model.id,
      model: params.model,
    },
  });
  if (streamFn) {
    ensureCustomApiRegistered(params.model.api, streamFn);
    return streamFn;
  }

  // Fallback: check if this is a web model (has a web stream factory registered).
  // Web models are not bundled as plugins, so resolveProviderStreamFn returns undefined.
  // We need to load credentials from auth-profiles and create the web stream directly.
  const webFactory = getWebStreamFactory(params.model.api);
  if (!webFactory) {
    return undefined;
  }

  const authStore = ensureAuthProfileStore(params.agentDir);
  const profileIds = listProfilesForProvider(authStore, params.model.provider);
  if (profileIds.length === 0) {
    console.log(
      `[provider-stream] no auth profile found for provider=${params.model.provider}; skipping web stream`,
    );
    return undefined;
  }

  const profile = authStore.profiles[profileIds[0]];
  if (!profile) {
    return undefined;
  }

  // Extract the credential token for the web stream factory.
  let credential: string;
  if (profile.type === "token" && profile.token) {
    credential = profile.token;
  } else if (profile.type === "api_key" && profile.key) {
    credential = profile.key;
  } else if (profile.type === "oauth") {
    credential = JSON.stringify(profile);
  } else {
    console.warn(
      `[provider-stream] unsupported auth profile type=${profile.type} for provider=${params.model.provider}`,
    );
    return undefined;
  }

  const webStreamFn = webFactory(credential);
  ensureCustomApiRegistered(params.model.api, webStreamFn);
  console.log(
    `[provider-stream] using web stream factory for provider=${params.model.provider} model=${params.model.id} api=${params.model.api}`,
  );
  return webStreamFn;
}
