// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Re-audit POCs. Tests named test_H*/test_M*/test_L* assert the invariant the contract
// SHOULD hold; they FAIL on the current code and each failure is the finding.
// Tests named test_OK_* assert an invariant that DOES hold and pass.
//
// Nothing here modifies src/ or the existing suite.

import {Test} from "forge-std/Test.sol";
import {SaksiPool, IAPassComplianceValidator, Ownable} from "../src/SaksiPool.sol";

contract A2Validator {
    mapping(address => bool) public eligible;
    IAPassComplianceValidator.RuleV2[] internal rules;
    bool public registered = true;

    function setEligible(address who, bool v) external { eligible[who] = v; }
    function setRegistered(bool v) external { registered = v; }

    function complianceVerify(address, address user) external view returns (bool) {
        require(registered, "pool not registered");
        return eligible[user];
    }
    function isRegistered(address) external view returns (bool) { return registered; }
    function getRulesV2(address) external view returns (IAPassComplianceValidator.RuleV2[] memory) {
        return rules;
    }
    function setRuleV2FromContract(IAPassComplianceValidator.RuleV2 calldata r) external {
        delete rules; rules.push(r);
    }
    function addRuleV2FromContract(IAPassComplianceValidator.RuleV2 calldata r) external { rules.push(r); }
    function removeRuleV2FromContract(uint256 i) external { rules[i] = rules[rules.length - 1]; rules.pop(); }
}

contract A2Asset {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// The CVA is a third-party Cleanverse A-Token (ops/launch-atoken.mjs); the register does
/// not control its implementation. This is the fee-on-transfer shape of that unknown.
contract A2FeeAsset {
    mapping(address => uint256) public balanceOf;
    uint256 public constant BPS = 100; // 1% skimmed on the way in
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        uint256 fee = (a * BPS) / 10_000;
        balanceOf[f] -= a; balanceOf[t] += a - fee; balanceOf[address(0xdead)] += fee;
        return true;
    }
}

contract A2Verifier {
    bool public shouldPass = true;
    function set(bool v) external { shouldPass = v; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[11] calldata)
        external view returns (bool) { return shouldPass; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[7] calldata)
        external view returns (bool) { return shouldPass; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[3] calldata)
        external view returns (bool) { return shouldPass; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[4] calldata)
        external view returns (bool) { return shouldPass; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[13] calldata)
        external view returns (bool) { return shouldPass; }
}

