import { describe, expect, it } from "vitest";
import { creditsAfterReserve, fmtNum } from "./economy";

describe("fmtNum", () => {
  it("keeps small numbers exact, with separators", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(7.5)).toBe("7.5");
    expect(fmtNum(999_999)).toBe("999,999");
  });

  it("switches to three-figure suffixes from a million up", () => {
    expect(fmtNum(1_250_000)).toBe("1.25M");
    expect(fmtNum(12_500_000)).toBe("12.5M");
    expect(fmtNum(125_000_000)).toBe("125M");
    expect(fmtNum(30_200_000_000)).toBe("30.2B");
    expect(fmtNum(4_000_000_000_000)).toBe("4.00T");
  });

  it("stays on the last suffix rather than inventing one", () => {
    expect(fmtNum(9_100_000_000_000_000)).toBe("9.10Q");
    expect(fmtNum(2e21)).toBe("2000000Q");
  });
});

describe("creditsAfterReserve", () => {
  it("keeps a required balance out of the spendable budget", () => {
    expect(creditsAfterReserve(900, 500)).toBe(400);
    expect(creditsAfterReserve(300, 500)).toBe(0);
    expect(creditsAfterReserve(300, 0)).toBe(300);
  });
});
