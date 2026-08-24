import type { Address } from "viem";

export interface BaseProtocolContract {
  address: Address;
  name: string;
  deploymentMechanism: "protocol-predeploy";
  introduced: string;
  proxied: boolean;
  baseRegistryUrl: string;
  protocolSpecificationUrl: string;
}

const BASE_PROTOCOL_CONTRACTS: Record<string, BaseProtocolContract> = {
  "0x4200000000000000000000000000000000000006": {
    address: "0x4200000000000000000000000000000000000006",
    name: "WETH9",
    deploymentMechanism: "protocol-predeploy",
    introduced: "Legacy",
    proxied: false,
    baseRegistryUrl:
      "https://docs.base.org/base-chain/network-information/base-contracts",
    protocolSpecificationUrl:
      "https://specs.optimism.io/protocol/predeploys.html#weth9",
  },
};

export function getBaseProtocolContract(
  address: Address,
): BaseProtocolContract | null {
  return BASE_PROTOCOL_CONTRACTS[address.toLowerCase()] ?? null;
}
