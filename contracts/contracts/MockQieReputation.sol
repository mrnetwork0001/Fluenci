// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Stand-in for the live QIE Reputation contract until its address and ABI are
/// confirmed. Shape matches IQieReputation in FluenciRegistryV4.
contract MockQieReputation {
    mapping(address => uint256) public scores;

    function setScore(address user, uint256 score) external {
        scores[user] = score;
    }

    function getScore(address user) external view returns (uint256) {
        return scores[user];
    }
}

/// Stand-in for QIE ID. Shape matches IQieIdentity.
contract MockQieIdentity {
    mapping(address => bool) public registered;

    function setIdentity(address user, bool ok) external {
        registered[user] = ok;
    }

    function hasIdentity(address user) external view returns (bool) {
        return registered[user];
    }
}

/// Always reverts, to prove a broken adapter fails the gate closed rather than
/// bricking the registry.
contract RevertingReputation {
    function getScore(address) external pure returns (uint256) {
        revert("adapter down");
    }
}
