import { describe, expect, it } from "bun:test";

import { SLUG_BASE_MAX_LENGTH, slugWithRandomSuffix, slugify } from "../src/utils/slug.ts";

describe("slugify", () => {
  it("lowercases and dashes word boundaries", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
    expect(slugify("  Void   Access  ")).toBe("void-access");
  });

  it("strips diacritics via unicode normalization", () => {
    expect(slugify("Café GmbH")).toBe("cafe-gmbh");
    expect(slugify("Naïve Dév")).toBe("naive-dev");
  });

  it("collapses punctuation and symbol runs into single dashes", () => {
    expect(slugify("Foo & Bar!")).toBe("foo-bar");
    expect(slugify("a---b___c d")).toBe("a-b-c-d");
  });

  it("keeps digits", () => {
    expect(slugify("Team 47")).toBe("team-47");
  });

  it("falls back to 'org' when no usable characters remain", () => {
    expect(slugify("")).toBe("org");
    expect(slugify("---")).toBe("org");
    expect(slugify("🚀🔥")).toBe("org");
  });

  it("caps the base so base + separator + suffix fits the column", () => {
    const longName = "x".repeat(500);
    const base = slugify(longName);
    expect(base.length).toBe(SLUG_BASE_MAX_LENGTH);

    const withSuffix = slugWithRandomSuffix(base);
    expect(withSuffix.length).toBeLessThanOrEqual(120);
  });

  it("trims a trailing dash left over after truncation", () => {
    // 111 chars where the last chunk ends exactly at the limit.
    const name = `${"a".repeat(54)} ${"b".repeat(56)} c`;
    expect(slugify(name)).not.toMatch(/-$/);
  });
});

describe("slugWithRandomSuffix", () => {
  it("appends an 8-char hex suffix separated by a dash", () => {
    const suffixed = slugWithRandomSuffix("acme");
    expect(suffixed.startsWith("acme-")).toBe(true);
    expect(suffixed).toMatch(/^acme-[0-9a-f]{8}$/);
  });

  it("produces different suffixes across calls", () => {
    const seen = new Set(Array.from({ length: 20 }, () => slugWithRandomSuffix("org")));
    expect(seen.size).toBeGreaterThan(1);
  });
});
