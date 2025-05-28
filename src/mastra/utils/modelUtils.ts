import { openai } from "@ai-sdk/openai";
import { z, ZodTypeAny } from "zod"; // Ensure ZodTypeAny is imported if used, or just z
import { loadConfig } from "../tools/config"; // Assuming config might be needed in future, or for consistency

// Note: The initModel function was originally in graphAgent.ts, then copied to supervisorAgent.ts and researcherAgent.ts.
// This consolidated version is intended to be the single source of truth.

/**
 * Initializes a model provider based on the specified configuration.
 * Currently, only OpenAI is supported.
 * @param provider The name of the model provider (e.g., "openai").
 * @param model The specific model name (e.g., "gpt-4.1").
 * @param kwargs Optional keyword arguments for model initialization, such as temperature, topP, etc.
 * @returns An object with a `generate` method for text or structured object generation.
 * @throws Error if the provider is unsupported.
 */
export async function initModel(provider: string, model: string, kwargs?: Record<string, any>) {
  // Encapsulate OpenAI specific logic
  if (provider === "openai") {
    const openaiModel = openai(model, kwargs);
    return {
      /**
       * Generates content using the initialized OpenAI model.
       * If a Zod schema is provided, it attempts to generate a structured object.
       * Otherwise, it generates plain text.
       * @param prompt The prompt to send to the model.
       * @param zodSchema Optional Zod schema for structured output. Its `description` field can be used for debugging.
       * @returns A promise that resolves to an object containing either the generated object (`object`) or text (`text`).
       * @throws Error if model generation fails, including schema validation errors.
       */
      generate: async ({ prompt, zodSchema }: { prompt: string, zodSchema?: z.ZodTypeAny }) => { // Use z.ZodTypeAny
        const ai = await import('ai'); // Dynamically import 'ai' package
        try {
          if (zodSchema) {
            // Use generateObject with the provided Zod schema
            console.log("Attempting to generate object with Zod schema:", zodSchema.description || "No Zod schema description provided");
            const result = await ai.generateObject({
              model: openaiModel,
              prompt,
              schema: zodSchema, // Pass the Zod schema directly
            });
            // The result structure from ai.generateObject is { object: YourTypedObject }
            return { object: result.object }; 
          } else {
            // Fallback to generateText if no schema is provided
            console.log("Generating text (no Zod schema provided).");
            const result = await ai.generateText({
              model: openaiModel,
              prompt
            });
            return { text: result.text };
          }
        } catch (error) {
          console.error('Model generation error:', error);
          if (error instanceof Error && zodSchema) {
             console.error(`Error details related to Zod schema (${zodSchema.description || 'N/A'}):`, error.message);
          }
          throw error; // Re-throw the error to be handled by the caller
        }
      }
    };
  }
  // Placeholder for other providers
  // else if (provider === "anthropic") { /* ... */ }
  
  throw new Error(`Unsupported provider: ${provider}`);
}
