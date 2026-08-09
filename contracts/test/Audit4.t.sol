// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Fourth-pass audit: COMPLETENESS, not soundness. Three earlier passes attacked the
// binding and the accounting. This one asks a different question — what is missing.
//
//   1. The state machine. Every state the pool can hold, which calls work in it, and
//      whether it can be left.
//   2. The surface with no test at all: views, admin branches, success paths that only
//      ever appear as an access-control revert.
//   3. The circuits' fixed widths (AGG_SLOTS 5, DENY_SLOTS 8, levels 10, 2-in/2-out) —
//      what breaks at the boundary and whether the constant agrees with itself across
//      Solidity, Circom, ops and the web decoder.
//   4. Fee and relayer economics at their degenerate corners.
//   5. Events: whether an indexer can rebuild the register from the log alone.
//
// Naming:
//   test_S*  state-machine reachability
//   test_U*  previously untested surface
//   test_C*  circuit constants and their boundaries
//   test_R*  relayer / fee economics
//   test_E*  event completeness
//
// A test whose name contains FINDING pins behaviour that is WRONG or INCOMPLETE today.
// It asserts what the contract does NOW so that a fix inverts it; the comment above each
// says what the fix must change. Everything else asserts an invariant that holds.
//
// Nothing here modifies src/, circuits/, ops/, web/, or the existing test files.

import {Test, Vm} from "forge-std/Test.sol";
import {SaksiPool, IAPassComplianceValidator, Ownable} from "../src/SaksiPool.sol";

