// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * FluenciRegistry v4
 *
 * Changes from v3, all driven by the v2 product spec (see ROADMAP.md):
 *
 *  1. Period-based pricing. v3 stored an integer `ratePerSecond`, which cannot
 *     represent consumer prices in 6-decimal qUSDC: $20/month truncated to
 *     $18.14 and $1/month rounded to zero and reverted. v4 stores
 *     `amountPerPeriod` + `periodSeconds` and settles against cumulative
 *     billed seconds, so "$20/month" is exact regardless of claim frequency.
 *
 *  2. Merchant-configurable access. v3 required a verified QIE Pass from every
 *     subscriber before a stream could exist. v4 lets each merchant choose:
 *     OPEN / QIE_ID / QIE_PASS / MIN_REPUTATION. Unconfigured merchants are OPEN.
 *
 *  3. Programmable spending limits. A subscriber caps what a given merchant may
 *     pull per window (e.g. $20/month). Claims above the cap are clamped, not
 *     reverted: the merchant receives what it is owed up to the cap and the
 *     remainder stays accrued. Only the subscriber can raise a cap.
 *
 * Preserved from v3: subscription NFTs, AI safety pause, dispute arbitration,
 * the protocol fee split, and auto-settlement on terminate.
 */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IFluenciAIAuditor {
    function trustedAiWorker() external view returns (address);
}

/* --- QIE ecosystem adapters -------------------------------------------------
 * Each identity source sits behind its own interface so the registry can ship
 * before every QIE contract address is known. An unset adapter makes its gate
 * revert rather than silently pass.
 */
interface IQiePass {
    function verifyIdentity(address user) external view returns (bool);
}

interface IQieIdentity {
    function hasIdentity(address user) external view returns (bool);
}

interface IQieReputation {
    function getScore(address user) external view returns (uint256);
}

