// Every tunable server value in one place (the app's equivalent is Config.swift).

export const config = {
  trialDailyIds: Number(process.env.TRIAL_DAILY_IDS ?? 3),
  /** Below this Pl@ntNet score (0–1) we don't name the plant: a wrong name is worse than none. */
  minSpeciesScore: 0.2,
  /** Regional Pl@ntNet results below this score are retried worldwide (houseplants, garden exotics). */
  regionalRetryScore: 0.25,
  /** Largest photo accepted (the app sends ~1024 px JPEGs, well under this). */
  maxImageBytes: 3 * 1024 * 1024,
  /** Facts per species, cached per species and language. */
  factsPerSpecies: 3,
  factCacheSeconds: 180 * 24 * 3600,
  /** App Attest one-time challenges. */
  challengeSeconds: 5 * 60,
  /** Trial-or-paid answer from Apple, cached per transaction. */
  tierCacheSeconds: 3600,
  appAttestMode: process.env.APP_ATTEST_MODE ?? "log",
  teamId: process.env.APPLE_TEAM_ID ?? "J72XXRT45L",
  bundleId: process.env.APP_BUNDLE_ID ?? "com.treesable.fotothis",
};
