export const PSN_HEADERS: Record<string, string> = {
  accept: "application/json",
  "content-type": "application/json",
  "X-PSN-Store-Locale-Override": "fr-FR",
  "X-PSN-App-Ver": "@sie-ppr-web-store/app/0.114.0-",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

/** Build a persisted-query GET for the store's internal GraphQL endpoint. */
export function gqlOp(
  operationName: string,
  variables: Record<string, unknown>,
  sha256Hash: string,
): string {
  const u = new URL("https://web.np.playstation.com/api/graphql/v1/op");
  u.searchParams.set("operationName", operationName);
  u.searchParams.set("variables", JSON.stringify(variables));
  u.searchParams.set("extensions", JSON.stringify({ persistedQuery: { version: 1, sha256Hash } }));
  return u.toString();
}
