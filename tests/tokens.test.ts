import { describe, expect, it } from "bun:test";

import {
  hashToken,
  parseDurationMs,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/utils/tokens.ts";
import { AppError } from "../src/utils/AppError.ts";

describe("parseDurationMs", () => {
  it("parses supported units", () => {
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("15m")).toBe(900_000);
    expect(parseDurationMs("12h")).toBe(43_200_000);
    expect(parseDurationMs("7d")).toBe(604_800_000);
  });

  it("trims whitespace", () => {
    expect(parseDurationMs(" 5m ")).toBe(300_000);
  });

  it("rejects invalid durations", () => {
    expect(() => parseDurationMs("abc")).toThrow();
    expect(() => parseDurationMs("15")).toThrow();
    expect(() => parseDurationMs("15w")).toThrow();
  });
});

describe("token signing and verification", () => {
  const userId = "3f6d2f6e-8a1b-4c3e-9a2b-1d2e3f4a5b6c";
  const sessionId = "9a8b7c6d-5e4f-4a3b-2c1d-0f9e8d7c6b5a";

  it("round-trips access tokens", () => {
    const token = signAccessToken(userId, sessionId);
    expect(verifyAccessToken(token)).toEqual({ sub: userId, sid: sessionId, typ: "access" });
  });

  it("round-trips refresh tokens", () => {
    const token = signRefreshToken(userId, sessionId);
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe(userId);
    expect(payload.sid).toBe(sessionId);
    expect(payload.typ).toBe("refresh");
    expect(payload.jti).toEqual(expect.any(String));
  });

  it("rejects tampered access tokens with a 401 AppError", () => {
    const token = signAccessToken(userId, sessionId);
    expect(() => verifyAccessToken(`${token}x`)).toThrow(AppError);
    try {
      verifyAccessToken(`${token}x`);
    } catch (error) {
      expect((error as AppError).statusCode).toBe(401);
      expect((error as AppError).errorCode).toBe("INVALID_ACCESS_TOKEN");
    }
  });

  it("rejects an access token signed with the refresh secret", () => {
    const refreshToken = signRefreshToken(userId, sessionId);
    expect(() => verifyAccessToken(refreshToken)).toThrow(AppError);
  });

  it("rejects malformed refresh tokens", () => {
    expect(() => verifyRefreshToken("not-a-jwt")).toThrow(AppError);
  });
});

describe("hashToken", () => {
  it("produces deterministic sha256 hex digests", () => {
    expect(hashToken("secret-value")).toBe(hashToken("secret-value"));
    expect(hashToken("secret-value")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
