import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const MONTH = 30 * 86_400;
const USD = (n: number) => BigInt(Math.round(n * 1_000_000));
const MIN_REPUTATION = 3;

// EIP-712 typed data the QIE reputation service must sign.
const TYPES = {
  ReputationAttestation: [
    { name: "wallet", type: "address" },
    { name: "score", type: "uint256" },
    { name: "tier", type: "string" },
    { name: "modelVersion", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
};

async function deploy() {
  const [owner, subscriber, merchant, treasury, qieSigner, impostor] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const qusdc = await (await ethers.getContractFactory("MockQUSDC")).deploy();
  const pass = await (await ethers.getContractFactory("MockQiePass")).deploy();
  const attestor = await (await ethers.getContractFactory("FluenciReputationAttestor")).deploy(qieSigner.address);
  const registry = await (await ethers.getContractFactory("FluenciRegistryV4"))
    .deploy(await pass.getAddress(), treasury.address);

  // The whole point of the adapter: the registry is pointed at the attestor and
  // needs no knowledge of how the score was produced.
  await registry.setQieReputation(await attestor.getAddress());
  await pass.registerIdentity(merchant.address, true);

  await qusdc.mint(subscriber.address, USD(1_000));
  await qusdc.connect(subscriber).approve(await registry.getAddress(), USD(1_000_000));

  const domain = {
    name: "Fluenci Reputation Attestor",
    version: "1",
    chainId,
    verifyingContract: await attestor.getAddress(),
  };

  const attest = async (over: any = {}, signer = qieSigner) => {
    const now = await time.latest();
    const a = {
      wallet: subscriber.address,
      score: 842n,
      tier: "Trusted",
      modelVersion: "2.0",
      issuedAt: BigInt(now),
      expiresAt: BigInt(now + 3600),
      chainId,
      ...over,
    };
    const sig = await signer.signTypedData(domain, TYPES, a);
    return { a, sig };
  };

  return { owner, subscriber, merchant, treasury, qieSigner, impostor, qusdc, pass, attestor, registry,
           chainId, domain, attest, token: await qusdc.getAddress() };
}

describe("FluenciReputationAttestor", () => {

  describe("signature authority", () => {
    it("accepts a score signed by the authorised QIE signer", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest();
      await f.attestor.submitAttestation(a, sig);
      expect(await f.attestor.getScore(f.subscriber.address)).to.equal(842n);
    });

    it("rejects a score signed by anyone else", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest({}, f.impostor);
      await expect(f.attestor.submitAttestation(a, sig))
        .to.be.revertedWith("Not signed by the authorised QIE signer");
    });

    it("rejects a tampered score even with a valid signature over the original", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest();
      await expect(f.attestor.submitAttestation({ ...a, score: 999n }, sig))
        .to.be.revertedWith("Not signed by the authorised QIE signer");
    });

    it("lets anyone relay — the signature is the authority, not the sender", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest();
      await expect(f.attestor.connect(f.impostor).submitAttestation(a, sig)).to.not.be.reverted;
      expect(await f.attestor.getScore(f.subscriber.address)).to.equal(842n);
    });
  });

  describe("validity window", () => {
    it("reports zero once the attestation expires", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest();
      await f.attestor.submitAttestation(a, sig);
      expect(await f.attestor.getScore(f.subscriber.address)).to.equal(842n);

      await time.increase(3601);
      expect(await f.attestor.getScore(f.subscriber.address)).to.equal(0n);
      expect(await f.attestor.isValid(f.subscriber.address)).to.equal(false);
    });

    it("refuses an already-expired attestation", async () => {
      const f = await deploy();
      const now = await time.latest();
      const { a, sig } = await f.attest({ issuedAt: BigInt(now - 100), expiresAt: BigInt(now - 1) });
      await expect(f.attestor.submitAttestation(a, sig)).to.be.revertedWith("Attestation already expired");
    });

    it("refuses a stale attestation replacing a newer one", async () => {
      const f = await deploy();
      const now = await time.latest();
      const fresh = await f.attest({ issuedAt: BigInt(now), expiresAt: BigInt(now + 7200) });
      await f.attestor.submitAttestation(fresh.a, fresh.sig);

      const stale = await f.attest({ issuedAt: BigInt(now - 60), expiresAt: BigInt(now + 7200), score: 10n });
      await expect(f.attestor.submitAttestation(stale.a, stale.sig))
        .to.be.revertedWith("A newer attestation is already on record");
    });
  });

  describe("replay and versioning", () => {
    it("refuses an attestation minted for another chain", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest({ chainId: 999n });
      await expect(f.attestor.submitAttestation(a, sig))
        .to.be.revertedWith("Attestation is for another chain");
    });

    it("can pin to one model version and reject retired ones", async () => {
      const f = await deploy();
      await f.attestor.setRequiredModelVersion("2.0");
      const old = await f.attest({ modelVersion: "1.0" });
      await expect(f.attestor.submitAttestation(old.a, old.sig))
        .to.be.revertedWith("Retired reputation model version");

      const current = await f.attest({ modelVersion: "2.0" });
      await expect(f.attestor.submitAttestation(current.a, current.sig)).to.not.be.reverted;
    });
  });

  describe("upgradeable signer", () => {
    it("follows the signer when QIE rotates its key", async () => {
      const f = await deploy();
      await f.attestor.setAuthorisedSigner(f.impostor.address);

      const oldKey = await f.attest({}, f.qieSigner);
      await expect(f.attestor.submitAttestation(oldKey.a, oldKey.sig))
        .to.be.revertedWith("Not signed by the authorised QIE signer");

      const newKey = await f.attest({}, f.impostor);
      await expect(f.attestor.submitAttestation(newKey.a, newKey.sig)).to.not.be.reverted;
    });

    it("only the owner can rotate the signer", async () => {
      const f = await deploy();
      await expect(f.attestor.connect(f.impostor).setAuthorisedSigner(f.impostor.address))
        .to.be.revertedWith("Only owner");
    });
  });

  describe("privacy", () => {
    it("exposes only the reputation result, never anything about KYC", async () => {
      const f = await deploy();
      const { a, sig } = await f.attest();
      await f.attestor.submitAttestation(a, sig);

      const out = await f.attestor.getAttestation(f.subscriber.address);
      expect(out.score).to.equal(842n);
      expect(out.tier).to.equal("Trusted");
      expect(out.modelVersion).to.equal("2.0");
      expect(out.valid).to.equal(true);

      // The ABI carries no identity fields at all — nothing to leak.
      const fields = f.attestor.interface.getFunction("getAttestation")!.outputs.map((o) => o.name);
      expect(fields).to.deep.equal(["score", "tier", "modelVersion", "issuedAt", "expiresAt", "valid"]);
    });
  });

  describe("end-to-end gating through FluenciRegistryV4", () => {
    it("blocks a subscriber below the merchant's minimum, then admits them once attested", async () => {
      const f = await deploy();
      await f.registry.connect(f.merchant).setMerchantPolicy(MIN_REPUTATION, 700);

      // No attestation on record: getScore returns 0, so the gate fails closed.
      await expect(
        f.registry.connect(f.subscriber).createSubscription(f.merchant.address, f.token, USD(20), MONTH, 0, 0)
      ).to.be.revertedWith("Subscriber does not meet merchant policy");

      const low = await f.attest({ score: 699n });
      await f.attestor.submitAttestation(low.a, low.sig);
      await expect(
        f.registry.connect(f.subscriber).createSubscription(f.merchant.address, f.token, USD(20), MONTH, 0, 0)
      ).to.be.revertedWith("Subscriber does not meet merchant policy");

      const now = await time.latest();
      const ok = await f.attest({ score: 700n, issuedAt: BigInt(now + 1), expiresAt: BigInt(now + 7200) });
      await time.increase(2);
      await f.attestor.submitAttestation(ok.a, ok.sig);
      await expect(
        f.registry.connect(f.subscriber).createSubscription(f.merchant.address, f.token, USD(20), MONTH, 0, 0)
      ).to.not.be.reverted;
    });

    it("an expired attestation closes the gate again", async () => {
      const f = await deploy();
      await f.registry.connect(f.merchant).setMerchantPolicy(MIN_REPUTATION, 700);
      const { a, sig } = await f.attest({ score: 900n });
      await f.attestor.submitAttestation(a, sig);

      await time.increase(3601);
      await expect(
        f.registry.connect(f.subscriber).createSubscription(f.merchant.address, f.token, USD(20), MONTH, 0, 0)
      ).to.be.revertedWith("Subscriber does not meet merchant policy");
    });
  });
});
