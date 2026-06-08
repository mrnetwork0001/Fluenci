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

interface IFluenciAIAuditor {
    function trustedAiWorker() external view returns (address);
}

contract FluenciRegistry {
    // --- ERC-721 State & Events ---
    string public constant name = "Fluenci Subscription NFT";
    string public constant symbol = "FLUENCI";

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // --- Protocol Config & Types ---
    address public owner;
    address public qiePass;
    address public aiAuditor;

    enum DisputeState { NONE, OPEN, RESOLVED }

    struct Subscription {
        address subscriber;
        address merchant;
        address tokenAddress;          // Token address used for streaming (qUSDC, WETH, etc.)
        uint256 ratePerSecond;        // Streaming rate per second
        uint256 lastClaimedTimestamp;
        uint256 startTime;
        uint256 cliffTime;            // Cliff timestamp (0 if none)
        uint256 stopTime;             // Stop timestamp (0 if infinite)
        bool active;
        bool pausedByAI;
        DisputeState dispute;
    }

    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => bytes32[]) private subscriberSubscriptions;
    mapping(address => bytes32[]) private merchantSubscriptions;

    event SubscriptionCreated(
        bytes32 indexed subId,
        address indexed subscriber,
        address indexed merchant,
        address tokenAddress,
        uint256 ratePerSecond,
        uint256 cliffTime,
        uint256 stopTime
    );
    event StreamPaused(bytes32 indexed subId, string reason);
    event StreamResumed(bytes32 indexed subId);
    event StreamTerminated(bytes32 indexed subId);
    event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount);
    event DisputeOpened(bytes32 indexed subId, address indexed subscriber);
    event DisputeResolved(bytes32 indexed subId, uint256 subscriberRefund, uint256 merchantShare);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlySubscriber(bytes32 subId) {
        require(subscriptions[subId].subscriber == msg.sender, "Only subscriber");
        _;
    }

    constructor(address _qiePass) {
        owner = msg.sender;
        qiePass = _qiePass;
    }

    function setAIAuditor(address _aiAuditor) external onlyOwner {
        aiAuditor = _aiAuditor;
    }

    function setQiePass(address _qiePass) external onlyOwner {
        qiePass = _qiePass;
    }

    /**
     * @notice Create a subscription stream (Mints a subscription NFT).
     */
    function createSubscription(
        address merchant,
        address tokenAddress,
        uint256 ratePerSecond,
        uint256 cliffTime,
        uint256 stopTime
    ) external returns (bytes32 subId) {
        // Gated by QIE Pass (KYC verification)
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Subscriber must hold verified QIE Pass");
        require(merchant != address(0), "Invalid merchant address");
        require(tokenAddress != address(0), "Invalid token address");
        require(ratePerSecond > 0, "Rate must be greater than zero");
        if (stopTime > 0) {
            require(stopTime > block.timestamp, "Stop time must be in the future");
            if (cliffTime > 0) {
                require(cliffTime < stopTime, "Cliff time must be before stop time");
            }
        }

        subId = keccak256(abi.encodePacked(msg.sender, merchant, block.timestamp, subscriberSubscriptions[msg.sender].length));

        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            merchant: merchant,
            tokenAddress: tokenAddress,
            ratePerSecond: ratePerSecond,
            lastClaimedTimestamp: block.timestamp,
            startTime: block.timestamp,
            cliffTime: cliffTime,
            stopTime: stopTime,
            active: true,
            pausedByAI: false,
            dispute: DisputeState.NONE
        });

        subscriberSubscriptions[msg.sender].push(subId);
        merchantSubscriptions[merchant].push(subId);

        // Emit ERC-721 Transfer from address(0) to subscriber to signify minting
        emit Transfer(address(0), msg.sender, uint256(subId));

        emit SubscriptionCreated(subId, msg.sender, merchant, tokenAddress, ratePerSecond, cliffTime, stopTime);
    }

    /**
     * @notice Merchant claims accumulated subscription streams.
     */
    function claimStream(bytes32 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(msg.sender == sub.merchant, "Only merchant can claim");
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Merchant must hold verified QIE Pass to withdraw");
        require(sub.active, "Subscription is not active");
        require(!sub.pausedByAI, "Stream paused by AI due to anomaly");
        require(sub.dispute != DisputeState.OPEN, "Stream is currently disputed");
        if (sub.cliffTime > 0) {
            require(block.timestamp >= sub.cliffTime, "Vesting cliff not reached yet");
        }

        uint256 claimEnd = block.timestamp;
        if (sub.stopTime > 0 && claimEnd > sub.stopTime) {
            claimEnd = sub.stopTime;
        }

        require(claimEnd > sub.lastClaimedTimestamp, "Nothing to claim yet");
        uint256 claimableDuration = claimEnd - sub.lastClaimedTimestamp;
        uint256 claimableAmount = claimableDuration * sub.ratePerSecond;

        sub.lastClaimedTimestamp = claimEnd;

        // Perform settlement in designated token
        require(
            IERC20(sub.tokenAddress).transferFrom(sub.subscriber, sub.merchant, claimableAmount),
            "Payment transfer failed"
        );

        emit FundsWithdrawn(subId, sub.merchant, claimableAmount);

        // If stopTime has been reached, terminate stream auto-cleanup
        if (sub.stopTime > 0 && claimEnd == sub.stopTime) {
            sub.active = false;
            emit StreamTerminated(subId);
        }
    }

    /**
     * @notice AI Auditor pauses the stream upon detecting billing anomalies.
     */
    function pauseStreamByAI(bytes32 subId, string calldata reason) external {
        require(msg.sender == aiAuditor, "Only AI Auditor");
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream not active");
        require(!sub.pausedByAI, "Already paused");

        sub.pausedByAI = true;
        emit StreamPaused(subId, reason);
    }

    /**
     * @notice Subscriber resolves issues and resumes the stream.
     */
    function resumeStream(bytes32 subId) external onlySubscriber(subId) {
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Subscriber must hold verified QIE Pass");
        Subscription storage sub = subscriptions[subId];
        require(sub.pausedByAI, "Stream not paused by AI");
        require(sub.dispute != DisputeState.OPEN, "Cannot resume during active dispute");

        sub.pausedByAI = false;
        sub.lastClaimedTimestamp = block.timestamp; // Reset timer to prevent double claiming for paused duration

        emit StreamResumed(subId);
    }

    /**
     * @notice Subscriber terminates a subscription stream permanently.
     */
    function terminateStream(bytes32 subId) external onlySubscriber(subId) {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream already inactive");
        sub.active = false;
        emit StreamTerminated(subId);
    }

    // --- Option A: AI Dispute Resolution & Refund Escrow ---

    /**
     * @notice Subscriber opens a dispute on a subscription stream.
     */
    function openDispute(bytes32 subId) external onlySubscriber(subId) {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream not active");
        require(sub.dispute == DisputeState.NONE, "Dispute already active or resolved");

        sub.dispute = DisputeState.OPEN;
        sub.pausedByAI = true;

        emit DisputeOpened(subId, msg.sender);
    }

    /**
     * @notice Settles a dispute with signature-based arbitration from the AI Auditor.
     */
    function resolveDispute(
        bytes32 subId,
        uint256 subscriberRefund, // Simulates the portion of accumulated stream that won't be charged
        uint256 merchantShare,      // The portion of accumulated stream to pay to merchant
        bytes calldata signature
    ) external {
        Subscription storage sub = subscriptions[subId];
        require(sub.dispute == DisputeState.OPEN, "No open dispute found");

        // Verify cryptographic signature of the AI Auditor
        bytes32 messageHash = getMessageHash(subId, subscriberRefund, merchantShare);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        address signer = recoverSigner(ethSignedMessageHash, signature);
        require(signer == IFluenciAIAuditor(aiAuditor).trustedAiWorker(), "Invalid AI Auditor signature");

        // Process merchant payout share if any
        if (merchantShare > 0) {
            require(
                IERC20(sub.tokenAddress).transferFrom(sub.subscriber, sub.merchant, merchantShare),
                "Dispute payout transfer failed"
            );
        }

        sub.lastClaimedTimestamp = block.timestamp;
        sub.dispute = DisputeState.RESOLVED;
        sub.pausedByAI = false; // Unpause after resolution

        emit DisputeResolved(subId, subscriberRefund, merchantShare);
    }

    // --- ERC-721 Interface Implementation ---

    function balanceOf(address ownerAddress) external view returns (uint256) {
        require(ownerAddress != address(0), "Zero address query");
        uint256 count = 0;
        bytes32[] memory list = subscriberSubscriptions[ownerAddress];
        for (uint256 i = 0; i < list.length; i++) {
            if (subscriptions[list[i]].active && subscriptions[list[i]].subscriber == ownerAddress) {
                count++;
            }
        }
        return count;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        bytes32 subId = bytes32(tokenId);
        address subscriber = subscriptions[subId].subscriber;
        require(subscriber != address(0), "Nonexistent NFT");
        return subscriber;
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        bytes32 subId = bytes32(tokenId);
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream is not active");
        require(sub.subscriber == from, "Transfer of token that is not owned");
        require(to != address(0), "Transfer to zero address");

        // Auth check
        require(
            msg.sender == from || 
            _tokenApprovals[tokenId] == msg.sender || 
            _operatorApprovals[from][msg.sender], 
            "Caller is not owner nor approved"
        );

        // Clean approvals
        delete _tokenApprovals[tokenId];

        // Update subscriber ownership arrays
        _removeSubscriberSubId(from, subId);
        subscriberSubscriptions[to].push(subId);

        // Update Subscription subscriber address
        sub.subscriber = to;

        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata /*data*/) external {
        transferFrom(from, to, tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        address subscriber = ownerOf(tokenId);
        require(msg.sender == subscriber || _operatorApprovals[subscriber][msg.sender], "Approve caller is not owner nor approved for all");
        _tokenApprovals[tokenId] = to;
        emit Approval(subscriber, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        address subscriber = ownerOf(tokenId);
        require(subscriber != address(0), "Approved query for nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address ownerAddress, address operator) external view returns (bool) {
        return _operatorApprovals[ownerAddress][operator];
    }

    // --- Helper Functions ---

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

    function getSubscriptionDetails(bytes32 subId) external view returns (
        address subscriber,
        address merchant,
        address tokenAddress,
        uint256 ratePerSecond,
        uint256 lastClaimedTimestamp,
        uint256 startTime,
        uint256 cliffTime,
        uint256 stopTime,
        bool active,
        bool pausedByAI,
        uint8 disputeState,
        uint256 claimableAmount
    ) {
        Subscription memory sub = subscriptions[subId];
        uint256 pending = 0;
        
        if (sub.active && !sub.pausedByAI && sub.dispute == DisputeState.NONE) {
            uint256 claimEnd = block.timestamp;
            if (sub.stopTime > 0 && claimEnd > sub.stopTime) {
                claimEnd = sub.stopTime;
            }
            if (claimEnd > sub.lastClaimedTimestamp && (sub.cliffTime == 0 || block.timestamp >= sub.cliffTime)) {
                pending = (claimEnd - sub.lastClaimedTimestamp) * sub.ratePerSecond;
            }
        }

        return (
            sub.subscriber,
            sub.merchant,
            sub.tokenAddress,
            sub.ratePerSecond,
            sub.lastClaimedTimestamp,
            sub.startTime,
            sub.cliffTime,
            sub.stopTime,
            sub.active,
            sub.pausedByAI,
            uint8(sub.dispute),
            pending
        );
    }

    // --- Signature Recovery Helpers ---

    function getMessageHash(bytes32 subId, uint256 subscriberRefund, uint256 merchantShare) public view returns (bytes32) {
        return keccak256(abi.encodePacked(subId, subscriberRefund, merchantShare, address(this)));
    }

    function getEthSignedMessageHash(bytes32 messageHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
    }

    function recoverSigner(bytes32 hash, bytes memory signature) public pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;

        if (signature.length != 65) {
            return address(0);
        }

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) {
            return address(0);
        }

        return ecrecover(hash, v, r, s);
    }
}
