import { analyzeFrameWithFal } from "./fal-vision.ts";
import { analyzeFrameWithGrok, type VlmResult } from "./grok-vision.ts";

export type ExternalAIProviderId =
  | "fal"
  | "xai"
  | "openai"
  | "gemini"
  | "claude"
  | "local"
  | "mcp-agent"
  | "custom";

export type ExternalAIProvider = {
  id: ExternalAIProviderId;
  available(): boolean;
  analyzeFrame(input: { imageBase64: string; prompt: string }): Promise<VlmResult>;
};

export const falVisionProvider: ExternalAIProvider = {
  id: "fal",
  available() {
    return Boolean(typeof process !== "undefined" && process.env.FAL_KEY);
  },
  analyzeFrame: analyzeFrameWithFal,
};

export const xaiGrokProvider: ExternalAIProvider = {
  id: "xai",
  available() {
    return Boolean(typeof process !== "undefined" && process.env.XAI_API_KEY);
  },
  analyzeFrame: analyzeFrameWithGrok,
};

function reserved(id: ExternalAIProviderId): ExternalAIProvider {
  return {
    id,
    available() {
      return false;
    },
    async analyzeFrame() {
      return {
        ok: false,
        code: "MODEL_NOT_AVAILABLE",
        error: `External provider '${id}' is not wired. Configure FAL_KEY for fal.ai vision or XAI_API_KEY for the Grok fallback.`,
      };
    },
  };
}

export const EXTERNAL_PROVIDERS: Record<ExternalAIProviderId, ExternalAIProvider> = {
  fal: falVisionProvider,
  xai: xaiGrokProvider,
  openai: reserved("openai"),
  gemini: reserved("gemini"),
  claude: reserved("claude"),
  local: reserved("local"),
  "mcp-agent": reserved("mcp-agent"),
  custom: reserved("custom"),
};

export function getExternalProvider(id?: ExternalAIProviderId): ExternalAIProvider {
  if (id) return EXTERNAL_PROVIDERS[id] ?? reserved("custom");
  if (falVisionProvider.available()) return falVisionProvider;
  return xaiGrokProvider;
}
