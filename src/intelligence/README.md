# Intelligence Module

AI and LLM integration layer for OpenClaw.

## Architecture

All providers implement the shared `AIProvider` interface from `types.ts`.
The **model router** (`index.ts`) selects the active provider at startup.

```
src/intelligence/
├── types.ts              # Shared interfaces (AIProvider, ChatMessage, etc.)
├── gemini.provider.ts    # Google Gemini adapter (@google/generative-ai)
├── kimi.provider.ts      # Moonshot AI / Kimi adapter (openai-compatible SDK)
└── index.ts              # Model router + re-exports
```

## Providers

| Provider | Env Key           | Model Env Var    | Default Model      |
|----------|-------------------|------------------|--------------------|
| Gemini   | `GEMINI_API_KEY`  | `GEMINI_MODEL`   | `gemini-1.5-pro`   |
| Kimi     | `MOONSHOT_API_KEY`| `MOONSHOT_MODEL` | `moonshot-v1-8k`   |

## Configuration

Set the active provider in `.env`:

```env
# Options: 'gemini' | 'kimi'
ACTIVE_AI_PROVIDER=kimi

# Kimi model options: moonshot-v1-8k | moonshot-v1-32k | moonshot-v1-128k
MOONSHOT_MODEL=moonshot-v1-8k
```

## Usage

```typescript
import { getProvider } from '@intelligence/index';

// Uses ACTIVE_AI_PROVIDER from .env
const ai = getProvider();

// Single-turn completion
const answer = await ai.complete('Summarise this safety report: ...');

// Multi-turn chat
const response = await ai.chat([
  { role: 'system', content: 'You are a safety compliance expert.' },
  { role: 'user',   content: 'What are the key risks in confined space entry?' },
]);

console.log(response.content);
console.log(response.usage); // token counts

// Explicitly select a provider
import { getProvider } from '@intelligence/index';
const kimi = getProvider('kimi');
const gemini = getProvider('gemini');

// Health check all providers
import { checkAllProviders } from '@intelligence/index';
await checkAllProviders();
```