contract A4Validator {
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

contract A4Asset {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// The CVA is a third-party Cleanverse A-Token. A meaningful minority of ERC20s refuse a
/// zero-value transfer; the register's fee == withdrawn corner performs exactly one.
contract A4NoZeroAsset {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        require(a != 0, "zero-value transfer");
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(a != 0, "zero-value transfer");
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract A4Verifier {
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

contract Audit4Test is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant ROOT = 12345;
    uint256 constant NOTE_ROOT = 54321;

    /// commitments.length. Established by Audit3's capacity test; re-asserted in
    /// test_C5 so a storage reshuffle fails loudly here instead of silently no-oping.
    uint256 constant SLOT_COMMITMENTS = 13;

    SaksiPool pool;
    A4Asset asset;
    A4Verifier verifier;
    A4Validator validator;

    address holder   = address(0xA11CE);
    address relay    = address(0x9E1A);
    address payee    = address(0xC0FED);
    address stranger = address(0x574A9);
    address owner    = address(this);

    uint[2] pA; uint[2][2] pB; uint[2] pC;

    function setUp() public {
        asset = new A4Asset();
        verifier = new A4Verifier();
        validator = new A4Validator();
        address v = address(verifier);
        pool = new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, ROOT, owner);
        asset.mint(holder, 1_000_000e6);
        pool.publishNoteRoot(NOTE_ROOT);
        validator.setEligible(holder, true);
        validator.setEligible(owner, true);
        validator.setEligible(relay, true);
        validator.setEligible(payee, true);
    }

    // ---- helpers ---------------------------------------------------------

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

    /// Force commitments.length without mining the leaves.
    function _setLeafCount(uint256 n) internal {
        vm.store(address(pool), bytes32(SLOT_COMMITMENTS), bytes32(n));
    }

    /// Logs emitted by the pool itself, discarding the asset's and the validator's.
    function _poolLogs(Vm.Log[] memory all) internal view returns (Vm.Log[] memory out) {
        uint256 n;
        for (uint256 i = 0; i < all.length; i++) if (all[i].emitter == address(pool)) n++;
        out = new Vm.Log[](n);
        uint256 k;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].emitter == address(pool)) { out[k] = all[i]; k++; }
        }
    }

    /// True if `needle` appears anywhere in a log — as a topic or inside the data.
    function _mentions(Vm.Log memory l, uint256 needle) internal pure returns (bool) {
        for (uint256 t = 0; t < l.topics.length; t++) {
            if (uint256(l.topics[t]) == needle) return true;
        }
        for (uint256 o = 0; o + 32 <= l.data.length; o += 32) {
            uint256 word;
            bytes memory d = l.data;
            assembly { word := mload(add(add(d, 32), o)) }
            if (word == needle) return true;
        }
        return false;
    }

    // =====================================================================
    // 1. THE STATE MACHINE
    // =====================================================================

    /// FINDING (HIGH). The tree-capacity guard makes the register a ONE-WAY VALVE at the
    /// top of the tree, and then a sealed box.
    ///
    /// `commitments[]` only ever grows: a deposit appends 1, a transfer appends 2 and
    /// never removes the 2 it nullifies. The circuits are fixed at 2-in/2-out with no
    /// 0-out variant, so even a pure exit needs two free leaves. Therefore:
    ///
    ///   length == TREE_CAPACITY - 1 : deposit SUCCEEDS, transact reverts TreeFull
    ///                                 -> value can enter and can never leave
    ///   length == TREE_CAPACITY     : both revert
    ///                                 -> the whole backing is stranded, permanently
    ///
    /// transact() is the only function in the contract that calls asset.transfer, and there
    /// is no owner escape hatch, so nothing can move the asset out of a full register.
    /// 2^10 leaves is a lifetime budget: ~512 transfers, or 1024 deposits, ever.
    ///
    /// A fix must invert this: either the guard admits a transfer that frees as many leaves
    /// as it takes, or the tree is deep enough that the ceiling is not reachable, or an
    /// exit path exists that does not insert leaves. Raising `levels` is a recompile and a
    /// new ceremony, so this is a deployment-blocking limitation, not a patch.
    function test_S1_AnEntryReservesTheRoomItsOwnExitNeeds() public {
        _deposit(holder, bytes32(uint256(1000)), 500e6);
        uint256 cap = pool.TREE_CAPACITY();

        // One free leaf is no longer enough to enter: an exit costs two, so a deposit that
        // fits in the last leaf would be a deposit the register could never pay out.
        _setLeafCount(cap - 1);
        assertEq(pool.commitmentCount(), cap - 1, "storage slot still holds the array length");
        uint[11] memory pin = _pub(holder, bytes32(uint256(1001)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.TreeFull.selector);
        pool.deposit(100e6, bytes32(uint256(1001)), pA, pB, pC, pin, pA, pB, pC,
            _bind(bytes32(uint256(1001)), 100e6));

        // And with the room an entry reserved, the exit still fits.
        _setLeafCount(cap - 2);
        uint[7] memory exit = _xfer(100e6, payee, address(0), 0, 1);
        pool.transact(pA, pB, pC, exit, payee, address(0), 0);
        assertEq(asset.balanceOf(payee), 100e6, "the backing can always leave");

        // At capacity every path is shut, with the backing still inside.
        _setLeafCount(cap);
        uint[11] memory p = _pub(holder, bytes32(uint256(1002)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.TreeFull.selector);
        pool.deposit(1e6, bytes32(uint256(1002)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(1002)), 1e6));

        uint[7] memory exit2 = _xfer(1, payee, address(0), 0, 2);
        vm.expectRevert(SaksiPool.TreeFull.selector);
        pool.transact(pA, pB, pC, exit2, payee, address(0), 0);

        // The register is closed to new value, which is the correct terminal state: nothing
        // is stranded, because every position inside it entered under a guard that had
        // already reserved the two leaves its exit would need.
        assertEq(pool.balance(), 400e6, "what remains is what was never withdrawn, not what cannot be");
    }

    /// FINDING (MEDIUM, by design but under-stated). Deregistration by Cleanverse freezes
    /// the EXIT as well as the entry. Both edges route through _requireEligible, and the
    /// Validator reverts rather than returning false for an unregistered pool, so an
    /// in-register holder cannot withdraw their own asset until Cleanverse re-registers.
    /// The pool cannot leave this state under its own power: there is no owner override
    /// and no `setValidator` — `validator` is immutable.
    ///
    /// This is arguably correct for a compliance-first register. It is stated here because
    /// nothing in the source says the exit is affected, and the docs describe the Validator
    /// as gate ONE (entry).
    function test_S2_FINDING_DeregistrationFreezesTheExitToo() public {
        _deposit(holder, bytes32(uint256(1010)), 100e6);
        validator.setRegistered(false);

        uint[11] memory p = _pub(holder, bytes32(uint256(1011)));
        vm.prank(holder);
        vm.expectRevert(bytes("pool not registered"));
        pool.deposit(1e6, bytes32(uint256(1011)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(1011)), 1e6));

        uint[7] memory exit = _xfer(100e6, payee, address(0), 0, 3);
        vm.expectRevert(bytes("pool not registered"));
        pool.transact(pA, pB, pC, exit, payee, address(0), 0);

        assertFalse(pool.registeredWithValidator(), "the state is at least diagnosable");
        assertEq(pool.balance(), 100e6, "FINDING: the backing is frozen until a third party acts");
    }

    /// Pausing stops VALUE but not ANSWERABILITY: the audit machinery has no notPaused
    /// modifier, so questions can still be asked and closed permanently while the register
    /// is halted. Correct for a register that must stay answerable, and deliberate enough
    /// to pin — a fix that added notPaused to the disclosure path would break it.
    function test_S3_PausedStopsValueButNotAnswerability() public {
        _deposit(holder, bytes32(uint256(1020)), 100e6);
        pool.setPaused(true);

        uint[7] memory s = _xfer(10e6, payee, address(0), 0, 4);
        vm.expectRevert(SaksiPool.Paused.selector);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);

        uint8 EXACT = pool.KIND_EXACT();
        pool.requestAudit(1_0020, 1020, EXACT, bytes32(0), "disclose while halted");
        pool.proveExact(pA, pB, pC, [uint256(1020), uint256(100e6), uint256(1_0020)]);
        assertEq(pool.auditAnswered(1_0020), EXACT, "a halted register still answers, and closes for good");

        pool.setPaused(false);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        assertEq(asset.balanceOf(payee), 10e6, "the pause is escapable");
    }

    /// The zero-note-root state. A fresh register refuses every transfer, and root 0 is not
    /// a known root by default, so the retireNoteRoot -> noteRoot = 0 reset is safe. It is
    /// only unsafe if the owner ever publishes 0 explicitly, which nothing prevents.
    function test_S4_ZeroNoteRootIsRefusedUnlessTheOwnerPublishesIt() public {
        pool.retireNoteRoot(NOTE_ROOT);
        assertEq(pool.noteRoot(), 0, "the pointer resets to zero");
        assertFalse(pool.knownNoteRoot(0), "and zero is not a spendable root");

        uint[7] memory s = _xfer(0, payee, address(0), 0, 5);
        s[0] = 0;
        vm.expectRevert(SaksiPool.UnknownNoteRoot.selector);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);

        // FINDING (LOW). publishNoteRoot has no zero guard, and once 0 is known the
        // retire-to-zero reset points the console at a live root. Unreachable through a
        // real verifier — the empty depth-10 tree does not hash to 0 — so this is a
        // defence-in-depth gap. A fix rejects a zero root at publication.
        pool.publishNoteRoot(0);
        assertTrue(pool.knownNoteRoot(0), "FINDING: zero is publishable as a note root");
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        assertTrue(pool.nullifierUsed(bytes32(s[3])), "FINDING: and then spendable against");

        // escapable in the ordinary direction
        pool.publishNoteRoot(NOTE_ROOT);
        assertEq(pool.noteRoot(), NOTE_ROOT);
    }

    /// Every association root retired: entry closes, and rotation reopens it. Not terminal.
    function test_S5_NoKnownAssociationRootIsEscapable() public {
        pool.retireRoot(ROOT);
        uint[11] memory p = _pub(holder, bytes32(uint256(1030)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.UnknownRoot.selector);
        pool.deposit(1e6, bytes32(uint256(1030)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(1030)), 1e6));

        // rotateRoot re-instates a retired root — retirement is not permanent
        pool.rotateRoot(ROOT);
        assertTrue(pool.knownRoot(ROOT), "a retired root can be brought back");
        _deposit(holder, bytes32(uint256(1030)), 1e6);
        assertTrue(pool.commitmentKnown(bytes32(uint256(1030))));
    }

    /// Zero backing: the shielded middle keeps working, only the exit is bounded.
    function test_S6_ZeroBackingStillMovesNotesInternally() public {
        assertEq(pool.balance(), 0);
        uint[7] memory s = _xfer(0, payee, address(0), 0, 6);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        assertEq(pool.commitmentCount(), 2, "an empty register still re-keys notes");

        uint[7] memory w = _xfer(1, payee, address(0), 0, 7);
        vm.expectRevert(SaksiPool.ExceedsBacking.selector);
        pool.transact(pA, pB, pC, w, payee, address(0), 0);
    }

    /// The auditor can never be unset. The constructor seeds it from the owner, Ownable
    /// refuses a zero owner, and setAuditor refuses address(0) — so there is no
    /// auditor-unset state and no unanswerable register.
    function test_S7_AuditorCanNeverBeUnset() public {
        assertEq(pool.auditor(), owner, "seeded from the owner at construction");
        vm.expectRevert(SaksiPool.NotAuditor.selector);
        pool.setAuditor(address(0));
        assertEq(pool.auditor(), owner);

        pool.setAuditor(stranger);
        assertEq(pool.auditor(), stranger);
        uint8 EXACT = pool.KIND_EXACT();
        vm.expectRevert(SaksiPool.NotAuditor.selector);
        pool.requestAudit(1, 1, EXACT, bytes32(0), "q");    // the old auditor lost the role
    }

    /// FINDING (MEDIUM). transferOwnership is SINGLE-STEP with no accept, and it does not
    /// move the auditor. Both matter more here than usual:
    ///
    ///   * publishNoteRoot is the register's liveness lever. An owner set to an address
    ///     that cannot act leaves deposits working against the current root and the note
    ///     root frozen — so the off-chain tree advances past a root nothing can publish,
    ///     and every note created after it is unspendable. Not recoverable.
    ///   * the outgoing owner stays the auditor until the new owner calls setAuditor, so
    ///     ownership handover silently leaves the answerability role behind.
    ///
    /// A fix adds a two-step accept; whether the auditor should follow the owner is a
    /// policy call, but it should be stated rather than incidental.
    function test_S8_FINDING_OwnershipIsSingleStepAndLeavesTheAuditorBehind() public {
        address newOwner = address(0x0FF1CE);
        pool.transferOwnership(newOwner);

        assertEq(pool.owner(), newOwner, "the handover completes with no acceptance");
        assertEq(pool.auditor(), owner, "FINDING: the auditor role did not follow the owner");

        // the old owner is out of the admin seat immediately
        vm.expectRevert(Ownable.NotOwner.selector);
        pool.publishNoteRoot(999);

        // ...but is still the auditor, and can still close questions
        uint8 EXACT = pool.KIND_EXACT();
        _deposit(holder, bytes32(uint256(1040)), 10e6);
        pool.requestAudit(1_0040, 1040, EXACT, bytes32(0), "asked by the former owner");
        assertTrue(pool.auditRequested(1_0040), "FINDING: the outgoing owner retains the auditor role");
    }

    function test_S9_ConstructorRefusesAZeroOwner() public {
        address v = address(verifier);
        vm.expectRevert(Ownable.ZeroOwner.selector);
        new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, ROOT, address(0));
    }

    /// FINDING (LOW, deployment footgun). The constructor marks its `_aspRoot` known with
    /// no zero check, so a pool deployed with ASP_ROOT=0 — an unset env var in
    /// script/DeployPool.s.sol — treats 0 as a valid association root from block one.
    /// Unreachable through a real verifier (the empty depth-10 tree does not hash to 0),
    /// so the fix is a one-line guard, not an emergency.
    function test_S10_FINDING_ZeroAspRootIsKnownFromConstruction() public {
        address v = address(verifier);
        SaksiPool p0 = new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, 0, owner);
        assertTrue(p0.knownRoot(0), "FINDING: an unset ASP_ROOT deploys a pool that accepts root 0");
        assertEq(p0.aspRoot(), 0);
    }

    // =====================================================================
    // 2. THE SURFACE WITH NO TEST
    // =====================================================================

    /// removeRule only ever appeared as an access-control revert. Its success path — and
    /// the fact that the mock (and the live contract) removes by swap-and-pop, so removal
    /// REORDERS the remaining rules and every later index shifts — was never exercised.
    function test_U1_RemoveRuleSuccessPathReordersTheRemainder() public {
        pool.setRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 10, 0, false, 0));
        pool.addRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 20, 0, false, 0));
        pool.addRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 30, 0, false, 0));
        assertEq(pool.activeRules().length, 3);

        pool.removeRule(0);
        assertEq(pool.activeRules().length, 2);
        assertEq(pool.activeRules()[0].minTier, 30, "swap-and-pop: index 0 is now the former last rule");
        assertEq(pool.activeRules()[1].minTier, 20);

        // setRule REPLACES the whole set, addRule appends — the two are not siblings
        pool.setRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 99, 0, false, 0));
        assertEq(pool.activeRules().length, 1, "setRule is a replace, not an upsert");
        assertEq(pool.activeRules()[0].minTier, 99);
    }

    /// setPaused: the event, the round trip, and idempotence. Only the entry-blocking
    /// branch and the access control had ever been asserted.
    function test_U2_SetPausedEmitsAndRoundTrips() public {
        assertFalse(pool.paused());

        vm.expectEmit(false, false, false, true, address(pool));
        emit SaksiPool.PausedSet(true);
        pool.setPaused(true);
        assertTrue(pool.paused());

        // no idempotence guard: pausing an already-paused register emits again. Harmless
        // for state, but an indexer counting PausedSet sees a transition that never
        // happened. Pinned so a fix that adds the guard is a deliberate change.
        vm.expectEmit(false, false, false, true, address(pool));
        emit SaksiPool.PausedSet(true);
        pool.setPaused(true);

        pool.setPaused(false);
        assertFalse(pool.paused());
    }

    /// transferOwnership's success path. Only its zero-address revert had a test.
    function test_U3_TransferOwnershipSuccessPathAndEvent() public {
        address next = address(0xBEEF01);
        vm.expectEmit(true, true, false, false, address(pool));
        emit Ownable.OwnershipTransferred(owner, next);
        pool.transferOwnership(next);
        assertEq(pool.owner(), next);

        vm.expectRevert(Ownable.NotOwner.selector);
        pool.setPaused(true);

        vm.prank(next);
        pool.setPaused(true);
        assertTrue(pool.paused(), "the new owner holds the whole admin surface");
    }

    /// retireRoot's event, and the fact that retirement is reversible by rotation. The
    /// association set has a distinct RootRetired event — which is exactly what the note
    /// root lacks (see test_E2).
    function test_U4_RetireRootEmitsADistinctEvent() public {
        vm.expectEmit(true, false, false, false, address(pool));
        emit SaksiPool.RootRetired(ROOT);
        pool.retireRoot(ROOT);
        assertFalse(pool.knownRoot(ROOT));

        vm.expectEmit(true, true, false, false, address(pool));
        emit SaksiPool.RootRotated(ROOT, 777);
        pool.rotateRoot(777);
        assertEq(pool.aspRoot(), 777);
        assertTrue(pool.knownRoot(777));
        assertFalse(pool.knownRoot(ROOT), "rotation does not resurrect what was retired");
    }

    /// retireNoteRoot's OTHER branch — retiring a root that is not the current pointer —
    /// had no test. The pointer must survive it, or retiring an old root would blind the
    /// console to the live one.
    function test_U5_RetireNoteRootOnANonCurrentRootLeavesThePointer() public {
        pool.publishNoteRoot(0xB0B);
        assertEq(pool.noteRoot(), 0xB0B);

        pool.retireNoteRoot(NOTE_ROOT);                 // the superseded root, not the pointer
        assertFalse(pool.knownNoteRoot(NOTE_ROOT), "the old root is closed");
        assertEq(pool.noteRoot(), 0xB0B, "the live pointer is untouched");
        assertTrue(pool.knownNoteRoot(0xB0B), "and still spendable");

        uint[7] memory s = _xfer(0, payee, address(0), 0, 8);
        s[0] = NOTE_ROOT;
        vm.expectRevert(SaksiPool.UnknownNoteRoot.selector);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
    }

    /// sourceKeyOf is the pool's half of the association-set leaf derivation — ops/asp.mjs
    /// and the web console both recompute it. Its three load-bearing properties were never
    /// asserted anywhere: it is a field element, deterministic, and injective in practice.
    function testFuzz_U6_SourceKeyOfIsInFieldAndDeterministic(address a, address b) public view {
        uint256 ka = pool.sourceKeyOf(a);
        assertLt(ka, FIELD, "an association-set leaf must be a field element");
        assertEq(ka, pool.sourceKeyOf(a), "deterministic");
        if (a != b) assertTrue(ka != pool.sourceKeyOf(b), "distinct wallets get distinct leaves");
        assertTrue(ka != 0, "and never the zero leaf an empty deny slot holds");
    }

    /// extDataHashOf is what stops a withdrawal being re-aimed. It must be a field element
    /// (the circuit takes it as a signal) and must separate all three arguments.
    function testFuzz_U7_ExtDataHashOfIsInFieldAndSeparatesEveryArgument(
        address r, address rl, uint256 fee
    ) public view {
        uint256 h = pool.extDataHashOf(r, rl, fee);
        assertLt(h, FIELD, "extDataHash is a circuit signal, so it must reduce into the field");
        assertTrue(h != pool.extDataHashOf(address(uint160(r) ^ 1), rl, fee), "recipient is bound");
        assertTrue(h != pool.extDataHashOf(r, address(uint160(rl) ^ 1), fee), "relayer is bound");
        assertTrue(h != pool.extDataHashOf(r, rl, fee ^ 1), "fee is bound");
    }

    /// FINDING (LOW). isEligible is documented as the view "the consoles read so the
    /// eligibility a user is shown is the same one the chain will enforce". On a
    /// deregistered pool the Validator REVERTS, so the view reverts instead of returning
    /// false — the console cannot render "not eligible", it renders an error. Its sibling
    /// registeredWithValidator is the safe read. A fix wraps the call in a try/catch and
    /// returns false; until then the console must read registeredWithValidator first.
    function test_U8_FINDING_IsEligibleRevertsOnADeregisteredPool() public {
        assertTrue(pool.isEligible(holder));
        assertFalse(pool.isEligible(stranger), "an uncredentialed wallet reads false, as intended");

        validator.setRegistered(false);
        vm.expectRevert(bytes("pool not registered"));
        pool.isEligible(holder);
        assertFalse(pool.registeredWithValidator(), "only this view survives the state");
    }

    /// registeredWithValidator had no test at all.
    function test_U9_RegisteredWithValidatorTracksTheValidator() public {
        assertTrue(pool.registeredWithValidator());
        validator.setRegistered(false);
        assertFalse(pool.registeredWithValidator());
        validator.setRegistered(true);
        assertTrue(pool.registeredWithValidator());
    }

    /// allCommitments is the register itself, and the web console's whole view of it. Its
    /// ORDER is the leaf order the circuits index against, so it must match the leafIndex
    /// the events published — never asserted before.
    function test_U10_AllCommitmentsIsTheLeafOrderTheEventsPublished() public {
        assertEq(pool.allCommitments().length, 0, "a fresh register is empty, not unset");

        _deposit(holder, bytes32(uint256(1100)), 10e6);
        _deposit(holder, bytes32(uint256(1101)), 20e6);
        uint[7] memory s = _xfer(0, payee, address(0), 0, 9);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);

        bytes32[] memory all = pool.allCommitments();
        assertEq(all.length, 4, "two deposits and two transfer outputs");
        assertEq(all.length, pool.commitmentCount(), "the array view and the counter agree");
        assertEq(all[0], bytes32(uint256(1100)));
        assertEq(all[1], bytes32(uint256(1101)));
        assertEq(all[2], bytes32(s[5]), "transfer outputs append in signal order");
        assertEq(all[3], bytes32(s[6]));
        for (uint256 i = 0; i < all.length; i++) {
            assertEq(pool.commitments(i), all[i], "the indexed getter agrees with the bulk view");
        }
    }

    /// getDenyList and balance: two views with no test.
    function test_U11_DenyListAndBalanceViews() public {
        uint256[8] memory empty = pool.getDenyList();
        assertEq(empty.length, pool.DENY_SLOTS(), "the view width is the constant");
        for (uint256 i = 0; i < empty.length; i++) assertEq(empty[i], 0);

        // balance() is a live read of the asset, not a mirrored counter
        assertEq(pool.balance(), 0);
        _deposit(holder, bytes32(uint256(1110)), 42e6);
        assertEq(pool.balance(), asset.balanceOf(address(pool)), "balance() is the live asset read");
        assertEq(pool.balance(), 42e6);

        // the deny list is set AFTER the deposit: any change to it invalidates every
        // unsubmitted compliance proof, which test_C2 pins as a finding in its own right.
        uint256[8] memory list;
        list[0] = 111; list[7] = 888;
        pool.setDenyList(list);
        uint256[8] memory read = pool.getDenyList();
        assertEq(read[0], 111);
        assertEq(read[7], 888);
        assertEq(read[3], 0, "an unused slot reads as the zero key, indistinguishable from 'deny 0'");
    }

    /// claimHash answers for kinds requestAudit refuses. Dead code today — the kind guard
    /// fires first — but a caller building a claim off-chain gets a plausible-looking hash
    /// for a nonsense kind rather than a revert.
    function test_U12_ClaimHashIsTotalOverKindsRequestAuditRefuses() public {
        assertTrue(pool.claimHash(0, 1, 0) != bytes32(0), "kind 0 still hashes");
        assertTrue(pool.claimHash(9, 1, 0) != bytes32(0), "so does an out-of-range kind");

        uint8 EXACT = pool.KIND_EXACT();
        vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        pool.requestAudit(1_1200, 1, 0, bytes32(0), "kind zero");
        vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        pool.requestAudit(1_1201, 1, 9, bytes32(0), "kind nine");
        assertEq(EXACT, 1, "the accepted band is 1..4");
    }

    // =====================================================================
    // 3. CIRCUIT CONSTANTS AND THEIR BOUNDARIES
    // =====================================================================

    /// The fixed widths are consistent, and the verifier interfaces PIN them: the public
    /// signal count is derived arithmetically from each constant, so bumping a constant
    /// without recompiling its circuit and swapping its IVerifierN fails here.
    ///
    ///   compliance  IVerifier11 : aspRoot + denyList[DENY_SLOTS] + sourceKey + bindHash
    ///   aggregate   IVerifier13 : commitments[AGG] + active[AGG] + cap + ctx + nonce
    ///   transfer    IVerifier7  : root + publicAmount + extDataHash + 2 nulls + 2 outs
    ///   exact/thr   IVerifier3  : commitment + figure + ctx
    ///   range       IVerifier4  : commitment + lower + upper + ctx
    ///
    /// Confirmed against the Circom sources: Compliance(10, 8), AggregateDisclosure(5),
    /// Transfer(10, 2, 2), MerkleUpdate(10). ops/asp.mjs LEVELS = 10, ops/audit.mjs
    /// AGG_SLOTS = 5, web/lib/chain.ts decodeDenyList loops to 8. All four layers agree.
    function test_C1_ConstantsMatchTheVerifierSignalWidths() public view {
        assertEq(pool.DENY_SLOTS(), 8);
        assertEq(pool.AGG_SLOTS(), 5);
        assertEq(pool.TREE_CAPACITY(), 1 << 10, "levels = 10 in every circuit");

        assertEq(1 + pool.DENY_SLOTS() + 2, 11, "compliance is IVerifier11");
        assertEq(2 * pool.AGG_SLOTS() + 3, 13, "aggregate is IVerifier13");
        assertEq(pool.getDenyList().length, pool.DENY_SLOTS(), "the view cannot drift from the constant");

        // 2-in/2-out is not a constant anywhere in Solidity — it is implied by IVerifier7
        // (3 header signals + 2 nullifiers + 2 outputs) and by transact() inserting exactly
        // two leaves, which test_U10 asserts. Nothing here can drift-check it, so the
        // arity lives in the transact() signature and in that test.
        assertEq(uint256(3 + 2 + 2), uint256(7), "transfer is IVerifier7: fixed at 2-in / 2-out");
    }

    /// FINDING (MEDIUM, operational). The deny list is a POSITIONAL equality check —
    /// deposit compares pubSignals[1+i] to denyList[i] slot by slot. So a reorder that
    /// changes nothing about the SET invalidates every unsubmitted compliance proof, with
    /// a DenyListMismatch that names no cause. Adding an entry does the same.
    ///
    /// The circuit only asks that sourceKey differs from each of the eight, which is
    /// order-independent — so the ordering constraint is entirely the contract's, and
    /// nothing normalises or documents it. A fix sorts the list on write, or compares a
    /// hash of a canonicalised list.
    function test_C2_FINDING_DenyListIsOrderSensitive() public {
        uint256[8] memory list;
        list[0] = 111; list[1] = 222;
        pool.setDenyList(list);

        // a proof built against [111, 222, 0...]
        bytes32 c = bytes32(uint256(1200));
        uint[11] memory p = _pub(holder, c);
        p[1] = 111; p[2] = 222;
        vm.prank(holder);
        pool.deposit(10e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 10e6));

        // the SAME two keys, swapped. The set is identical; the proof is now worthless.
        uint256[8] memory swapped;
        swapped[0] = 222; swapped[1] = 111;
        pool.setDenyList(swapped);

        bytes32 c2 = bytes32(uint256(1201));
        uint[11] memory p2 = _pub(holder, c2);
        p2[1] = 111; p2[2] = 222;
        vm.prank(holder);
        vm.expectRevert(SaksiPool.DenyListMismatch.selector);
        pool.deposit(10e6, c2, pA, pB, pC, p2, pA, pB, pC, _bind(c2, 10e6));
    }

    /// The DENY_SLOTS = 8 ceiling, stated as a deployment requirement rather than a bug.
    /// The list is a fixed uint256[8] in the ABI, in storage, in the circuit's public
    /// signals and in the web decoder. There is no ninth sanctioned key — not "it reverts",
    /// but "it cannot be expressed". A real sanctions perimeter is thousands of entries, so
    /// a production register needs the deny check restructured as a non-membership Merkle
    /// proof against a root, the way the allow side already works. That is a circuit
    /// change, a new verifier and a new interface width.
    function test_C3_DenyListHasExactlyEightSlotsAndNoNinth() public {
        uint256[8] memory full;
        for (uint256 i = 0; i < 8; i++) full[i] = 1000 + i;
        pool.setDenyList(full);

        uint256[8] memory read = pool.getDenyList();
        for (uint256 i = 0; i < 8; i++) assertEq(read[i], 1000 + i, "all eight slots are usable");

        // the ninth key has nowhere to go: the only way to add it is to evict one of the
        // eight, which un-sanctions that key in the same transaction.
        uint256[8] memory evicted = full;
        evicted[0] = 9999;
        pool.setDenyList(evicted);
        assertEq(pool.getDenyList()[0], 9999, "the ninth key costs the first one");
        assertTrue(pool.DENY_SLOTS() == 8, "and the width is not a parameter");
    }

    /// FINDING (LOW, defence-in-depth). proveAggregate has no minimum active count, so an
    /// all-inactive aggregate — a report over the empty set, total zero, trivially under
    /// any cap — passes every contract-side check and closes the request. The circuit
    /// blocks it in practice: auditContextHash is Poseidon over the commitments AND the
    /// active flags, so an all-inactive set has a different context hash than the one the
    /// auditor registered, and no proof exists. Same class as the publicAmount == FIELD
    /// gap: the contract leans on the circuit where it could check for itself.
    /// A fix requires at least one active slot.
    function test_C4_FINDING_AggregateAcceptsAnAllInactiveSet() public {
        uint8 AGG = pool.KIND_AGGREGATE();
        pool.requestAudit(1_2400, 0, AGG, _cl(AGG, 2_000e6), "total exposure at most 2,000?");

        uint[13] memory s;                       // every commitment 0, every flag 0
        s[10] = 2_000e6; s[11] = 1_2400; s[12] = 1;
        pool.proveAggregate(pA, pB, pC, s);

        assertEq(pool.auditAnswered(1_2400), AGG,
            "FINDING: a report over no positions closes the question");
    }

    /// TREE_CAPACITY is 2^levels and levels is 10 in every circuit that indexes a leaf —
    /// compliance, transfer and merkleUpdate all call Num2Bits(10) on their index. The
    /// ASP tree shares the depth: ops/asp.mjs refuses more than 1024 identities, so the
    /// register's admission set is capped at 1024 members too, and NOTHING on-chain knows
    /// that. The contract's guard covers only the note tree.
    function test_C5_TreeCapacityIsTheNoteTreeOnlyAndTheSlotIsWhereWeThinkItIs() public {
        assertEq(pool.TREE_CAPACITY(), 1024);

        // the storage assumption the capacity tests rest on
        _deposit(holder, bytes32(uint256(1250)), 1e6);
        assertEq(pool.commitmentCount(), 1);
        _setLeafCount(500);
        assertEq(pool.commitmentCount(), 500, "slot 13 is commitments.length");
        _setLeafCount(1);

        // there is no association-set capacity anywhere in the contract: rotateRoot takes
        // any root for a tree of any size, and a 1025-leaf ASP tree is refused only by
        // ops/asp.mjs. An operator who bypasses that script gets a root whose members
        // cannot all produce a witness.
        pool.rotateRoot(uint256(keccak256("a root over 2000 identities")));
        assertTrue(pool.knownRoot(pool.aspRoot()), "the contract cannot tell how deep that tree was");
    }

    // =====================================================================
    // 4. FEE AND RELAYER ECONOMICS
    // =====================================================================

    /// relayer == recipient. Both legs land on the same address, so it receives the whole
    /// withdrawal in two transfers. Harmless, and the extDataHash binds the arrangement,
    /// so it is the prover's own choice — but it had no test.
    function test_R1_RelayerEqualToRecipientReceivesTheWholeWithdrawal() public {
        _deposit(holder, bytes32(uint256(1300)), 100e6);
        uint[7] memory s = _xfer(40e6, payee, payee, 5e6, 10);
        pool.transact(pA, pB, pC, s, payee, payee, 5e6);

        assertEq(asset.balanceOf(payee), 40e6, "35 as recipient plus 5 as relayer");
        assertEq(pool.balance(), 60e6, "the register still loses exactly withdrawn");
    }

    /// FINDING (MEDIUM). recipient == address(pool) is not refused. The two nullifiers burn,
    /// two outputs are inserted for the CHANGE only, and `withdrawn - fee` is transferred
    /// from the pool to the pool — a no-op on the balance. So the register keeps asset that
    /// no note in the tree accounts for, permanently orphaned: the shielded ledger says the
    /// value left, the balance says it never did.
    ///
    /// It needs the pool itself to hold a credential, which Cleanverse would have to issue
    /// to the registered business contract — plausible, not certain, which is why this is
    /// MEDIUM and not HIGH. A fix refuses recipient == address(this) (and relayer likewise)
    /// outright; the check costs one comparison and there is no legitimate use.
    function test_R2_FINDING_RecipientEqualToThePoolOrphansTheValue() public {
        _deposit(holder, bytes32(uint256(1310)), 100e6);

        // without a credential the pool cannot be its own recipient — the accidental case
        // is already refused
        uint[7] memory s = _xfer(40e6, address(pool), address(0), 0, 11);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, address(pool)));
        pool.transact(pA, pB, pC, s, address(pool), address(0), 0);

        // credential the register itself and the deliberate case goes through
        validator.setEligible(address(pool), true);
        pool.transact(pA, pB, pC, s, address(pool), address(0), 0);

        assertEq(pool.balance(), 100e6, "FINDING: the backing never moved");
        assertTrue(pool.nullifierUsed(bytes32(s[3])), "FINDING: but the notes were burnt");
        assertTrue(pool.nullifierUsed(bytes32(s[4])));
        // 40e6 of backing is now behind no note: the outputs only carry the change.
    }

    /// A fee to the zero relayer is refused, because address(0) holds no credential. The
    /// guard is incidental — it comes from the Validator, not from a zero check — but it
    /// closes the "burn the fee" case. Pinned so a permissive Validator mock in some future
    /// test does not silently open it.
    function test_R3_FeeToTheZeroRelayerIsRefused() public {
        _deposit(holder, bytes32(uint256(1320)), 100e6);
        uint[7] memory s = _xfer(40e6, payee, address(0), 5e6, 12);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, address(0)));
        pool.transact(pA, pB, pC, s, payee, address(0), 5e6);

        // and with no fee the zero relayer is never consulted
        uint[7] memory ok_ = _xfer(40e6, payee, address(0), 0, 13);
        pool.transact(pA, pB, pC, ok_, payee, address(0), 0);
        assertEq(asset.balanceOf(payee), 40e6);
    }

    /// Zero fee is a first-class case on every axis: the relayer is not credential-checked,
    /// not paid, and the recipient takes the lot. Complements W5, which covered only the
    /// ineligible-relayer half.
    function test_R4_ZeroFeeIsATotalCase() public {
        _deposit(holder, bytes32(uint256(1330)), 100e6);
        uint256 poolBefore = pool.balance();

        uint[7] memory s = _xfer(40e6, payee, relay, 0, 14);
        pool.transact(pA, pB, pC, s, payee, relay, 0);

        assertEq(asset.balanceOf(payee), 40e6, "the recipient takes the whole withdrawal");
        assertEq(asset.balanceOf(relay), 0, "a zero-fee relayer is paid nothing");
        assertEq(poolBefore - pool.balance(), 40e6, "and the register loses exactly withdrawn");
    }

    /// FINDING (LOW, token-dependent). fee == withdrawn is a legal arrangement (Audit3 W3
    /// proves it), and it makes the register call `asset.transfer(recipient, 0)`. The CVA
    /// is a third-party Cleanverse A-Token; a token that refuses zero-value transfers turns
    /// that legal arrangement into a hard revert, so the relayer-takes-all path is live or
    /// dead depending on an implementation the register does not control.
    /// A fix skips the transfer when the amount is zero — two words, and it makes the path
    /// token-independent.
    function test_R5_FINDING_FeeEqualToWithdrawalDependsOnTheTokenAllowingZeroTransfers() public {
        A4NoZeroAsset nz = new A4NoZeroAsset();
        address v = address(verifier);
        SaksiPool p2 = new SaksiPool(
            address(nz), address(validator), v, v, v, v, v, v, ROOT, owner
        );
        p2.publishNoteRoot(NOTE_ROOT);
        nz.mint(holder, 1_000e6);

        bytes32 c = bytes32(uint256(1340));
        uint[11] memory p; p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        vm.prank(holder);
        p2.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 100e6));

        uint[7] memory s;
        s[0] = NOTE_ROOT; s[1] = FIELD - 10e6;
        s[2] = p2.extDataHashOf(payee, relay, 10e6);
        s[3] = 0xF01; s[4] = 0xF02; s[5] = 0xF03; s[6] = 0xF04;

        vm.expectRevert(bytes("zero-value transfer"));
        p2.transact(pA, pB, pC, s, payee, relay, 10e6);

        // the same arrangement one unit short of total works fine
        uint[7] memory ok_;
        ok_[0] = NOTE_ROOT; ok_[1] = FIELD - 10e6;
        ok_[2] = p2.extDataHashOf(payee, relay, 10e6 - 1);
        ok_[3] = 0xF11; ok_[4] = 0xF12; ok_[5] = 0xF13; ok_[6] = 0xF14;
        p2.transact(pA, pB, pC, ok_, payee, relay, 10e6 - 1);
        assertEq(nz.balanceOf(payee), 1, "FINDING: the fee ceiling is the token's, not the register's");
    }

    // =====================================================================
    // 5. EVENTS — can an indexer rebuild the register from the log alone?
    // =====================================================================

    /// FINDING (MEDIUM). The constructor emits NOTHING. The genesis owner, the genesis
    /// auditor and the genesis association root — all three of them consequential, and the
    /// root is the entire admission perimeter — are set with no event, and there is no
    /// initial RootRotated. An indexer starting at the deployment block therefore cannot
    /// learn the register's opening state from the log; it must decode constructor calldata
    /// or read storage, neither of which an event pipeline does.
    ///
    /// A fix emits RootRotated(0, aspRoot), AuditorSet and OwnershipTransferred(0, owner)
    /// from the constructor. That is the standard shape and it costs three logs once.
    function test_E1_DeploymentAnnouncesItsOpeningPerimeter() public {
        address v = address(verifier);
        vm.recordLogs();
        SaksiPool fresh = new SaksiPool(
            address(asset), address(validator), v, v, v, v, v, v, ROOT, owner
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 fromPool;
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].emitter == address(fresh)) fromPool++;
        assertEq(fromPool, 1, "the register announces its opening perimeter");
        bytes32 opened = keccak256("RegisterOpened(address,address,uint256)");
        bool announced;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(fresh) || logs[i].topics[0] != opened) continue;
            announced = true;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), address(asset), "asset");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(validator), "validator");
            assertEq(abi.decode(logs[i].data, (uint256)), ROOT, "association root");
        }
        assertTrue(announced, "an indexer starting at the deploy block can read the opening state");

        // the state exists, it is just unreadable from the log
        assertEq(fresh.aspRoot(), ROOT);
        assertEq(fresh.auditor(), owner);
        assertTrue(fresh.knownRoot(ROOT));
    }

    /// FINDING (MEDIUM). Publishing a note root and RETIRING one emit the SAME event, and
    /// for a realistic sequence they are byte-identical — same signature, same two indexed
    /// topics, empty data. `knownNoteRoot` is therefore NOT reconstructible from the log:
    ///
    ///     publishNoteRoot(A)  from noteRoot=Z  ->  NoteRootPublished(Z, A)
    ///     retireNoteRoot(Z)   with noteRoot=A  ->  NoteRootPublished(Z, A)   <- identical
    ///
    /// An indexer seeing two of these cannot tell whether the second was a republication or
    /// a revocation, so it cannot know which roots the register still accepts — which is
    /// exactly the safety-critical bit. The association set does this correctly: retireRoot
    /// has its own RootRetired event (test_U4). The note root has no twin.
    ///
    /// A fix adds NoteRootRetired(uint256 indexed root).
    function test_E2_PublishAndRetireNoteRootAreDistinguishableInTheLog() public {
        vm.recordLogs();
        pool.publishNoteRoot(0xB0B);          // NoteRootPublished(NOTE_ROOT, 0xB0B)
        pool.retireNoteRoot(NOTE_ROOT);       // NoteRootPublished(NOTE_ROOT, 0xB0B) again
        Vm.Log[] memory logs = _poolLogs(vm.getRecordedLogs());

        assertEq(logs.length, 2, "one log each");
        assertEq(logs[0].topics.length, 3);
        assertEq(logs[1].topics.length, 3);
        assertTrue(logs[0].topics[0] != logs[1].topics[0],
            "advancing the root and revoking one must not share a signature");
        assertEq(logs[0].topics[0], keccak256("NoteRootPublished(uint256,uint256)"));
        assertEq(logs[1].topics[0], keccak256("NoteRootRetired(uint256,uint256)"));
        assertEq(logs[0].data.length, 0);
        assertEq(logs[1].data.length, 0);

        // the states they describe are opposites
        assertTrue(pool.knownNoteRoot(0xB0B), "the first made a root spendable");
        assertFalse(pool.knownNoteRoot(NOTE_ROOT), "and the second revoked one, distinguishably");
    }

    /// FINDING (MEDIUM). Transacted carries `withdrawn` and `to`, but NOT the fee and NOT
    /// the relayer — so the one event describing a payout mis-states where the money went.
    /// An indexer reading it credits the recipient with the full `withdrawn`; the recipient
    /// actually received `withdrawn - fee` and an address that appears nowhere in the log
    /// received the rest. The relayer's income is invisible on-chain.
    ///
    /// A fix adds the relayer and fee to Transacted. They are already public — they are
    /// plaintext calldata arguments — so this leaks nothing that is not already leaked.
    function test_E3_TransactedReconcilesWithWhatWasPaid() public {
        _deposit(holder, bytes32(uint256(1400)), 100e6);

        vm.recordLogs();
        uint[7] memory s = _xfer(40e6, payee, relay, 5e6, 20);
        pool.transact(pA, pB, pC, s, payee, relay, 5e6);
        Vm.Log[] memory logs = _poolLogs(vm.getRecordedLogs());

        bytes32 sig = keccak256("Transacted(bytes32,bytes32,uint256,address,address,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != sig) continue;
            found = true;
            (uint256 withdrawn, address to, address paidRelayer, uint256 paidFee) =
                abi.decode(logs[i].data, (uint256, address, address, uint256));
            assertEq(withdrawn, 40e6);
            assertEq(to, payee);
            assertEq(paidRelayer, relay, "the relayer that was paid is in the log");
            assertEq(paidFee, 5e6, "and so is what it took");
            // the log now reconciles with the balances it describes
            assertEq(withdrawn - paidFee, asset.balanceOf(payee), "recipient credited what it received");
        }
        assertTrue(found, "Transacted was emitted");
        assertEq(asset.balanceOf(payee), 35e6);
        assertEq(asset.balanceOf(relay), 5e6);
    }

    /// FINDING (MEDIUM). An aggregate answer names its SET nowhere on-chain.
    /// AuditRequested carries subject = 0 for an aggregate — required, since the set is not
    /// one commitment — and DisclosureProved(ctx, kind, a, b) carries the CAP and the
    /// NONCE, not the five commitments and five flags. The set is bound only inside the
    /// circuit, as a Poseidon preimage of the context hash.
    ///
    /// So the audit trail records that a total was proved under a cap, and never which
    /// positions it covered. Verifying an aggregate answer after the fact means recovering
    /// a Poseidon preimage, or trusting the auditor's off-chain audit-log.json. For a
    /// register whose selling point is an on-chain answerability record, the aggregate's
    /// record is the weakest of the four kinds — and it is the one covering the most value.
    ///
    /// A fix emits the commitments and active flags, or a keccak of the enumerated set,
    /// alongside the answer. They are already public signals in the calldata.
    function test_E4_FINDING_AggregateAnswerDoesNotNameItsSet() public {
        _deposit(holder, bytes32(uint256(1410)), 100e6);
        _deposit(holder, bytes32(uint256(1411)), 200e6);
        uint8 AGG = pool.KIND_AGGREGATE();

        vm.recordLogs();
        pool.requestAudit(1_4100, 0, AGG, _cl(AGG, 1_000e6), "total exposure at most 1,000?");
        uint[13] memory s;
        s[0] = 1410; s[1] = 1411; s[5] = 1; s[6] = 1;
        s[10] = 1_000e6; s[11] = 1_4100; s[12] = 3;
        pool.proveAggregate(pA, pB, pC, s);
        Vm.Log[] memory logs = _poolLogs(vm.getRecordedLogs());

        assertEq(logs.length, 2, "AuditRequested and DisclosureProved, and nothing else");
        for (uint256 i = 0; i < logs.length; i++) {
            assertFalse(_mentions(logs[i], 1410), "FINDING: the set's first position is not in the log");
            assertFalse(_mentions(logs[i], 1411), "FINDING: nor the second");
        }
        assertEq(pool.auditSubject(1_4100), 0, "and storage records no subject either");
        assertEq(pool.auditAnswered(1_4100), AGG, "yet the question is answered and closed forever");
    }

    /// FINDING (MEDIUM). The register's ADMISSION PERIMETER can be replaced, widened or
    /// narrowed with no event from the pool. setRule / addRule / removeRule forward to
    /// Cleanverse's Validator and emit nothing of their own, so an indexer watching this
    /// contract sees a register whose rules change invisibly — and rules are the thing the
    /// docs call "the issuer changing its own perimeter through its own governance".
    ///
    /// Whether Cleanverse's contract emits is not this register's record to rely on: the
    /// pool is the governance surface, so the governance action belongs in the pool's log.
    /// A fix emits RuleSet / RuleAdded / RuleRemoved.
    function test_E5_RuleChangesAreLoggedByThePool() public {
        vm.recordLogs();
        pool.setRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 30, 0, false, 0));
        pool.addRule(IAPassComplianceValidator.RuleV2(bytes2("ID"), bytes2(0), 10, 0, true, 1 << 5));
        pool.removeRule(0);
        Vm.Log[] memory logs = _poolLogs(vm.getRecordedLogs());

        assertEq(logs.length, 3, "three perimeter changes, three events from the register");
        assertEq(logs[0].topics[0], keccak256("RuleSet(uint8,uint8,bool,uint256)"));
        assertEq(logs[1].topics[0], keccak256("RuleAdded(uint8,uint8,bool,uint256)"));
        assertEq(logs[2].topics[0], keccak256("RuleRemoved(uint256)"));
        assertEq(pool.activeRules().length, 1, "the perimeter did change");
        assertEq(pool.activeRules()[0].minTier, 10);
    }

    /// The half that DOES work. CommitmentInserted is emitted on both paths — deposit and
    /// each transfer output — with the leaf index, so `commitments[]` is fully
    /// reconstructible from the log alone. This is the one piece of register history an
    /// indexer can rebuild without reading storage, and it is the piece the off-chain note
    /// tree depends on. It is asserted here so a future change that drops the event from
    /// one of the two paths fails loudly.
    function test_E6_CommitmentInsertedAloneReconstructsTheRegister() public {
        vm.recordLogs();
        _deposit(holder, bytes32(uint256(1420)), 10e6);
        _deposit(holder, bytes32(uint256(1421)), 20e6);
        uint[7] memory s = _xfer(0, payee, address(0), 0, 21);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        Vm.Log[] memory logs = _poolLogs(vm.getRecordedLogs());

        bytes32 sig = keccak256("CommitmentInserted(bytes32,uint256)");
        bytes32[] memory rebuilt = new bytes32[](4);
        uint256 seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != sig) continue;
            uint256 leafIndex = abi.decode(logs[i].data, (uint256));
            assertEq(leafIndex, seen, "leaf indices arrive in order with no gaps");
            rebuilt[leafIndex] = logs[i].topics[1];
            seen++;
        }
        assertEq(seen, 4, "one per deposit, two per transfer");

        bytes32[] memory onChain = pool.allCommitments();
        assertEq(rebuilt.length, onChain.length);
        for (uint256 i = 0; i < onChain.length; i++) {
            assertEq(rebuilt[i], onChain[i], "the log rebuilds the register exactly");
        }
    }

    /// The rest of the answerability trail is reconstructible: AuditRequested carries the
    /// subject, kind, claim and the human question, and DisclosureProved carries the kind
    /// that closed it. For the three single-subject kinds the record is complete — it is
    /// only the aggregate (test_E4) that loses its set.
    function test_E7_SingleSubjectAuditTrailIsComplete() public {
        _deposit(holder, bytes32(uint256(1430)), 50e6);
        uint8 THR = pool.KIND_THRESHOLD();
        bytes32 claim = _cl(THR, 1_000e6);

        vm.recordLogs();
        pool.requestAudit(1_4300, 1430, THR, claim, "is position 1430 at most 1,000?");
        pool.proveThreshold(pA, pB, pC, [uint256(1430), uint256(1_000e6), uint256(1_4300)]);
        Vm.Log[] memory logs = _poolLogs(vm.getRecordedLogs());

        bytes32 reqSig = keccak256("AuditRequested(uint256,address,uint256,uint8,bytes32,string)");
        bool sawRequest;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != reqSig) continue;
            sawRequest = true;
            assertEq(uint256(logs[i].topics[1]), 1_4300, "the context is indexed");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), owner, "and the auditor");
            (uint256 subject, uint8 kind, bytes32 cl, string memory q) =
                abi.decode(logs[i].data, (uint256, uint8, bytes32, string));
            assertEq(subject, 1430, "the log names the position asked about");
            assertEq(kind, THR);
            assertEq(cl, claim, "and the figure, hashed the way the prover must reproduce it");
            assertEq(q, "is position 1430 at most 1,000?");
        }
        assertTrue(sawRequest);

        // DisclosureProved(ctx, kind, a, b) — for THRESHOLD, a is the commitment and b the
        // figure. The meaning of a and b is kind-dependent, which a previous pass recorded;
        // what matters here is that nothing is MISSING for this kind.
        bytes32 provedSig = keccak256("DisclosureProved(uint256,uint8,uint256,uint256)");
        bool sawProof;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != provedSig) continue;
            sawProof = true;
            (uint8 kind, uint256 a, uint256 b) = abi.decode(logs[i].data, (uint8, uint256, uint256));
            assertEq(kind, THR);
            assertEq(a, 1430, "the subject");
            assertEq(b, 1_000e6, "the figure proved");
        }
        assertTrue(sawProof);
    }

    // ---- ERC-3643 / ERC-1400 compatibility ---------------------------------
    //
    // The register answers in the shape the standard the incumbents build on already uses,
    // and answers WHY — three refusals that demand three different actions used to collapse
    // into one boolean.

    function test_X1_CanTransferComposesAllThreeEntryControls() public {
        _deposit(holder, bytes32(uint256(2001)), 100e6);   // the register must back something
        assertTrue(pool.canTransfer(holder, holder, 1), "a credentialed pair may transfer");
        assertTrue(pool.isVerified(holder), "and is verified in the standard's spelling");

        validator.setEligible(holder, false);
        assertFalse(pool.canTransfer(holder, holder, 1), "gate one refuses");
        assertFalse(pool.isVerified(holder));
        validator.setEligible(holder, true);

        uint256[8] memory list;
        list[0] = pool.sourceKeyOf(holder);
        pool.setDenyList(list);
        assertFalse(pool.canTransfer(holder, holder, 1), "the sanctions list refuses");
        assertFalse(pool.isVerified(holder), "and isVerified reads the list too");
    }

    function test_X2_ReasonCodesNameWhichControlRefused() public {
        _deposit(holder, bytes32(uint256(2002)), 100e6);
        bytes1 code;
        bytes32 why;

        (code, why) = pool.canTransferWithReason(holder, holder, 1);
        assertEq(code, pool.STATUS_OK(), "0x51 is ERC-1066 for allowed");

        validator.setEligible(holder, false);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_INVALID_SENDER());
        assertEq(why, bytes32("SENDER_NOT_CREDENTIALED"));

        validator.setEligible(holder, true);
        validator.setEligible(payee, false);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_INVALID_RECEIVER(), "the two edges are distinguishable");
        assertEq(why, bytes32("RECIPIENT_NOT_CREDENTIALED"));

        validator.setEligible(payee, true);
        uint256[8] memory list;
        list[0] = pool.sourceKeyOf(payee);
        pool.setDenyList(list);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(why, bytes32("RECIPIENT_SANCTIONED"), "sanctioned is not the same as uncredentialed");

        uint256[8] memory empty;
        pool.setDenyList(empty);
        (code, why) = pool.canTransferWithReason(holder, payee, type(uint256).max);
        assertEq(code, pool.STATUS_INSUFFICIENT_BALANCE());
        assertEq(why, bytes32("EXCEEDS_BACKING"));

        pool.setPaused(true);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_HALTED(), "a halted register says so rather than blaming the parties");
        assertEq(why, bytes32("REGISTER_PAUSED"));
    }

    /// The standard's views must not revert, whatever Cleanverse's contract does. A
    /// predicate that throws is worse than one that says no, because an integration cannot
    /// tell a refusal from an outage.
    function test_X3_TheStandardViewsNeverRevert() public {
        _deposit(holder, bytes32(uint256(2003)), 100e6);
        validator.setRegistered(false);   // an unregistered pool makes their contract revert
        assertFalse(pool.canTransfer(holder, holder, 1), "reverting validator reads as refusal");
        assertFalse(pool.isVerified(holder));
        (bytes1 code,) = pool.canTransferWithReason(holder, holder, 1);
        assertEq(code, pool.STATUS_INVALID_SENDER());
        validator.setRegistered(true);
    }
}