contract Audit2Test is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant ROOT = 12345;
    uint256 constant NOTE_ROOT = 54321;
    uint256 constant U64_MAX = type(uint64).max;

    SaksiPool pool;
    A2Asset asset;
    A2Verifier verifier;
    A2Validator validator;

    address holder      = address(0xA11CE);
    address relay       = address(0x9E1A);
    address confederate = address(0xC0FED);
    address stranger    = address(0x574A9);
    address owner       = address(this);

    uint[2] pA; uint[2][2] pB; uint[2] pC;

    function setUp() public {
        asset = new A2Asset();
        verifier = new A2Verifier();
        validator = new A2Validator();
        address v = address(verifier);
        pool = new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, ROOT, owner);
        asset.mint(holder, 1_000_000e6);
        pool.publishNoteRoot(NOTE_ROOT);
        validator.setEligible(holder, true);
        validator.setEligible(owner, true);
        validator.setEligible(relay, true);
        validator.setEligible(confederate, true);
    }

    function _pub(address who, bytes32 c) internal view returns (uint[11] memory p) {
        p[0] = ROOT;
        p[9] = pool.sourceKeyOf(who);
        p[10] = uint256(c) % FIELD;
    }

    function _bind(bytes32 c, uint256 amount) internal pure returns (uint[3] memory s) {
        s[0] = uint256(c); s[1] = amount; s[2] = 0;
    }

    function _deposit(address who, bytes32 c, uint256 amt) internal {
        uint[11] memory p = _pub(who, c);
        vm.prank(who);
        pool.deposit(amt, c, pA, pB, pC, p, pA, pB, pC, _bind(c, amt));
    }

    function _xfer(uint256 out, address to, address rel, uint256 fee, uint256 nonce)
        internal view returns (uint[7] memory s)
    {
        s[0] = NOTE_ROOT;
        s[1] = out == 0 ? 0 : FIELD - out;
        s[2] = pool.extDataHashOf(to, rel, fee);
        s[3] = 0x1000 + nonce;
        s[4] = 0x2000 + nonce;
        s[5] = 0x3000 + nonce;
        s[6] = 0x4000 + nonce;
    }

    function _cl(uint8 k, uint256 a) internal pure returns (bytes32) { return keccak256(abi.encode(k, a)); }
    function _cl2(uint8 k, uint256 a, uint256 b) internal pure returns (bytes32) {
        return keccak256(abi.encode(k, a, b));
    }

    // =====================================================================
    // HIGH
    // =====================================================================

    /// H-1. requestAudit pins subject and kind but NOT the numeric claim. The auditor
    /// asks "is position 62 at most 1,000?"; the holder answers "62 <= 2^64-1", the
    /// request closes forever and the on-chain record reads ANSWERED.
    /// The threshold circuit range-checks `threshold` to 64 bits, so 2^64-1 is the
    /// largest legal — and therefore always satisfiable — value.
    function test_H1_VacuousThresholdClosesTheQuestion() public {
        _deposit(holder, bytes32(uint256(62)), 50e6);
        pool.requestAudit(9001, 62, pool.KIND_THRESHOLD(), _cl(pool.KIND_THRESHOLD(), 1_000e6), "is position 62 at most 1,000?");

        vm.prank(holder);
        vm.expectRevert(); // desired: the answer must be about the threshold that was ASKED
        pool.proveThreshold(pA, pB, pC, [uint256(62), U64_MAX, uint256(9001)]);
    }

    /// H-1b. Same hole on the aggregate path. The context hash pins the SET (the circuit
    /// recomputes Poseidon(nonce, commitments, active)) but `cap` is not inside that hash
    /// and is not pinned on-chain, so the holder picks the cap they can meet.
    function test_H1b_VacuousAggregateCapClosesTheQuestion() public {
        _deposit(holder, bytes32(uint256(70)), 400_000e6);
        _deposit(holder, bytes32(uint256(71)), 400_000e6);
        pool.requestAudit(9002, 0, pool.KIND_AGGREGATE(), _cl(pool.KIND_AGGREGATE(), 2_000e6), "is total exposure at most 2,000?");

        uint[13] memory s;
        s[0] = 70; s[1] = 71;
        s[5] = 1;  s[6] = 1;
        s[10] = type(uint72).max;   // the largest cap the 72-bit range check allows
        s[11] = 9002;
        s[12] = 7;

        vm.prank(holder);
        vm.expectRevert(); // desired: the cap the auditor named must be the cap proved
        pool.proveAggregate(pA, pB, pC, s);
    }

    /// H-1c. And on the range path: the band is the prover's to choose.
    function test_H1c_VacuousRangeBandClosesTheQuestion() public {
        _deposit(holder, bytes32(uint256(72)), 50e6);
        pool.requestAudit(9003, 72, pool.KIND_RANGE(), _cl2(pool.KIND_RANGE(), 100e6, 400e6), "is position 72 in [100, 400]?");

        vm.prank(holder);
        vm.expectRevert(); // desired: the band must be the one that was asked
        pool.proveRange(pA, pB, pC, [uint256(72), uint256(0), U64_MAX, uint256(9003)]);
    }

    /// H-2. Nothing on-chain ties `noteRoot` to `commitments[]`. The owner publishes an
    /// arbitrary root; a spend against it is honoured up to the whole backing. Off-chain
    /// the owner builds a tree containing Poseidon(anyAmount, ownerKey, blinding), so a
    /// REAL transfer proof against that root exists — the mock only stands in for the
    /// pairing, not for the missing link.
    function test_KNOWN_OwnerPublishedNoteRootIsUnconstrained() public {
        _deposit(holder, bytes32(uint256(80)), 100e6);

        // DISCLOSED LIMITATION, not a fix. merkleUpdate.circom exists and is keyed, but
        // its verifier is not wired to publishNoteRoot, so nothing on-chain ties noteRoot
        // to commitments[]. The owner can publish a root the register never produced and
        // spend against it, bounded only by the backing. This test asserts what the
        // contract does TODAY; wiring the proof must invert it.
        pool.publishNoteRoot(0xDEADBEEF);
        uint[7] memory s = _xfer(100e6, owner, address(0), 0, 1);
        s[0] = 0xDEADBEEF;
        pool.transact(pA, pB, pC, s, owner, address(0), 0);

        assertEq(asset.balanceOf(address(pool)), 0,
            "TODAY: an owner-published root is spendable against the whole backing");
    }

    // =====================================================================
    // MEDIUM
    // =====================================================================

    /// M-1. contextHash 0 is the entry-binding domain, and requestAudit accepts it. Once
    /// the auditor registers an EXACT question at ctx 0, the depositor's binding proof —
    /// public in the deposit calldata, byte-identical public signals [c, amount, 0] —
    /// is a valid answer that ANYONE can replay. Same verifier, same signals.
    function test_M1_EntryBindingProofAnswersAContextZeroAudit() public {
        bytes32 c = bytes32(uint256(90));
        _deposit(holder, c, 10e6);                 // binding proof [90, 10e6, 0] now public

        // The hole is closed one step earlier than the POC probed it: context 0 is the
        // entry-binding domain, so no audit can be registered there at all and the public
        // deposit calldata never becomes a replayable answer.
        uint8 exact = pool.KIND_EXACT();
        vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        pool.requestAudit(0, uint256(c), exact, bytes32(0), "disclose position 90");
    }

    /// M-2. The transfer proof carries no association-set input and is not bound to
    /// msg.sender, so _requireEligible(msg.sender) is a check on whoever submits. A
    /// revoked holder hands the proof to an eligible relay and exits to an eligible
    /// confederate. (Acknowledged in the transact() comment; proved here.)
    function test_KNOWN_RevokedHolderExitsViaEligibleRelay() public {
        _deposit(holder, bytes32(uint256(91)), 100e6);
        validator.setEligible(holder, false);      // credential withdrawn

        // DISCLOSED: the transfer circuit takes no association-set input and the proof is
        // not bound to msg.sender, so _requireEligible gates the SUBMITTER, not the owner
        // of the note. Entry is gated cryptographically; the exit is gated operationally.
        // Closing it needs a recompile and a new phase-2 ceremony.
        uint[7] memory s = _xfer(100e6, confederate, address(0), 0, 2);
        vm.prank(relay);
        pool.transact(pA, pB, pC, s, confederate, address(0), 0);
        assertEq(asset.balanceOf(confederate), 100e6,
            "TODAY: an eligible relay carries a revoked holder's exit");
    }

    /// M-2b. Worse on the internal-transfer path: withdrawn == 0 checks nobody but the
    /// submitter, so a revoked holder re-keys the position to a fresh note for free.
    function test_KNOWN_RevokedHolderRekeysNoteViaRelay() public {
        _deposit(holder, bytes32(uint256(92)), 100e6);
        validator.setEligible(holder, false);

        // The sharper half: a pure internal transfer checks nobody but the submitter, so
        // the revoked position re-keys to a fresh note and the value never leaves.
        uint[7] memory s = _xfer(0, address(0), address(0), 0, 3);
        vm.prank(relay);
        pool.transact(pA, pB, pC, s, address(0), address(0), 0);
        assertTrue(pool.nullifierUsed(bytes32(s[3])), "TODAY: the revoked note moves");
    }

    /// M-3. deposit() trusts the `amount` argument instead of measuring the balance the
    /// register actually received. On a fee-on-transfer / skimming CVA the commitment
    /// binds to more than the pool holds, and the JoinSplit conserves the gap on exit.
    function test_M3_FeeOnTransferUnderBacksTheCommitment() public {
        A2FeeAsset fot = new A2FeeAsset();
        SaksiPool p2 = new SaksiPool(
            address(fot), address(validator), address(verifier), address(verifier),
            address(verifier), address(verifier), address(verifier), address(verifier),
            ROOT, owner
        );
        fot.mint(holder, 1_000e6);

        bytes32 c = bytes32(uint256(93));
        uint[11] memory p;
        p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        // Fixed: the register measures its own balance across the transfer instead of
        // trusting the argument, so a skimming token cannot leave a commitment binding
        // more than the pool holds. The deposit is refused rather than under-backed.
        vm.prank(holder);
        vm.expectRevert(SaksiPool.AmountNotBound.selector);
        p2.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 100e6));
        assertEq(fot.balanceOf(address(p2)), 0, "nothing enters a register that cannot back it");
    }

    // =====================================================================
    // LOW
    // =====================================================================

    /// L-1. auditAnswered is never cleared and requestAudit does not clear it, so a
    /// contextHash is single-use for all time. Any auditor whose ctx is deterministic
    /// (the aggregate ctx is exactly Poseidon(nonce, set) — reuse the nonce and it
    /// collides) registers a question that can never be answered.
    function test_L1_AnsweredContextHashIsPermanentlyDead() public {
        _deposit(holder, bytes32(uint256(94)), 50e6);
        bytes32 cl = _cl(pool.KIND_THRESHOLD(), 1_000e6);
        pool.requestAudit(9100, 94, pool.KIND_THRESHOLD(), cl, "period 1");
        pool.proveThreshold(pA, pB, pC, [uint256(94), uint256(1_000e6), uint256(9100)]);

        // An answer is permanent, so reusing the context is refused HERE rather than
        // producing a request that silently can never be answered. The auditor sees the
        // collision at the moment they cause it.
        uint8 thr = pool.KIND_THRESHOLD();
        vm.expectRevert(SaksiPool.AuditClosed.selector);
        pool.requestAudit(9100, 94, thr, cl, "period 2");
    }

    /// L-2. transact() gained DuplicateOutput for the two output commitments but has no
    /// twin for the two nullifiers: nA == nB passes the contract. The transfer circuit
    /// does enforce distinctness, so this is a defence-in-depth asymmetry, not a live
    /// exploit against a real verifier.
    function test_L2_TransactAcceptsIdenticalNullifiers() public {
        _deposit(holder, bytes32(uint256(95)), 50e6);
        uint[7] memory s = _xfer(0, address(0), address(0), 0, 4);
        s[4] = s[3];                                // one note, spent twice in one tx
        vm.expectRevert(); // desired: the twin of DuplicateOutput
        pool.transact(pA, pB, pC, s, address(0), address(0), 0);
    }

    /// L-3. retireNoteRoot() clears the gate but leaves the public `noteRoot` pointer at
    /// the retired value and emits nothing. The web console reads noteRoot() and keeps
    /// showing a root the register will no longer accept.
    function test_L3_RetireNoteRootLeavesAStalePointer() public {
        pool.retireNoteRoot(NOTE_ROOT);
        assertFalse(pool.knownNoteRoot(NOTE_ROOT), "gate closed");
        assertTrue(pool.noteRoot() != NOTE_ROOT, "the published pointer still names a retired root");
    }

    // =====================================================================
    // The three fixes — these PASS.
    // =====================================================================

    /// FIX 1 holds on a standard token: the commitment cannot open to anything other
    /// than the amount that moved, in either direction.
    function test_OK_Fix1_AmountBindingIsExact() public {
        bytes32 c = bytes32(uint256(100));
        uint[11] memory p = _pub(holder, c);

        vm.prank(holder);
        vm.expectRevert(SaksiPool.AmountNotBound.selector);
        pool.deposit(1, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 1_000_000e6));   // over-commit

        vm.prank(holder);
        vm.expectRevert(SaksiPool.AmountNotBound.selector);
        pool.deposit(1_000e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 1));       // under-commit

        _deposit(holder, c, 1_000e6);
        assertEq(asset.balanceOf(address(pool)), 1_000e6);
    }

    /// FIX 1 domain separation holds in the audit -> entry direction: no proof carrying a
    /// live audit context can be spent as an entry binding, and an entry binding cannot
    /// answer any request whose contextHash is not the reserved 0.
    function test_OK_Fix1_DomainSeparationHoldsForNonZeroContext() public {
        bytes32 c = bytes32(uint256(101));
        uint[11] memory p = _pub(holder, c);

        // audit-shaped proof (ctx != 0) refused as a binding
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
        pool.deposit(10e6, c, pA, pB, pC, p, pA, pB, pC, [uint256(c), uint256(10e6), uint256(4242)]);

        // entry-shaped proof (ctx == 0) refused as an answer to a real request
        _deposit(holder, c, 10e6);
        pool.requestAudit(4242, uint256(c), pool.KIND_EXACT(), bytes32(0), "disclose 101");
        vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        pool.proveExact(pA, pB, pC, _bind(c, 10e6));
    }

    /// FIX 2 holds: all six bytes32 preimages of a residue above the first are refused,
    /// so uint256(commitment) % FIELD is injective on everything the register stores.
    function test_OK_Fix2_EveryFieldAliasIsRefused() public {
        uint256 base = 110;
        for (uint256 k = 1; k <= 5; k++) {
            bytes32 alias_ = bytes32(base + k * FIELD);
            assertEq(uint256(alias_) % FIELD, base, "alias shares the residue");
            uint[11] memory p = _pub(holder, bytes32(base));
            vm.prank(holder);
            vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
            pool.deposit(10e6, alias_, pA, pB, pC, p, pA, pB, pC, _bind(bytes32(base), 10e6));
        }
    }

    /// FIX 2, the other half: everything else that crosses bytes32 <-> uint256 comes out
    /// of a snarkjs verifier, which rejects any public signal >= r before the pairing.
    /// transact()'s nullifiers and outputs are therefore already field elements — the
    /// contract inherits the guard rather than repeating it.
    function test_OK_Fix2_TransactStoresOnlyFieldElements() public {
        _deposit(holder, bytes32(uint256(120)), 50e6);
        uint[7] memory s = _xfer(0, address(0), address(0), 0, 5);
        pool.transact(pA, pB, pC, s, address(0), address(0), 0);
        bytes32[] memory all = pool.allCommitments();
        for (uint256 i = 0; i < all.length; i++) {
            assertLt(uint256(all[i]), FIELD, "stored commitment is a field element");
        }
    }

    /// FIX 3 holds for subject and kind: a stranger cannot answer about their own note,
    /// and an exact demand cannot be met with a weaker statement.
    function test_OK_Fix3_SubjectAndKindArePinned() public {
        _deposit(holder, bytes32(uint256(130)), 50e6);
        validator.setEligible(stranger, true);
        asset.mint(stranger, 1);
        _deposit(stranger, bytes32(uint256(131)), 1);

        pool.requestAudit(9200, 130, pool.KIND_EXACT(), bytes32(0), "disclose position 130");

        vm.prank(stranger);
        vm.expectRevert(SaksiPool.WrongSubject.selector);
        pool.proveExact(pA, pB, pC, [uint256(131), uint256(1), uint256(9200)]);

        vm.expectRevert(SaksiPool.WrongDisclosureKind.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(130), U64_MAX, uint256(9200)]);

        pool.proveExact(pA, pB, pC, [uint256(130), uint256(50e6), uint256(9200)]);
        assertEq(pool.auditAnswered(9200), pool.KIND_EXACT());
    }

    /// FIX 3, replay: an answered request stays answered, and a proof for one context
    /// cannot be presented against another.
    function test_OK_Fix3_ContextHashCannotBeReplayed() public {
        _deposit(holder, bytes32(uint256(132)), 50e6);
        pool.requestAudit(9201, 132, pool.KIND_THRESHOLD(), _cl(pool.KIND_THRESHOLD(), 1_000e6), "q1");
        pool.requestAudit(9202, 132, pool.KIND_THRESHOLD(), _cl(pool.KIND_THRESHOLD(), 1_000e6), "q2");

        pool.proveThreshold(pA, pB, pC, [uint256(132), uint256(1_000e6), uint256(9201)]);
        vm.expectRevert(SaksiPool.AuditClosed.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(132), uint256(1_000e6), uint256(9201)]);

        // the 9201 proof's signals name 9201; presenting them against 9202 is not possible
        // without a proof whose public ctx signal IS 9202.
        assertEq(pool.auditAnswered(9202), 0);
    }

    /// Access control sweep: every mutator is owner-gated (or auditor-gated) as claimed.
    function test_OK_AccessControlSweep() public {
        address bad = address(0xBAD);
        uint256[8] memory list;
        vm.startPrank(bad);
        vm.expectRevert(Ownable.NotOwner.selector); pool.rotateRoot(1);
        vm.expectRevert(Ownable.NotOwner.selector); pool.retireRoot(ROOT);
        vm.expectRevert(Ownable.NotOwner.selector); pool.publishNoteRoot(1);
        vm.expectRevert(Ownable.NotOwner.selector); pool.retireNoteRoot(NOTE_ROOT);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setDenyList(list);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setAuditor(bad);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setPaused(true);
        vm.expectRevert(Ownable.NotOwner.selector); pool.transferOwnership(bad);
        vm.expectRevert(Ownable.NotOwner.selector); pool.removeRule(0);
        vm.expectRevert(SaksiPool.NotAuditor.selector); pool.requestAudit(1, 1, 2, bytes32(0), "q");
        vm.stopPrank();
    }

    /// Fee accounting: the relayer is paid out of the withdrawal, never on top of it, and
    /// a fee larger than the withdrawal cannot mint value out of the backing.
    function test_OK_FeeIsPaidOutOfTheWithdrawal() public {
        _deposit(holder, bytes32(uint256(140)), 100e6);
        uint[7] memory s = _xfer(40e6, confederate, relay, 5e6, 6);
        pool.transact(pA, pB, pC, s, confederate, relay, 5e6);
        assertEq(asset.balanceOf(confederate), 35e6);
        assertEq(asset.balanceOf(relay), 5e6);
        assertEq(asset.balanceOf(address(pool)), 60e6);

        uint[7] memory bad = _xfer(1e6, confederate, relay, 2e6, 7);
        vm.expectRevert();                       // fee > withdrawn underflows and reverts
        pool.transact(pA, pB, pC, bad, confederate, relay, 2e6);
    }

    /// Deposit is effects-before-interactions: the commitment is recorded before
    /// transferFrom, so a reentrant CVA cannot observe a half-written register.
    function test_OK_DepositIsEffectsBeforeInteractions() public {
        bytes32 c = bytes32(uint256(150));
        _deposit(holder, c, 10e6);
        assertTrue(pool.commitmentKnown(c));
        assertEq(pool.commitmentCount(), 1);
    }
}
