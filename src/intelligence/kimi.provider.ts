/**
 * Intelligence Module — Moonshot / Kimi Provider
 *
 * Moonshot AI exposes an OpenAI-compatible REST API at:
 *   https://api.moonshot.cn/v1
 *
 * This adapter works with any moonshot-v1-* model, including:
 *   - moonshot-v1-8k
 *   - moonshot-v1-32k
 *   - moonshot-v1-128k
 *
 * The `openai` npm package is used as the HTTP client because Moonshot's
 * API is fully OpenAI-compatible, saving us from hand-rolling requests.
 */

import OpenAI from 'openai';
import type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types';

const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_MODEL = 'moonshot-v1-8k';

export class KimiProvider implements AIProvider {
    readonly name = 'Kimi (Moonshot AI)';
    readonly model: string;

    private readonly client: OpenAI;

    constructor(apiKey?: string, model?: string) {
        const key = apiKey ?? process.env['MOONSHOT_API_KEY'];
        if (!key) {
            throw new Error('KimiProvider: MOONSHOT_API_KEY is not set');
        }
        this.model = model ?? process.env['MOONSHOT_MODEL'] ?? DEFAULT_MODEL;
        this.client = new OpenAI({
            apiKey: key,
            baseURL: MOONSHOT_BASE_URL,
        });
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        // Build the messages array, injecting an optional system prompt
        const builtMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
            builtMessages.push({ role: 'system', content: options.systemPrompt });
        }

        for (const msg of messages) {
            builtMessages.push({ role: msg.role, content: msg.content });
        }

        const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: builtMessages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
        });

        const choice = completion.choices[0];
        if (!choice?.message.content) {
            throw new Error('KimiProvider: received empty response from Moonshot API');
        }

        return {
            content: choice.message.content,
            model: completion.model,
            usage: completion.usage
                ? {
                    promptTokens: completion.usage.prompt_tokens,
                    completionTokens: completion.usage.completion_tokens,
                    totalTokens: completion.usage.total_tokens,
                }
                : undefined,
        };
    }

    async complete(prompt: string, options?: ChatOptions): Promise<string> {
        const response = await this.chat(
            [{ role: 'user', content: prompt }],
            options,
        );
        return response.content;
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.complete('Respond with OK', { maxTokens: 5 });
            return true;
        } catch (err) {
            console.error(`[${this.name}] Health check failed:`, err instanceof Error ? err.message : err);
            return false;
        }
    }
}
