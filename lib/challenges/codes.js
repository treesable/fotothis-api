// Invite codes like "OAK-482": a short nature word + 3 digits (docs/CHALLENGES.md). Typed codes
// are forgiving: any case, spaces or no dash, and O/0 mixed up both ways.
import { randomInt } from "node:crypto";

export const WORDS = [
  "OAK", "ASH", "ELM", "FIR", "IVY", "YEW", "BAY", "SKY", "SUN", "DEW", "BUD", "FOG",
  "OWL", "ELK", "BEE", "FOX", "JAY", "MOSS", "FERN", "PINE", "LEAF", "RAIN", "SNOW", "WREN",
  "LARK", "HAWK", "DEER", "HARE", "PEAK", "RIDGE", "BROOK", "RIVER", "CEDAR", "BIRCH", "MAPLE", "WILLOW",
];

export function generateCode() {
  return `${WORDS[randomInt(WORDS.length)]}-${randomInt(100, 1000)}`;
}

/** "oak 482", "0AK-48O", "oak482" → "OAK-482"; null when it can't be a code. */
export function normalizeCode(input) {
  if (typeof input !== "string") return null;
  const compact = input.toUpperCase().replace(/[\s-]+/g, "");
  const match = compact.match(/^([A-Z0]{3,6})([0-9O]{3})$/);
  if (!match) return null;
  const word = match[1].replace(/0/g, "O");
  const digits = match[2].replace(/O/g, "0");
  return WORDS.includes(word) ? `${word}-${digits}` : null;
}
