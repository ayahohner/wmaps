import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./origins";

const LIST = "https://maptogether.io, https://*--maptogether.netlify.app,,";

describe("isAllowedOrigin", () => {
  it("accepts exact and wildcard matches", () => {
    expect(isAllowedOrigin("https://maptogether.io", LIST)).toBe(true);
    expect(isAllowedOrigin("https://deploy-preview-9--maptogether.netlify.app", LIST)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAllowedOrigin(null, LIST)).toBe(false);
    expect(isAllowedOrigin("https://evil.com", LIST)).toBe(false);
    expect(isAllowedOrigin("https://maptogether.io.evil.com", LIST)).toBe(false);
    expect(isAllowedOrigin("https://a.b--maptogether.netlify.app", LIST)).toBe(false);
  });
});
