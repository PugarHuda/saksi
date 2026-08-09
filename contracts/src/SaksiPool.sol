// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IVerifier11 {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[11] calldata s)
        external view returns (bool);
}

interface IVerifier7 {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[7] calldata s)
        external view returns (bool);
}

interface IVerifier3 {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[3] calldata s)
        external view returns (bool);
}

interface IVerifier4 {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[4] calldata s)
        external view returns (bool);
}

interface IVerifier13 {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[13] calldata s)
        external view returns (bool);
}

/// Cleanverse's own CVI Compliance Validator (CCP). This is their contract, deployed by
/// them, holding the rule set they enforce — Saksi calls it, it does not reimplement it.
///
/// Monad testnet: 0xaC7e5179C2C7f03f209136886c172eb34F161792
interface IAPassComplianceValidator {
    struct RuleV2 {
        bytes2 allowedGroup;        // empty = unrestricted
        bytes2 allowedSubGroup;
        uint8 minTier;              // 0 = unrestricted
        uint8 minSubTier;
        uint256 poolCountryBitmap;  // 0 = unrestricted
    }

    /// Reverts if `poolAddress` was never registered — an unregistered pool cannot
    /// silently behave like an open one.
    function complianceVerify(address poolAddress, address userAddress) external view returns (bool);
    function isRegistered(address poolAddress) external view returns (bool);
    function getRulesV2(address poolAddress) external view returns (RuleV2[] memory);

    /// Called by the registered business contract itself, so the register's perimeter
    /// can be changed by its own governance rather than out of band.
    function setRuleV2FromContract(RuleV2 calldata rule) external;
    function addRuleV2FromContract(RuleV2 calldata rule) external;
    function removeRuleV2FromContract(uint256 index) external;
}

/// Minimal Ownable. Cleanverse's `validator/register` requires the pool to expose
/// `owner()` so it can check the EIP-191 signature over chain + contract_address,
/// so this is load-bearing rather than convention.
abstract contract Ownable {
    address public owner;
    error NotOwner();
    event OwnershipTransferred(address indexed from, address indexed to);

    constructor(address initialOwner) { owner = initialOwner; }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    function transferOwnership(address to) external onlyOwner {
        emit OwnershipTransferred(owner, to);
        owner = to;
    }
}

