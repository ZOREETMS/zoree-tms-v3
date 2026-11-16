import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { z } from "zod";

if (!process.env.OPENAI_API_KEY) {
  console.error("FATAL: OPENAI_API_KEY environment variable is not set.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model is configurable via env; falls back to the default below.
// If OpenAI renames models, change OPENAI_MODEL rather than this file.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6";

const server = new McpServer({
  name: "openai-reviewer",
  version: "1.0.0",
});

server.tool(
  "ask_openai",
  "Ask an OpenAI model for a second opinion, review, or independent analysis. " +
    "Pass the full context in the prompt - the model has no access to Claude's conversation, files, or memory.",
  {
    prompt: z.string().describe("The complete, self-contained prompt for the OpenAI model"),
    system: z
      .string()
      .optional()
      .describe("Optional system/instructions message, e.g. a role or rules the model should follow"),
    model: z
      .string()
      .optional()
      .describe("Optional model override for this single call (defaults to OPENAI_MODEL env or the built-in default)"),
  },
  async ({ prompt, system, model }) => {
    try {
      const response = await openai.responses.create({
        model: model || MODEL,
        ...(system ? { instructions: system } : {}),
        input: prompt,
      });
      return {
        content: [{ type: "text", text: response.output_text ?? "(empty response)" }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `OpenAI API error: ${err?.message || String(err)}. ` +
              `Check OPENAI_API_KEY, billing status, and that the model name "${model || MODEL}" is valid.`,
          },
        ],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
