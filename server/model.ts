import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export type ModelCompletion = (
  messages: ChatCompletionMessageParam[],
  json?: boolean,
) => Promise<string | undefined>;

export function getModelCompletion(): ModelCompletion | undefined {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return undefined;
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
  const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com", maxRetries: 0 });

  return async (messages, json = false) => {
    const request: ChatCompletionCreateParamsNonStreaming & { thinking: { type: "disabled" } } = {
      model,
      thinking: { type: "disabled" },
      messages,
      max_tokens: json ? 650 : 240,
      ...(json && { response_format: { type: "json_object" } }),
    };
    try {
      const result = await client.chat.completions.create(request, {
        timeout: json ? 12000 : 7000,
      });
      const choice = result.choices[0];
      if (choice?.finish_reason === "stop") return choice.message.content?.trim() || undefined;
    } catch {
      // 请求失败时交回本地流程。避免把密钥、对话或供应商原始响应写入日志。
    }
  };
}