/// Saksi — a confidential holder register for a tokenized real-world asset.
///
/// Positions in a Cleanverse Verified Asset are held as commitments, so amount and
/// holder are hidden on-chain. The register stays answerable at both edges:
///
///   ENTRY is gated twice over.
///     1. Cleanverse's own Validator contract, which this pool is registered with,
///        checks the depositor's A-Pass tier, group, and country tags against our
///        rule set. That gate is *their* contract, not our reimplementation of one.
///     2. A zero-knowledge compliance proof shows the depositor's key is inside the
///        association-set root — a Merkle tree whose leaves are live CVI identities —
///        and absent from the sanctions set. The proof is bound to the caller and to
///        the commitment, so neither can be swapped after the fact.
///
///   THE MIDDLE is shielded. Positions move by a JoinSplit transfer proof: value is
///   conserved, inputs are nullified, and nothing about amount or owner is published.
///
///   THE EXIT is answerable. Four selective-disclosure proof types are verified by
///   this contract, each bound to an audit request the auditor registered on-chain
///   *before* the answer existed, so a proof cannot be replayed against a different
///   question.
///
/// Revocation flows through the root. A frozen A-Pass is dropped from the next
/// association set; its holder can no longer produce a valid entry proof and the
/// position freezes without anyone having to move it.
contract SaksiPool is Ownable {
    /// BN254 scalar field. Every public signal is reduced into it.
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256 public constant DENY_SLOTS = 8;
    uint256 public constant AGG_SLOTS = 5;

    IERC20 public immutable asset;              // the CVA this register tracks
    /// Cleanverse's CVI Compliance Validator. The pool is registered with it and its
    /// rule set is the first of the two entry gates.
    IAPassComplianceValidator public immutable validator;
    IVerifier11 public immutable complianceVerifier;
    IVerifier7 public immutable transferVerifier;
    IVerifier3 public immutable exactVerifier;
    IVerifier3 public immutable thresholdVerifier;
    IVerifier4 public immutable rangeVerifier;
    IVerifier13 public immutable aggregateVerifier;

    // ---- association set: who may enter (CVI) -----------------------------

    /// Current association-set root: the A-Pass identities eligible to enter.
    uint256 public aspRoot;
    /// Publicly known sanctioned keys every entry proof must clear.
    uint256[DENY_SLOTS] public denyList;
    /// Roots stay accepted after rotation so in-flight proofs do not break.
    mapping(uint256 => bool) public knownRoot;

    // ---- the shielded register --------------------------------------------

    mapping(bytes32 => bool) public commitmentKnown;
    mapping(bytes32 => bool) public nullifierUsed;
    bytes32[] public commitments;

    /// Root of the note tree the transfer proof spends against. Recomputable by
    /// anyone from the Deposited and Transacted event log.
    ///
    /// ponytail: the note tree is maintained off-chain and its root published here,
    /// because Poseidon has no cheap Solidity implementation. The tree is public and
    /// every leaf is emitted, so a wrong root is detectable by any observer — but a
    /// pilot wanting trustlessness advances it with the merkleUpdate proof instead.
    uint256 public noteRoot;
    mapping(uint256 => bool) public knownNoteRoot;

    // ---- answerability -----------------------------------------------------

    address public auditor;

    /// Questions the auditor registered, keyed by the context hash the disclosure
    /// proof must carry. Registering first is what stops an answer to one question
    /// being presented as the answer to another.
    mapping(uint256 => bool) public auditRequested;
    mapping(uint256 => uint8) public auditAnswered;   // 0 = open, else DisclosureKind

    bool public paused;

    uint8 public constant KIND_EXACT = 1;
    uint8 public constant KIND_THRESHOLD = 2;
    uint8 public constant KIND_RANGE = 3;
    uint8 public constant KIND_AGGREGATE = 4;

    event Deposited(bytes32 indexed commitment, uint256 amount, address indexed from, uint256 leafIndex);
    event Transacted(bytes32 indexed nullifierA, bytes32 indexed nullifierB, uint256 withdrawn, address to);
    event CommitmentInserted(bytes32 indexed commitment, uint256 leafIndex);
    event RootRotated(uint256 indexed previousRoot, uint256 indexed newRoot);
    event RootRetired(uint256 indexed root);
    event NoteRootPublished(uint256 indexed previousRoot, uint256 indexed newRoot);
    event DenyListSet(uint256[DENY_SLOTS] denyList);
    event AuditRequested(uint256 indexed contextHash, address indexed by, string question);
    event DisclosureProved(uint256 indexed contextHash, uint8 kind, uint256 a, uint256 b);
    event PausedSet(bool paused);
    event AuditorSet(address indexed auditor);

    error Paused();
    error UnknownRoot();
    error UnknownNoteRoot();
    error DenyListMismatch();
    error SourceKeyMismatch();
    error CommitmentNotBound();
    error CommitmentExists();
    error NullifierUsed();
    error InvalidProof();
    error NotAuditor();
    error ZeroAmount();
    error NoSuchAudit();
    error AuditClosed();
    error UnknownCommitment();
    error ExtDataMismatch();
    error DepositsUseDepositPath();
    error NotBoolean();
    error ValidatorRefused(address who);

    constructor(
        address _asset,
        address _validator,
        address _complianceVerifier,
        address _transferVerifier,
        address _exactVerifier,
        address _thresholdVerifier,
        address _rangeVerifier,
        address _aggregateVerifier,
        uint256 _aspRoot,
        address _owner
    ) Ownable(_owner) {
        asset = IERC20(_asset);
        validator = IAPassComplianceValidator(_validator);
        complianceVerifier = IVerifier11(_complianceVerifier);
        transferVerifier = IVerifier7(_transferVerifier);
        exactVerifier = IVerifier3(_exactVerifier);
        thresholdVerifier = IVerifier3(_thresholdVerifier);
        rangeVerifier = IVerifier4(_rangeVerifier);
        aggregateVerifier = IVerifier13(_aggregateVerifier);
        aspRoot = _aspRoot;
        knownRoot[_aspRoot] = true;
        auditor = _owner;
    }

    modifier notPaused() { if (paused) revert Paused(); _; }

    // ---- identity binding -------------------------------------------------

    /// The key a depositor must prove membership for. Derived from the caller's
    /// address, so a valid proof for one wallet is useless from another.
    function sourceKeyOf(address who) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(who))) % FIELD;
    }

    /// GATE ONE. Cleanverse's Validator, asked live, in the same transaction that moves
    /// the value. Not an off-chain lookup performed beforehand and trusted afterwards:
    /// a credential frozen one block ago fails here.
    ///
    /// The call reverts rather than returning false if this pool is not registered, so
    /// an unregistered register cannot quietly behave like an open one.
    function _requireEligible(address who) internal view {
        if (!validator.complianceVerify(address(this), who)) revert ValidatorRefused(who);
    }

    /// What the Validator says about a wallet right now. The consoles read this so the
    /// eligibility a user is shown is the same one the chain will enforce.
    function isEligible(address who) external view returns (bool) {
        return validator.complianceVerify(address(this), who);
    }

    function registeredWithValidator() external view returns (bool) {
        return validator.isRegistered(address(this));
    }

    /// The rule set actually in force, read from Cleanverse rather than mirrored here.
    function activeRules() external view returns (IAPassComplianceValidator.RuleV2[] memory) {
        return validator.getRulesV2(address(this));
    }

    // ---- the perimeter, managed by this contract ---------------------------

    /// Replace the register's admission rules. The issuer changes its own perimeter
    /// through its own governance, and Cleanverse enforces the result.
    function setRule(IAPassComplianceValidator.RuleV2 calldata r) external onlyOwner {
        validator.setRuleV2FromContract(r);
    }

    /// Append a rule. Rules are OR-ed, so this widens admission — a second lawful path
    /// in, such as a jurisdiction carve-out.
    function addRule(IAPassComplianceValidator.RuleV2 calldata r) external onlyOwner {
        validator.addRuleV2FromContract(r);
    }

    function removeRule(uint256 index) external onlyOwner {
        validator.removeRuleV2FromContract(index);
    }

    /// The value the transfer proof's extDataHash must carry. Binding the recipient
    /// into the proof is what stops a valid withdrawal being re-aimed in the mempool.
    function extDataHashOf(address recipient, address relayer, uint256 fee)
        public pure returns (uint256)
    {
        return uint256(keccak256(abi.encode(recipient, relayer, fee))) % FIELD;
    }

    // ---- register administration -----------------------------------------

    /// Rotate the association set. Dropping a frozen A-Pass here is what freezes its
    /// holder: the old root stays valid for in-flight proofs, but the revoked identity
    /// is absent from every root issued after this call.
    function rotateRoot(uint256 newRoot) external onlyOwner {
        emit RootRotated(aspRoot, newRoot);
        aspRoot = newRoot;
        knownRoot[newRoot] = true;
    }

    /// Immediate revocation for a root that must not remain usable at all — the hard
    /// version of the freeze, for when an in-flight proof would itself be a breach.
    function retireRoot(uint256 root) external onlyOwner {
        knownRoot[root] = false;
        emit RootRetired(root);
    }

    function publishNoteRoot(uint256 newRoot) external onlyOwner {
        emit NoteRootPublished(noteRoot, newRoot);
        noteRoot = newRoot;
        knownNoteRoot[newRoot] = true;
    }

    function setDenyList(uint256[DENY_SLOTS] calldata list) external onlyOwner {
        denyList = list;
        emit DenyListSet(list);
    }

    function setAuditor(address who) external onlyOwner {
        auditor = who;
        emit AuditorSet(who);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    // ---- entering the register -------------------------------------------

    /// Deposit CVA into the confidential register.
    ///
    /// pubSignals is [aspRoot, denyList[0..7], sourceKey, bindHash]. Every one of
    /// those is checked against chain state rather than trusted from the caller: the
    /// root must be accepted, the deny list must match ours, the source key must be
    /// this caller's, and bindHash must be the commitment being inserted.
    function deposit(
        uint256 amount,
        bytes32 commitment,
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC,
        uint[11] calldata pubSignals
    ) external notPaused {
        if (amount == 0) revert ZeroAmount();
        if (commitmentKnown[commitment]) revert CommitmentExists();

        // GATE ONE — Cleanverse's Validator, on their contract, against this wallet's
        // live A-Pass and this pool's registered rule set.
        _requireEligible(msg.sender);

        // GATE TWO — the zero-knowledge proof. The two gates ask different questions:
        // the Validator asks whether this wallet is eligible today, the proof asks
        // whether this wallet was in the association set the issuer anchored. Passing
        // one is not passing the other, which is the point of having both.
        if (!knownRoot[pubSignals[0]]) revert UnknownRoot();

        for (uint256 i = 0; i < DENY_SLOTS; i++) {
            if (pubSignals[1 + i] != denyList[i]) revert DenyListMismatch();
        }
        if (pubSignals[9] != sourceKeyOf(msg.sender)) revert SourceKeyMismatch();
        if (pubSignals[10] != uint256(commitment) % FIELD) revert CommitmentNotBound();

        if (!complianceVerifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        uint256 leafIndex = commitments.length;
        commitmentKnown[commitment] = true;
        commitments.push(commitment);

        // ponytail: no fee logic. Add a take-rate here when there is a pilot to charge.
        require(asset.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Deposited(commitment, amount, msg.sender, leafIndex);
        emit CommitmentInserted(commitment, leafIndex);
    }

    // ---- moving inside the register, and leaving it ------------------------

    /// Spend two notes and create two, proving value conservation without revealing
    /// any amount or owner. A negative publicAmount leaves the register as a
    /// withdrawal to `recipient`; zero is a pure internal transfer.
    ///
    /// Entry is deliberately not available here: value only enters through deposit(),
    /// which is the edge carrying the CVI compliance proof.
    ///
    /// pubSignals is [noteRoot, publicAmount, extDataHash, nullifier[2], outCommitment[2]].
    function transact(
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC,
        uint[7] calldata pubSignals,
        address recipient, address relayer, uint256 fee
    ) external notPaused {
        if (!knownNoteRoot[pubSignals[0]]) revert UnknownNoteRoot();
        if (pubSignals[2] != extDataHashOf(recipient, relayer, fee)) revert ExtDataMismatch();

        // publicAmount is a field element: a withdrawal of x is encoded FIELD - x.
        uint256 publicAmount = pubSignals[1];
        uint256 withdrawn;
        if (publicAmount != 0) {
            if (publicAmount < FIELD / 2) revert DepositsUseDepositPath();
            withdrawn = FIELD - publicAmount;
        }

        bytes32 nA = bytes32(pubSignals[3]);
        bytes32 nB = bytes32(pubSignals[4]);
        if (nullifierUsed[nA] || nullifierUsed[nB]) revert NullifierUsed();
        nullifierUsed[nA] = true;
        nullifierUsed[nB] = true;

        bytes32 cA = bytes32(pubSignals[5]);
        bytes32 cB = bytes32(pubSignals[6]);
        if (commitmentKnown[cA] || commitmentKnown[cB]) revert CommitmentExists();

        if (!transferVerifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        uint256 idxA = commitments.length;
        commitmentKnown[cA] = true;
        commitments.push(cA);
        emit CommitmentInserted(cA, idxA);

        uint256 idxB = commitments.length;
        commitmentKnown[cB] = true;
        commitments.push(cB);
        emit CommitmentInserted(cB, idxB);

        if (withdrawn != 0) {
            // Leaving the register is an edge too. Cleanverse hold that every address
            // receiving a CVA needs a credential, so the exit is gated on the recipient
            // rather than on whoever happens to be submitting the proof.
            _requireEligible(recipient);
            if (fee != 0) _requireEligible(relayer);

            require(asset.transfer(recipient, withdrawn - fee), "transfer failed");
            if (fee != 0) require(asset.transfer(relayer, fee), "fee transfer failed");
        }
        emit Transacted(nA, nB, withdrawn, recipient);
    }

    // ---- answerability -----------------------------------------------------

    /// The auditor registers the question before any answer exists, so the disclosure
    /// proof that follows is bound to this specific request and cannot be reused as
    /// the answer to a different one.
    function requestAudit(uint256 contextHash, string calldata question) external {
        if (msg.sender != auditor) revert NotAuditor();
        auditRequested[contextHash] = true;
        emit AuditRequested(contextHash, msg.sender, question);
    }

    function _openAudit(uint256 contextHash) internal view {
        if (!auditRequested[contextHash]) revert NoSuchAudit();
        if (auditAnswered[contextHash] != 0) revert AuditClosed();
    }

    function _requireKnown(uint256 commitment) internal view {
        if (!commitmentKnown[bytes32(commitment)]) revert UnknownCommitment();
    }

    /// Exact disclosure: [commitment, disclosedAmount, auditContextHash].
    /// The strongest answer, for when the regulator is entitled to the figure itself.
    function proveExact(
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC, uint[3] calldata s
    ) external {
        _openAudit(s[2]);
        _requireKnown(s[0]);
        if (!exactVerifier.verifyProof(pA, pB, pC, s)) revert InvalidProof();
        auditAnswered[s[2]] = KIND_EXACT;
        emit DisclosureProved(s[2], KIND_EXACT, s[0], s[1]);
    }

    /// Threshold disclosure: [commitment, threshold, auditContextHash].
    /// Proves the position is at or under a cap while the figure stays hidden — the
    /// concentration-limit answer an issuer owes without publishing its holder book.
    function proveThreshold(
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC, uint[3] calldata s
    ) external {
        _openAudit(s[2]);
        _requireKnown(s[0]);
        if (!thresholdVerifier.verifyProof(pA, pB, pC, s)) revert InvalidProof();
        auditAnswered[s[2]] = KIND_THRESHOLD;
        emit DisclosureProved(s[2], KIND_THRESHOLD, s[0], s[1]);
    }

    /// Two-sided range: [commitment, lower, upper, auditContextHash].
    /// Answers "is this position in the reportable bracket" without naming it.
    function proveRange(
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC, uint[4] calldata s
    ) external {
        _openAudit(s[3]);
        _requireKnown(s[0]);
        if (!rangeVerifier.verifyProof(pA, pB, pC, s)) revert InvalidProof();
        auditAnswered[s[3]] = KIND_RANGE;
        emit DisclosureProved(s[3], KIND_RANGE, s[1], s[2]);
    }

    /// Aggregate: [commitments[5], active[5], cap, auditContextHash, ctxNonce].
    /// Proves total exposure across a named set of positions is under a cap. The
    /// context hash commits to the exact set, so a holder cannot answer by leaving a
    /// position out — the report is complete or there is no proof.
    function proveAggregate(
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC, uint[13] calldata s
    ) external {
        _openAudit(s[11]);
        for (uint256 i = 0; i < AGG_SLOTS; i++) {
            uint256 flag = s[AGG_SLOTS + i];
            if (flag > 1) revert NotBoolean();
            if (flag == 1) _requireKnown(s[i]);
        }
        if (!aggregateVerifier.verifyProof(pA, pB, pC, s)) revert InvalidProof();
        auditAnswered[s[11]] = KIND_AGGREGATE;
        emit DisclosureProved(s[11], KIND_AGGREGATE, s[10], s[12]);
    }

    // ---- views ------------------------------------------------------------

    function commitmentCount() external view returns (uint256) { return commitments.length; }

    function getDenyList() external view returns (uint256[DENY_SLOTS] memory) { return denyList; }

    function allCommitments() external view returns (bytes32[] memory) { return commitments; }

    function balance() external view returns (uint256) { return asset.balanceOf(address(this)); }
}
