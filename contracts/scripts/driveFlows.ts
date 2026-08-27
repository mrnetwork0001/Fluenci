import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * End-to-end driver for the FluenciRegistryV4 write paths, run against a live
 * local node rather than an in-process chain:
 *
 *     npx hardhat node                                      (separate terminal)
 *     npx hardhat run scripts/deployV4.ts --network localhost
 *     npx hardhat run scripts/driveFlows.ts --network localhost
 *
 * It exercises, with an assertion after every step:
 *
 *   1. setSpendCap -> createSubscription
 *   2. advance time -> claimStream, merchant credited net of the protocol fee
 *  2b. the same claim WITHOUT an ERC-20 allowance, which reverts. This is not
 *      decoration: the v2 dashboard's create flow (DashboardV2.handleCreate ->
 *      useFluenciV4.createSubscription) never approves the V4 registry, so a
 *      subscription opened from the UI lands in exactly this state.
 *   3. a claim larger than the remaining cap - CLAMPED, not reverted
 *   4. setMerchantPolicy(QIE_PASS) - an unverified subscriber is refused
 *   5. terminateStream - settles the tail and deactivates
 *
 * Every expected figure is recomputed here from the contract's own arithmetic
 * (integer division, cumulative-fee accounting, fixed cap windows) and compared
 * against real balance deltas, so a change in _settle's rounding fails the run
 * instead of being absorbed by a tolerance.
 *
 * The script is re-runnable: it clears the cap, terminates leftovers from a
 * previous run and resets the merchant policy before it asserts anything.
 */

// ---------------------------------------------------------------------------
// Fixture. 1 qUSDC per second makes every intermediate figure checkable by eye.
// ---------------------------------------------------------------------------
const PERIOD_SECONDS = 60n;
const AMOUNT_PER_PERIOD = 60_000_000n;   // $60 per minute == $1/second
const CAP_MAX = 100_000_000n;            // $100 per cap window
const CAP_PERIOD = 86_400n;              // 1 day - long enough never to roll here
const CAP_MAX_RAISED = 1_000_000_000n;   // $1,000, for the closing settlement
const MINT = 10_000_000_000n;            // $10,000 of headroom for the subscriber

const T_CLAIM_1 = 30n;    // seconds after createSubscription
const T_CLAIM_2 = 130n;
const T_TERMINATE = 160n;

const GATE = { OPEN: 0, QIE_ID: 1, QIE_PASS: 2, MIN_REPUTATION: 3 } as const;

/*
 * Bound with an explicit ABI rather than through artifacts/. Two reasons: the
 * script then checks the deployed bytecode against the same signatures the
 * frontend ships in dashboard/v4Config.js, and it cannot be derailed by a
 * recompile of the shared artifacts directory while it runs.
 */
const REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function qiePass() view returns (address)",
  "function qieReputation() view returns (address)",
  "function protocolFeeBps() view returns (uint256)",
  "function requireMerchantKyc() view returns (bool)",
  "function createSubscription(address merchant, address tokenAddress, uint256 amountPerPeriod, uint256 periodSeconds, uint256 cliffTime, uint256 stopTime) returns (bytes32)",
  "function claimStream(bytes32 subId)",
  "function terminateStream(bytes32 subId)",
  "function previewOwed(bytes32 subId) view returns (uint256)",
  "function getSubscription(bytes32 subId) view returns (tuple(address subscriber,address merchant,address tokenAddress,uint256 amountPerPeriod,uint256 periodSeconds,uint256 billedSeconds,uint256 settledAmount,uint256 settledFees,uint256 lastTickTimestamp,uint256 startTime,uint256 cliffTime,uint256 stopTime,bool active,bool pausedByAI,uint8 dispute))",
  "function getSubscriberSubscriptions(address subscriber) view returns (bytes32[])",
  "function getMerchantSubscriptions(address merchant) view returns (bytes32[])",
  "function setSpendCap(address merchant, uint256 maxAmount, uint256 periodSeconds)",
  "function clearSpendCap(address merchant)",
  "function remainingAllowance(address subscriber, address merchant) view returns (uint256)",
  "function spendCaps(address subscriber, address merchant) view returns (uint256 maxAmount, uint256 periodSeconds, uint256 windowStart, uint256 spentInWindow, bool set)",
  "function setMerchantPolicy(uint8 gate, uint256 minReputation)",
  "function getMerchantGate(address merchant) view returns (uint8 gate, uint256 minReputation)",
  "function meetsMerchantPolicy(address merchant, address subscriber) view returns (bool)",
  "event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, address tokenAddress, uint256 amountPerPeriod, uint256 periodSeconds, uint256 cliffTime, uint256 stopTime)",
  "event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount)",
  "event ProtocolFeeCollected(bytes32 indexed subId, address indexed treasury, uint256 feeAmount)",
  "event SpendCapSet(address indexed subscriber, address indexed merchant, uint256 maxAmount, uint256 periodSeconds)",
  "event SpendCapReached(bytes32 indexed subId, address indexed merchant, uint256 requested, uint256 paid)",
  "event MerchantPolicySet(address indexed merchant, uint8 gate, uint256 minReputation)",
  "event StreamTerminated(bytes32 indexed subId)",
  "event StreamTerminatedUnsettled(bytes32 indexed subId, uint256 outstanding)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
];

const QIE_PASS_ABI = [
  "function registerIdentity(address user, bool status)",
  "function verifyIdentity(address user) view returns (bool)",
];

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
const failures: string[] = [];

const usd = (v: bigint) => `$${ethers.formatUnits(v, 6)}`;

function ok(label: string, detail = "") {
  passed += 1;
  console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
}

function fail(label: string, detail: string) {
  failures.push(`${label}: ${detail}`);
  console.log(`  FAIL  ${label}  ${detail}`);
}

function assertTrue(cond: boolean, label: string, detail = "") {
  if (cond) ok(label, detail);
  else fail(label, detail || "expected true");
}

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = typeof actual === "bigint" ? actual.toString() : String(actual);
  const e = typeof expected === "bigint" ? expected.toString() : String(expected);
  if (a === e) ok(label, a);
  else fail(label, `expected ${e}, got ${a}`);
}

function assertMoney(actual: bigint, expected: bigint, label: string) {
  if (actual === expected) ok(label, usd(actual));
  else fail(label, `expected ${usd(expected)} (${expected}), got ${usd(actual)} (${actual})`);
}

/**
 * Asserts `contract.method(...args)` cannot succeed, and that the reason
 * contains `needle`.
 *
 * Two probes, because a node started with throwOnTransactionFailures disabled
 * mines a reverting transaction with status 0 rather than rejecting the send:
 * staticCall reports the revert string, and the real transaction proves it does
 * not land.
 */
async function assertReverts(contract: any, method: string, args: any[], needle: string, label: string) {
  let reason = "";
  try {
    await contract[method].staticCall(...args);
  } catch (e: any) {
    reason = String(e?.reason ?? e?.shortMessage ?? e?.message ?? e);
  }
  if (!reason) {
    fail(label, "the call succeeded; a revert was expected");
    return;
  }

  let landed = false;
  try {
    const receipt = await (await contract[method](...args)).wait();
    landed = receipt?.status === 1;
  } catch {
    landed = false; // wait() rejects on a status-0 receipt
  }
  if (landed) fail(label, `staticCall reverted ("${reason}") but the transaction still landed`);
  else if (reason.includes(needle)) ok(label, `reverted: ${reason}`);
  else fail(label, `reverted, but with "${reason}" rather than "${needle}"`);
}

// ---------------------------------------------------------------------------
// A local mirror of FluenciRegistryV4._tick + _owed + _settle, so expectations
// are derived rather than guessed. Every division is integer division, exactly
// as Solidity does it.
// ---------------------------------------------------------------------------
type SubState = {
  amountPerPeriod: bigint;
  periodSeconds: bigint;
  billedSeconds: bigint;
  settledAmount: bigint;
  settledFees: bigint;
  lastTickTimestamp: bigint;
  active: boolean;
  pausedByAI: boolean;
  dispute: bigint;
};

