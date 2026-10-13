// Species facts from Groq, for identified plants only (moment facts are built into the app).
// Grounded in the species' Wikipedia article: the model only picks and rephrases facts from it
// (without a source it invented "the Mong Kok banyan blocked a subway entrance"). Cached per
// species and language, so each species costs one Groq and one Wikipedia call ever.
import { config } from "./config.js";
import { store } from "./store.js";
import { articleFor } from "./wikipedia.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
/**
 * The largest general model on our Groq account (13 Oct 2026; llama-3.3-70b isn't available to it).
 * Bigger knows more true details about specific plants. Groq retires models now and then:
 * override with GROQ_MODEL without a code change.
 */
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
/** gpt-oss reasons before answering; keep that short, and leave room for it in max tokens. */
const isReasoningModel = (model) => model.startsWith("openai/gpt-oss");
const LANGUAGES = { en: "English", da: "Danish", de: "German", fr: "French", es: "Spanish", nl: "Dutch" };

export function cacheKey(scientificName, lang) {
  // Bump the version when the prompt changes, so facts from the old prompt aren't reused.
  return `facts:v3:${lang}:${scientificName.toLowerCase()}`;
}

/**
 * Up to 3 facts and where they came from: "wikipedia" (picked only from the species' article)
 * or "model" (no article: 1–2 general facts under strict rules). [] if Groq is unavailable.
 */
export async function factsFor(species, lang = "en") {
  const key = cacheKey(species.scientificName, lang);
  const cached = await store.get(key).catch(() => null);
  if (cached) return JSON.parse(cached);

  const article = await articleFor(species.scientificName);
  const facts = await askGroq(species, lang, article);
  const result = { facts, source: article ? "wikipedia" : "model" };
  if (facts.length > 0) await store.set(key, JSON.stringify(result), config.factCacheSeconds).catch(() => {});
  return result;
}

async function askGroq(species, lang, article) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("GROQ_API_KEY is not set: no facts");
    return [];
  }
  const language = LANGUAGES[lang] ?? "English";
  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: isReasoningModel(GROQ_MODEL) ? 1500 : 400,
        ...(isReasoningModel(GROQ_MODEL) ? { reasoning_effort: "low" } : {}),
        messages: [
          {
            role: "system",
            content:
              "You pick surprising, true facts about plants for a nature app, written like a friend telling you " +
              "something cool, not a textbook. Accuracy matters more than anything: a wrong fact is far worse than " +
              "no fact. No markdown, no code fences. " +
              `Write in ${language}.`,
          },
          { role: "user", content: prompt(species, article) },
        ],
      }),
    });
    if (!response.ok) {
      console.error(`Groq: ${response.status} (model ${GROQ_MODEL})`, await response.text());
      return [];
    }
    const content = (await response.json()).choices?.[0]?.message?.content ?? "";
    return parseFacts(content);
  } catch (error) {
    console.error("Groq failed:", error.message);
    return [];
  }
}

export function prompt(species, article) {
  const name = `"${species.commonName}" (${species.scientificName}${species.family ? `, family ${species.family}` : ""})`;
  const style = `Style:
- One sentence per fact, at most 18 words. Friendly tone. No Latin names, no jargon.
- The most surprising first: unusual biology, how humans use it, how it spreads or defends itself.
- If it's poisonous to people or pets, one fact says so plainly.
- Never stories about one named tree, place or event, and no numbers you can't back up.

Return ONLY a JSON array of strings: ["...", "..."]`;

  if (article) {
    return `Pick up to ${config.factsPerSpecies} surprising facts about the plant ${name}.

Use ONLY facts stated in the source text below. Rephrase them simply, but don't add anything the text doesn't say. If the text has fewer than ${config.factsPerSpecies} surprising facts, return fewer.

${style}

Source text (Wikipedia):
"""
${article}
"""`;
  }
  return `Give 1 or 2 facts about the plant ${name} that are widely documented and that you are certain of. Return [] if you're not certain of any.

${style}`;
}

/** The JSON array of strings in Groq's answer, tolerating stray text around it. */
export function parseFacts(content) {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0])
      .map((fact) => (typeof fact === "string" ? fact : fact?.text))
      .filter((fact) => typeof fact === "string" && fact.trim().length > 0)
      .map((fact) => fact.trim())
      .slice(0, config.factsPerSpecies);
  } catch {
    return [];
  }
}
