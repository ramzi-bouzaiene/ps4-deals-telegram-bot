export interface RegionConfig {
  code: string;
  country: string;
  language: string;
  locale: string;
  path: string;
  currency: string;
  symbol: string;
}

const REGIONS: Record<string, RegionConfig> = {
  FR: {
    code: "FR",
    country: "FR",
    language: "fr",
    locale: "fr-FR",
    path: "fr-fr",
    currency: "EUR",
    symbol: "€",
  },
  DE: {
    code: "DE",
    country: "DE",
    language: "de",
    locale: "de-DE",
    path: "de-de",
    currency: "EUR",
    symbol: "€",
  },
  ES: {
    code: "ES",
    country: "ES",
    language: "es",
    locale: "es-ES",
    path: "es-es",
    currency: "EUR",
    symbol: "€",
  },
  IT: {
    code: "IT",
    country: "IT",
    language: "it",
    locale: "it-IT",
    path: "it-it",
    currency: "EUR",
    symbol: "€",
  },
  UK: {
    code: "UK",
    country: "GB",
    language: "en",
    locale: "en-GB",
    path: "en-gb",
    currency: "GBP",
    symbol: "£",
  },
  US: {
    code: "US",
    country: "US",
    language: "en",
    locale: "en-US",
    path: "en-us",
    currency: "USD",
    symbol: "$",
  },
};

export const SUPPORTED_REGIONS = Object.keys(REGIONS);

export function getRegion(code: string): RegionConfig {
  const r = REGIONS[String(code || "").toUpperCase()];
  if (!r)
    throw new Error(`Unsupported region "${code}" — use one of: ${SUPPORTED_REGIONS.join(", ")}`);
  return r;
}
