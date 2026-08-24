import { getAddress, isAddress, type Address, type Hex } from "viem";

const DELEGATION_PREFIX = "0xef0100";
const DELEGATION_DESIGNATOR_LENGTH = 48;

/**
 * EIP-7702 stores 0xef0100 followed by a 20-byte delegate address in an EOA's
 * code field. It is an account delegation marker, not ordinary deployed
 * contract bytecode.
 */
export function parseEip7702Delegation(code: Hex): Address | null {
  if (
    code.length !== DELEGATION_DESIGNATOR_LENGTH ||
    !code.toLowerCase().startsWith(DELEGATION_PREFIX)
  ) {
    return null;
  }

  const candidate = `0x${code.slice(DELEGATION_PREFIX.length)}`;
  if (!isAddress(candidate)) return null;
  return getAddress(candidate);
}
