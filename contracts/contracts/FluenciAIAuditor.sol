// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFluenciRegistry {
    function pauseStreamByAI(bytes32 subId, string calldata reason) external;
}

contract FluenciAIAuditor {
    address public owner;
    address public fluenciRegistry;
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
        fluenciRegistry = _registry;
    }

    function setAiWorker(address _worker) external onlyOwner {
        trustedAiWorker = _worker;
    }

    /**
     * @notice AI worker reports a billing anomaly and pauses the corresponding stream.
     */
    function triggerSafetyPause(bytes32 subId, string calldata reason) external onlyAiWorker {
        IFluenciRegistry(fluenciRegistry).pauseStreamByAI(subId, reason);
        emit AnomalyReported(subId, reason, block.timestamp);
    }
}
