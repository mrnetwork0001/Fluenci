// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IQieFlowRegistry {
    function pauseStreamByAI(bytes32 subId, string calldata reason) external;
}

contract QieFlowAIAuditor {
    address public owner;
    address public qieFlowRegistry;
    address public trustedAiWorker;

    event AnomalyReported(bytes32 indexed subId, string reason, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAiWorker() {
        require(msg.sender == trustedAiWorker, "Only trusted AI worker");
        _;
    }

    constructor(address _registry) {
        owner = msg.sender;
        qieFlowRegistry = _registry;
    }

    function setAiWorker(address _worker) external onlyOwner {
        trustedAiWorker = _worker;
    }

    /**
     * @notice AI worker reports a billing anomaly and pauses the corresponding stream.
     */
    function triggerSafetyPause(bytes32 subId, string calldata reason) external onlyAiWorker {
        IQieFlowRegistry(qieFlowRegistry).pauseStreamByAI(subId, reason);
        emit AnomalyReported(subId, reason, block.timestamp);
    }
}
