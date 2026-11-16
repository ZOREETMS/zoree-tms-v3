# openai-mcp — `ask_openai` tool for Claude

Local MCP server that lets Claude call the OpenAI Responses API for a second opinion. Dependencies are already installed (`node_modules` present) and the server is syntax-checked and boot-tested.

## 1. Get an API key

platform.openai.com → API keys → create key. **API billing is separate from ChatGPT Plus** — add a payment method / credits on the platform account or calls will fail.

## 2. Set the key (Windows PowerShell — persistent)

```powershell
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-...", "User")
# optional - change the model without editing code:
[Environment]::SetEnvironmentVariable("OPENAI_MODEL", "gpt-5.6", "User")
```

Restart the Claude app / terminal after setting these so they're picked up. Never put the key in server.js.

**Note on the model name:** the default is `gpt-5.6`. If OpenAI's current model naming differs, set `OPENAI_MODEL` to whatever the platform's model list shows — no code change needed. A wrong model name returns a clear error through the tool rather than crashing.

## 3a. Add to Claude Code (CLI)

```powershell
claude mcp add openai-reviewer -- node C:\Zoree\zoree-tms-v3\zoree-tms-v3\openai-mcp\server.js
claude mcp list   # should show: openai-reviewer
```

## 3b. Add to the Claude desktop app (Cowork)

Settings → Developer → Edit Config (`claude_desktop_config.json`), add:

```json
{
  "mcpServers": {
    "openai-reviewer": {
      "command": "node",
      "args": ["C:\\Zoree\\zoree-tms-v3\\zoree-tms-v3\\openai-mcp\\server.js"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

(If the env vars are set at the User level per step 2, the `env` block is optional.)

Restart the app. The `ask_openai` tool then appears in Claude's tool list.

## 4. Use it

- "Ask OpenAI to independently review this email draft."
- "Get a second opinion from GPT on this architecture, then tell me where you agree and disagree."

The tool accepts `prompt` (required), plus optional `system` (role/rules for GPT) and `model` (per-call override).

**Limitation:** this reaches the OpenAI *API* — not your ChatGPT app conversations, memories, or files. Claude must pass all needed context inside the prompt.

## Suggested Zoree review loop

For important outreach or architecture decisions:
1. Claude analyzes / drafts first.
2. Claude calls `ask_openai` with the draft + the relevant skill rules as the `system` message.
3. Claude compares the two takes, states agreements and disagreements.
4. Claude gives one final recommendation.
