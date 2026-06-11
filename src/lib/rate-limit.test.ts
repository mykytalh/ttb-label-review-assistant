/**
 * Tests for the fixed-window rate limiter. A deterministic clock (`now`) is
 * passed in so the window behavior is tested without real timers.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, clientIp, __resetRateLimits } from "./rate-limit";

beforeEach(() => __resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit, then blocks", () => {
    const key = "1.2.3.4";
    expect(rateLimit(key, 3, 1000, 0).allowed).toBe(true);
    expect(rateLimit(key, 3, 1000, 0).allowed).toBe(true);
    expect(rateLimit(key, 3, 1000, 0).allowed).toBe(true);
    const blocked = rateLimit(key, 3, 1000, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "5.6.7.8";
    rateLimit(key, 1, 1000, 0);
    expect(rateLimit(key, 1, 1000, 500).allowed).toBe(false); // still in window
    expect(rateLimit(key, 1, 1000, 1001).allowed).toBe(true); // new window
  });

  it("tracks separate keys independently", () => {
    expect(rateLimit("a", 1, 1000, 0).allowed).toBe(true);
    expect(rateLimit("b", 1, 1000, 0).allowed).toBe(true); // different key, fresh
    expect(rateLimit("a", 1, 1000, 0).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first IP from x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(clientIp(h)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
