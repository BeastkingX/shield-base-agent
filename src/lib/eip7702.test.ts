import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { parseEip7702Delegation } from "./eip7702";

describe("EIP-7702 delegation detection", () => {
  it("extracts the delegate from an exact delegation designator", () => {
    expect(
      parseEip7702Delegation(
        "0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d" as Hex,
      ),
    ).toBe("0x5A7FC11397E9a8AD41BF10bf13F22B0a63f96f6d");
  });

  it("accepts a zero target but rejects ordinary, truncated, and extended code", () => {
    expect(parseEip7702Delegation("0x60006000" as Hex)).toBeNull();
    expect(
      parseEip7702Delegation(
        "0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96" as Hex,
      ),
    ).toBeNull();
    expect(
      parseEip7702Delegation(
        "0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d00" as Hex,
      ),
    ).toBeNull();
    expect(
      parseEip7702Delegation(
        "0xef01000000000000000000000000000000000000000000" as Hex,
      ),
    ).toBe("0x0000000000000000000000000000000000000000");
  });
});