type CapState = {
  maxAmount: bigint;
  periodSeconds: bigint;
  windowStart: bigint;
  spentInWindow: bigint;
  set: boolean;
};

type Expectation = {
  owed: bigint;
  paid: bigint;
  fee: bigint;
  merchantAmount: bigint;
  clamped: boolean;
};

function expectSettlement(sub: SubState, cap: CapState, feeBps: bigint, atTs: bigint): Expectation {
  // _tick: billable time only accrues while active, unpaused and undisputed.
  let billed = sub.billedSeconds;
  if (sub.active && !sub.pausedByAI && sub.dispute === 0n && atTs > sub.lastTickTimestamp) {
    billed += atTs - sub.lastTickTimestamp;
  }

  // _owed
  const accrued = (billed * sub.amountPerPeriod) / sub.periodSeconds;
  const owed = accrued > sub.settledAmount ? accrued - sub.settledAmount : 0n;

  // _settle: clamp by the cap before anything moves.
  let paid = owed;
  let clamped = false;
  if (cap.set && owed > 0n) {
    let spent = cap.spentInWindow;
    if (atTs - cap.windowStart >= cap.periodSeconds) spent = 0n; // window roll
    const remaining = cap.maxAmount > spent ? cap.maxAmount - spent : 0n;
    if (paid > remaining) {
      clamped = true;
      paid = remaining;
    }
  }

  // Fee is cumulative-to-date minus fee-already-taken, never a per-claim slice.
  const newSettled = sub.settledAmount + paid;
  const feeToDate = (newSettled * feeBps) / 10_000n;
  const fee = feeToDate > sub.settledFees ? feeToDate - sub.settledFees : 0n;

  return { owed, paid, fee, merchantAmount: paid - fee, clamped };
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------
async function latestTs(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp);
}

/** Pin the timestamp of the next block, so billed seconds are exact. */
async function setNextTs(ts: bigint, mine = false) {
  const now = await latestTs();
  const target = ts > now ? ts : now + 1n;
  await network.provider.send("evm_setNextBlockTimestamp", [Number(target)]);
  // A view call reads the latest block, so anything that inspects accrual
  // before sending a transaction needs the block actually mined.
  if (mine) await network.provider.send("evm_mine", []);
  return target;
}

async function txTs(tx: any): Promise<bigint> {
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return BigInt(block!.timestamp);
}

function eventsFrom(receipt: any, iface: any, name: string) {
  const out: any[] = [];
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === name) out.push(parsed);
    } catch {
      // a log from another contract - not ours to read
    }
  }
  return out;
}

