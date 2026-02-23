/**
 * Intelligence Module — Gemini Provider
 * Google Gemini integration via @google/generative-ai SDK.
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types';

export class GeminiProvider implements AIProvider {
    readonly name = 'Gemini';
    readonly model: string;

    private readonly client: GoogleGenerativeAI;
    private readonly generativeModel: GenerativeModel;

    constructor(apiKey?: string, model?: string) {
        const key = apiKey ?? process.env['GEMINI_API_KEY'];
        if (!key) {
            throw new Error('GeminiProvider: GEMINI_API_KEY is not set');
        }
        this.model = model ?? process.env['GEMINI_MODEL'] ?? 'gemini-1.5-pro';
        this.client = new GoogleGenerativeAI(key);
        this.generativeModel = this.client.getGenerativeModel({ model: this.model });
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        // Extract system message if present
        const systemMessages = messages.filter((m) => m.role === 'system');
        const conversationMessages = messages.filter((m) => m.role !== 'system');

        const systemInstruction = options?.systemPrompt
            ?? (systemMessages.length > 0 ? systemMessages.map((m) => m.content).join('\n') : undefined);

        const modelInstance = systemInstruction
            ? this.client.getGenerativeModel({
                model: this.model,
                systemInstruction,
            })
            : this.generativeModel;

        // Build Gemini history (all but the final user message)
        const history = conversationMessages.slice(0, -1).map((m) => ({
            role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
            parts: [{ text: m.content }],
        }));

        const lastMessage = conversationMessages[conversationMessages.length - 1];
        if (!lastMessage || lastMessage.role !== 'user') {
            throw new Error('GeminiProvider: last message must be a user message');
        }

        const chat = modelInstance.startChat({
            history,
            generationConfig: {
                maxOutputTokens: options?.maxTokens,
                temperature: options?.temperature,
            },
        });

        const result = await chat.sendMessage(lastMessage.content);
        const response = result.response;
        const text = response.text();
        const usageMeta = response.usageMetadata;

        return {
            content: text,
            model: this.model,
            usage: usageMeta
                ? {
                    promptTokens: usageMeta.promptTokenCount ?? 0,
                    completionTokens: usageMeta.candidatesTokenCount ?? 0,
                    totalTokens: usageMeta.totalTokenCount ?? 0,
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
