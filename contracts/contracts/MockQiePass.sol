// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockQiePass {
    mapping(address => bool) public identities;

    event IdentityRegistered(address indexed user, bool status);

    function registerIdentity(address user, bool status) external {
        identities[user] = status;
        emit IdentityRegistered(user, status);
    }

    function verifyIdentity(address user) external view returns (bool) {
        return identities[user];
    }
}
