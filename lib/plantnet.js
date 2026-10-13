// Pl@ntNet identification. The regional lookup and the worldwide retry come from ReelNature's
// backend (copied, not shared): a regional flora names local plants more accurately.
import { config } from "./config.js";

const PLANTNET_BASE = "https://my-api.plantnet.org/v2/identify";

// Rough boxes for Pl@ntNet's regional (TDWG) projects; first match wins, so smaller regions
// that overlap larger ones come first.
const TDWG_REGIONS = [
  { project: "k-northern-europe", latMin: 54, latMax: 72, lngMin: -25, lngMax: 32 },
  { project: "k-middle-europe", latMin: 42, latMax: 54, lngMin: -10, lngMax: 25 },
  { project: "k-southwestern-europe", latMin: 35, latMax: 44, lngMin: -10, lngMax: 5 },
  { project: "k-southeastern-europe", latMin: 35, latMax: 48, lngMin: 13, lngMax: 30 },
  { project: "k-eastern-europe", latMin: 45, latMax: 70, lngMin: 25, lngMax: 60 },
  { project: "k-northern-africa", latMin: 18, latMax: 37, lngMin: -18, lngMax: 35 },
  { project: "k-western-asia", latMin: 28, latMax: 42, lngMin: 26, lngMax: 55 },
  { project: "k-arabian-peninsula", latMin: 12, latMax: 32, lngMin: 34, lngMax: 60 },
  { project: "k-china", latMin: 18, latMax: 54, lngMin: 73, lngMax: 135 },
  { project: "k-eastern-asia", latMin: 24, latMax: 46, lngMin: 124, lngMax: 150 },
  { project: "k-indian-subcontinent", latMin: 6, latMax: 36, lngMin: 60, lngMax: 98 },
  { project: "k-indo-china", latMin: -10, latMax: 24, lngMin: 92, lngMax: 120 },
  { project: "k-australia", latMin: -45, latMax: -10, lngMin: 112, lngMax: 155 },
  { project: "k-new-zealand", latMin: -48, latMax: -34, lngMin: 165, lngMax: 179 },
  { project: "k-southern-africa", latMin: -35, latMax: -16, lngMin: 10, lngMax: 41 },
  { project: "k-east-tropical-africa", latMin: -12, latMax: 6, lngMin: 28, lngMax: 42 },
  { project: "k-west-tropical-africa", latMin: 4, latMax: 18, lngMin: -18, lngMax: 16 },
  { project: "k-brazil", latMin: -34, latMax: 6, lngMin: -74, lngMax: -34 },
  { project: "k-southern-south-america", latMin: -56, latMax: -22, lngMin: -76, lngMax: -52 },
  { project: "k-mexico", latMin: 14, latMax: 33, lngMin: -118, lngMax: -86 },
  { project: "k-southeastern-u.s.a.", latMin: 24, latMax: 37, lngMin: -92, lngMax: -75 },
  { project: "k-northeastern-u.s.a.", latMin: 37, latMax: 48, lngMin: -80, lngMax: -66 },
  { project: "k-southwestern-u.s.a.", latMin: 31, latMax: 42, lngMin: -124, lngMax: -102 },
  { project: "k-north-central-u.s.a.", latMin: 36, latMax: 49, lngMin: -104, lngMax: -80 },
  { project: "k-northwestern-u.s.a.", latMin: 42, latMax: 49, lngMin: -125, lngMax: -104 },
  { project: "k-western-canada", latMin: 48, latMax: 70, lngMin: -141, lngMax: -88 },
  { project: "k-eastern-canada", latMin: 42, latMax: 63, lngMin: -88, lngMax: -52 },
  { project: "k-caribbean", latMin: 10, latMax: 28, lngMin: -85, lngMax: -59 },
  { project: "k-central-america", latMin: 7, latMax: 18, lngMin: -92, lngMax: -77 },
];

/** The regional project for a position, or "all". */
export function projectFor(lat, lng) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (lat == null || lng == null || Number.isNaN(latN) || Number.isNaN(lngN)) return "all";
  const region = TDWG_REGIONS.find(
    (r) => latN >= r.latMin && latN <= r.latMax && lngN >= r.lngMin && lngN <= r.lngMax,
  );
  return region?.project ?? "all";
}

/** Pl@ntNet's best match as our species shape, or null. */
export function parseResult(data) {
  const top = data?.results?.[0];
  if (!top) return null;
  const species = top.species ?? {};
  const scientificName = cleanLatinName(species.scientificNameWithoutAuthor);
  if (!scientificName) return null;
  return {
    commonName: titleCase(species.commonNames?.[0] ?? scientificName),
    scientificName,
    family: species.family?.scientificNameWithoutAuthor ?? null,
    score: Math.round((top.score ?? 0) * 1000) / 1000,
    gbifId: top.gbif?.id ? String(top.gbif.id) : null,
  };
}

/** Best match for a JPEG, regional first, worldwide when the region is unsure. Null on failure. */
export async function identify(image, { lat, lng, lang = "en" } = {}) {
  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey) throw Object.assign(new Error("PLANTNET_API_KEY is not set"), { status: 503 });

  async function call(project) {
    const form = new FormData();
    form.append("images", new Blob([image], { type: "image/jpeg" }), "photo.jpg");
    form.append("organs", "auto");
    const query = new URLSearchParams({
      "api-key": apiKey, "include-related-images": "false", "no-reject": "true", "nb-results": "3", lang,
    });
    const response = await fetch(`${PLANTNET_BASE}/${project}?${query}`, { method: "POST", body: form });
    if (!response.ok) {
      console.warn(`Pl@ntNet ${project}: ${response.status}`);
      return null;
    }
    return response.json();
  }

  const project = projectFor(lat, lng);
  let data = project === "all" ? null : await call(project);
  if (!data?.results?.length || (data.results[0].score ?? 0) < config.regionalRetryScore) {
    data = (await call("all")) ?? data;
  }
  return parseResult(data);
}

const SMALL_WORDS = new Set(["of", "and", "the", "in", "on", "de", "la", "du", "von", "van"]);

/** "rose of sharon" → "Rose of Sharon", like a field guide (first word always capitalised). */
export function titleCase(text) {
  return text
    .split(" ")
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase()
      : word.replace(/^\p{L}/u, (c) => c.toUpperCase())))
    .join(" ");
}

/** Drops author abbreviations Pl@ntNet sometimes leaves in ("Hedera helix L." → "Hedera helix"). */
export function cleanLatinName(name) {
  if (!name) return null;
  return name
    .replace(/\s*×\s*/g, " × ")
    .replace(/\s+(L\.|Mill\.|DC\.|Pers\.|Lam\.|Thunb\.|Willd\.|Aiton|Medik\.|Moench|Salisb\.|Lindl\.|Hook\.f?\.|Kunth|Hort\.|Engl\.|Benth\.|Jacq\.|Spreng\.|Nutt\.|Sweet|R\.Br\.|ex\s+\w+\.?)(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