contract FluenciRegistryV4 {
    // --- ERC-721 state & events ---
    string public constant name = "Fluenci Subscription NFT";
    string public constant symbol = "FLUENCI";

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // --- Protocol config ---
    address public owner;
    address public qiePass;
    address public qieIdentity;
    address public qieReputation;
    address public aiAuditor;
    address public treasury;

    uint256 public protocolFeeBps = 50; // 0.5%, hard-capped at 5%
    bool public requireMerchantKyc = true; // progressive KYC: verify to withdraw

    enum DisputeState { NONE, OPEN, RESOLVED }

    /// Who a merchant will accept subscriptions from.
    enum Gate { OPEN, QIE_ID, QIE_PASS, MIN_REPUTATION }

    struct MerchantPolicy {
        Gate gate;
        uint256 minReputation; // only meaningful when gate == MIN_REPUTATION
        bool configured;
    }

    mapping(address => MerchantPolicy) public merchantPolicies;

    /*
     * Accrual model.
     *
     * `billedSeconds` accumulates only while a stream is active, unpaused and
     * undisputed. Everything owed is derived from that single cumulative
     * figure rather than from per-claim deltas, so a merchant claiming once a
     * month and one claiming every second are paid identically. Truncation is
     * bounded at one token unit over the lifetime of the stream instead of
     * compounding on every claim.
     */
    struct Subscription {
        address subscriber;
        address merchant;
        address tokenAddress;
        uint256 amountPerPeriod;      // e.g. 20_000000 for $20 in 6-decimal qUSDC
        uint256 periodSeconds;        // e.g. 2_592_000 for 30 days
        uint256 billedSeconds;        // cumulative billable seconds
        uint256 settledAmount;        // cumulative amount already transferred
        uint256 settledFees;          // cumulative protocol fee already taken
        uint256 feeDust;              // sub-basis-point remainder carried between claims
        uint256 lastTickTimestamp;    // last time billedSeconds was brought current
        uint256 startTime;
        uint256 cliffTime;            // payouts blocked until this time (accrual continues)
        uint256 stopTime;             // 0 = open-ended
        bool active;
        bool pausedByAI;
        DisputeState dispute;
    }

    /*
     * Spending cap, scoped to a (subscriber, merchant) pair rather than to a
     * single subscription — otherwise a merchant could open three streams and
     * draw the cap three times over. Windows are fixed rather than rolling: a
     * sliding window needs per-claim history that is expensive on-chain, and
     * "resets on the 1st" is easier to explain to a user than a decaying total.
     */
    struct SpendCap {
        uint256 maxAmount;
        uint256 periodSeconds;
        uint256 windowStart;
        uint256 spentInWindow;
        bool set;
    }

    mapping(bytes32 => Subscription) internal subscriptions;
    mapping(address => bytes32[]) private subscriberSubscriptions;
    mapping(address => bytes32[]) private merchantSubscriptions;
    mapping(address => mapping(address => SpendCap)) public spendCaps; // subscriber => merchant => cap

    /*
     * Receiving a subscription NFT makes you the PAYER: billing follows ownership,
     * and _settle pulls from whoever holds the token at settle time. Without consent
     * an attacker could mint a punitive stream to their own merchant and push it onto
     * any wallet holding a standing allowance, drained uncapped because an unset cap
     * reads as unlimited. Receipt is therefore opt-in.
     */
    /*
     * Transfers are PULL, not push. transferFrom only nominates a recipient;
     * the payer does not change until that recipient calls acceptSubscription.
     *
     * A global "I accept transfers" flag was not enough: an attacker contract
     * could mint a punitive stream and push it in the SAME transaction, so
     * _tick had credited no time yet, the arrears check passed for free, and
     * the merchant-policy re-check asked the attacker's own merchant for
     * permission. Requiring a second transaction from the recipient removes
     * atomicity, which is what made that attack free.
     */
    mapping(bytes32 => address) public pendingTransferTo;

    event SubscriptionCreated(
        bytes32 indexed subId,
        address indexed subscriber,
        address indexed merchant,
        address tokenAddress,
        uint256 amountPerPeriod,
        uint256 periodSeconds,
        uint256 cliffTime,
        uint256 stopTime
    );
    event StreamPaused(bytes32 indexed subId, string reason);
    event StreamResumed(bytes32 indexed subId);
    event StreamTerminated(bytes32 indexed subId);
    event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount);
    event ProtocolFeeCollected(bytes32 indexed subId, address indexed treasury, uint256 feeAmount);
    event DisputeOpened(bytes32 indexed subId, address indexed subscriber);
    event DisputeResolved(bytes32 indexed subId, uint256 subscriberRefund, uint256 merchantShare);
    event MerchantPolicySet(address indexed merchant, Gate gate, uint256 minReputation);
    event SpendCapSet(address indexed subscriber, address indexed merchant, uint256 maxAmount, uint256 periodSeconds);
    event SpendCapReached(bytes32 indexed subId, address indexed merchant, uint256 requested, uint256 paid);
    event TransferOffered(bytes32 indexed subId, address indexed from, address indexed to);
    event TransferOfferCancelled(bytes32 indexed subId);
    event StreamTerminatedUnsettled(bytes32 indexed subId, uint256 outstanding);

    uint256 public constant MIN_PERIOD = 60;             // one minute
    uint256 public constant MAX_PERIOD = 3650 days;      // ten years

    uint256 private _reentrancyGuard = 1;

    modifier nonReentrant() {
        require(_reentrancyGuard == 1, "Reentrant call");
        _reentrancyGuard = 2;
        _;
        _reentrancyGuard = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlySubscriber(bytes32 subId) {
        require(subscriptions[subId].subscriber == msg.sender, "Only subscriber");
        _;
    }

    constructor(address _qiePass, address _treasury) {
        require(_treasury != address(0), "Invalid treasury");
        owner = msg.sender;
        qiePass = _qiePass;
        treasury = _treasury;
    }

    // --- Admin ---

    address public pendingOwner;

    function transferOwnership(address newOwner) external onlyOwner { pendingOwner = newOwner; }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Only pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setAIAuditor(address _aiAuditor) external onlyOwner { aiAuditor = _aiAuditor; }
    function setQiePass(address _qiePass) external onlyOwner { qiePass = _qiePass; }
    function setQieIdentity(address _qieIdentity) external onlyOwner { qieIdentity = _qieIdentity; }
    function setQieReputation(address _qieReputation) external onlyOwner { qieReputation = _qieReputation; }
    function setRequireMerchantKyc(bool _required) external onlyOwner { requireMerchantKyc = _required; }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function setProtocolFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "Fee cannot exceed 5%");
        protocolFeeBps = _feeBps;
    }

    // --- Merchant access policy ---

    /// @notice Merchants choose who may subscribe to them. Unconfigured merchants are OPEN.
    function setMerchantPolicy(Gate gate, uint256 minReputation) external {
        if (gate == Gate.MIN_REPUTATION) {
            require(minReputation > 0, "Minimum reputation must be greater than zero");
        }
        merchantPolicies[msg.sender] = MerchantPolicy({
            gate: gate,
            minReputation: gate == Gate.MIN_REPUTATION ? minReputation : 0,
            configured: true
        });
        emit MerchantPolicySet(msg.sender, gate, minReputation);
    }

    function getMerchantGate(address merchant) public view returns (Gate gate, uint256 minReputation) {
        MerchantPolicy memory p = merchantPolicies[merchant];
        if (!p.configured) return (Gate.OPEN, 0);
        return (p.gate, p.minReputation);
    }

    /// @notice Whether `subscriber` currently satisfies `merchant`'s access policy.
    function meetsMerchantPolicy(address merchant, address subscriber) public view returns (bool) {
        (Gate gate, uint256 minRep) = getMerchantGate(merchant);
        if (gate == Gate.OPEN) return true;
        if (gate == Gate.QIE_PASS) {
            if (qiePass == address(0)) return false;
            return _hasQiePass(subscriber);
        }
        if (gate == Gate.QIE_ID) {
            if (qieIdentity == address(0)) return false;
            return _hasQieId(subscriber);
        }
        if (qieReputation == address(0)) return false;
        return _reputationOf(subscriber) >= minRep;
    }

    function _enforceMerchantPolicy(address merchant, address subscriber) internal view {
        (Gate gate, ) = getMerchantGate(merchant);
        if (gate == Gate.OPEN) return;
        if (gate == Gate.QIE_PASS) {
            require(qiePass != address(0), "QIE Pass adapter not configured");
        } else if (gate == Gate.QIE_ID) {
            require(qieIdentity != address(0), "QIE ID adapter not configured");
        } else {
            require(qieReputation != address(0), "Reputation adapter not configured");
        }
        require(meetsMerchantPolicy(merchant, subscriber), "Subscriber does not meet merchant policy");
    }

    // External identity reads are wrapped so a reverting or self-destructed
    // adapter fails the gate instead of bricking every subscription.
    function _hasQiePass(address user) internal view returns (bool) {
        try IQiePass(qiePass).verifyIdentity(user) returns (bool ok) { return ok; } catch { return false; }
    }

    function _hasQieId(address user) internal view returns (bool) {
        try IQieIdentity(qieIdentity).hasIdentity(user) returns (bool ok) { return ok; } catch { return false; }
    }

    function _reputationOf(address user) internal view returns (uint256) {
        try IQieReputation(qieReputation).getScore(user) returns (uint256 score) { return score; } catch { return 0; }
    }

    // --- Spending caps ---

    /// @notice Cap what `merchant` may draw from the caller per window. Only the
    ///         subscriber can call this, so any increase is subscriber-approved.
    /// @param maxAmount     token units per window; 0 blocks the merchant entirely
    /// @param periodSeconds window length, e.g. 2_592_000 for 30 days
    function setSpendCap(address merchant, uint256 maxAmount, uint256 periodSeconds) external {
        require(merchant != address(0), "Invalid merchant");
        require(periodSeconds >= MIN_PERIOD && periodSeconds <= MAX_PERIOD, "Cap period out of range");

        SpendCap storage cap = spendCaps[msg.sender][merchant];
        // Re-anchor when the period changes; leaving a stale windowStart would
        // retro-roll the window and hand back a full allowance immediately.
        if (!cap.set || periodSeconds != cap.periodSeconds) {
            cap.windowStart = block.timestamp;
            cap.spentInWindow = 0;
            cap.set = true;
        }
        cap.maxAmount = maxAmount;
        cap.periodSeconds = periodSeconds;
        emit SpendCapSet(msg.sender, merchant, maxAmount, periodSeconds);
    }

    /// @notice Remove the cap on `merchant`, restoring uncapped draw.
    function clearSpendCap(address merchant) external {
        delete spendCaps[msg.sender][merchant];
        emit SpendCapSet(msg.sender, merchant, 0, 0);
    }

    /// @notice Remaining amount `merchant` may draw from `subscriber` this window.
    function remainingAllowance(address subscriber, address merchant) public view returns (uint256) {
        SpendCap memory cap = spendCaps[subscriber][merchant];
        if (!cap.set) return type(uint256).max;
        uint256 spent = cap.spentInWindow;
        if (block.timestamp - cap.windowStart >= cap.periodSeconds) spent = 0;
        return cap.maxAmount > spent ? cap.maxAmount - spent : 0;
    }

    // --- Subscriptions ---

    /**
     * @notice Open a subscription and mint its NFT.
     * @param amountPerPeriod token units charged per period, e.g. 20_000000 = $20 qUSDC
     * @param periodSeconds   length of one billing period, e.g. 2_592_000 = 30 days
     */
    function createSubscription(
        address merchant,
        address tokenAddress,
        uint256 amountPerPeriod,
        uint256 periodSeconds,
        uint256 cliffTime,
        uint256 stopTime
    ) external returns (bytes32 subId) {
        require(merchant != address(0), "Invalid merchant address");
        require(tokenAddress != address(0), "Invalid token address");
        require(amountPerPeriod > 0, "Amount must be greater than zero");
        require(amountPerPeriod <= 1e30, "Amount too large");
        require(periodSeconds >= MIN_PERIOD && periodSeconds <= MAX_PERIOD, "Period out of range");
        if (cliffTime > 0) {
            require(cliffTime >= block.timestamp, "Cliff time cannot be in the past");
            require(cliffTime <= block.timestamp + MAX_PERIOD, "Cliff time too far out");
        }
        if (stopTime > 0) {
            require(stopTime > block.timestamp, "Stop time must be in the future");
            if (cliffTime > 0) require(cliffTime < stopTime, "Cliff time must be before stop time");
        }

        _enforceMerchantPolicy(merchant, msg.sender);

        subId = keccak256(abi.encodePacked(msg.sender, merchant, block.timestamp, subscriberSubscriptions[msg.sender].length));
        require(subscriptions[subId].subscriber == address(0), "Subscription already exists");

        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            merchant: merchant,
            tokenAddress: tokenAddress,
            amountPerPeriod: amountPerPeriod,
            periodSeconds: periodSeconds,
            billedSeconds: 0,
            settledAmount: 0,
            settledFees: 0,
            feeDust: 0,
            lastTickTimestamp: block.timestamp,
            startTime: block.timestamp,
            cliffTime: cliffTime,
            stopTime: stopTime,
            active: true,
            pausedByAI: false,
            dispute: DisputeState.NONE
        });

        subscriberSubscriptions[msg.sender].push(subId);
        merchantSubscriptions[merchant].push(subId);

        emit Transfer(address(0), msg.sender, uint256(subId));
        emit SubscriptionCreated(subId, msg.sender, merchant, tokenAddress, amountPerPeriod, periodSeconds, cliffTime, stopTime);
    }

    // --- Accrual ---

    /// Conditions under which funds may actually move for this subscription.
    /// A RESOLVED dispute is settleable again; only an OPEN one blocks payout.
    function _canPayout(Subscription storage sub) internal view returns (bool) {
        if (sub.pausedByAI) return false;
        if (sub.dispute == DisputeState.OPEN) return false;
        if (sub.cliffTime > 0 && block.timestamp < sub.cliffTime) return false;
        if (requireMerchantKyc && (qiePass == address(0) || !_hasQiePass(sub.merchant))) return false;
        return true;
    }

    function _billableEnd(Subscription storage sub) internal view returns (uint256) {
        if (sub.stopTime > 0 && block.timestamp > sub.stopTime) return sub.stopTime;
        return block.timestamp;
    }

    /// Bring `billedSeconds` current. Paused, disputed and inactive time is skipped
    /// by advancing the tick without crediting the interval.
    function _tick(Subscription storage sub) internal {
        uint256 end = _billableEnd(sub);
        if (end <= sub.lastTickTimestamp) return;
        if (sub.active && !sub.pausedByAI && sub.dispute != DisputeState.OPEN) {
            sub.billedSeconds += end - sub.lastTickTimestamp;
        }
        sub.lastTickTimestamp = end;
    }

    function _owed(Subscription storage sub) internal view returns (uint256) {
        uint256 accrued = (sub.billedSeconds * sub.amountPerPeriod) / sub.periodSeconds;
        if (accrued <= sub.settledAmount) return 0;
        return accrued - sub.settledAmount;
    }

    /// @notice Amount currently claimable, before any spending cap is applied.
    function previewOwed(bytes32 subId) public view returns (uint256) {
        Subscription memory sub = subscriptions[subId];
        if (sub.subscriber == address(0)) return 0;
        if (sub.cliffTime > 0 && block.timestamp < sub.cliffTime) return 0;

        uint256 end = block.timestamp;
        if (sub.stopTime > 0 && end > sub.stopTime) end = sub.stopTime;

        uint256 billed = sub.billedSeconds;
        if (sub.active && !sub.pausedByAI && sub.dispute != DisputeState.OPEN && end > sub.lastTickTimestamp) {
            billed += end - sub.lastTickTimestamp;
        }

        uint256 accrued = (billed * sub.amountPerPeriod) / sub.periodSeconds;
        if (accrued <= sub.settledAmount) return 0;
        return accrued - sub.settledAmount;
    }

    /**
     * Settles up to `owed`, clamped by the subscriber's cap for this merchant.
     * State is written before any token transfer.
     */
    function _settle(bytes32 subId, Subscription storage sub) internal returns (uint256 paid) {
        uint256 owedAmount = _owed(sub);
        if (owedAmount == 0) return 0;

        paid = owedAmount;

        SpendCap storage cap = spendCaps[sub.subscriber][sub.merchant];
        if (cap.set) {
            if (block.timestamp - cap.windowStart >= cap.periodSeconds) {
                uint256 windowsElapsed = (block.timestamp - cap.windowStart) / cap.periodSeconds;
                cap.windowStart += windowsElapsed * cap.periodSeconds;
                cap.spentInWindow = 0;
            }
            uint256 remaining = cap.maxAmount > cap.spentInWindow ? cap.maxAmount - cap.spentInWindow : 0;
            if (paid > remaining) {
                emit SpendCapReached(subId, sub.merchant, paid, remaining);
                paid = remaining;
            }
            if (paid == 0) return 0;
            cap.spentInWindow += paid;
        }

        // Effects before interactions.
        sub.settledAmount += paid;

        // Charge on THIS slice, never recomputed over lifetime history: deriving
        // the fee from cumulative settledAmount at the CURRENT rate meant a later
        // setProtocolFeeBps retroactively re-priced everything already settled,
        // which could exceed the current payout and underflow `paid - fee`.
        // feeDust carries the truncated remainder forward, so slicing claims into
        // small pieces still cannot round the fee away to nothing.
        uint256 fee = 0;
        if (treasury != address(0) && protocolFeeBps > 0) {
            uint256 gross = paid * protocolFeeBps + sub.feeDust;
            fee = gross / 10000;
            sub.feeDust = gross % 10000;
            if (fee > paid) fee = paid;   // belt and braces: a fee can never exceed its payout
            sub.settledFees += fee;
        }
        uint256 merchantAmount = paid - fee;

        if (merchantAmount > 0) {
            require(
                IERC20(sub.tokenAddress).transferFrom(sub.subscriber, sub.merchant, merchantAmount),
                "Merchant transfer failed"
            );
            emit FundsWithdrawn(subId, sub.merchant, merchantAmount);
        }

        if (fee > 0) {
            require(
                IERC20(sub.tokenAddress).transferFrom(sub.subscriber, treasury, fee),
                "Fee transfer failed"
            );
            emit ProtocolFeeCollected(subId, treasury, fee);
        }
    }

    /// @notice Merchant withdraws what has accrued, subject to the subscriber's cap.
    function claimStream(bytes32 subId) external nonReentrant {
        Subscription storage sub = subscriptions[subId];
        require(msg.sender == sub.merchant, "Only merchant can claim");
        if (requireMerchantKyc) {
            require(qiePass != address(0), "QIE Pass adapter not configured");
            require(_hasQiePass(msg.sender), "Merchant must hold verified QIE Pass to withdraw");
        }
        require(sub.active, "Subscription is not active");
        require(sub.dispute != DisputeState.OPEN, "Stream is currently disputed");
        require(!sub.pausedByAI, "Stream paused by AI due to anomaly");
        if (sub.cliffTime > 0) {
            require(block.timestamp >= sub.cliffTime, "Vesting cliff not reached yet");
        }

        _tick(sub);
        uint256 paid = _settle(subId, sub);
        require(paid > 0, "Nothing claimable (or spending cap reached)");

        if (sub.stopTime > 0 && block.timestamp >= sub.stopTime && _owed(sub) == 0) {
            sub.active = false;
            emit Transfer(sub.subscriber, address(0), uint256(subId));
            emit StreamTerminated(subId);
        }
    }

    // --- Lifecycle ---

    function pauseStreamByAI(bytes32 subId, string calldata reason) external {
        require(msg.sender == aiAuditor, "Only AI Auditor");
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream not active");
        require(!sub.pausedByAI, "Already paused");

        _tick(sub); // credit time up to the pause, then stop the clock
        sub.pausedByAI = true;
        emit StreamPaused(subId, reason);
    }

    function resumeStream(bytes32 subId) external onlySubscriber(subId) {
        Subscription storage sub = subscriptions[subId];
        require(sub.pausedByAI, "Stream not paused by AI");
        require(sub.dispute != DisputeState.OPEN, "Cannot resume during active dispute");
        _enforceMerchantPolicy(sub.merchant, msg.sender);

        sub.lastTickTimestamp = block.timestamp; // paused interval is never billed
        sub.pausedByAI = false;
        emit StreamResumed(subId);
    }

    /// @notice Subscriber ends the stream, auto-settling whatever has accrued.
    ///         Cancellation always succeeds: if settlement cannot complete, the
    ///         outstanding amount is reported rather than trapping the subscriber.
    function terminateStream(bytes32 subId) external onlySubscriber(subId) nonReentrant {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream already inactive");

        _tick(sub); // credit time up to now regardless, so accounting is correct

        // Freeze accrual first: from here nothing further is billed, whatever
        // happens to the settlement below.
        if (sub.stopTime == 0 || sub.stopTime > block.timestamp) {
            sub.stopTime = block.timestamp;
        }

        if (_canPayout(sub)) {
            try this.settleFor(subId) {
                // settled
            } catch {
                // token refused; arrears remain claimable below
            }
        }

        uint256 remaining = _owed(sub);
        if (remaining == 0) {
            sub.active = false;
            emit Transfer(sub.subscriber, address(0), uint256(subId));
            emit StreamTerminated(subId);
        } else {
            // Do NOT close the record while money is owed: claimStream requires an
            // active subscription, so deactivating here made the arrears permanently
            // uncollectable. Accrual is already frozen by stopTime, and claimStream
            // deactivates the stream itself once the balance reaches zero.
            emit StreamTerminatedUnsettled(subId, remaining);
        }
    }

    /// @dev External only so terminateStream can call it inside try/catch. Self-call guarded.
    function settleFor(bytes32 subId) external {
        require(msg.sender == address(this), "Internal only");
        _settle(subId, subscriptions[subId]);
    }

    // --- Disputes ---

    function openDispute(bytes32 subId) external onlySubscriber(subId) {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream not active");
        require(sub.dispute == DisputeState.NONE, "Dispute already active or resolved");

        _tick(sub); // freeze accrual at the moment of dispute
        sub.dispute = DisputeState.OPEN;
        sub.pausedByAI = true;
        emit DisputeOpened(subId, msg.sender);
    }

    function resolveDispute(
        bytes32 subId,
        uint256 subscriberRefund,
        uint256 merchantShare,
        bytes calldata signature
    ) external nonReentrant {
        Subscription storage sub = subscriptions[subId];
        require(sub.dispute == DisputeState.OPEN, "No open dispute found");
        require(aiAuditor != address(0), "AI Auditor not configured");
        require(msg.sender == sub.subscriber || msg.sender == sub.merchant, "Not a party to this dispute");

        bytes32 messageHash = getMessageHash(subId, subscriberRefund, merchantShare);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        address signer = recoverSigner(ethSignedMessageHash, signature);
        require(signer != address(0), "Invalid signature");
        require(signer == IFluenciAIAuditor(aiAuditor).trustedAiWorker(), "Invalid AI Auditor signature");

        _tick(sub);
        uint256 outstanding = _owed(sub);
        require(merchantShare <= outstanding, "Merchant share exceeds outstanding balance");
        require(subscriberRefund + merchantShare == outstanding, "Split must account for the full balance");

        uint256 payable_ = merchantShare;
        if (payable_ > 0) {
            // Arbitration still draws against the subscriber's cap for this
            // merchant; not charging it here would let one window be drawn twice.
            SpendCap storage cap = spendCaps[sub.subscriber][sub.merchant];
            if (cap.set) {
                if (block.timestamp - cap.windowStart >= cap.periodSeconds) {
                    uint256 windowsElapsed = (block.timestamp - cap.windowStart) / cap.periodSeconds;
                    cap.windowStart += windowsElapsed * cap.periodSeconds;
                    cap.spentInWindow = 0;
                }
                uint256 remaining = cap.maxAmount > cap.spentInWindow ? cap.maxAmount - cap.spentInWindow : 0;
                if (payable_ > remaining) {
                    emit SpendCapReached(subId, sub.merchant, payable_, remaining);
                    payable_ = remaining;
                }
                cap.spentInWindow += payable_;
            }
        }

        // Dispose ONLY of what the arbitration actually resolved: the amount paid,
        // plus what the arbitrator explicitly refunded. The part of the award the
        // spend cap refused stays in arrears and is claimable once the window
        // rolls, exactly as _settle treats a clamped claim.
        //
        // Folding (merchantShare - payable_) in here made settledAmount += outstanding
        // unconditionally, which destroyed the clamped portion of the award for good —
        // and let a subscriber zero their own cap to void a ruling against them.
        sub.settledAmount += payable_ + subscriberRefund;

        if (payable_ > 0) {
            uint256 fee = 0;
            if (treasury != address(0) && protocolFeeBps > 0) {
                uint256 gross = payable_ * protocolFeeBps + sub.feeDust;
                fee = gross / 10000;
                sub.feeDust = gross % 10000;
                if (fee > payable_) fee = payable_;
                sub.settledFees += fee;
            }
            uint256 merchantAmount = payable_ - fee;
            if (merchantAmount > 0) {
                require(
                    IERC20(sub.tokenAddress).transferFrom(sub.subscriber, sub.merchant, merchantAmount),
                    "Dispute payout transfer failed"
                );
                emit FundsWithdrawn(subId, sub.merchant, merchantAmount);
            }
            if (fee > 0) {
                require(
                    IERC20(sub.tokenAddress).transferFrom(sub.subscriber, treasury, fee),
                    "Fee transfer failed"
                );
                emit ProtocolFeeCollected(subId, treasury, fee);
            }
        }

        sub.lastTickTimestamp = block.timestamp;
        sub.dispute = DisputeState.RESOLVED;
        sub.pausedByAI = false;

        emit DisputeResolved(subId, subscriberRefund, merchantShare);
    }

    // --- ERC-721 ---

    function balanceOf(address ownerAddress) external view returns (uint256) {
        require(ownerAddress != address(0), "Zero address query");
        uint256 count = 0;
        bytes32[] memory list = subscriberSubscriptions[ownerAddress];
        for (uint256 i = 0; i < list.length; i++) {
            if (subscriptions[list[i]].active && subscriptions[list[i]].subscriber == ownerAddress) count++;
        }
        return count;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address subscriber = subscriptions[bytes32(tokenId)].subscriber;
        require(subscriber != address(0), "Nonexistent NFT");
        return subscriber;
    }

    /**
     * @notice Nominate `to` as the next payer of this subscription. Ownership and
     *         the payment obligation do NOT move until `to` calls
     *         acceptSubscription(subId) in a separate transaction.
     */
    function transferFrom(address from, address to, uint256 tokenId) public nonReentrant {
        bytes32 subId = bytes32(tokenId);
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream is not active");
        require(sub.subscriber == from, "Transfer of token that is not owned");
        require(to != address(0), "Transfer to zero address");
        require(to != from, "Already the owner");
        require(
            msg.sender == from || _tokenApprovals[tokenId] == msg.sender || _operatorApprovals[from][msg.sender],
            "Caller is not owner nor approved"
        );

        // The outgoing owner must leave nothing owed behind.
        _tick(sub);
        if (_canPayout(sub)) {
            _settle(subId, sub);
        }
        require(_owed(sub) == 0, "Settle arrears before transferring");

        pendingTransferTo[subId] = to;
        emit TransferOffered(subId, from, to);
    }

    /**
     * @notice Accept a nominated subscription and become its payer.
     * @dev Deliberately a separate transaction from transferFrom, so consent can
     *      never be obtained inside the attacker's own call frame. The caller
     *      must already have a spending cap set for this merchant: receiving a
     *      stream must never grant an uncapped draw on the new payer's wallet.
     */
    function acceptSubscription(bytes32 subId) external nonReentrant {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream is not active");
        require(pendingTransferTo[subId] == msg.sender, "Not nominated for this subscription");
        require(spendCaps[msg.sender][sub.merchant].set, "Set a spending limit for this merchant first");
        _enforceMerchantPolicy(sub.merchant, msg.sender);

        // Settle the outgoing payer once more: time has passed since nomination.
        address from = sub.subscriber;
        _tick(sub);
        if (_canPayout(sub)) {
            _settle(subId, sub);
        }
        require(_owed(sub) == 0, "Outgoing payer still owes on this subscription");

        delete pendingTransferTo[subId];
        delete _tokenApprovals[uint256(subId)];
        _removeSubscriberSubId(from, subId);
        subscriberSubscriptions[msg.sender].push(subId);
        sub.subscriber = msg.sender;

        emit Transfer(from, msg.sender, uint256(subId));
    }

    /// @notice Withdraw a nomination. Either party may cancel it.
    function cancelTransferOffer(bytes32 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(msg.sender == sub.subscriber || msg.sender == pendingTransferTo[subId], "Not a party to this offer");
        delete pendingTransferTo[subId];
        emit TransferOfferCancelled(subId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external {
        transferFrom(from, to, tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        address subscriber = ownerOf(tokenId);
        require(
            msg.sender == subscriber || _operatorApprovals[subscriber][msg.sender],
            "Approve caller is not owner nor approved for all"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(subscriber, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address ownerAddress, address operator) external view returns (bool) {
        return _operatorApprovals[ownerAddress][operator];
    }

    // --- Views ---

    function _removeSubscriberSubId(address subscriber, bytes32 subId) internal {
        bytes32[] storage list = subscriberSubscriptions[subscriber];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == subId) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
    }

    function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[] memory) {
        return subscriberSubscriptions[subscriber];
    }

    function getMerchantSubscriptions(address merchant) external view returns (bytes32[] memory) {
        return merchantSubscriptions[merchant];
    }

    /// @notice Raw subscription record.
    function getSubscription(bytes32 subId) external view returns (Subscription memory) {
        return subscriptions[subId];
    }

    /// @notice Full subscription record plus the amount currently claimable.
    /// Returned as a struct rather than a long tuple: v3's 13-value signature
    /// exceeded the EVM stack limit once the period fields were added.
    function getSubscriptionDetails(bytes32 subId)
        external
        view
        returns (Subscription memory sub, uint256 claimableAmount)
    {
        return (subscriptions[subId], previewOwed(subId));
    }

    // --- Signature helpers ---

    function getMessageHash(bytes32 subId, uint256 subscriberRefund, uint256 merchantShare) public view returns (bytes32) {
        return keccak256(abi.encodePacked(subId, subscriberRefund, merchantShare, address(this)));
    }

    function getEthSignedMessageHash(bytes32 messageHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
    }

    function recoverSigner(bytes32 hash, bytes memory signature) public pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);

        // Reject the malleable upper-range s value.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);

        return ecrecover(hash, v, r, s);
    }
}
