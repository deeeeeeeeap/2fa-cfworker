import { describe, expect, it } from "vitest";
import { generateTotp, normalizeBase32 } from "../src/index";
import { TotpError } from "../src/totp-core";

// RFC 6238 Appendix B, ASCII secret "12345678901234567890" encoded as Base32.
const RFC_SHA1_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_SHA256_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const RFC_SHA512_SECRET_BASE32 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

const rfcCases = [
  { timeSeconds: 59, SHA1: "94287082", SHA256: "46119246", SHA512: "90693936" },
  { timeSeconds: 1111111109, SHA1: "07081804", SHA256: "68084774", SHA512: "25091201" },
  { timeSeconds: 1111111111, SHA1: "14050471", SHA256: "67062674", SHA512: "99943326" },
  { timeSeconds: 1234567890, SHA1: "89005924", SHA256: "91819424", SHA512: "93441116" },
  { timeSeconds: 2000000000, SHA1: "69279037", SHA256: "90698825", SHA512: "38618901" },
  { timeSeconds: 20000000000, SHA1: "65353130", SHA256: "77737706", SHA512: "47863826" },
] as const;

describe("TOTP", () => {
  for (const vector of rfcCases) {
    it(`matches RFC 6238 vectors at ${vector.timeSeconds}`, async () => {
      const commonOptions = {
        timestampMs: vector.timeSeconds * 1000,
        period: 30,
        digits: 8,
      } as const;

      await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { ...commonOptions, algorithm: "SHA1" })).resolves.toMatchObject({
        token: vector.SHA1,
      });
      await expect(generateTotp(RFC_SHA256_SECRET_BASE32, { ...commonOptions, algorithm: "SHA256" })).resolves.toMatchObject({
        token: vector.SHA256,
      });
      await expect(generateTotp(RFC_SHA512_SECRET_BASE32, { ...commonOptions, algorithm: "SHA512" })).resolves.toMatchObject({
        token: vector.SHA512,
      });
    });
  }

  it("normalizes spaces, hyphens, lowercase and optional padding", () => {
    expect(normalizeBase32(" gezd-gnbv gy3tqojq==== ")).toBe("GEZDGNBVGY3TQOJQ");
  });

  it("validates runtime options even when called directly", async () => {
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { period: 0 })).rejects.toThrow("period must be an integer");
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { digits: 9 })).rejects.toThrow("digits must be an integer");
  });

  it("accepts the period boundary values 5 and 300", async () => {
    const shortPeriod = await generateTotp(RFC_SHA1_SECRET_BASE32, { period: 5, time: 59 });
    expect(shortPeriod.period).toBe(5);
    expect(shortPeriod.token).toMatch(/^\d{6}$/);

    const longPeriod = await generateTotp(RFC_SHA1_SECRET_BASE32, { period: 300, time: 59 });
    expect(longPeriod.period).toBe(300);
    expect(longPeriod.token).toMatch(/^\d{6}$/);
  });

  it("rejects period values just outside 5..300", async () => {
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { period: 4 })).rejects.toThrow(
      "period must be an integer between 5 and 300",
    );
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { period: 301 })).rejects.toThrow(
      "period must be an integer between 5 and 300",
    );
  });

  it("accepts the digits boundary values 6 and 8", async () => {
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { time: 59, digits: 6 })).resolves.toMatchObject({
      token: "287082",
      digits: 6,
    });
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { time: 59, digits: 8 })).resolves.toMatchObject({
      token: "94287082",
      digits: 8,
    });
  });

  it("rejects digits values just outside 6..8", async () => {
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { digits: 5 })).rejects.toThrow(
      "digits must be an integer between 6 and 8",
    );
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { digits: 9 })).rejects.toThrow(
      "digits must be an integer between 6 and 8",
    );
  });

  it("rejects secrets longer than 256 characters with a too_long TotpError", async () => {
    await expect(generateTotp("A".repeat(260))).rejects.toThrow("secret is too long");

    let caught: unknown;
    try {
      normalizeBase32("A".repeat(300));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TotpError);
    expect((caught as TotpError).kind).toBe("too_long");
    expect((caught as TotpError).message).toBe("secret is too long");
  });

  it("rejects timestamps earlier than t0", async () => {
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { t0: 100, time: 50 })).rejects.toThrow(
      "time must be greater than or equal to t0",
    );
  });

  it("applies the t0 offset when computing the counter", async () => {
    const offset = await generateTotp(RFC_SHA1_SECRET_BASE32, { t0: 30, time: 89, period: 30, digits: 8 });
    const reference = await generateTotp(RFC_SHA1_SECRET_BASE32, { time: 59, digits: 8 });

    expect(reference.token).toBe("94287082");
    expect(offset.token).toBe(reference.token);
    expect(offset.counter).toBe("1");
  });

  it("prefers timestampMs over time when both are provided", async () => {
    await expect(generateTotp(RFC_SHA1_SECRET_BASE32, { timestampMs: 59000, time: 9999999, digits: 8 })).resolves.toMatchObject({
      token: "94287082",
    });
  });
});
