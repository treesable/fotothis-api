// Region-aware rarity (docs/WILDLINGS.md in the app repo, "Build now so it fits later"):
// common / seasonal / rare, from GBIF occurrence records (which include iNaturalist's research-grade
// observations) in the ~100 km grid square around the photo. Never hard-coded months or seasons:
// "seasonal" means this species' local records cluster in some months far more than all plants'
// records in the same square do. Null when the square has too little data or GBIF doesn't answer:
// the app then shows no badge. Only the grid square (whole degrees) is sent to GBIF.
import { config } from "./config.js";
import { store } from "./store.js";

const GBIF = "https://api.gbif.org/v1";
const PLANTAE = 6;

/** The whole-degree grid square containing a position, or null. */
export function cellFor(lat, lng) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
  if (Math.abs(latN) > 90 || Math.abs(lngN) > 180) return null;
  return { lat: Math.min(Math.floor(latN), 89), lng: Math.min(Math.floor(lngN), 179) };
}

/**
 * How unevenly the species' records fall over the months, compared with all plants in the square
 * (total variation distance, 0 = same pattern, 1 = completely different). Corrects for people
 * simply going out more in summer.
 */
export function seasonality(speciesMonths, baselineMonths) {
  const total = (months) => months.reduce((sum, value) => sum + value, 0);
  const speciesTotal = total(speciesMonths);
  const baselineTotal = total(baselineMonths);
  if (!speciesTotal || !baselineTotal) return 0;
  let distance = 0;
  for (let month = 0; month < 12; month++) {
    distance += Math.max(0, speciesMonths[month] / speciesTotal - baselineMonths[month] / baselineTotal);
  }
  return distance;
}

/**
 * The tier from counts in one grid square. Pure, unit-tested.
 * `species`/`baseline`: { count, months: [12 counts, Jan first] }; `genusCount`: records of the genus.
 */
export function classify({ species, genusCount, baseline }) {
  const rules = config.rarity;
  if (!baseline || baseline.count < rules.minBaselineRecords) return null;
  const share = species.count / baseline.count;
  const genusShare = (genusCount ?? species.count) / baseline.count;
  // Too few records to say: a garden plant, a houseplant outside or a wrong name, more likely than a rarity.
  if (species.count < rules.minRareRecords) return null;
  if (share < rules.rareMaxShare && genusShare < rules.rareMaxGenusShare) return "rare";
  if (species.count >= rules.minSeasonalRecords
      && seasonality(species.months, baseline.months) >= rules.seasonalMinDistance) return "seasonal";
  return "common";
}

/** Rarity for an identified species at a position, cached per species and grid square. */
export async function rarityFor(species, { lat, lng } = {}) {
  const cell = cellFor(lat, lng);
  const taxonKey = species?.gbifId;
  if (!cell || !taxonKey || !/^\d+$/.test(taxonKey)) return null;
  const key = `rarity:v1:${taxonKey}:${cell.lat}:${cell.lng}`;
  const cached = await store.get(key).catch(() => null);
  if (cached) return cached === "none" ? null : cached;

  try {
    const [counts, baseline, genusKey] = await Promise.all([
      occurrences(taxonKey, cell), baselineFor(cell), genusOf(taxonKey),
    ]);
    const genus = genusKey && genusKey !== Number(taxonKey) ? await occurrences(genusKey, cell, false) : null;
    const rarity = classify({ species: counts, genusCount: genus?.count, baseline });
    await store.set(key, rarity ?? "none", config.rarity.cacheSeconds).catch(() => {});
    return rarity;
  } catch (error) {
    console.warn(`rarity: ${taxonKey} ${error.message}`);
    return null;  // not cached: try again next time
  }
}

async function baselineFor(cell) {
  const key = `rarity:v1:baseline:${cell.lat}:${cell.lng}`;
  const cached = await store.get(key).catch(() => null);
  if (cached) return JSON.parse(cached);
  const baseline = await occurrences(PLANTAE, cell);
  await store.set(key, JSON.stringify(baseline), config.rarity.cacheSeconds).catch(() => {});
  return baseline;
}

async function genusOf(taxonKey) {
  return (await gbif(`/species/${taxonKey}`)).genusKey ?? null;
}

async function occurrences(taxonKey, cell, withMonths = true) {
  const query = new URLSearchParams({
    taxonKey: String(taxonKey),
    decimalLatitude: `${cell.lat},${cell.lat + 1}`,
    decimalLongitude: `${cell.lng},${cell.lng + 1}`,
    limit: "0",
  });
  if (withMonths) {
    query.set("facet", "month");
    query.set("facetLimit", "12");
  }
  const data = await gbif(`/occurrence/search?${query}`);
  const months = new Array(12).fill(0);
  for (const { name, count } of data.facets?.[0]?.counts ?? []) {
    const month = Number(name);
    if (month >= 1 && month <= 12) months[month - 1] = count;
  }
  return { count: data.count ?? 0, months };
}

async function gbif(path) {
  const response = await fetch(`${GBIF}${path}`, { signal: AbortSignal.timeout(config.rarity.timeoutMs) });
  if (!response.ok) throw new Error(`GBIF ${response.status}`);
  return response.json();
}
