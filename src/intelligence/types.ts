/**
 * Intelligence Module — Shared Types
 * Common interfaces for all AI provider adapters.
 */

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatOptions {
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Sampling temperature (0–1) */
    temperature?: number;
    /** System prompt to prepend (optional shorthand) */
    systemPrompt?: string;
}

export interface ChatResponse {
    /** The generated text */
    content: string;
    /** Which model was actually used (as reported by the provider) */
    model: string;
    /** Token usage, if the provider returns it */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * All AI provider adapters must implement this interface.
 */
export interface AIProvider {
    /** Human-readable name for logging/debugging */
    readonly name: string;
    /** The model identifier being used */
    readonly model: string;
    /**
     * Send a chat completion request.
     */
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
    /**
     * Simple single-turn convenience wrapper.
     */
    complete(prompt: string, options?: ChatOptions): Promise<string>;
    /**
     * Verify the provider is reachable and configured correctly.
     */
    healthCheck(): Promise<boolean>;
}
