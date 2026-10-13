// The species' Wikipedia article (English), as plain text: the only source species facts may
// come from, so the model picks surprising true facts instead of inventing them.
// Free, no key; Wikipedia asks for a descriptive User-Agent.

const API = "https://en.wikipedia.org/w/api.php";
const MAX_CHARS = 6000;

/** Plain-text article for a scientific name (follows redirects), or null if there is none. */
export async function articleFor(scientificName) {
  const query = new URLSearchParams({
    action: "query", prop: "extracts", explaintext: "1", exchars: String(MAX_CHARS),
    redirects: "1", format: "json", titles: scientificName,
  });
  try {
    const response = await fetch(`${API}?${query}`, {
      headers: { "User-Agent": "fotothis-api/1.0 (https://github.com/treesable/fotothis-api)" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const page = Object.values((await response.json()).query?.pages ?? {})[0];
    return cleanExtract(page?.extract);
  } catch (error) {
    console.warn("Wikipedia:", error.message);
    return null;
  }
}

/** Drops section headings and empty lines; null when too short to be useful (stubs). */
export function cleanExtract(extract) {
  if (!extract) return null;
  const text = extract
    .split("\n")
    .filter((line) => line.trim() && !/^=+.*=+$/.test(line.trim()))
    .join("\n")
    .trim();
  return text.length >= 300 ? text : null;
}
