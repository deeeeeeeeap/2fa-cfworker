import { describe, expect, it } from "vitest";
import { CLIENT_JS, homeHtml } from "../src/page";
import { base32ToBytes, counterToBytes, hotp, normalizeBase32, type TotpAlgorithm } from "../src/totp-core";

// RFC 6238 Appendix B secrets (same constants as tests/totp.test.ts).
const RFC_SECRETS: Record<TotpAlgorithm, string> = {
  SHA1: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  SHA256: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
  SHA512:
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
};
const RFC_TIME_POINTS = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];

type ClientTotpModule = {
  normalizeBase32(input: unknown): string;
  base32ToBytes(input: string): Uint8Array;
  counterToBytes(counter: bigint): Uint8Array;
  hotp(secret: string, counter: bigint, digits: number, algorithm: TotpAlgorithm): Promise<string>;
};

function mustIndexOf(needle: string, from = 0): number {
  const index = CLIENT_JS.indexOf(needle, from);
  if (index === -1) throw new Error(`CLIENT_JS is missing expected marker: ${needle}`);
  return index;
}

/**
 * Slices one top-level declaration out of CLIENT_JS, from startMarker to the
 * nearest of the end markers (function bodies are indented, so a marker like
 * "\nconst " only matches the next top-level declaration).
 */
function extractDeclaration(startMarker: string, endMarkers: string[]): string {
  const start = mustIndexOf(startMarker);
  let end = CLIENT_JS.length;
  for (const endMarker of endMarkers) {
    const candidate = CLIENT_JS.indexOf(endMarker, start + startMarker.length);
    if (candidate !== -1 && candidate < end) end = candidate;
  }
  return CLIENT_JS.slice(start, end);
}

const FUNCTION_END_MARKERS = ["\nfunction ", "\nasync function ", "\nconst ", "\nlet ", "\nfor "];

function buildClientModule(): ClientTotpModule {
  const declarations = [
    // The client normalizeBase32 resolves error copy through t(); the drift
    // tests only care about throw/no-throw parity, so a key-echo stub is fine.
    "const t = (key) => key;",
    extractDeclaration("const maxSecretLength", ["\n"]),
    extractDeclaration("const alphabet", ["\n"]),
    extractDeclaration("const hashName", ["\n"]),
    extractDeclaration("let cachedSecret", ["\n"]),
    extractDeclaration("let cachedAlgorithm", ["\n"]),
    extractDeclaration("let cachedKey", ["\n"]),
    extractDeclaration("function normalizeBase32", FUNCTION_END_MARKERS),
    extractDeclaration("function base32ToBytes", FUNCTION_END_MARKERS),
    extractDeclaration("function counterToBytes", FUNCTION_END_MARKERS),
    extractDeclaration("async function cryptoKeyFor", FUNCTION_END_MARKERS),
    extractDeclaration("async function hotp", FUNCTION_END_MARKERS),
  ];
  const factory = new Function(
    `${declarations.join("\n")}\nreturn { normalizeBase32, base32ToBytes, counterToBytes, hotp };`,
  );
  return factory() as ClientTotpModule;
}

function extractI18nTable(): { zh: Record<string, string>; en: Record<string, string> } {
  const start = mustIndexOf("const i18n = {");
  const braceStart = mustIndexOf("{", start);
  const end = mustIndexOf("\n};", start);
  const objectSource = CLIENT_JS.slice(braceStart, end + "\n}".length);
  const factory = new Function(`return (${objectSource});`);
  return factory() as { zh: Record<string, string>; en: Record<string, string> };
}

const client = buildClientModule();

