/* One schema-enforced call to Claude, shared by both apps.
 *
 * Written against the SDK that actually installs (0.71.x): structured outputs
 * are client.beta.messages.parse with a top-level output_format, and
 * output_config carries only effort. Where that path is unavailable — a
 * different key, SDK or model — it logs one line and falls back to
 * JSON-in-text with tolerant parsing, so the app keeps working. */

import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";

export function salvage(text, key) {
  const out = []; const s = String(text || "");
  let i = s.indexOf(`"${key}"`); if (i < 0) return out;
  i = s.indexOf("[", i); if (i < 0) return out;
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = j; depth++; continue; }
    if (ch === "}") { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(s.slice(start, j + 1))); } catch {} start = -1; } continue; }
    if (ch === "]" && depth === 0) break;
  }
  return out;
}

export function makeLLM(env) {
  const key = env.ANTHROPIC_API_KEY;
  const client = key ? new Anthropic(Object.assign({ apiKey: key },
    env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {})) : null;
  const defaults = {
    model: env.ANTHROPIC_MODEL || "claude-opus-5",
    fallbackModel: env.ANTHROPIC_FALLBACK_MODEL || "claude-opus-4-8",
    effort: env.ANTHROPIC_EFFORT || "high",
    betas: (env.ANTHROPIC_BETAS || "structured-outputs-2025-11-13").split(",").map(s => s.trim()).filter(Boolean),
  };
  let schemaWorks = true;

  async function viaSchema(model, prompt, schema, opts) {
    const res = await client.beta.messages.parse({
      model, max_tokens: 16000, betas: opts.betas,
      output_format: betaJSONSchemaOutputFormat(schema),
      output_config: { effort: opts.effort },
      messages: [{ role: "user", content: prompt }],
    });
    return { stop_reason: res.stop_reason, value: res.parsed_output };
  }

  async function viaText(model, prompt, schema, opts, arrayKey) {
    const res = await client.messages.create({
      model, max_tokens: 16000,
      messages: [{ role: "user", content:
        `${prompt}\n\nReply with ONLY JSON matching this schema, and nothing else:\n${JSON.stringify(schema)}` }],
    });
    const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
    let value = null;
    try { value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
    if (!value && arrayKey) { const rows = salvage(text, arrayKey); if (rows.length) value = { [arrayKey]: rows }; }
    return { stop_reason: res.stop_reason, value };
  }

  async function once(model, prompt, schema, opts, arrayKey) {
    if (schemaWorks) {
      try { return await viaSchema(model, prompt, schema, opts); }
      catch (e) {
        const msg = String((e && e.message) || e);
        const shapeProblem = e && (e.status === 400 || e.status === 404)
          && /output_format|beta|structured|not supported|unexpected/i.test(msg);
        if (!shapeProblem) throw e;
        schemaWorks = false;
        console.warn("[llm] structured outputs unavailable here, falling back to text JSON:", msg);
      }
    }
    return viaText(model, prompt, schema, opts, arrayKey);
  }

  return {
    client,
    configured: () => !!client,
    defaults,
    /* Resolves the parsed object. A policy decline is retried once on the
     * fallback model rather than failing the batch. */
    async parse(prompt, schema, options = {}) {
      if (!client) throw Object.assign(new Error("ANTHROPIC_API_KEY is not set on the server"), { code: "no_api_key" });
      const opts = Object.assign({}, defaults, options);
      const arrayKey = Object.keys((schema && schema.properties) || {})
        .find(k => schema.properties[k] && schema.properties[k].type === "array");
      let res = await once(opts.model, prompt, schema, opts, arrayKey);
      if (res.stop_reason === "refusal") res = await once(opts.fallbackModel, prompt, schema, opts, arrayKey);
      if (res.stop_reason === "refusal")
        throw Object.assign(new Error("the model declined this request"), { code: "refused" });
      if (!res.value) throw Object.assign(new Error("the reply did not parse"), { code: "invalid_output" });
      return res.value;
    },
  };
}
