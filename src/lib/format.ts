import { formatEther } from "viem";

export function formatEth(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction} ETH` : `${whole} ETH`;
}

export function storageValueToAddress(value?: `0x${string}`): string | null {
  if (!value || /^0x0*$/.test(value)) return null;
  const addressPart = value.slice(-40);
  if (/^0{40}$/.test(addressPart)) return null;
  return `0x${addressPart}`;
}
