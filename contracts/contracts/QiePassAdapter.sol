// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QiePassAdapter
/// @notice On-chain QIE Pass verification bridge for FluenciRegistryV4.
///
/// QIE Pass verification happens off-chain against QIE's Pass API. A trusted
/// oracle (the Fluenci backend, only after a successful API verification) writes
/// the boolean result here via `registerIdentity`. Unlike the earlier mock, the
/// setter is access-controlled, so a wallet cannot self-grant "verified" status —
/// which is what secures both the QIE Pass subscriber gate and the merchant
/// KYC-to-withdraw check in the registry.
///
/// `verifyIdentity` exposes only the pass/fail result — never any KYC data.
contract QiePassAdapter {
    address public owner;
    address public oracle;
    mapping(address => bool) private verified;

    event OracleChanged(address indexed previousOracle, address indexed newOracle);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event IdentityRegistered(address indexed user, bool status);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /// Owner is allowed too, so the cold owner can correct state without the oracle.
    modifier onlyOracle() {
        require(msg.sender == oracle || msg.sender == owner, "Only oracle");
        _;
    }

    constructor(address _oracle) {
        owner = msg.sender;
        oracle = _oracle;
        emit OracleChanged(address(0), _oracle);
    }

    function setOracle(address _oracle) external onlyOwner {
        emit OracleChanged(oracle, _oracle);
        oracle = _oracle;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Record a wallet's QIE Pass verification result. Oracle/owner only.
    /// Same signature as the previous adapter, so the backend writer is unchanged
    /// apart from the contract address and the (now authorised) signer key.
    function registerIdentity(address user, bool status) external onlyOracle {
        verified[user] = status;
        emit IdentityRegistered(user, status);
    }

    /// @notice IQiePass — the only function the registry reads. Result only.
    function verifyIdentity(address user) external view returns (bool) {
        return verified[user];
    }
}
