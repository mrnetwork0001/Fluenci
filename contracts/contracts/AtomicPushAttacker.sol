// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Approve { function approve(address, uint256) external returns (bool); }

interface IRegistry {
    function createSubscription(address merchant, address tokenAddress, uint256 amountPerPeriod,
        uint256 periodSeconds, uint256 cliffTime, uint256 stopTime) external returns (bytes32);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// Reproduces the audit's attack: mint a punitive stream and push it onto a
/// victim inside ONE transaction. Under the pull model this must not be able to
/// change who pays.
contract AtomicPushAttacker {
    function attack(address registry, address merchant, address token, address victim,
                    uint256 amountPerPeriod, uint256 periodSeconds) external returns (bytes32 subId) {
        // Approve first, so the attack runs to completion and the test can show
        // exactly whose balance is drained.
        IERC20Approve(token).approve(registry, type(uint256).max);
        subId = IRegistry(registry).createSubscription(merchant, token, amountPerPeriod, periodSeconds, 0, 0);
        IRegistry(registry).transferFrom(address(this), victim, uint256(subId));
    }
}
