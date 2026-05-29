// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IQiePass {
    function verifyIdentity(address user) external view returns (bool);
}

contract QieFlowRegistry {
    address public owner;
    address public qiePass;
    address public qieStableCoin;
    address public aiAuditor;

    struct Subscription {
        address subscriber;
        address merchant;
        uint256 ratePerSecond;        // Tokens scaled by 1e6 per second
        uint256 lastClaimedTimestamp;
        uint256 startTime;
        bool active;
        bool pausedByAI;
    }

    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => bytes32[]) private subscriberSubscriptions;
    mapping(address => bytes32[]) private merchantSubscriptions;

    event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, uint256 ratePerSecond);
    event StreamPaused(bytes32 indexed subId, string reason);
    event StreamResumed(bytes32 indexed subId);
    event StreamTerminated(bytes32 indexed subId);
    event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlySubscriber(bytes32 subId) {
        require(subscriptions[subId].subscriber == msg.sender, "Only subscriber");
        _;
    }

    modifier onlyAuditor() {
        require(msg.sender == aiAuditor, "Only AI Auditor");
        _;
    }

    constructor(address _qiePass, address _qieStableCoin) {
        owner = msg.sender;
        qiePass = _qiePass;
        qieStableCoin = _qieStableCoin;
    }

    function setAIAuditor(address _aiAuditor) external onlyOwner {
        aiAuditor = _aiAuditor;
    }

    /**
     * @notice Create a subscription stream. Requires subscriber to have a verified QIE Pass.
     */
    function createSubscription(
        address merchant,
        uint256 ratePerSecond
    ) external returns (bytes32 subId) {
        // Gated by QIE Pass (Bonus points indicator)
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Subscriber must have a verified QIE Pass");
        require(merchant != address(0), "Invalid merchant address");
        require(ratePerSecond > 0, "Rate must be greater than zero");

        subId = keccak256(abi.encodePacked(msg.sender, merchant, block.timestamp, subscriberSubscriptions[msg.sender].length));
        
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            merchant: merchant,
            ratePerSecond: ratePerSecond,
            lastClaimedTimestamp: block.timestamp,
            startTime: block.timestamp,
            active: true,
            pausedByAI: false
        });

        subscriberSubscriptions[msg.sender].push(subId);
        merchantSubscriptions[merchant].push(subId);

        emit SubscriptionCreated(subId, msg.sender, merchant, ratePerSecond);
    }

    /**
     * @notice Merchant claims accumulated subscription streams.
     */
    function claimStream(bytes32 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Subscription is not active");
        require(!sub.pausedByAI, "Stream is paused by AI Auditor due to anomaly");

        uint256 claimableDuration = block.timestamp - sub.lastClaimedTimestamp;
        require(claimableDuration > 0, "Nothing to claim yet");

        uint256 claimableAmount = claimableDuration * sub.ratePerSecond;
        sub.lastClaimedTimestamp = block.timestamp;

        // Perform settlement in stablecoin (qUSD)
        require(
            IERC20(qieStableCoin).transferFrom(sub.subscriber, sub.merchant, claimableAmount),
            "Payment transfer failed"
        );

        emit FundsWithdrawn(subId, sub.merchant, claimableAmount);
    }

    /**
     * @notice AI Auditor pauses the stream upon detecting billing anomalies.
     */
    function pauseStreamByAI(bytes32 subId, string calldata reason) external onlyAuditor {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream not active");
        require(!sub.pausedByAI, "Already paused");

        sub.pausedByAI = true;
        emit StreamPaused(subId, reason);
    }

    /**
     * @notice Subscriber resolves issues and resumes the stream using their QIE Pass signature.
     */
    function resumeStream(bytes32 subId) external onlySubscriber(subId) {
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Subscriber must hold verified QIE Pass");
        Subscription storage sub = subscriptions[subId];
        require(sub.pausedByAI, "Stream not paused by AI");

        sub.pausedByAI = false;
        sub.lastClaimedTimestamp = block.timestamp; // Reset timer to prevent double-claiming during paused gap

        emit StreamResumed(subId);
    }

    /**
     * @notice Subscriber terminates a subscription stream permanently.
     */
    function terminateStream(bytes32 subId) external onlySubscriber(subId) {
        Subscription storage sub = subscriptions[subId];
        sub.active = false;
        emit StreamTerminated(subId);
    }

    /**
     * @notice Get all subscription IDs for a subscriber
     */
    function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[] memory) {
        return subscriberSubscriptions[subscriber];
    }

    /**
     * @notice Get all subscription IDs for a merchant
     */
    function getMerchantSubscriptions(address merchant) external view returns (bytes32[] memory) {
        return merchantSubscriptions[merchant];
    }

    /**
     * @notice Get full details of a subscription
     */
    function getSubscriptionDetails(bytes32 subId) external view returns (
        address subscriber,
        address merchant,
        uint256 ratePerSecond,
        uint256 lastClaimedTimestamp,
        uint256 startTime,
        bool active,
        bool pausedByAI,
        uint256 claimableAmount
    ) {
        Subscription memory sub = subscriptions[subId];
        uint256 pending = 0;
        if (sub.active && !sub.pausedByAI && block.timestamp > sub.lastClaimedTimestamp) {
            pending = (block.timestamp - sub.lastClaimedTimestamp) * sub.ratePerSecond;
        }
        return (
            sub.subscriber,
            sub.merchant,
            sub.ratePerSecond,
            sub.lastClaimedTimestamp,
            sub.startTime,
            sub.active,
            sub.pausedByAI,
            pending
        );
    }
}
