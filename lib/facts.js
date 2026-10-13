// Species facts from Groq, for identified plants only (moment facts are built into the app).
// Cached per species and language, so each species costs one Groq call ever.
// The prompt comes from ReelNature's backend, trimmed to plants and one sentence per fact.
import { config } from "./config.js";
import { store } from "./store.js";

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
  return `facts:v2:${lang}:${scientificName.toLowerCase()}`;
}

/** Up to 3 facts; [] if Groq is unavailable (the app shows the name without a fact). */
export async function factsFor(species, lang = "en") {
  const key = cacheKey(species.scientificName, lang);
  const cached = await store.get(key).catch(() => null);
  if (cached) return JSON.parse(cached);

  const facts = await askGroq(species, lang);
  if (facts.length > 0) await store.set(key, JSON.stringify(facts), config.factCacheSeconds).catch(() => {});
  return facts;
}

async function askGroq(species, lang) {
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
        temperature: 0.4,
        max_tokens: isReasoningModel(GROQ_MODEL) ? 1500 : 400,
        ...(isReasoningModel(GROQ_MODEL) ? { reasoning_effort: "low" } : {}),
        messages: [
          {
            role: "system",
            content:
              "You are a curious, warm friend who knows amazing things about plants. You share real, surprising " +
              "facts that make people say 'Wow, I had no idea!', like a friend at dinner, not a textbook. Every fact " +
              "must be genuinely true and verifiable for this exact species. Never invent, guess or stretch. If you " +
              "are not confident a fact is true, leave it out. No markdown, no code fences. " +
              `Write in ${language}.`,
          },
          { role: "user", content: prompt(species) },
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

export function prompt(species) {
  return `Give me ${config.factsPerSpecies} genuinely surprising, true facts about the plant "${species.commonName}" (${species.scientificName}${species.family ? `, family ${species.family}` : ""}).

Look for: unusual biology, real history and human uses, how it spreads or defends itself, records with a specific place or number.

Strict rules:
- Every fact must be real and verifiable for THIS species. Do not invent, guess or stretch the truth.
- One sentence per fact, at most 18 words. Friendly tone. No Latin, no jargon.
- Be concrete (a place, a use, a behavior). No vague claims.
- Use a number only if it is widely documented for this species. Never estimate or round up a number to sound impressive.
- Fewer facts are better than a doubtful one: return 2 or even 1 if you aren't sure of a third.
- If the plant is poisonous to people or pets, make one fact say so plainly.

GREAT: "Hydrangea flowers turn blue or pink depending on whether the soil is acidic or alkaline."
GREAT: "In Florida it's listed as invasive, because it strangles the trees it grows on."
BAD: "Its roots can cover up to 100 m² of ground." (made-up number)
BAD: "Hydrangeas give a feeling of relaxation." (vague, not a fact)

Return ONLY a JSON array of strings: ["...", "...", "..."]`;
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
