// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * FluenciReputationAttestor
 *
 * QIE Reputation has no canonical on-chain registry — the score is computed
 * off-chain from signals (wallet age, tx history, staking, verified reports) and
 * evolves over time. Rather than couple Fluenci to a contract that does not
 * exist, this adapter accepts a score SIGNED by an authorised QIE reputation
 * signer and exposes it through the same IQieReputation.getScore(address) view
 * that FluenciRegistryV4 already consumes. Swapping to a direct on-chain
 * registry later is a single setQieReputation() call — no migration.
 *
 * Privacy: only the reputation RESULT is ever stored or exposed — score, tier,
 * model version and validity window. No KYC data, no identity documents, no
 * underlying signals. Nothing here reveals why a score is what it is.
 *
 * Anyone may relay an attestation; the signature is the authority, not the
 * sender. So a user, a merchant, or Fluenci's backend can submit on the
 * subscriber's behalf without being trusted.
 */
contract FluenciReputationAttestor {
    address public owner;

    /// The QIE-operated key authorised to sign reputation attestations.
    /// Upgradeable by design: the score model and its signer will change.
    address public authorisedSigner;

    struct Attestation {
        uint256 score;
        string tier;          // e.g. "New", "Trusted" — display only
        string modelVersion;  // e.g. "2.0" — lets us reject a retired model
        uint256 issuedAt;
        uint256 expiresAt;
    }

    /// Wire format for a signed attestation. Passed as a struct because the
    /// flat argument list exceeded the EVM stack limit.
    struct AttestationInput {
        address wallet;
        uint256 score;
        string tier;
        string modelVersion;
        uint256 issuedAt;
        uint256 expiresAt;
        uint256 chainId;
    }

    mapping(address => Attestation) private attestations;

    /// Revocation floor. Deleting the record alone was reversible by replay,
    /// because the deleted issuedAt was the only thing rejecting the old signature.
    mapping(address => uint256) public revokedThrough;

    /// Optional: when set, attestations from any other model version are rejected.
    string public requiredModelVersion;

    /// A single signature must not be able to pin a score forever.
    uint256 public constant MAX_TTL = 90 days;

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "ReputationAttestation(address wallet,uint256 score,string tier,string modelVersion,uint256 issuedAt,uint256 expiresAt,uint256 chainId)"
    );

    bytes32 private immutable _domainSeparator;

    event AuthorisedSignerChanged(address indexed previousSigner, address indexed newSigner);
    event RequiredModelVersionChanged(string modelVersion);
    event AttestationSubmitted(address indexed wallet, uint256 score, string tier, uint256 expiresAt);
    event AttestationRevoked(address indexed wallet);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _authorisedSigner) {
        owner = msg.sender;
        authorisedSigner = _authorisedSigner;
        _domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Fluenci Reputation Attestor")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // --- Admin ---

    function setAuthorisedSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer");
        emit AuthorisedSignerChanged(authorisedSigner, newSigner);
        authorisedSigner = newSigner;
    }

    /// @notice Pin attestations to one model version, or pass "" to accept any.
    function setRequiredModelVersion(string calldata modelVersion) external onlyOwner {
        requiredModelVersion = modelVersion;
        emit RequiredModelVersionChanged(modelVersion);
    }

    address public pendingOwner;

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Only pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// @notice Drop an attestation early — for a revoked or disputed score.
    function revokeAttestation(address wallet) external onlyOwner {
        if (block.timestamp > revokedThrough[wallet]) {
            revokedThrough[wallet] = block.timestamp;
        }
        delete attestations[wallet];
        emit AttestationRevoked(wallet);
    }

    // --- Submission ---

    /**
     * @notice Record a reputation score signed by the authorised QIE signer.
     * @dev Relayable: the signature authorises the data, not msg.sender.
     */
    function submitAttestation(AttestationInput calldata a, bytes calldata signature) external {
        _validate(a);
        require(_digestSigner(a, signature) == authorisedSigner, "Not signed by the authorised QIE signer");

        attestations[a.wallet] = Attestation({
            score: a.score,
            tier: a.tier,
            modelVersion: a.modelVersion,
            issuedAt: a.issuedAt,
            expiresAt: a.expiresAt
        });

        emit AttestationSubmitted(a.wallet, a.score, a.tier, a.expiresAt);
    }

    function _validate(AttestationInput calldata a) internal view {
        require(authorisedSigner != address(0), "No authorised signer configured");
        require(a.wallet != address(0), "Invalid wallet");
        require(a.chainId == block.chainid, "Attestation is for another chain");
        require(a.expiresAt > block.timestamp, "Attestation already expired");
        require(a.issuedAt <= block.timestamp, "Attestation issued in the future");
        require(a.expiresAt > a.issuedAt, "Invalid validity window");
        require(a.expiresAt - a.issuedAt <= MAX_TTL, "Validity window too long");

        if (bytes(requiredModelVersion).length > 0) {
            require(
                keccak256(bytes(a.modelVersion)) == keccak256(bytes(requiredModelVersion)),
                "Retired reputation model version"
            );
        }
        // A newer attestation always wins; a stale one can never overwrite it.
        require(a.issuedAt > attestations[a.wallet].issuedAt, "A newer attestation is already on record");
        require(a.issuedAt > revokedThrough[a.wallet], "Attestation has been revoked");
    }

    /// @notice The EIP-712 digest QIE's signer must sign. Exposed so the signing
    ///         service can be verified against this contract before going live.
    function hashAttestation(AttestationInput calldata a) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                a.wallet,
                a.score,
                keccak256(bytes(a.tier)),
                keccak256(bytes(a.modelVersion)),
                a.issuedAt,
                a.expiresAt,
                a.chainId
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
    }

    function _digestSigner(AttestationInput calldata a, bytes calldata signature) internal view returns (address) {
        address signer = _recover(hashAttestation(a), signature);
        require(signer != address(0), "Malformed signature");
        return signer;
    }

    // --- Reads (IQieReputation) ---

    /**
     * @notice Current reputation score, or 0 if absent or expired.
     * @dev Returns rather than reverts so the registry's gate fails closed.
     *      This is the function FluenciRegistryV4 calls via IQieReputation.
     */
    function getScore(address user) external view returns (uint256) {
        Attestation memory a = attestations[user];
        if (a.expiresAt <= block.timestamp) return 0;
        return a.score;
    }

    /// @notice Result only — never the signals or identity behind it.
    function getAttestation(address user)
        external
        view
        returns (uint256 score, string memory tier, string memory modelVersion, uint256 issuedAt, uint256 expiresAt, bool valid)
    {
        Attestation memory a = attestations[user];
        return (a.score, a.tier, a.modelVersion, a.issuedAt, a.expiresAt, a.expiresAt > block.timestamp);
    }

    function isValid(address user) external view returns (bool) {
        return attestations[user].expiresAt > block.timestamp;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    // --- Signature recovery ---

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // Reject the malleable upper-range s value.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);

        return ecrecover(digest, v, r, s);
    }
}
