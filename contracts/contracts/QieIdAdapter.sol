// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721Balance {
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * Implements IQieIdentity.hasIdentity for FluenciRegistryV4's QIE_ID gate.
 *
 * QIE ships no `hasIdentity(address)` contract, but it does ship the .qie name
 * NFT. A wallet "has a QIE ID" if it owns at least one .qie name, so this reads
 * balanceOf on that NFT. try/catch so a misbehaving token fails the gate closed
 * rather than reverting the whole subscription.
 */
contract QieIdAdapter {
    // QIE .qie name NFT (verified live: name() == "qie", 12k+ supply).
    IERC721Balance public constant QIE_ID_NFT =
        IERC721Balance(0x9aab56e7727af53A3131985BFB16d845319b7bdc);

    function hasIdentity(address user) external view returns (bool) {
        try QIE_ID_NFT.balanceOf(user) returns (uint256 bal) {
            return bal > 0;
        } catch {
            return false;
        }
    }
}
