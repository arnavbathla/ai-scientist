import { AnthropicProvider } from "./anthropic";
import type { ModelProvider, ModelPurpose } from "./provider";
import { env, hasAnthropicKey } from "@/lib/utils/env";

/**
 * ModelRouter
 *
 * Maps a research-purpose to a provider. Today every purpose routes to Anthropic
 * (claude-sonnet-4-5 by default), but the interface is purpose-keyed so a future
 * provider (e.g. a cheaper critique model or a different planning model) can
 * be slotted in without touching agent code.
 */
let _default: AnthropicProvider | null = null;

function defaultProvider(): AnthropicProvider {
  if (_default) return _default;
  _default = new AnthropicProvider(env().ANTHROPIC_MODEL);
  return _default;
}

export const ModelRouter = {
  for(_purpose: ModelPurpose): ModelProvider {
    // Single-provider routing for now. Per-purpose overrides land here when a
    // second provider exists. We keep this method signature stable.
    return defaultProvider();
  },

  /** Returns the active providers (one entry per unique provider config). */
  listProviders(): ModelProvider[] {
    return [defaultProvider()];
  },

  /** Reports configuration health to the settings UI without making a network call. */
  status(): {
    anthropic: { configured: boolean; model: string };
  } {
    return {
      anthropic: {
        configured: hasAnthropicKey(),
        model: env().ANTHROPIC_MODEL,
      },
    };
  },

  reset() {
    _default = null;
  },
};
