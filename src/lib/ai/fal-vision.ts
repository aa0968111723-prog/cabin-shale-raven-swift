import type { VlmResult } from "./grok-vision.ts";

const FAL_OPENROUTER_VISION_URL =
  "https://fal.run/openrouter/router/openai/v1/chat/completions";

const DEFAULT_PRIMARY_MODEL = "openai/gpt-5.6-sol";
const DEFAULT_FALLBACK_MODEL = "google/gemini-2.5-flash";

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function callFalVision(
  model: string,
  input: { imageBase64: string; prompt: string },
  timeoutMs: number,
): Promise<VlmResult> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    return {
      ok: false,
      code: "MODEL_NOT_AVAILABLE",
      error: "FAL_KEY is not available in this environment.",
    };
  }

  const prompt =
    input.prompt.trim() ||
    [
      "You are an animation supervisor inspecting a single frame from a frame-by-frame sequence.",
      "Analyze subject identity, pose, silhouette, hand/foot contacts, camera framing, scene geometry, props, lighting, squash/stretch, motion direction, and continuity risks with neighboring frames.",
      "Return concrete production notes in Traditional Chinese. Do not invent details that are not visible.",
    ].join(" ");

  try {
    const res = await fetch(FAL_OPENROUTER_VISION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      signal: timeoutSignal(timeoutMs),
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Act as a precise animation continuity supervisor. Prefer observable facts, concise structured production notes, and Traditional Chinese.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${input.imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        code: "JOB_FAILED",
        error: `fal.ai vision API error ${res.status} (${model}): ${body.slice(0, 280)}`,
      };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return {
        ok: false,
        code: "JOB_FAILED",
        error: `fal.ai vision returned an empty response (${model}).`,
      };
    }

    return { ok: true, text, model, provider: "fal" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "JOB_FAILED",
      error: `fal.ai vision request failed (${model}): ${message}`,
    };
  }
}

export async function analyzeFrameWithFal(input: {
  imageBase64: string;
  prompt: string;
}): Promise<VlmResult> {
  const primaryModel =
    process.env.FAL_VISION_MODEL?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel =
    process.env.FAL_VISION_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;

  // Keep total latency comfortably below the UI's 75s timeout while still
  // giving the flagship model a real chance to answer.
  const primary = await callFalVision(primaryModel, input, 30_000);
  if (primary.ok || fallbackModel === primaryModel) return primary;

  const fallback = await callFalVision(fallbackModel, input, 20_000);
  if (fallback.ok) return fallback;

  return {
    ok: false,
    code: "JOB_FAILED",
    error: `${primary.error} | fallback: ${fallback.error}`,
  };
}
