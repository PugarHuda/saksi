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
    /// Six fields, in this order. An earlier version of this interface omitted
    /// `isBlackList`, which Cleanverse published on 9 Aug. The omission was invisible in
    /// `getRulesV2` only by luck — our rule carries `isBlackList = false` and a zero
    /// bitmap, so the short decode read one zero where another belonged — but it made
    /// `setRuleV2FromContract` encode five words for a validator that decodes six, so the
    /// rule-management calls below could never have succeeded against the live contract.
    struct RuleV2 {
        bytes2 allowedGroup;        // empty = unrestricted
        bytes2 allowedSubGroup;
        uint8 minTier;              // 0 = unrestricted
        uint8 minSubTier;
        bool isBlackList;           // true = `countryBitmap` is a deny list, not an allow list
        uint256 countryBitmap;      // 0 = unrestricted
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

    error ZeroOwner();

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroOwner();
        owner = initialOwner;
    }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    /// No renouncing to the zero address. Everything the register needs after deployment —
    /// rotating the association root, publishing the note root, pausing — is owner-only,
    /// so an owner of zero locks every deposit in the pool permanently.
    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroOwner();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }
}

/// Saksi — a confidential holder register for a tokenized real-world asset.
///
/// Positions in a Cleanverse Verified Asset are held as commitments. The register stays
/// answerable at both edges:
///
/// What the commitment does NOT hide, stated plainly because a reader with the event log
/// can check it in a minute: an ENTRY is public. `deposit` takes `amount` as a plaintext
/// argument, the depositor is `msg.sender`, and both are emitted in `Deposited` alongside
/// the ERC20 Transfer log. So the map from a commitment to its opening amount and its
/// first owner is readable by anyone until that position MOVES. Breaking that link is
/// exactly what `transact` below is for — and it needs a published note root to be
/// reachable at all. The confidentiality this register earns is over a position's life,
/// not at the moment it is created.
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
    /// 2^levels of the Circom trees. A leaf past this has no witness — inLeafIndex is
    /// Num2Bits(levels)-bounded — so anything inserted beyond it is unspendable forever.
    /// The contract has to know the number the circuits were compiled with, because nothing
    /// else in the system does.
    uint256 public constant TREE_CAPACITY = 1 << 10;
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
    mapping(uint256 => uint256) public auditSubject;  // the commitment asked about; 0 = a set
    mapping(uint256 => uint8) public auditKind;       // the answer the auditor will accept
    mapping(uint256 => bytes32) public auditClaim;    // the figure asked about, hashed

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
    event AuditRequested(
        uint256 indexed contextHash,
        address indexed by,
        uint256 subject,
        uint8 kind,
        bytes32 claim,
        string question
    );
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
    error AmountNotBound();
    error DuplicateOutput();
    error WrongDisclosureKind();
    error WrongSubject();
    error WrongClaim();
    error FeeWithoutWithdrawal();
    error ExceedsBacking();
    error TreeFull();

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

    /// A published note root is spendable forever otherwise, so a wrong one — mistaken or
    /// malicious — has no undo. The association set has retireRoot; this is its twin.
    function retireNoteRoot(uint256 root) external onlyOwner {
        knownNoteRoot[root] = false;
        // Leaving noteRoot pointing at a root transact() now refuses would have the
        // console advertising a root the register will not accept.
        if (root == noteRoot) noteRoot = 0;
        emit NoteRootPublished(root, noteRoot);
    }

    function setDenyList(uint256[DENY_SLOTS] calldata list) external onlyOwner {
        denyList = list;
        emit DenyListSet(list);
    }

    function setAuditor(address who) external onlyOwner {
        if (who == address(0)) revert NotAuditor();
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
    /// TWO proofs, because one is not enough and the compliance circuit says so in its
    /// own header: it binds the caller and the commitment, but nothing in it binds the
    /// commitment to a VALUE. A commitment is Poseidon(amount, pubKey, blinding) computed
    /// off-chain, so without a second proof a depositor could transfer one unit while
    /// committing to a million, and the JoinSplit would faithfully conserve the forgery
    /// on the way out.
    ///
    ///   compliance  [aspRoot, denyList[0..7], sourceKey, bindHash]
    ///               — who may enter, bound to this caller and this commitment
    ///   binding     [commitment, disclosedAmount, contextHash]
    ///               — the commitment opens to EXACTLY the amount being transferred
    ///
    /// Every public signal is checked against chain state rather than trusted from the
    /// caller: the root must be accepted, the deny list must match ours, the source key
    /// must be this caller's, and both proofs must name the same commitment.
    function deposit(
        uint256 amount,
        bytes32 commitment,
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC,
        uint[11] calldata pubSignals,
        uint[2] calldata bA, uint[2][2] calldata bB, uint[2] calldata bC,
        uint[3] calldata bindSignals
    ) external notPaused {
        if (amount == 0) revert ZeroAmount();
        if (commitmentKnown[commitment]) revert CommitmentExists();

        // A commitment must BE a field element, not merely reduce to one. Six distinct
        // bytes32 values share each residue, so without this the same proof pair admits
        // six register entries whose keys differ from the value every disclosure is forced
        // to name — a position that spends normally and can never be audited.
        // Past capacity the note tree cannot produce a witness for the new leaf, so the
        // position would be permanently unspendable. Checked first: it costs one SLOAD and
        // refusing here saves the caller two Groth16 verifications they cannot use.
        if (commitments.length + 1 > TREE_CAPACITY) revert TreeFull();
        if (uint256(commitment) >= FIELD) revert CommitmentNotBound();

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

        // THE VALUE BINDING. Eligibility says this wallet may enter; it says nothing about
        // what it is entering WITH. Without the three lines below, a depositor transfers
        // one unit, commits to a million, and the JoinSplit conserves the forgery out the
        // other side. The commitment must open to exactly the amount that moved.
        if (bindSignals[0] != uint256(commitment)) revert CommitmentNotBound();
        if (bindSignals[1] != amount) revert AmountNotBound();
        // Domain separation. The same circuit answers exact-disclosure questions, so an
        // entry binding with a free context hash would be a structurally valid answer to
        // whatever audit request the depositor chose to name.
        if (bindSignals[2] != 0) revert CommitmentNotBound();
        if (!exactVerifier.verifyProof(bA, bB, bC, bindSignals)) revert InvalidProof();

        uint256 leafIndex = commitments.length;
        commitmentKnown[commitment] = true;
        commitments.push(commitment);

        // ponytail: no fee logic. Add a take-rate here when there is a pilot to charge.
        //
        // Measure what arrived rather than trusting the argument. The commitment binds
        // `amount`, but the CVA is a Cleanverse A-Token whose implementation this register
        // does not control: on any token that skims, rebases, or otherwise delivers less
        // than it was asked for, the commitment would bind more than the pool holds and
        // the JoinSplit would conserve the gap on its way out.
        uint256 before = asset.balanceOf(address(this));
        require(asset.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        if (asset.balanceOf(address(this)) - before != amount) revert AmountNotBound();
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
        // A transfer inserts two leaves, so it needs two free slots.
        if (commitments.length + 2 > TREE_CAPACITY) revert TreeFull();
        if (!knownNoteRoot[pubSignals[0]]) revert UnknownNoteRoot();
        if (pubSignals[2] != extDataHashOf(recipient, relayer, fee)) revert ExtDataMismatch();

        // The spender is checked too. The transfer circuit proves note ownership and value
        // conservation; it carries no association-set input, so without this a holder
        // whose credential was revoked keeps a fully working exit and "the position
        // freezes" would be false.
        //
        // Stated honestly: this is a live check on whoever submits, and the transfer proof
        // is not bound to msg.sender, so a revoked holder could still have an eligible
        // party relay it. Closing that properly means adding the association set to the
        // transfer circuit — which is a recompile and a new ceremony, not a patch. Entry
        // is gated cryptographically; the exit is gated operationally, and the difference
        // is real.
        _requireEligible(msg.sender);

        // publicAmount is a field element: a withdrawal of x is encoded FIELD - x.
        uint256 publicAmount = pubSignals[1];
        uint256 withdrawn;
        if (publicAmount != 0) {
            if (publicAmount < FIELD / 2) revert DepositsUseDepositPath();
            withdrawn = FIELD - publicAmount;
            // The circuit's range checks call themselves defence-in-depth. The contract
            // should not be relying on them alone: nothing here can pay out more than the
            // register is actually holding.
            if (withdrawn > asset.balanceOf(address(this))) revert ExceedsBacking();
        }
        // A fee is only payable out of a withdrawal. Silently pocketing it on an internal
        // transfer would leave a relayer out of pocket for the gas.
        if (withdrawn == 0 && fee != 0) revert FeeWithoutWithdrawal();

        bytes32 nA = bytes32(pubSignals[3]);
        bytes32 nB = bytes32(pubSignals[4]);
        if (nA == nB || nullifierUsed[nA] || nullifierUsed[nB]) revert NullifierUsed();
        nullifierUsed[nA] = true;
        nullifierUsed[nB] = true;

        bytes32 cA = bytes32(pubSignals[5]);
        bytes32 cB = bytes32(pubSignals[6]);
        if (commitmentKnown[cA] || commitmentKnown[cB]) revert CommitmentExists();
        // Two identical outputs would insert the same leaf twice and leave the note tree
        // disagreeing with the commitment array.
        if (cA == cB) revert DuplicateOutput();

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
    /// proof that follows is bound to this specific request and cannot be reused as the
    /// answer to a different one.
    ///
    /// The question names its SUBJECT and its KIND, and both are enforced. Without them
    /// the request was an opaque flag that any known commitment could satisfy: a stranger
    /// could deposit one unit and answer a concentration question with a vacuous
    /// threshold proof about their own throwaway note, closing the request permanently
    /// and writing a false answer into the record. A holder could use the same trick on
    /// itself to downgrade an exact-disclosure demand.
    ///
    /// `subject` is the commitment the question is about; pass 0 for an aggregate, where
    /// the circuit's own context hash already pins the whole set.
    ///
    /// `claim` pins the FIGURE, and without it the rest of this is decoration. Pinning the
    /// subject and the kind still let a holder answer "is this position at most 1,000?"
    /// with a proof that it is at most 2^64-1 — true, provable, and it closes the request
    /// forever with the record reading ANSWERED. The bound is not incidental: the circuits
    /// range-check the threshold to 64 bits and the aggregate cap to 72, so the vacuous
    /// claim always has a witness. Until this hash was checked, the number the auditor
    /// actually asked for lived only in `question`, which nothing verifies.
    ///
    /// Build it with `claimHash`. An exact disclosure takes no figure, so its claim is 0.
    function requestAudit(
        uint256 contextHash,
        uint256 subject,
        uint8 kind,
        bytes32 claim,
        string calldata question
    ) external {
        if (msg.sender != auditor) revert NotAuditor();
        if (kind == 0 || kind > KIND_AGGREGATE) revert NoSuchAudit();
        // Context 0 is the entry-binding domain. A deposit's binding proof carries public
        // signals [commitment, amount, 0] and is verified by this same exact verifier, so
        // an audit registered here would be answerable by replaying calldata that is
        // already public — by anyone, not just the holder.
        if (contextHash == 0) revert NoSuchAudit();
        // Answers are permanent, so re-asking on a spent context would create a request
        // that can never be satisfied. Fail here rather than at answering time.
        if (auditAnswered[contextHash] != 0) revert AuditClosed();
        if (subject >= FIELD) revert WrongSubject();
        // An aggregate is named by its context hash, not by one commitment; a non-zero
        // subject here would be unanswerable.
        if (kind == KIND_AGGREGATE && subject != 0) revert WrongSubject();
        if (kind == KIND_EXACT && claim != bytes32(0)) revert WrongClaim();

        auditRequested[contextHash] = true;
        auditSubject[contextHash] = subject;
        auditKind[contextHash] = kind;
        auditClaim[contextHash] = claim;
        emit AuditRequested(contextHash, msg.sender, subject, kind, claim, question);
    }

    /// The figure the auditor named, hashed the way the provers below recompute it.
    /// Threshold: `claimHash(KIND_THRESHOLD, cap, 0)`. Range: `(KIND_RANGE, lower, upper)`.
    /// Aggregate: `(KIND_AGGREGATE, cap, 0)`. Exact takes no figure and hashes to 0.
    function claimHash(uint8 kind, uint256 a, uint256 b) public pure returns (bytes32) {
        if (kind == KIND_EXACT) return bytes32(0);
        if (kind == KIND_RANGE) return keccak256(abi.encode(kind, a, b));
        return keccak256(abi.encode(kind, a));
    }

    /// Open, of the right kind, about the position the auditor asked about, and answering
    /// the figure they asked for.
    function _openAudit(uint256 contextHash, uint256 subject, uint8 kind, bytes32 claim)
        internal
        view
    {
        if (!auditRequested[contextHash]) revert NoSuchAudit();
        if (auditAnswered[contextHash] != 0) revert AuditClosed();
        if (auditKind[contextHash] != kind) revert WrongDisclosureKind();
        if (auditSubject[contextHash] != subject) revert WrongSubject();
        if (auditClaim[contextHash] != claim) revert WrongClaim();
    }

    function _requireKnown(uint256 commitment) internal view {
        if (!commitmentKnown[bytes32(commitment)]) revert UnknownCommitment();
    }

    /// Exact disclosure: [commitment, disclosedAmount, auditContextHash].
    /// The strongest answer, for when the regulator is entitled to the figure itself.
    function proveExact(
        uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC, uint[3] calldata s
    ) external {
        _openAudit(s[2], s[0], KIND_EXACT, bytes32(0));
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
        _openAudit(s[2], s[0], KIND_THRESHOLD, claimHash(KIND_THRESHOLD, s[1], 0));
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
        _openAudit(s[3], s[0], KIND_RANGE, claimHash(KIND_RANGE, s[1], s[2]));
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
        // Subject 0: the set is named by the context hash the circuit itself recomputes,
        // so there is no single commitment for the auditor to have pinned.
        _openAudit(s[11], 0, KIND_AGGREGATE, claimHash(KIND_AGGREGATE, s[10], 0));
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
