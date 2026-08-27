import { ethers } from "ethers";

/*
 * Reverse-resolve a wallet to its primary .qie name.
 *
 * v1 does this by paging the explorer for the wallet's transaction history and
 * decoding registration calldata (selector 0xf2101e95) - slow, rate-limited, and
 * wrong whenever a name was transferred rather than registered.
 *
 * QIE actually ships a reverse resolver. It is deployed by QIE's core deployer
 * (0x9a689036…, the same account behind the domain registry) and answers in one
 * eth_call. Verified live: 0xe63a7e2c… -> "etherium.qie".
 */
export const QIE_DEFAULT_RESOLVER = "0x76ec8ed377cC0d36D1B48027ac7892Ec6799171E";

const RESOLVER_ABI = ["function resolve(address addr) external view returns (string)"];

/**
 * @returns the primary .qie name, or null when the wallet has none set.
 *          Never throws - callers render the address instead.
 */
export async function resolveQieName(address, provider) {
  if (!address || !provider) return null;
  try {
    const resolver = new ethers.Contract(QIE_DEFAULT_RESOLVER, RESOLVER_ABI, provider);
    const name = await Promise.race([
      resolver.resolve(address),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    const trimmed = (name || "").trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/*
 * Forward resolution: .qie name -> wallet address.
 *
 * QIE runs TWO domain registries and a name lives in exactly one of them -
 * verified live: etherium.qie and fluenci.qie resolve on the "hovr" registry,
 * test.qie and test101.qie on the "wallet" registry. Both expose
 * resolver(string) returning (bytes32 node, address owner), so a lookup is one
 * eth_call per registry instead of downloading the registry's entire
 * transaction history and decoding registration calldata.
 *
 * That history scan is also simply wrong for a name that was transferred after
 * registration: it returns whoever registered it, not who owns it now.
 */
export const QIE_REGISTRIES = [
  "0x26cCB3fABd6db18834987134d715Ba2346CE7223", // hovr
  "0x1D69d75AD7b77b91C3760F84faC52E651710f62e", // wallet
];

const REGISTRY_ABI = ["function resolver(string name) external view returns (bytes32 node, address owner)"];

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * @returns the owning address, or null when the name is registered in neither
 *          registry. Never throws.
 */
export async function resolveQieAddress(name, provider) {
  const trimmed = (name || "").trim().toLowerCase();
  if (!trimmed || !provider) return null;

  const attempts = QIE_REGISTRIES.map(async (addr) => {
    try {
      const reg = new ethers.Contract(addr, REGISTRY_ABI, provider);
      const [, owner] = await Promise.race([
        reg.resolver(trimmed),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
      return owner && owner !== ZERO ? owner : null;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(attempts);
  return results.find(Boolean) ?? null;
}