describe("client/server algorithm drift", () => {
  it("normalizes Base32 secrets identically on both sides", () => {
    const samples = [
      " gezd-gnbv gy3tqojq==== ",
      "GEZDGNBVGY3TQOJQ",
      "MFRGGZDFMZTWQ2LK",
      "MFRG%20GZDF",
      "",
      "NOT!VALID",
      "A".repeat(300),
    ];

    for (const sample of samples) {
      const label = `input: ${JSON.stringify(sample.slice(0, 40))}`;
      let serverValue: string | undefined;
      let serverThrew = false;
      try {
        serverValue = normalizeBase32(sample);
      } catch {
        serverThrew = true;
      }

      let clientValue: string | undefined;
      let clientThrew = false;
      try {
        clientValue = client.normalizeBase32(sample);
      } catch {
        clientThrew = true;
      }

      expect(clientThrew, label).toBe(serverThrew);
      if (!serverThrew) {
        expect(clientValue, label).toBe(serverValue);
      }
    }
  });

  it("decodes Base32 secrets into identical key bytes", () => {
    for (const secret of Object.values(RFC_SECRETS)) {
      expect(Array.from(client.base32ToBytes(secret))).toEqual(Array.from(base32ToBytes(secret)));
    }
  });

  it("rejects degenerate secrets identically on both sides", () => {
    // "A"/"A=" decode to zero bytes (5 bits): the server throws its empty-key
    // error and the client must mirror it instead of reaching importKey.
    for (const sample of ["A", "A=", "AA", "AAAA"]) {
      let serverBytes: number[] | undefined;
      let serverThrew = false;
      try {
        serverBytes = Array.from(base32ToBytes(sample));
      } catch {
        serverThrew = true;
      }

      let clientBytes: number[] | undefined;
      let clientThrew = false;
      try {
        clientBytes = Array.from(client.base32ToBytes(sample));
      } catch {
        clientThrew = true;
      }

      expect(clientThrew, sample).toBe(serverThrew);
      if (!serverThrew) {
        expect(clientBytes, sample).toEqual(serverBytes);
      }
    }
  });

  it("encodes HOTP counters into identical big-endian bytes", () => {
    for (const counter of [0n, 1n, 59n, 255n, 4294967296n, 9223372036854775807n]) {
      expect(Array.from(client.counterToBytes(counter)), String(counter)).toEqual(Array.from(counterToBytes(counter)));
    }
  });

  for (const algorithm of ["SHA1", "SHA256", "SHA512"] as const) {
    it(`computes identical ${algorithm} HOTP tokens for the RFC 6238 vectors`, async () => {
      const secret = RFC_SECRETS[algorithm];
      const key = base32ToBytes(secret);

      for (const timeSeconds of RFC_TIME_POINTS) {
        const counter = BigInt(Math.floor(timeSeconds / 30));
        const clientToken = await client.hotp(secret, counter, 8, algorithm);
        const serverToken = await hotp(key, counter, 8, algorithm);
        expect(clientToken, `time=${timeSeconds}`).toBe(serverToken);
      }
    });
  }

  it("anchors the shared implementation to the RFC 6238 SHA1 vector at t=59", async () => {
    await expect(client.hotp(RFC_SECRETS.SHA1, 1n, 8, "SHA1")).resolves.toBe("94287082");
  });
});

describe("client/server copy drift", () => {
  it("keeps zh i18n strings in sync with the server-rendered default copy", () => {
    const i18n = extractI18nTable();
    expect(Object.keys(i18n.zh).length).toBeGreaterThan(10);
    expect(Object.keys(i18n.en).sort()).toEqual(Object.keys(i18n.zh).sort());

    const html = homeHtml("testnonce");
    let compared = 0;
    for (const match of html.matchAll(/data-i18n="([a-zA-Z]+)"[^>]*>([^<]*)</g)) {
      const key = match[1];
      const renderedDefault = match[2].trim();
      const zhValue = i18n.zh[key];
      if (typeof zhValue === "string" && !zhValue.includes("<")) {
        expect(renderedDefault, `data-i18n="${key}"`).toBe(zhValue.trim());
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(10);
  });

  it("keeps input placeholders in sync with the zh i18n strings", () => {
    const i18n = extractI18nTable();
    const html = homeHtml("testnonce");

    let compared = 0;
    for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
      const placeholderMatch = tag.match(/ placeholder="([^"]*)"/);
      const keyMatch = tag.match(/ data-i18n-placeholder="([a-zA-Z]+)"/);
      if (!placeholderMatch || !keyMatch) continue;

      const zhValue = i18n.zh[keyMatch[1]];
      expect(typeof zhValue, keyMatch[1]).toBe("string");
      expect(placeholderMatch[1].trim(), `data-i18n-placeholder="${keyMatch[1]}"`).toBe(zhValue.trim());
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });
});