/** Read the registry address the frontend is actually pointed at. */
function registryAddress(): string {
  if (process.env.REGISTRY_V4_ADDRESS) return ethers.getAddress(process.env.REGISTRY_V4_ADDRESS);
  const envPath = path.resolve(__dirname, "../../frontend/.env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  const match = raw.match(/^VITE_REGISTRY_V4_ADDRESS\s*=\s*(0x[0-9a-fA-F]{40})/m);
  if (!match) {
    throw new Error(
      `No VITE_REGISTRY_V4_ADDRESS in ${envPath}. ` +
      `Deploy with scripts/deployV4.ts, or pass REGISTRY_V4_ADDRESS=0x... to this script.`
    );
  }
  return ethers.getAddress(match[1]);
}

function toSubState(s: any): SubState {
  return {
    amountPerPeriod: s.amountPerPeriod,
    periodSeconds: s.periodSeconds,
    billedSeconds: s.billedSeconds,
    settledAmount: s.settledAmount,
    settledFees: s.settledFees,
    lastTickTimestamp: s.lastTickTimestamp,
    active: s.active,
    pausedByAI: s.pausedByAI,
    dispute: BigInt(s.dispute),
  };
}

function toCapState(c: any): CapState {
  return {
    maxAmount: c.maxAmount,
    periodSeconds: c.periodSeconds,
    windowStart: c.windowStart,
    spentInWindow: c.spentInWindow,
    set: c.set,
  };
}

// ---------------------------------------------------------------------------
async function main() {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 31337n) {
    throw new Error(`Refusing to run against chain ${net.chainId}. This script writes state and is for the local node only.`);
  }

  const signers = await ethers.getSigners();
  if (signers.length < 7) throw new Error("Need at least 7 unlocked accounts on the node.");
  const [owner, , , subscriber, merchant, unverified, noAllowance] = signers;

  const registryAddr = registryAddress();
  if ((await ethers.provider.getCode(registryAddr)) === "0x") {
    throw new Error(`No contract at ${registryAddr}. Run scripts/deployV4.ts --network localhost first.`);
  }

  const registry: any = new ethers.Contract(registryAddr, REGISTRY_ABI, owner);
  const iface = registry.interface;

  const feeBps: bigint = await registry.protocolFeeBps();
  const treasury: string = await registry.treasury();
  const qiePassAddr: string = await registry.qiePass();
  const requireMerchantKyc: boolean = await registry.requireMerchantKyc();
  const qiePass: any = new ethers.Contract(qiePassAddr, QIE_PASS_ABI, owner);

  // The token is per-subscription, so use the one the seeded subscription uses
  // when there is one, and otherwise deploy a fresh mock.
  let tokenAddr = process.env.QUSDC_ADDRESS ?? "";
  if (!tokenAddr) {
    const seeded = await registry.getSubscriberSubscriptions(owner.address);
    if (seeded.length > 0) tokenAddr = (await registry.getSubscription(seeded[0])).tokenAddress;
  }
  if (!tokenAddr || (await ethers.provider.getCode(tokenAddr)) === "0x") {
    const fresh = await (await ethers.getContractFactory("MockQUSDC")).deploy();
    await fresh.waitForDeployment();
    tokenAddr = await fresh.getAddress();
  }
  const token: any = new ethers.Contract(tokenAddr, ERC20_ABI, owner);

  console.log("FluenciRegistryV4 write-path drive");
  console.log("----------------------------------------------------------------");
  console.log(`registry            ${registryAddr}`);
  console.log(`qUSDC               ${tokenAddr}`);
  console.log(`qiePass             ${qiePassAddr}`);
  console.log(`treasury            ${treasury}`);
  console.log(`protocolFeeBps      ${feeBps} (${Number(feeBps) / 100}%)`);
  console.log(`requireMerchantKyc  ${requireMerchantKyc}`);
  console.log(`subscriber          ${subscriber.address}`);
  console.log(`merchant            ${merchant.address}`);
  console.log(`unverified          ${unverified.address}`);
  console.log("");

  assertEq(feeBps, 50n, "protocol fee is 0.5%");

  // --- setup: make the run repeatable ------------------------------------
  console.log("\nsetup");

  // The merchant must hold a QIE Pass while requireMerchantKyc is on, or no
  // claim of theirs can pay out at all.
  await (await qiePass.connect(owner).registerIdentity(merchant.address, true)).wait();
  // Guarantee step 4's precondition rather than inheriting it.
  await (await qiePass.connect(owner).registerIdentity(unverified.address, false)).wait();
  // A previous run may have left the gate closed.
  await (await registry.connect(merchant).setMerchantPolicy(GATE.OPEN, 0)).wait();

  // Retire anything a previous run left behind, then wipe the cap so the
  // window starts empty (setSpendCap only re-anchors when the period changes).
  for (const who of [subscriber, noAllowance, unverified]) {
    for (const id of await registry.getSubscriberSubscriptions(who.address)) {
      const s = await registry.getSubscription(id);
      if (s.active && s.merchant.toLowerCase() === merchant.address.toLowerCase()) {
        await (await registry.connect(who).terminateStream(id)).wait();
      }
    }
  }
  await (await registry.connect(subscriber).clearSpendCap(merchant.address)).wait();

  await (await token.mint(subscriber.address, MINT)).wait();
  await (await token.connect(subscriber).approve(registryAddr, ethers.MaxUint256)).wait();
  ok("setup complete", `subscriber funded ${usd(await token.balanceOf(subscriber.address))}, registry approved`);

  // =======================================================================
  // 1. setSpendCap, then createSubscription
  // =======================================================================
  console.log("\n1. setSpendCap -> createSubscription");

  const capTs = await txTs(await registry.connect(subscriber).setSpendCap(merchant.address, CAP_MAX, CAP_PERIOD));
  const cap0 = toCapState(await registry.spendCaps(subscriber.address, merchant.address));
  assertTrue(cap0.set, "cap is set");
  assertMoney(cap0.maxAmount, CAP_MAX, "cap maxAmount");
  assertEq(cap0.periodSeconds, CAP_PERIOD, "cap periodSeconds");
  assertEq(cap0.windowStart, capTs, "cap window anchored to this block");
  assertMoney(cap0.spentInWindow, 0n, "cap window starts empty");
  assertMoney(await registry.remainingAllowance(subscriber.address, merchant.address), CAP_MAX, "remainingAllowance");

  const createTx = await registry
    .connect(subscriber)
    .createSubscription(merchant.address, tokenAddr, AMOUNT_PER_PERIOD, PERIOD_SECONDS, 0, 0);
  const createReceipt = await createTx.wait();
  const created = eventsFrom(createReceipt, iface, "SubscriptionCreated");
  assertEq(created.length, 1, "SubscriptionCreated emitted");

  const subId: string = created[0].args.subId;
  const t0 = BigInt((await ethers.provider.getBlock(createReceipt!.blockNumber))!.timestamp);

  const sub1 = await registry.getSubscription(subId);
  assertEq(sub1.subscriber, subscriber.address, "subscription subscriber");
  assertEq(sub1.merchant, merchant.address, "subscription merchant");
  assertEq(sub1.tokenAddress, ethers.getAddress(tokenAddr), "subscription token");
  assertMoney(sub1.amountPerPeriod, AMOUNT_PER_PERIOD, "amountPerPeriod");
  assertEq(sub1.periodSeconds, PERIOD_SECONDS, "periodSeconds");
  assertTrue(sub1.active, "subscription is active");
  assertEq(sub1.lastTickTimestamp, t0, "lastTickTimestamp anchored at creation");
  assertMoney(await registry.previewOwed(subId), 0n, "nothing owed at t0");
  assertTrue(
    (await registry.getSubscriberSubscriptions(subscriber.address)).includes(subId),
    "subId indexed under the subscriber"
  );
  assertTrue(
    (await registry.getMerchantSubscriptions(merchant.address)).includes(subId),
    "subId indexed under the merchant"
  );

  // =======================================================================
  // 2. advance time, claimStream, merchant paid net of the fee
  // =======================================================================
  console.log("\n2. advance time -> claimStream (net of the protocol fee)");

  const preSub2 = toSubState(await registry.getSubscription(subId));
  const preCap2 = toCapState(await registry.spendCaps(subscriber.address, merchant.address));
  const claim1Ts = await setNextTs(t0 + T_CLAIM_1);
  const want2 = expectSettlement(preSub2, preCap2, feeBps, claim1Ts);

  const mBefore2 = await token.balanceOf(merchant.address);
  const tBefore2 = await token.balanceOf(treasury);
  const sBefore2 = await token.balanceOf(subscriber.address);

  const claim1Receipt = await (await registry.connect(merchant).claimStream(subId)).wait();
  const actualTs1 = BigInt((await ethers.provider.getBlock(claim1Receipt!.blockNumber))!.timestamp);
  assertEq(actualTs1, claim1Ts, "claim landed at the pinned timestamp");

  const elapsed1 = claim1Ts - t0;
  assertEq(elapsed1, T_CLAIM_1, "billable seconds elapsed");
  assertMoney(want2.owed, (elapsed1 * AMOUNT_PER_PERIOD) / PERIOD_SECONDS, "owed matches $1/second");
  assertTrue(!want2.clamped, "claim is under the cap, so nothing is clamped");

  assertMoney(await token.balanceOf(merchant.address) - mBefore2, want2.merchantAmount, "merchant credited net of fee");
  assertMoney(await token.balanceOf(treasury) - tBefore2, want2.fee, "treasury credited the fee");
  assertMoney(sBefore2 - await token.balanceOf(subscriber.address), want2.paid, "subscriber debited the gross");
  assertMoney(want2.fee, (want2.paid * feeBps) / 10_000n, "fee is 0.5% of the gross");
  assertEq(want2.merchantAmount + want2.fee, want2.paid, "merchant + treasury == gross");

  const withdrawn = eventsFrom(claim1Receipt, iface, "FundsWithdrawn");
  assertEq(withdrawn.length, 1, "FundsWithdrawn emitted");
  assertMoney(withdrawn[0].args.amount, want2.merchantAmount, "FundsWithdrawn amount is the net figure");
  const feeEvents = eventsFrom(claim1Receipt, iface, "ProtocolFeeCollected");
  assertEq(feeEvents.length, 1, "ProtocolFeeCollected emitted");
  assertMoney(feeEvents[0].args.feeAmount, want2.fee, "ProtocolFeeCollected amount");

  const sub2 = await registry.getSubscription(subId);
  assertMoney(sub2.settledAmount, want2.paid, "settledAmount is cumulative gross");
  assertMoney(sub2.settledFees, want2.fee, "settledFees is cumulative fee");
  assertMoney(
    (await registry.spendCaps(subscriber.address, merchant.address)).spentInWindow,
    want2.paid,
    "cap window consumed by the gross, not the net"
  );

  // =======================================================================
  // 2b. the same claim with no ERC-20 allowance - this is the shape a
  //     subscription created from the v2 dashboard is left in.
  // =======================================================================
  console.log("\n2b. claim with no allowance (the state the v2 create flow leaves behind)");

  await (await token.mint(noAllowance.address, MINT)).wait();
  await (await token.connect(noAllowance).approve(registryAddr, 0)).wait();
  const naReceipt = await (await registry
    .connect(noAllowance)
    .createSubscription(merchant.address, tokenAddr, AMOUNT_PER_PERIOD, PERIOD_SECONDS, 0, 0)).wait();
  const naSubId: string = eventsFrom(naReceipt, iface, "SubscriptionCreated")[0].args.subId;

  assertTrue(
    (await registry.getSubscription(naSubId)).active,
    "a subscription opens fine without an allowance - nothing warns the subscriber"
  );
  await setNextTs((await latestTs()) + 60n, true);
  assertTrue((await registry.previewOwed(naSubId)) > 0n, "it accrues normally", usd(await registry.previewOwed(naSubId)));
  await assertReverts(
    registry.connect(merchant), "claimStream", [naSubId],
    "reverted",
    "the merchant's first claim reverts - funds can never move"
  );
  await (await registry.connect(noAllowance).terminateStream(naSubId)).wait();

  // =======================================================================
  // 3. a claim larger than the cap - CLAMPED, not reverted
  // =======================================================================
  console.log("\n3. claim over the cap -> clamped, not reverted");

  const preSub3 = toSubState(await registry.getSubscription(subId));
  const preCap3 = toCapState(await registry.spendCaps(subscriber.address, merchant.address));
  const claim2Ts = await setNextTs(t0 + T_CLAIM_2);
  const want3 = expectSettlement(preSub3, preCap3, feeBps, claim2Ts);

  const remainingBefore3 = await registry.remainingAllowance(subscriber.address, merchant.address);
  assertTrue(want3.owed > remainingBefore3, "owed exceeds the remaining allowance", `${usd(want3.owed)} > ${usd(remainingBefore3)}`);
  assertTrue(want3.clamped, "settlement will be clamped");

  const mBefore3 = await token.balanceOf(merchant.address);
  const tBefore3 = await token.balanceOf(treasury);

  const claim2Receipt = await (await registry.connect(merchant).claimStream(subId)).wait();
  assertEq(claim2Receipt!.status, 1, "the over-cap claim SUCCEEDED (not reverted)");

  const capReached = eventsFrom(claim2Receipt, iface, "SpendCapReached");
  assertEq(capReached.length, 1, "SpendCapReached emitted");
  assertMoney(capReached[0].args.requested, want3.owed, "SpendCapReached requested");
  assertMoney(capReached[0].args.paid, want3.paid, "SpendCapReached paid (the clamped figure)");
  assertMoney(want3.paid, remainingBefore3, "paid == exactly the remaining allowance");

  assertMoney(await token.balanceOf(merchant.address) - mBefore3, want3.merchantAmount, "merchant credited the clamped net");
  assertMoney(await token.balanceOf(treasury) - tBefore3, want3.fee, "treasury credited the fee on the clamped gross");
  assertMoney(await registry.remainingAllowance(subscriber.address, merchant.address), 0n, "allowance now exhausted");
  assertMoney(
    (await registry.spendCaps(subscriber.address, merchant.address)).spentInWindow,
    CAP_MAX,
    "cap window fully spent"
  );

  const shortfall = want3.owed - want3.paid;
  assertMoney(await registry.previewOwed(subId), shortfall, "the unpaid remainder stays owed, it is not forgiven");
  assertTrue((await registry.getSubscription(subId)).active, "the stream stays active after being clamped");

  // A follow-up claim against a spent cap is where it does revert - the
  // clamp only holds while some allowance is left.
  await assertReverts(
    registry.connect(merchant), "claimStream", [subId],
    "Nothing claimable",
    "a claim against a fully spent cap reverts"
  );

  // =======================================================================
  // 4. setMerchantPolicy(QIE_PASS) - unverified subscriber refused
  // =======================================================================
  console.log("\n4. setMerchantPolicy(QIE_PASS) -> unverified subscriber refused");

  const policyReceipt = await (await registry.connect(merchant).setMerchantPolicy(GATE.QIE_PASS, 0)).wait();
  const policyEvents = eventsFrom(policyReceipt, iface, "MerchantPolicySet");
  assertEq(policyEvents.length, 1, "MerchantPolicySet emitted");
  assertEq(policyEvents[0].args.gate, BigInt(GATE.QIE_PASS), "gate recorded as QIE_PASS");

  const [gate, minRep] = await registry.getMerchantGate(merchant.address);
  assertEq(gate, BigInt(GATE.QIE_PASS), "getMerchantGate reads back QIE_PASS");
  assertEq(minRep, 0n, "QIE_PASS carries no reputation threshold");

  assertEq(await qiePass.verifyIdentity(unverified.address), false, "the test subscriber holds no QIE Pass");
  assertEq(
    await registry.meetsMerchantPolicy(merchant.address, unverified.address),
    false,
    "meetsMerchantPolicy is false for them"
  );
  assertEq(
    await registry.meetsMerchantPolicy(merchant.address, merchant.address),
    true,
    "meetsMerchantPolicy is true for a pass holder"
  );

  await (await token.mint(unverified.address, MINT)).wait();
  await (await token.connect(unverified).approve(registryAddr, ethers.MaxUint256)).wait();

  // Count first: a terminated subscription stays in this index (it is only
  // spliced out on NFT transfer), so a previous run leaves entries behind and
  // the meaningful assertion is that the refused call adds none.
  const unverifiedBefore = (await registry.getSubscriberSubscriptions(unverified.address)).length;
  await assertReverts(
    registry.connect(unverified),
    "createSubscription",
    [merchant.address, tokenAddr, AMOUNT_PER_PERIOD, PERIOD_SECONDS, 0, 0],
    "Subscriber does not meet merchant policy",
    "createSubscription is refused for the unverified subscriber"
  );
  assertEq(
    (await registry.getSubscriberSubscriptions(unverified.address)).length,
    unverifiedBefore,
    "the refused call recorded no subscription"
  );

  // Granting the pass lets the same call through, so the refusal is the gate
  // and not some unrelated failure.
  await (await qiePass.connect(owner).registerIdentity(unverified.address, true)).wait();
  const allowedReceipt = await (await registry
    .connect(unverified)
    .createSubscription(merchant.address, tokenAddr, AMOUNT_PER_PERIOD, PERIOD_SECONDS, 0, 0)).wait();
  assertEq(allowedReceipt!.status, 1, "the same call succeeds once the pass is granted");
  const allowedSubId: string = eventsFrom(allowedReceipt, iface, "SubscriptionCreated")[0].args.subId;
  await (await registry.connect(unverified).terminateStream(allowedSubId)).wait();
  await (await qiePass.connect(owner).registerIdentity(unverified.address, false)).wait();

  // =======================================================================
  // 5. terminateStream - settles the tail and deactivates
  // =======================================================================
  console.log("\n5. terminateStream -> settles and deactivates");

  // Raise the ceiling so the closing settlement can actually move money. The
  // period is unchanged, so windowStart and spentInWindow must survive.
  const capBeforeRaise = toCapState(await registry.spendCaps(subscriber.address, merchant.address));
  await (await registry.connect(subscriber).setSpendCap(merchant.address, CAP_MAX_RAISED, CAP_PERIOD)).wait();
  const capAfterRaise = toCapState(await registry.spendCaps(subscriber.address, merchant.address));
  assertEq(capAfterRaise.windowStart, capBeforeRaise.windowStart, "raising the cap keeps the window anchored");
  assertMoney(capAfterRaise.spentInWindow, capBeforeRaise.spentInWindow, "raising the cap does not refund the window");

  const preSub5 = toSubState(await registry.getSubscription(subId));
  const preCap5 = toCapState(await registry.spendCaps(subscriber.address, merchant.address));
  const termTs = await setNextTs(t0 + T_TERMINATE);
  const want5 = expectSettlement(preSub5, preCap5, feeBps, termTs);
  assertTrue(want5.paid > 0n, "there is a tail to settle", usd(want5.paid));
  assertTrue(!want5.clamped, "the raised cap covers it");

  const mBefore5 = await token.balanceOf(merchant.address);
  const tBefore5 = await token.balanceOf(treasury);

  const termReceipt = await (await registry.connect(subscriber).terminateStream(subId)).wait();
  assertEq(termReceipt!.status, 1, "terminateStream succeeded");

  assertMoney(await token.balanceOf(merchant.address) - mBefore5, want5.merchantAmount, "merchant received the closing net");
  assertMoney(await token.balanceOf(treasury) - tBefore5, want5.fee, "treasury received the closing fee");

  const termWithdrawn = eventsFrom(termReceipt, iface, "FundsWithdrawn");
  assertEq(termWithdrawn.length, 1, "termination settled (FundsWithdrawn emitted)");
  assertEq(eventsFrom(termReceipt, iface, "StreamTerminatedUnsettled").length, 0, "nothing left unsettled");
  assertEq(eventsFrom(termReceipt, iface, "StreamTerminated").length, 1, "StreamTerminated emitted");

  const sub5 = await registry.getSubscription(subId);
  assertEq(sub5.active, false, "subscription deactivated");
  assertMoney(await registry.previewOwed(subId), 0n, "nothing owed after termination");
  assertMoney(
    sub5.settledAmount,
    (( termTs - t0) * AMOUNT_PER_PERIOD) / PERIOD_SECONDS,
    "settled the whole billable life of the stream"
  );
  assertMoney(sub5.settledFees, (sub5.settledAmount * feeBps) / 10_000n, "cumulative fee is 0.5% of everything settled");

  await assertReverts(
    registry.connect(merchant), "claimStream", [subId],
    "Subscription is not active",
    "a claim after termination reverts"
  );
  await assertReverts(
    registry.connect(subscriber), "terminateStream", [subId],
    "Stream already inactive",
    "terminating twice reverts"
  );

  // -----------------------------------------------------------------------
  console.log("\n----------------------------------------------------------------");
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\n" + (e?.stack || e?.message || e));
  process.exitCode = 1;
});
