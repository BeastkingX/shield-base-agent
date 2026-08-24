import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { getBaseProtocolContract } from "./base-protocol-contracts";

describe("Base protocol contract registry", () => {
  it("recognizes WETH9 only by its exact documented Base address", () => {
    const result = getBaseProtocolContract(
      "0x4200000000000000000000000000000000000006" as Address,
    );

    expect(result).toMatchObject({
      name: "WETH9",
      deploymentMechanism: "protocol-predeploy",
      proxied: false,
    });
  });

  it("does not infer provenance from the 0x4200 prefix", () => {
    expect(
      getBaseProtocolContract(
        "0x4200000000000000000000000000000000000999" as Address,
      ),
    ).toBeNull();
  });
});
