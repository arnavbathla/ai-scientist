import { describe, it, expect } from "vitest";

/**
 * Elo math test mirroring the formula used in RankingAgent.
 */
function expectedScore(eA: number, eB: number): number {
  return 1 / (1 + Math.pow(10, (eB - eA) / 400));
}

describe("Elo math", () => {
  it("equal scores → expected 0.5", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
  });
  it("higher rated favored", () => {
    expect(expectedScore(1100, 1000)).toBeGreaterThan(0.5);
  });
  it("a 200-point underdog has lower probability than 100-point underdog", () => {
    expect(expectedScore(1000, 1200)).toBeLessThan(expectedScore(1000, 1100));
  });
});
