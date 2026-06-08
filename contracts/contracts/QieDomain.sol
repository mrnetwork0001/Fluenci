// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract QieDomain {
    mapping(string => address) private domains;
    mapping(address => string) private primaryNames;

    event DomainRegistered(string domain, address indexed owner);

    function registerDomain(string calldata domain, address owner) external {
        require(domains[domain] == address(0), "Domain already registered");
        domains[domain] = owner;
        primaryNames[owner] = domain;
        emit DomainRegistered(domain, owner);
    }

    function resolveDomain(string calldata domain) external view returns (address) {
        return domains[domain];
    }

    function lookupAddress(address addr) external view returns (string memory) {
        return primaryNames[addr];
    }
}
