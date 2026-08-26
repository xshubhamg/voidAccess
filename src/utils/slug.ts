import { randomBytes } from "node:crypto";

/** Must match organizations.slug column width: varchar(120). */
const MAX_SLUG_LENGTH = 120;

const SUFFIX_LENGTH = 8;
const SEPARATOR_LENGTH = 1;

export const SLUG_BASE_MAX_LENGTH = MAX_SLUG_LENGTH - SUFFIX_LENGTH - SEPARATOR_LENGTH;

/**
 * Converts free-form text into a URL-safe slug: lowercase ASCII letters,
 * digits, and single dashes. Falls back to "org" when nothing usable
 * survives (e.g. an emoji-only name).
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/, "");

  return slug.length > 0 ? slug : "org";
}

/** Appends a fixed-length random hex suffix so a colliding slug fits the column. */
export function slugWithRandomSuffix(base: string): string {
  return `${base}-${randomBytes(SUFFIX_LENGTH / 2).toString("hex")}`;
}
