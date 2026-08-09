// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Fifth-pass audit: PROPERTIES, not examples.
//
// The four earlier passes are 131 example tests. Each one names a case somebody thought
// of, and the ratio of test to source is already 3.6:1 — so another example buys nothing.
// What none of them do is let the machine look for the case nobody thought of. This pass
// is that:
//
//   1. Stateful INVARIANTS driven by a handler over random call sequences. Each is a
//      sentence about the register that must survive any interleaving of any calls.
//   2. FUZZED partitions of every integer and address the contract takes, so the
//      boundaries — 0, FIELD-1, FIELD, 2^256-1, address(0), the pool itself, a
//      self-transfer, a fee above the withdrawal — are reached by construction rather
//      than by somebody remembering them.
//   3. The ACCESS-CONTROL and PAUSE matrices, enumerated over the whole external surface
//      rather than sampled.
//   4. REENTRANCY on every leg that moves value, and on the two contracts the register
//      trusts to answer it.
//   5. The ERC-3643 / ERC-1400 surface: every status byte reachable, and — the half that
//      matters to an integrator switching on the byte — whether the byte describes what
//      the register will actually DO.
//
// Naming follows the earlier passes:
//   invariant_*          a property that holds over random call sequences
//   testFuzz_*           a property that holds over a fuzzed input domain
//   test_F<n>_FINDING_*  behaviour that is WRONG or overstated today. The assertion pins
//                        what the contract does NOW, so a fix inverts the test.
//   everything else      asserts an invariant that holds.
//
// Nothing here modifies src/, circuits/, ops/, web/, or the existing test files.

import {Test, Vm, StdInvariant, StdUtils, stdError} from "forge-std/Test.sol";
import {CommonBase} from "forge-std/Base.sol";
import {SaksiPool, IAPassComplianceValidator, Ownable} from "../src/SaksiPool.sol";

// =========================================================================
// MOCKS
// =========================================================================

contract A5Validator {
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

contract A5Asset {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// The three `require(asset.transferX(...), "...")` branches in the register have never
/// executed: every mock in the suite returns true unconditionally. A meaningful minority
/// of ERC20s signal failure by returning false rather than reverting, and the CVA is a
/// third-party Cleanverse A-Token whose implementation this register does not control.
contract A5FalseAsset {
    mapping(address => uint256) public balanceOf;
    bool public failPull;
    bool public failPay;
    uint8 public payCount;
    uint8 public failPayOnCall;      // 1 = the recipient leg, 2 = the fee leg

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function setFailPull(bool v) external { failPull = v; }
    function setFailPay(bool v, uint8 onCall) external { failPay = v; failPayOnCall = onCall; payCount = 0; }

    function transfer(address to, uint256 a) external returns (bool) {
        payCount++;
        if (failPay && payCount == failPayOnCall) return false;   // silent failure, no revert
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        if (failPull) return false;
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// A CVA that re-enters the register on a chosen leg. `armOn` selects WHICH call fires the
/// hook, so the same token attacks the deposit pull, the withdrawal payout and the fee
/// payout independently — Audit3's W8 only ever armed the first payout.
contract A5HookAsset {
    mapping(address => uint256) public balanceOf;
    address public target;
    bytes public payload;
    uint8 public armOn;              // 1 = transferFrom, 2 = first transfer, 3 = second transfer
    uint8 public payCount;
    bool public fired;
    bool public reenteredOk;
    bytes public reentryError;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function arm(uint8 on, address t, bytes calldata data) external {
        armOn = on; target = t; payload = data; payCount = 0; fired = false;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        payCount++;
        // Fire BEFORE the debit: the worst case for any guard that reads a balance.
        if ((armOn == 2 && payCount == 1) || (armOn == 3 && payCount == 2)) _fire();
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a;
        // Fire AFTER the credit, which is where an ERC777-style receive hook lands: the
        // register has the value but has not yet re-read its own balance.
        if (armOn == 1) _fire();
        return true;
    }

    function _fire() internal {
        armOn = 0;                    // one shot; a loop would just run out of gas
        fired = true;
        (bool ok, bytes memory err) = target.call(payload);
        reenteredOk = ok; reentryError = err;
    }
}

contract A5Verifier {
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

/// Cleanverse's Validator is a contract this register does not control, called on every
/// entry and every exit. This is the hostile version of it: `complianceVerify` is declared
/// NON-view here while the interface the pool holds declares it view, so the pool issues a
/// STATICCALL and any storage write in the callee reverts the frame.
contract A5EvilValidator {
    mapping(address => bool) public eligible;
    uint256 public writes;
    bool public registered = true;
    bool public hostile = true;

    function setEligible(address who, bool v) external { eligible[who] = v; }
    function setHostile(bool v) external { hostile = v; }

    function complianceVerify(address, address user) external returns (bool) {
        if (hostile) writes++;        // reverts under STATICCALL
        return eligible[user];
    }
    function isRegistered(address) external view returns (bool) { return registered; }
    function getRulesV2(address) external pure returns (IAPassComplianceValidator.RuleV2[] memory r) { return r; }
    function setRuleV2FromContract(IAPassComplianceValidator.RuleV2 calldata) external {}
    function addRuleV2FromContract(IAPassComplianceValidator.RuleV2 calldata) external {}
    function removeRuleV2FromContract(uint256) external {}
}

/// The same shape for the Groth16 verifiers: five contracts the register trusts to answer
/// a yes/no, each called through a `view` interface.
contract A5EvilVerifier {
    uint256 public writes;
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[11] calldata)
        external returns (bool) { writes++; return true; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[7] calldata)
        external returns (bool) { writes++; return true; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[3] calldata)
        external returns (bool) { writes++; return true; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[4] calldata)
        external returns (bool) { writes++; return true; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[13] calldata)
        external returns (bool) { writes++; return true; }
}

// =========================================================================
// INVARIANT HANDLER
// =========================================================================

/// Drives the register through random call sequences and keeps the ghost state the
/// invariants below are checked against.
///
/// It deliberately does NOT inherit Test: a handler that exposes DSTest's own public
/// surface hands the fuzzer a pile of irrelevant selectors. The callable surface is
/// pinned explicitly with targetSelector in the invariant suite's setUp.
contract A5Handler is CommonBase, StdUtils {
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    SaksiPool public pool;
    A5Asset public asset;
    A5Validator public validator;

    /// Four wallets, all credentialed. address(this) — the pool — is deliberately NOT an
    /// actor: a withdrawal to the register itself breaks the backing invariant, which is
    /// Audit4's R2 finding and is pinned as a unit test below rather than left to
    /// resurface here as noise.
    address[4] public actors;

    uint256 public nonce;

    // ---- ghosts ----------------------------------------------------------
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public ghostLeafHighWater;
    uint256 public ghostDepositsWhilePaused;
    uint256 public ghostTransactsWhilePaused;

    /// Tracked lists are capped: an invariant runs after EVERY call in a sequence, so an
    /// unbounded loop inside one turns the suite quadratic for no extra signal.
    uint256 internal constant TRACK_CAP = 32;

    bytes32[] public seenNullifiers;
    uint256[] public seenContexts;
    mapping(uint256 => uint8) public ghostAnsweredKind;
    uint256[] public openContexts;
    /// The claim is pinned on-chain as a hash, so the only figure that can answer a
    /// request is the one it was registered with. The handler remembers it rather than
    /// searching for a preimage.
    mapping(uint256 => uint256) public ctxCap;

    uint256[] public seenNoteRoots;
    mapping(uint256 => bool) public expectNoteRootKnown;
    mapping(uint256 => bool) internal noteRootTracked;

    uint256[] public seenAspRoots;
    mapping(uint256 => bool) public expectAspRootKnown;
    mapping(uint256 => bool) internal aspRootTracked;

    uint[2] internal pA; uint[2][2] internal pB; uint[2] internal pC;

    constructor(SaksiPool _pool, A5Asset _asset, A5Validator _validator, address[4] memory _actors) {
        pool = _pool; asset = _asset; validator = _validator; actors = _actors;
        _trackAspRoot(pool.aspRoot(), true);
        _trackNoteRoot(pool.noteRoot(), true);
    }

    // ---- getters the invariants read -------------------------------------

    function seenNullifierCount() external view returns (uint256) { return seenNullifiers.length; }
    function seenContextCount() external view returns (uint256) { return seenContexts.length; }
    function seenNoteRootCount() external view returns (uint256) { return seenNoteRoots.length; }
    function seenAspRootCount() external view returns (uint256) { return seenAspRoots.length; }
    function actorAt(uint256 i) external view returns (address) { return actors[i]; }

    // ---- internals -------------------------------------------------------

    function _fresh() internal returns (uint256) {
        nonce++;
        return uint256(keccak256(abi.encode("A5", address(this), nonce))) % FIELD;
    }

    function _bind(bytes32 c, uint256 amount) internal pure returns (uint[3] memory s) {
        s[0] = uint256(c); s[1] = amount; s[2] = 0;
    }

    function _trackNoteRoot(uint256 r, bool known) internal {
        if (!noteRootTracked[r]) { noteRootTracked[r] = true; seenNoteRoots.push(r); }
        expectNoteRootKnown[r] = known;
    }

    function _trackAspRoot(uint256 r, bool known) internal {
        if (!aspRootTracked[r]) { aspRootTracked[r] = true; seenAspRoots.push(r); }
        expectAspRootKnown[r] = known;
    }

    // ---- the callable surface --------------------------------------------

    /// The compliance signals the register will accept, read from chain state rather than
    /// invented: a handler that made up its own deny list would only ever exercise the
    /// happy path of the positional equality check.
    function _pub(address who, bytes32 c) internal view returns (uint[11] memory p) {
        p[0] = pool.aspRoot();
        for (uint256 i = 0; i < 8; i++) p[1 + i] = pool.denyList(i);
        p[9] = pool.sourceKeyOf(who);
        p[10] = uint256(c);
    }

    function _doDeposit(address who, uint256 amount, bytes32 c) internal {
        uint[11] memory p = _pub(who, c);
        vm.prank(who);
        pool.deposit(amount, c, pA, pB, pC, p, pA, pB, pC, _bind(c, amount));
    }

    function h_deposit(uint256 actorSeed, uint256 amountSeed) external {
        address who = actors[actorSeed % 4];
        uint256 amount = bound(amountSeed, 1, 1e15);
        bytes32 c = bytes32(_fresh());
        asset.mint(who, amount);
        bool wasPaused = pool.paused();

        _doDeposit(who, amount, c);

        // Only reached on success. A deposit that landed while paused would be a live
        // breach of the halt, and the invariant below asserts this counter stays zero.
        if (wasPaused) ghostDepositsWhilePaused++;
        ghostDeposited += amount;
        ghostLeafHighWater = pool.commitmentCount();
    }

    function _signals(uint256 out, address to, address rel, uint256 fee)
        internal returns (uint[7] memory s)
    {
        s[0] = pool.noteRoot();
        s[1] = out == 0 ? 0 : FIELD - out;
        s[2] = pool.extDataHashOf(to, rel, fee);
        s[3] = _fresh(); s[4] = _fresh(); s[5] = _fresh(); s[6] = _fresh();
    }

    function h_transact(uint256 actorSeed, uint256 outSeed, uint256 feeSeed) external {
        uint256 out = bound(outSeed, 0, pool.balance());
        uint256 fee = out == 0 ? 0 : bound(feeSeed, 0, out);
        address to = actors[actorSeed % 4];
        address rel = fee == 0 ? address(0) : actors[(actorSeed / 4) % 4];

        uint[7] memory s = _signals(out, to, rel, fee);
        bool wasPaused = pool.paused();

        vm.prank(actors[(actorSeed / 16) % 4]);
        pool.transact(pA, pB, pC, s, to, rel, fee);

        if (wasPaused) ghostTransactsWhilePaused++;
        ghostWithdrawn += out;
        ghostLeafHighWater = pool.commitmentCount();
        if (seenNullifiers.length + 2 <= TRACK_CAP) {
            seenNullifiers.push(bytes32(s[3]));
            seenNullifiers.push(bytes32(s[4]));
        }
    }

    function h_setPaused(uint256 seed) external {
        pool.setPaused(seed % 4 == 0);
    }

    function h_publishNoteRoot(uint256 seed) external {
        uint256 r = 0xA5000 + (seed % 5);
        pool.publishNoteRoot(r);
        _trackNoteRoot(r, true);
    }

    function h_retireNoteRoot(uint256 seed) external {
        if (seenNoteRoots.length == 0) return;
        uint256 r = seenNoteRoots[seed % seenNoteRoots.length];
        pool.retireNoteRoot(r);
        _trackNoteRoot(r, false);
    }

    function h_rotateRoot(uint256 seed) external {
        uint256 r = 0xB5000 + (seed % 5);
        pool.rotateRoot(r);
        _trackAspRoot(r, true);
    }

    function h_retireRoot(uint256 seed) external {
        if (seenAspRoots.length == 0) return;
        uint256 r = seenAspRoots[seed % seenAspRoots.length];
        pool.retireRoot(r);
        _trackAspRoot(r, false);
    }

    /// Sanctions an actor's own leaf, so the deny-list invariants are checked against a
    /// list that actually names somebody rather than eight zeroes.
    function h_setDenyList(uint256 seed) external {
        uint256[8] memory list;
        uint256 n = seed % 5;
        for (uint256 i = 0; i < n; i++) list[i] = pool.sourceKeyOf(actors[(seed + i) % 4]);
        pool.setDenyList(list);
    }

    /// The handler is the auditor. Only the threshold kind is driven here: the per-kind
    /// admission rules are exhaustively covered by the unit tests, and the property under
    /// test — an answer is permanent — is kind-independent.
    function h_requestAudit(uint256 seed, uint256 capSeed) external {
        uint256 count = pool.commitmentCount();
        if (count == 0) return;
        uint256 subject = uint256(pool.commitments(seed % count));
        uint256 ctx = 1 + (seed % 512);
        uint256 cap = bound(capSeed, 1, type(uint64).max);
        uint8 thr = pool.KIND_THRESHOLD();

        pool.requestAudit(ctx, subject, thr, pool.claimHash(thr, cap, 0), "invariant sweep");
        // Only after the call: requestAudit refuses a context that is already answered, so
        // a rewritten cap here would otherwise outlive a request that was never rewritten.
        ctxCap[ctx] = cap;
        if (openContexts.length < TRACK_CAP) openContexts.push(ctx);
    }

    function h_proveThreshold(uint256 seed) external {
        if (openContexts.length == 0) return;
        uint256 ctx = openContexts[seed % openContexts.length];
        if (!pool.auditRequested(ctx) || pool.auditAnswered(ctx) != 0) return;

        uint256 subject = pool.auditSubject(ctx);
        uint8 thr = pool.KIND_THRESHOLD();
        uint256 cap = ctxCap[ctx];
        if (cap == 0) return;

        pool.proveThreshold(pA, pB, pC, [subject, cap, ctx]);
        ghostAnsweredKind[ctx] = thr;
        if (seenContexts.length < TRACK_CAP) seenContexts.push(ctx);
    }
}

// =========================================================================
// 1. INVARIANTS
// =========================================================================

contract Audit5InvariantTest is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant ROOT = 12345;
    uint256 constant NOTE_ROOT = 54321;

    SaksiPool pool;
    A5Asset asset;
    A5Verifier verifier;
    A5Validator validator;
    A5Handler handler;

    function setUp() public {
        asset = new A5Asset();
        verifier = new A5Verifier();
        validator = new A5Validator();
        address v = address(verifier);
        pool = new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, ROOT, address(this));
        pool.publishNoteRoot(NOTE_ROOT);

        address[4] memory actors = [
            address(0xA11CE), address(0xB0B), address(0xC0FED), address(0xD00D)
        ];
        for (uint256 i = 0; i < 4; i++) validator.setEligible(actors[i], true);

        handler = new A5Handler(pool, asset, validator, actors);
        validator.setEligible(address(handler), true);

        // The handler holds both privileged roles, so the admin surface is inside the
        // fuzzed sequence rather than frozen at its setUp value.
        pool.setAuditor(address(handler));
        pool.transferOwnership(address(handler));

        bytes4[] memory sels = new bytes4[](10);
        sels[0] = A5Handler.h_deposit.selector;
        sels[1] = A5Handler.h_transact.selector;
        sels[2] = A5Handler.h_setPaused.selector;
        sels[3] = A5Handler.h_publishNoteRoot.selector;
        sels[4] = A5Handler.h_retireNoteRoot.selector;
        sels[5] = A5Handler.h_rotateRoot.selector;
        sels[6] = A5Handler.h_retireRoot.selector;
        sels[7] = A5Handler.h_setDenyList.selector;
        sels[8] = A5Handler.h_requestAudit.selector;
        sels[9] = A5Handler.h_proveThreshold.selector;

        targetContract(address(handler));
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: sels}));
    }

    // The committed runs/depth below are a SPEED choice, not a confidence one: at 24x48
    // the nine invariants together take about 1.3s, which keeps `forge test` usable. Every
    // one of them was also run at 150x250 — 37,500 calls each — and held. Raise the inline
    // config, not the env var: an inline forge-config comment overrides FOUNDRY_INVARIANT_*.

    /// THE SOLVENCY INVARIANT. The register holds exactly what entered minus what left.
    /// There is no "outstanding" figure in storage to compare against — the shielded
    /// ledger is commitments, not balances — so the ghost accounting IS the register's
    /// claim, and this asserts the asset balance never falls behind it.
    ///
    /// It is only true because the handler never withdraws to the pool itself; see
    /// test_F13 for why that case breaks it and is a finding rather than an omission.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_BackingEqualsWhatEnteredMinusWhatLeft() public view {
        assertEq(
            asset.balanceOf(address(pool)),
            handler.ghostDeposited() - handler.ghostWithdrawn(),
            "the register holds exactly deposits minus withdrawals"
        );
        assertEq(pool.balance(), asset.balanceOf(address(pool)), "balance() is the live read");
    }

    /// A nullifier, once spent, is spent forever. The contract has exactly one writer —
    /// `nullifierUsed[n] = true` in transact — and no path that clears it, so a double
    /// spend would have to come from a missing write, not from an unset.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_NullifiersAreSpentForever() public view {
        uint256 n = handler.seenNullifierCount();
        for (uint256 i = 0; i < n; i++) {
            assertTrue(pool.nullifierUsed(handler.seenNullifiers(i)), "a spent nullifier came back");
        }
    }

    /// commitmentCount never decreases, and it is the leaf count the circuits index
    /// against — the array view, the counter and the indexed getter cannot drift apart.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_LeafCountIsMonotonicAndAgreesWithItself() public view {
        uint256 count = pool.commitmentCount();
        assertGe(count, handler.ghostLeafHighWater(), "the leaf count went backwards");
        assertEq(count, pool.allCommitments().length, "the counter and the array disagree");
        assertLe(count, pool.TREE_CAPACITY(), "a leaf past capacity has no witness");
    }

    /// Every stored leaf is a field element and is marked known. The first half is what
    /// makes `uint256(commitment) % FIELD` injective on the register's contents — the
    /// property every disclosure depends on to name a position unambiguously.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_EveryStoredLeafIsAKnownFieldElement() public view {
        bytes32[] memory all = pool.allCommitments();
        // Bounded: the tail is the newest and the most likely to be wrong.
        uint256 from = all.length > 32 ? all.length - 32 : 0;
        for (uint256 i = from; i < all.length; i++) {
            assertLt(uint256(all[i]), FIELD, "a stored leaf is not a field element");
            assertTrue(pool.commitmentKnown(all[i]), "a stored leaf is not marked known");
        }
    }

    /// A root's known-ness changes ONLY through the two calls that are allowed to change
    /// it. Stated as the naive "a known root is never un-known" the property is FALSE —
    /// retireRoot and retireNoteRoot exist precisely to un-know one — so this is the true
    /// form: the register's answer matches the retirement history exactly, with no root
    /// silently closing or silently reopening.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_RootsCloseOnlyByRetirementAndOpenOnlyByPublication() public view {
        uint256 n = handler.seenNoteRootCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 r = handler.seenNoteRoots(i);
            assertEq(pool.knownNoteRoot(r), handler.expectNoteRootKnown(r), "note root drifted");
        }
        uint256 m = handler.seenAspRootCount();
        for (uint256 i = 0; i < m; i++) {
            uint256 r = handler.seenAspRoots(i);
            assertEq(pool.knownRoot(r), handler.expectAspRootKnown(r), "association root drifted");
        }
    }

    /// An answered audit stays answered, with the kind that answered it. auditAnswered has
    /// one writer per prove* path and never returns to 0, which is what makes the record
    /// an answer rather than a status.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_AnsweredAuditsStayAnsweredWithTheSameKind() public view {
        uint256 n = handler.seenContextCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 ctx = handler.seenContexts(i);
            uint8 answered = pool.auditAnswered(ctx);
            assertTrue(answered != 0, "an answered request reopened");
            assertEq(answered, handler.ghostAnsweredKind(ctx), "the answer changed kind");
        }
    }

    /// The pause halts VALUE. Both counters can only be incremented by a deposit or a
    /// transact that succeeded while `paused` was already true, and the notPaused modifier
    /// makes that unreachable — so a non-zero counter is a live breach of the halt.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_PausedNeverLetsValueMove() public view {
        assertEq(handler.ghostDepositsWhilePaused(), 0, "a deposit landed on a halted register");
        assertEq(handler.ghostTransactsWhilePaused(), 0, "a transfer landed on a halted register");
    }

    /// A sanctioned wallet is never verified, whatever the rule set says. isVerified is
    /// `_eligible && !_denied`, so the deny list is a veto that no rule can widen past —
    /// the register's own sanctions perimeter cannot be traded away by loosening admission.
    ///
    /// This holds for the ERC-3643 surface. It does NOT hold for the paths that move value:
    /// see test_F11 and test_F12.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_ASanctionedWalletIsNeverVerified() public view {
        for (uint256 i = 0; i < 4; i++) {
            address who = handler.actorAt(i);
            uint256 key = pool.sourceKeyOf(who);
            bool denied;
            for (uint256 s = 0; s < 8; s++) {
                if (pool.denyList(s) != 0 && pool.denyList(s) == key) denied = true;
            }
            if (denied) {
                assertFalse(pool.isVerified(who), "a sanctioned wallet reads as verified");
                assertFalse(pool.canTransfer(who, who, 0), "and may transfer");
            }
        }
    }

    /// The auditor and the owner are never zero. Both are the register's liveness levers —
    /// a zero owner freezes publishNoteRoot forever, a zero auditor makes the register
    /// unanswerable — and both setters refuse zero. Checked over the whole sequence so a
    /// path that reaches zero indirectly is caught.
    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 48
    function invariant_TheTwoPrivilegedRolesAreNeverZero() public view {
        assertTrue(pool.owner() != address(0), "an owner of zero locks every deposit in");
        assertTrue(pool.auditor() != address(0), "an auditor of zero makes the register unanswerable");
    }
}

// =========================================================================
// 2-5. FUZZED DOMAINS, THE ACCESS MATRICES, REENTRANCY, THE STANDARD SURFACE
// =========================================================================

contract Audit5Test is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant ROOT = 12345;
    uint256 constant NOTE_ROOT = 54321;

    /// commitments.length, established by Audit3's capacity test and re-asserted by
    /// Audit4's test_C5. A storage reshuffle must fail loudly rather than silently no-op.
    uint256 constant SLOT_COMMITMENTS = 13;

    SaksiPool pool;
    A5Asset asset;
    A5Verifier verifier;
    A5Validator validator;

    address holder   = address(0xA11CE);
    address relay    = address(0x9E1A);
    address payee    = address(0xC0FED);
    address stranger = address(0x574A9);
    address owner    = address(this);

    uint[2] pA; uint[2][2] pB; uint[2] pC;

    function setUp() public {
        asset = new A5Asset();
        verifier = new A5Verifier();
        validator = new A5Validator();
        address v = address(verifier);
        pool = new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, ROOT, owner);
        asset.mint(holder, type(uint128).max);
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
    function _cl2(uint8 k, uint256 a, uint256 b) internal pure returns (bytes32) {
        return keccak256(abi.encode(k, a, b));
    }

    function _setLeafCount(uint256 n) internal {
        vm.store(address(pool), bytes32(SLOT_COMMITMENTS), bytes32(n));
    }

    // =====================================================================
    // 2. FUZZED DOMAINS
    // =====================================================================

    /// deposit()'s whole argument domain, partitioned. The guard order is load-bearing:
    /// the two cheap refusals come before two Groth16 verifications the caller cannot use,
    /// so a fuzz that only ever reached the happy path would not notice the order changing.
    function testFuzz_DepositAmountAndCommitmentPartition(uint256 amount, uint256 cRaw) public {
        amount = bound(amount, 0, 1e30);
        bytes32 c = bytes32(cRaw);
        uint[11] memory p = _pub(holder, bytes32(cRaw % FIELD));
        uint[3] memory b;
        b[0] = cRaw; b[1] = amount; b[2] = 0;

        vm.startPrank(holder);
        if (amount == 0) {
            vm.expectRevert(SaksiPool.ZeroAmount.selector);
            pool.deposit(amount, c, pA, pB, pC, p, pA, pB, pC, b);
        } else if (cRaw >= FIELD) {
            // Six bytes32 values share each residue; only the smallest is a field element.
            vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
            pool.deposit(amount, c, pA, pB, pC, p, pA, pB, pC, b);
        } else {
            pool.deposit(amount, c, pA, pB, pC, p, pA, pB, pC, b);
            assertTrue(pool.commitmentKnown(c));
            assertEq(pool.balance(), amount, "the register holds exactly what moved");
        }
        vm.stopPrank();
    }

    /// The commitment ceiling, at the values either side of it. FIELD-1 is the largest
    /// legal leaf and must be accepted: refusing it would silently shrink the register's
    /// key space below the circuits'.
    function testFuzz_DepositCommitmentBoundaryIsExactlyFIELD(uint256 delta) public {
        delta = bound(delta, 0, 64);

        bytes32 ok_ = bytes32(FIELD - 1 - delta);
        _deposit(holder, ok_, 1e6);
        assertTrue(pool.commitmentKnown(ok_), "FIELD-1 is a legal leaf");

        bytes32 over = bytes32(FIELD + delta);
        uint[11] memory p = _pub(holder, over);
        uint[3] memory b;
        b[0] = FIELD + delta; b[1] = 1e6; b[2] = 0;
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
        pool.deposit(1e6, over, pA, pB, pC, p, pA, pB, pC, b);
    }

    /// The value binding is exact in both directions and the entry domain is reserved.
    /// Over-committing is the attack the binding exists for; under-committing strands
    /// backing behind no note; a non-zero context turns the entry proof into an answer to
    /// somebody's audit.
    function testFuzz_DepositBindingIsExactOnAmountAndOnContext(uint256 amount, uint256 claimed, uint256 ctx)
        public
    {
        amount = bound(amount, 1, 1e24);
        bytes32 c = bytes32(uint256(5000));
        uint[11] memory p = _pub(holder, c);

        if (claimed != amount) {
            uint[3] memory wrongAmount;
            wrongAmount[0] = uint256(c); wrongAmount[1] = claimed; wrongAmount[2] = 0;
            vm.prank(holder);
            vm.expectRevert(SaksiPool.AmountNotBound.selector);
            pool.deposit(amount, c, pA, pB, pC, p, pA, pB, pC, wrongAmount);
        }

        if (ctx != 0) {
            uint[3] memory wrongCtx;
            wrongCtx[0] = uint256(c); wrongCtx[1] = amount; wrongCtx[2] = ctx;
            vm.prank(holder);
            vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
            pool.deposit(amount, c, pA, pB, pC, p, pA, pB, pC, wrongCtx);
        }

        assertEq(pool.commitmentCount(), 0, "nothing entered on any refused path");
        assertEq(pool.balance(), 0);
    }

    /// publicAmount is a field element carrying a SIGN, and the whole uint256 line has to
    /// be accounted for. Six regions, each with a different outcome; the two nobody would
    /// write by hand are the modulus itself and everything above it.
    function testFuzz_TransactPublicAmountPartition(uint256 region, uint256 mag) public {
        _deposit(holder, bytes32(uint256(5100)), 100e6);
        region = region % 6;

        uint256 pub;
        if (region == 0)      pub = 0;                                   // internal transfer
        else if (region == 1) pub = bound(mag, 1, FIELD / 2 - 1);        // positive: an entry
        else if (region == 2) pub = bound(mag, FIELD / 2, FIELD - 1e18); // a withdrawal past any backing
        else if (region == 3) pub = FIELD - bound(mag, 1, 200e6);        // a plausible withdrawal
        else if (region == 4) pub = FIELD;                               // the modulus itself
        else                  pub = bound(mag, FIELD + 1, type(uint256).max);

        uint[7] memory s = _xfer(0, payee, address(0), 0, 1);
        s[1] = pub;
        uint256 withdrawn = (pub >= FIELD / 2 && pub <= FIELD) ? FIELD - pub : 0;

        if (region == 1) {
            // Value only enters through deposit(), the edge carrying the CVI proof.
            vm.expectRevert(SaksiPool.DepositsUseDepositPath.selector);
            pool.transact(pA, pB, pC, s, payee, address(0), 0);
        } else if (region == 5) {
            // FINDING (F8, LOW). Above the modulus the contract computes FIELD - publicAmount
            // with no upper bound, so the refusal is a bare arithmetic panic rather than a
            // named error. Unreachable through a real snarkjs verifier — it rejects any
            // public signal >= r before the pairing — so this is the same class of
            // defence-in-depth gap Audit3's F4 pinned AT the modulus, one step further out.
            vm.expectRevert(stdError.arithmeticError);
            pool.transact(pA, pB, pC, s, payee, address(0), 0);
        } else if (withdrawn > pool.balance()) {
            vm.expectRevert(SaksiPool.ExceedsBacking.selector);
            pool.transact(pA, pB, pC, s, payee, address(0), 0);
        } else {
            pool.transact(pA, pB, pC, s, payee, address(0), 0);
            assertEq(asset.balanceOf(payee), withdrawn, "exactly the encoded amount left");
            assertEq(pool.balance(), 100e6 - withdrawn);
            assertEq(pool.commitmentCount(), 3, "two outputs on every path, withdrawal or not");
        }
    }

    /// The fee comes out of the withdrawal or the transaction does not happen. Fuzzed over
    /// the whole (out, fee) plane, including fee > out and a fee with no withdrawal at all.
    function testFuzz_TransactFeeIsAlwaysBoundedByTheWithdrawal(uint256 out, uint256 fee) public {
        _deposit(holder, bytes32(uint256(5200)), 100e6);
        out = bound(out, 0, 100e6);
        fee = bound(fee, 0, 200e6);

        uint[7] memory s = _xfer(out, payee, relay, fee, 2);

        if (out == 0 && fee != 0) {
            // Pocketing a fee on an internal transfer would leave the relayer paying gas
            // out of value that never moved.
            vm.expectRevert(SaksiPool.FeeWithoutWithdrawal.selector);
            pool.transact(pA, pB, pC, s, payee, relay, fee);
        } else if (fee > out) {
            // No path may pay out more than it burnt; the subtraction is the last guard.
            vm.expectRevert(stdError.arithmeticError);
            pool.transact(pA, pB, pC, s, payee, relay, fee);
        } else {
            pool.transact(pA, pB, pC, s, payee, relay, fee);
            assertEq(asset.balanceOf(payee), out - fee, "recipient takes withdrawn - fee");
            assertEq(asset.balanceOf(relay), fee, "relayer takes exactly the fee");
            assertEq(100e6 - pool.balance(), out, "and the register loses exactly withdrawn");
        }
    }

    /// The exit is gated on the RECIPIENT, for every address in the space. A withdrawal to
    /// an uncredentialed wallet — including address(0) and the register itself — is refused
    /// by Cleanverse's Validator rather than by an allow list this contract maintains.
    function testFuzz_WithdrawalRefusesEveryUncredentialedRecipient(address to) public {
        vm.assume(!validator.eligible(to));
        _deposit(holder, bytes32(uint256(5300)), 100e6);

        uint[7] memory s = _xfer(10e6, to, address(0), 0, 3);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, to));
        pool.transact(pA, pB, pC, s, to, address(0), 0);
        assertEq(pool.balance(), 100e6, "nothing leaves on a refused exit");
        assertFalse(pool.nullifierUsed(bytes32(s[3])), "and nothing is burnt");
    }

    /// A relayer is credential-checked exactly when it is PAID, and never otherwise. The
    /// asymmetry is deliberate — an unpaid relayer receives nothing, so gating it would
    /// refuse transactions for no compliance gain — and it is fuzzed here because the
    /// boundary is `fee != 0` rather than `relayer != address(0)`.
    function testFuzz_PaidRelayerIsCredentialCheckedUnpaidRelayerIsNot(address rel, uint256 fee) public {
        vm.assume(!validator.eligible(rel));
        _deposit(holder, bytes32(uint256(5400)), 100e6);
        fee = bound(fee, 0, 10e6);

        uint[7] memory s = _xfer(10e6, payee, rel, fee, 4);
        if (fee == 0) {
            pool.transact(pA, pB, pC, s, payee, rel, fee);
            assertEq(asset.balanceOf(payee), 10e6, "the recipient takes the lot");
            assertEq(asset.balanceOf(rel), 0, "an unpaid relayer is never asked for a credential");
        } else {
            vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, rel));
            pool.transact(pA, pB, pC, s, payee, rel, fee);
        }
    }

    /// requestAudit's admission rules, as a total function of its four arguments. Every
    /// refusal below closes a way of registering a question that could never be answered,
    /// or one whose answer already exists in public calldata.
    function testFuzz_RequestAuditAdmissionRules(uint256 ctx, uint256 subject, uint8 kind, bytes32 claim)
        public
    {
        uint8 AGG = pool.KIND_AGGREGATE();
        uint8 EXACT = pool.KIND_EXACT();

        bool admitted = kind != 0 && kind <= AGG && ctx != 0 && subject < FIELD
            && !(kind == AGG && subject != 0) && !(kind == EXACT && claim != bytes32(0));

        if (kind == 0 || kind > AGG) {
            vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        } else if (ctx == 0) {
            // ctx 0 is the entry-binding domain: the depositor's own public calldata would
            // be a valid answer, replayable by anyone.
            vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        } else if (subject >= FIELD) {
            vm.expectRevert(SaksiPool.WrongSubject.selector);
        } else if (kind == AGG && subject != 0) {
            vm.expectRevert(SaksiPool.WrongSubject.selector);
        } else if (kind == EXACT && claim != bytes32(0)) {
            vm.expectRevert(SaksiPool.WrongClaim.selector);
        }
        pool.requestAudit(ctx, subject, kind, claim, "fuzzed question");

        assertEq(pool.auditRequested(ctx), admitted, "registered exactly when admitted");
        if (admitted) {
            assertEq(pool.auditSubject(ctx), subject);
            assertEq(pool.auditKind(ctx), kind);
            assertEq(pool.auditClaim(ctx), claim);
        }
    }

    /// claimHash over the WHOLE uint8 kind space, not just the four named constants.
    /// Two properties an auditor's tooling depends on: the sentinel bytes32(0) belongs to
    /// EXACT alone, so a zero claim on any other kind is unanswerable by construction
    /// (Audit3's F2, generalised past the three kinds it tested); and the kind byte is
    /// inside the preimage, so no figure can be reinterpreted under a different kind.
    function testFuzz_ClaimHashIsTotalAndTheZeroSentinelBelongsToExactAlone(
        uint8 kind, uint8 other, uint256 a, uint256 b
    ) public view {
        uint8 EXACT = pool.KIND_EXACT();
        uint8 RANGE = pool.KIND_RANGE();
        bytes32 h = pool.claimHash(kind, a, b);

        if (kind == EXACT) {
            assertEq(h, bytes32(0), "the exact path's subject IS the question");
        } else {
            assertTrue(h != bytes32(0), "no numeric claim ever hashes to the exact sentinel");
            assertEq(h, kind == RANGE ? _cl2(kind, a, b) : _cl(kind, a), "the documented encoding");
        }

        // A different kind never produces the same claim for the same figures.
        if (other != kind && other != EXACT && kind != EXACT) {
            assertTrue(h != pool.claimHash(other, a, b), "the kind byte separates the claim");
        }
    }

    /// A threshold answer must name the cap the auditor asked for and nothing else — the
    /// H-1 vulnerability, fuzzed over the whole figure space rather than at the one vacuous
    /// maximum the original POC used.
    function testFuzz_ThresholdAnswersOnlyTheFigureThatWasAsked(uint256 asked, uint256 answered) public {
        _deposit(holder, bytes32(uint256(5500)), 50e6);
        uint8 THR = pool.KIND_THRESHOLD();
        pool.requestAudit(5501, 5500, THR, _cl(THR, asked), "at most `asked`?");

        if (answered != asked) {
            vm.prank(holder);
            vm.expectRevert(SaksiPool.WrongClaim.selector);
            pool.proveThreshold(pA, pB, pC, [uint256(5500), answered, uint256(5501)]);
            assertEq(pool.auditAnswered(5501), 0, "a refused answer leaves the question open");
        }

        vm.prank(holder);
        pool.proveThreshold(pA, pB, pC, [uint256(5500), asked, uint256(5501)]);
        assertEq(pool.auditAnswered(5501), THR, "and the honest answer still lands");
    }

    /// The range path spends both claim slots on its bounds, so BOTH have to be pinned:
    /// widening either one is the vacuous answer in disguise.
    function testFuzz_RangeAnswersOnlyTheBandThatWasAsked(
        uint256 lo, uint256 hi, uint256 lo2, uint256 hi2
    ) public {
        _deposit(holder, bytes32(uint256(5600)), 50e6);
        uint8 RNG = pool.KIND_RANGE();
        pool.requestAudit(5601, 5600, RNG, _cl2(RNG, lo, hi), "inside [lo, hi]?");

        if (lo2 != lo || hi2 != hi) {
            vm.expectRevert(SaksiPool.WrongClaim.selector);
            pool.proveRange(pA, pB, pC, [uint256(5600), lo2, hi2, uint256(5601)]);
        }
        pool.proveRange(pA, pB, pC, [uint256(5600), lo, hi, uint256(5601)]);
        assertEq(pool.auditAnswered(5601), RNG);
    }

    /// An exact disclosure is about ONE position, and the subject is pinned in the request.
    /// A stranger's own note is not an answer to a question about somebody else's.
    function testFuzz_ExactDisclosureSubjectIsPinned(uint256 wrongSubject, uint256 figure) public {
        _deposit(holder, bytes32(uint256(5700)), 50e6);
        wrongSubject = wrongSubject % FIELD;
        vm.assume(wrongSubject != 5700);
        uint8 EXACT = pool.KIND_EXACT();
        pool.requestAudit(5701, 5700, EXACT, bytes32(0), "disclose position 5700");

        vm.expectRevert(SaksiPool.WrongSubject.selector);
        pool.proveExact(pA, pB, pC, [wrongSubject, figure, uint256(5701)]);

        pool.proveExact(pA, pB, pC, [uint256(5700), figure, uint256(5701)]);
        assertEq(pool.auditAnswered(5701), EXACT);
    }

    /// The aggregate's five active flags are booleans in the circuit and integers in the
    /// ABI. Anything above 1 in any slot is refused, or "is this slot part of the report"
    /// would have answers the circuit cannot represent.
    function testFuzz_AggregateActiveFlagsMustBeBoolean(uint256 slot, uint256 flag) public {
        _deposit(holder, bytes32(uint256(5800)), 50e6);
        slot = bound(slot, 0, 4);
        flag = bound(flag, 2, type(uint256).max);
        uint8 AGG = pool.KIND_AGGREGATE();
        pool.requestAudit(5801, 0, AGG, _cl(AGG, 1_000e6), "total at most 1,000?");

        uint[13] memory s;
        s[0] = 5800; s[5] = 1;
        s[10] = 1_000e6; s[11] = 5801; s[12] = 1;
        s[pool.AGG_SLOTS() + slot] = flag;

        vm.expectRevert(SaksiPool.NotBoolean.selector);
        pool.proveAggregate(pA, pB, pC, s);
        assertEq(pool.auditAnswered(5801), 0, "the question stays open");
    }

    /// The perimeter is the issuer's own governance surface: owner-only for every caller
    /// that is not the owner, and every field of the rule round-trips unchanged for the one
    /// that is. RuleV2 is SIX fields — encoding five for a six-word decoder fails silently —
    /// so the fuzz carries all six.
    function testFuzz_PerimeterManagementIsOwnerOnlyAndRoundTrips(
        address caller, uint8 minTier, uint8 minSubTier, bool isBlackList, uint256 bitmap
    ) public {
        vm.assume(caller != owner);
        IAPassComplianceValidator.RuleV2 memory r =
            IAPassComplianceValidator.RuleV2(bytes2("ID"), bytes2("XX"), minTier, minSubTier, isBlackList, bitmap);

        vm.startPrank(caller);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setRule(r);
        vm.expectRevert(Ownable.NotOwner.selector); pool.addRule(r);
        vm.expectRevert(Ownable.NotOwner.selector); pool.removeRule(0);
        vm.stopPrank();

        pool.setRule(r);
        IAPassComplianceValidator.RuleV2[] memory live = pool.activeRules();
        assertEq(live.length, 1, "setRule replaces the whole set");
        assertEq(live[0].minTier, minTier);
        assertEq(live[0].minSubTier, minSubTier);
        assertEq(live[0].isBlackList, isBlackList, "the field an earlier interface omitted");
        assertEq(live[0].countryBitmap, bitmap);
    }

    /// removeRule forwards its index with no bounds check of its own. Not a bug — the
    /// register does not mirror Cleanverse's rule array and cannot know its length — but it
    /// means the failure an operator sees comes from a contract they did not call, with no
    /// error of this register's own. Pinned so the pass-through is deliberate.
    function testFuzz_RemoveRuleIndexIsForwardedUnchecked(uint256 index) public {
        pool.setRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 1, 0, false, 0));
        if (index == 0) {
            pool.removeRule(0);
            assertEq(pool.activeRules().length, 0);
        } else {
            vm.expectRevert();      // the Validator's array bound, not the register's
            pool.removeRule(index);
            assertEq(pool.activeRules().length, 1, "the perimeter is unchanged on a refused removal");
        }
    }

    /// The deny list holds LEAVES, not addresses, and sanctioning one must sanction exactly
    /// one wallet. Fuzzed across both the address space and all eight slots, because the
    /// deposit path compares the list positionally and the views scan it linearly — two
    /// different readings of the same storage.
    function testFuzz_SanctioningALeafSanctionsExactlyOneWallet(address a, address b, uint256 slot) public {
        vm.assume(a != b);
        slot = bound(slot, 0, 7);

        uint256[8] memory list;
        list[slot] = pool.sourceKeyOf(a);
        pool.setDenyList(list);

        validator.setEligible(a, true);
        validator.setEligible(b, true);
        assertFalse(pool.isVerified(a), "the sanctioned wallet");
        assertTrue(pool.isVerified(b), "and nobody else");
    }

    // =====================================================================
    // 3. THE ACCESS-CONTROL AND PAUSE MATRICES
    // =====================================================================

    /// THE COMPLETE STATE-CHANGING SURFACE. Eighteen external functions mutate storage:
    ///
    ///   owner-gated (11)   transferOwnership setRule addRule removeRule rotateRoot
    ///                      retireRoot publishNoteRoot retireNoteRoot setDenyList
    ///                      setAuditor setPaused
    ///   auditor-gated (1)  requestAudit
    ///   permissionless (6) deposit transact proveExact proveThreshold proveRange
    ///                      proveAggregate
    ///
    /// Audit2's sweep covers ten of the eleven owner-gated calls. This is the census: the
    /// refusal for all twelve gated functions AND proof that the six ungated ones genuinely
    /// admit a stranger — a role check that only ever appears as a revert is
    /// indistinguishable from a function nobody can call at all.
    function test_AccessControlMatrixCoversTheWholeStateChangingSurface() public {
        address bad = address(0xBADBAD);
        IAPassComplianceValidator.RuleV2 memory r =
            IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 1, 0, false, 0);
        uint256[8] memory list;

        vm.startPrank(bad);
        vm.expectRevert(Ownable.NotOwner.selector); pool.transferOwnership(bad);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setRule(r);
        vm.expectRevert(Ownable.NotOwner.selector); pool.addRule(r);
        vm.expectRevert(Ownable.NotOwner.selector); pool.removeRule(0);
        vm.expectRevert(Ownable.NotOwner.selector); pool.rotateRoot(1);
        vm.expectRevert(Ownable.NotOwner.selector); pool.retireRoot(ROOT);
        vm.expectRevert(Ownable.NotOwner.selector); pool.publishNoteRoot(1);
        vm.expectRevert(Ownable.NotOwner.selector); pool.retireNoteRoot(NOTE_ROOT);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setDenyList(list);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setAuditor(bad);
        vm.expectRevert(Ownable.NotOwner.selector); pool.setPaused(true);
        vm.expectRevert(SaksiPool.NotAuditor.selector); pool.requestAudit(1, 0, 1, bytes32(0), "q");
        vm.stopPrank();

        // The six ungated ones. deposit and transact are gated by the Validator and by a
        // proof, not by a role, so an outsider holding a live credential gets through.
        address outsider = address(0x0757);
        validator.setEligible(outsider, true);
        asset.mint(outsider, 10e6);
        _deposit(outsider, bytes32(uint256(6000)), 10e6);
        assertTrue(pool.commitmentKnown(bytes32(uint256(6000))), "deposit takes no role");

        vm.prank(outsider);
        pool.transact(pA, pB, pC, _xfer(0, payee, address(0), 0, 10), payee, address(0), 0);
        assertEq(pool.commitmentCount(), 3, "transact takes no role either");

        // The four disclosure paths consult neither the owner, the auditor NOR the
        // Validator. Deliberate and load-bearing: the answer is bound to the subject, the
        // kind and the figure, so who submits it changes nothing about what it says — and
        // answerability has to survive a credential being frozen, or a revoked position
        // would become permanently unauditable.
        _deposit(holder, bytes32(uint256(6001)), 10e6);
        uint8 EXACT = pool.KIND_EXACT();
        uint8 THR = pool.KIND_THRESHOLD();
        uint8 RNG = pool.KIND_RANGE();
        uint8 AGG = pool.KIND_AGGREGATE();
        pool.requestAudit(6100, 6000, EXACT, bytes32(0), "exact");
        pool.requestAudit(6101, 6001, THR, _cl(THR, 1_000e6), "threshold");
        pool.requestAudit(6102, 6001, RNG, _cl2(RNG, 1, 1_000e6), "range");
        pool.requestAudit(6103, 0, AGG, _cl(AGG, 1_000e6), "aggregate");

        address nobody = address(0xB0D1E5);
        assertFalse(pool.isVerified(nobody), "with no credential of any kind");
        vm.startPrank(nobody);
        pool.proveExact(pA, pB, pC, [uint256(6000), uint256(10e6), uint256(6100)]);
        pool.proveThreshold(pA, pB, pC, [uint256(6001), uint256(1_000e6), uint256(6101)]);
        pool.proveRange(pA, pB, pC, [uint256(6001), uint256(1), uint256(1_000e6), uint256(6102)]);
        uint[13] memory g;
        g[0] = 6001; g[5] = 1; g[10] = 1_000e6; g[11] = 6103; g[12] = 1;
        pool.proveAggregate(pA, pB, pC, g);
        vm.stopPrank();

        assertEq(pool.auditAnswered(6100), EXACT);
        assertEq(pool.auditAnswered(6101), THR);
        assertEq(pool.auditAnswered(6102), RNG);
        assertEq(pool.auditAnswered(6103), AGG);
    }

    /// THE PAUSE MATRIX, over the same eighteen. "paused blocks every state-changing entry
    /// point" is FALSE, and deliberately so: `notPaused` is on deposit and transact and on
    /// nothing else, so the halt stops VALUE and leaves governance and answerability alive.
    /// Audit4's S3 asserts that for one disclosure; this is the exhaustive form, and it is
    /// the shape a fix must not break — adding notPaused to the audit machinery would mean
    /// a halted register could not answer for the positions it is still holding.
    function test_PausedBlocksExactlyTwoOfTheEighteenEntryPoints() public {
        _deposit(holder, bytes32(uint256(6200)), 100e6);
        _deposit(holder, bytes32(uint256(6201)), 100e6);
        uint8 EXACT = pool.KIND_EXACT();
        uint8 THR = pool.KIND_THRESHOLD();
        uint8 RNG = pool.KIND_RANGE();
        uint8 AGG = pool.KIND_AGGREGATE();

        // Built while the register is open: _xfer reads extDataHashOf off the pool, and an
        // expectRevert armed over that read would fire on the wrong call.
        uint[11] memory p = _pub(holder, bytes32(uint256(6202)));
        uint[7] memory s = _xfer(1e6, payee, address(0), 0, 11);

        pool.setPaused(true);

        // --- the two that are blocked ---
        vm.prank(holder);
        vm.expectRevert(SaksiPool.Paused.selector);
        pool.deposit(1e6, bytes32(uint256(6202)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(6202)), 1e6));

        vm.expectRevert(SaksiPool.Paused.selector);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);

        // --- the sixteen that are not ---
        pool.rotateRoot(777);                 assertTrue(pool.knownRoot(777));
        pool.retireRoot(777);                 assertFalse(pool.knownRoot(777));
        pool.publishNoteRoot(0xB0B);          assertTrue(pool.knownNoteRoot(0xB0B));
        pool.retireNoteRoot(0xB0B);           assertFalse(pool.knownNoteRoot(0xB0B));
        uint256[8] memory list; list[0] = 42;
        pool.setDenyList(list);               assertEq(pool.getDenyList()[0], 42);
        pool.setRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 1, 0, false, 0));
        pool.addRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 2, 0, false, 0));
        pool.removeRule(0);                   assertEq(pool.activeRules().length, 1);

        pool.requestAudit(6300, 6200, EXACT, bytes32(0), "asked while halted");
        pool.requestAudit(6301, 6201, THR, _cl(THR, 1_000e6), "asked while halted");
        pool.requestAudit(6302, 6201, RNG, _cl2(RNG, 1, 1_000e6), "asked while halted");
        pool.requestAudit(6303, 0, AGG, _cl(AGG, 1_000e6), "asked while halted");

        pool.proveExact(pA, pB, pC, [uint256(6200), uint256(100e6), uint256(6300)]);
        pool.proveThreshold(pA, pB, pC, [uint256(6201), uint256(1_000e6), uint256(6301)]);
        pool.proveRange(pA, pB, pC, [uint256(6201), uint256(1), uint256(1_000e6), uint256(6302)]);
        uint[13] memory g;
        g[0] = 6201; g[5] = 1; g[10] = 1_000e6; g[11] = 6303; g[12] = 1;
        pool.proveAggregate(pA, pB, pC, g);

        assertEq(pool.auditAnswered(6300), EXACT, "a halted register still answers");
        assertEq(pool.auditAnswered(6303), AGG, "and closes the question for good");

        pool.setPaused(true);                 assertTrue(pool.paused(), "no idempotence guard");
        pool.setAuditor(stranger);            assertEq(pool.auditor(), stranger);
        pool.transferOwnership(stranger);     assertEq(pool.owner(), stranger);

        assertTrue(pool.paused(), "and the halt outlives every one of them");
    }

    // =====================================================================
    // 4. REENTRANCY
    // =====================================================================

    function _hookPool(A5HookAsset tok) internal returns (SaksiPool p2) {
        address v = address(verifier);
        p2 = new SaksiPool(address(tok), address(validator), v, v, v, v, v, v, ROOT, owner);
        p2.publishNoteRoot(NOTE_ROOT);
        tok.mint(holder, 1_000e6);
        validator.setEligible(address(tok), true);   // the adversarial premise: the hook can
                                                     // pass transact's own eligibility gate
    }

    function _depositTo(SaksiPool p2, address who, bytes32 c, uint256 amt) internal {
        uint[11] memory p;
        p[0] = ROOT; p[9] = p2.sourceKeyOf(who); p[10] = uint256(c);
        vm.prank(who);
        p2.deposit(amt, c, pA, pB, pC, p, pA, pB, pC, _bind(c, amt));
    }

    /// The deposit pull. The register measures its own balance across transferFrom rather
    /// than trusting the argument, and that measurement is what makes the path effectively
    /// non-reentrant: any nested call that moves the register's balance makes the outer
    /// delta disagree with the committed amount, and the whole frame unwinds.
    ///
    /// The hook's own bookkeeping is rolled back with everything else, so it cannot report
    /// that it ran. The disarmed control at the end is the evidence: the identical deposit
    /// succeeds, so the refusal above is the reentrancy and nothing else.
    function test_ReentrantCallDuringTheDepositPullUnwindsTheWholeFrame() public {
        A5HookAsset tok = new A5HookAsset();
        SaksiPool p2 = _hookPool(tok);

        uint[11] memory inner;
        inner[0] = ROOT; inner[9] = p2.sourceKeyOf(address(tok)); inner[10] = 0x7001;
        tok.mint(address(tok), 5e6);
        tok.arm(1, address(p2), abi.encodeWithSelector(
            SaksiPool.deposit.selector,
            uint256(5e6), bytes32(uint256(0x7001)), pA, pB, pC, inner, pA, pB, pC,
            _bind(bytes32(uint256(0x7001)), 5e6)
        ));

        bytes32 c = bytes32(uint256(0x7000));
        uint[11] memory p;
        p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        vm.prank(holder);
        vm.expectRevert(SaksiPool.AmountNotBound.selector);
        p2.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 100e6));

        assertEq(p2.commitmentCount(), 0, "no half-written register survives the revert");
        assertEq(p2.balance(), 0, "and no backing");
        assertEq(tok.armOn(), 1, "the hook's own state was rolled back with the frame");

        tok.arm(0, address(0), "");
        _depositTo(p2, holder, c, 100e6);
        assertTrue(p2.commitmentKnown(c), "the identical deposit lands with the hook disarmed");
    }

    /// The FEE leg — the second of the two transfers, which Audit3's W8 never reached. The
    /// hook fires with the recipient already paid and the fee not yet sent, so the balance a
    /// nested transact reads is STALE by exactly the fee. Draining what it can see leaves
    /// the outer fee transfer to underflow, and the whole transaction unwinds.
    ///
    /// Stated as it is rather than as a clean pass: solvency on this path rests on the
    /// token's own arithmetic, not on ExceedsBacking — the same conclusion W8 reached about
    /// the recipient leg. A register that wanted this guaranteed would take a reentrancy
    /// lock rather than read a balance.
    function test_ReentrancyOnTheFeeLegCannotOutrunTheBacking() public {
        A5HookAsset tok = new A5HookAsset();
        SaksiPool p2 = _hookPool(tok);
        _depositTo(p2, holder, bytes32(uint256(0x7100)), 100e6);

        // The hook fires on the second transfer, which is after the recipient's 35e6 has
        // been debited and before the 5e6 fee is: the balance it reads is 65e6 and it
        // takes all of it, which is exactly what ExceedsBacking permits.
        uint[7] memory inner;
        inner[0] = NOTE_ROOT; inner[1] = FIELD - 65e6;      // everything the hook can see
        inner[2] = p2.extDataHashOf(payee, address(0), 0);
        inner[3] = 0xC1; inner[4] = 0xC2; inner[5] = 0xC3; inner[6] = 0xC4;
        tok.arm(3, address(p2), abi.encodeWithSelector(
            SaksiPool.transact.selector, pA, pB, pC, inner, payee, address(0), uint256(0)
        ));

        uint[7] memory outer;
        outer[0] = NOTE_ROOT; outer[1] = FIELD - 40e6;
        outer[2] = p2.extDataHashOf(payee, relay, 5e6);
        outer[3] = 0xD1; outer[4] = 0xD2; outer[5] = 0xD3; outer[6] = 0xD4;

        vm.expectRevert(stdError.arithmeticError);
        p2.transact(pA, pB, pC, outer, payee, relay, 5e6);

        assertEq(tok.balanceOf(address(p2)), 100e6, "backing intact");
        assertEq(tok.balanceOf(payee), 0, "nothing drained");
        assertFalse(p2.nullifierUsed(bytes32(uint256(0xD1))), "and nothing burnt");
    }

    /// The nullifier set is written BEFORE any value moves, so a hook re-entering with the
    /// outer transaction's own nullifiers is refused by state the outer call has already
    /// committed. This is what effects-before-interactions buys on this path, and it is
    /// asserted from inside the hook rather than inferred from the source ordering.
    function test_ReentrantTransactCannotReplayTheOuterNullifiers() public {
        A5HookAsset tok = new A5HookAsset();
        SaksiPool p2 = _hookPool(tok);
        _depositTo(p2, holder, bytes32(uint256(0x7200)), 100e6);

        uint[7] memory replay;
        replay[0] = NOTE_ROOT; replay[1] = FIELD - 10e6;
        replay[2] = p2.extDataHashOf(payee, address(0), 0);
        replay[3] = 0xE1; replay[4] = 0xE2;                 // the OUTER call's nullifiers
        replay[5] = 0xE5; replay[6] = 0xE6;                 // fresh outputs, so only the
                                                            // nullifier check can refuse it
        tok.arm(2, address(p2), abi.encodeWithSelector(
            SaksiPool.transact.selector, pA, pB, pC, replay, payee, address(0), uint256(0)
        ));

        uint[7] memory outer;
        outer[0] = NOTE_ROOT; outer[1] = FIELD - 10e6;
        outer[2] = p2.extDataHashOf(payee, address(0), 0);
        outer[3] = 0xE1; outer[4] = 0xE2; outer[5] = 0xE3; outer[6] = 0xE4;
        p2.transact(pA, pB, pC, outer, payee, address(0), 0);

        assertTrue(tok.fired(), "the hook ran");
        assertFalse(tok.reenteredOk(), "and the replay was refused");
        assertEq(bytes4(tok.reentryError()), SaksiPool.NullifierUsed.selector,
            "refused by the nullifier the outer call had already burnt");
        assertEq(tok.balanceOf(payee), 10e6, "the honest withdrawal still completed");
        assertEq(p2.commitmentCount(), 3, "and inserted its two outputs exactly once");
    }

    /// Cross-function: a hook that DEPOSITS during a withdrawal succeeds — it is a
    /// legitimate independent call — and the register stays consistent through it. The leaf
    /// ORDER is what matters: the outer call's two outputs are pushed before the transfer,
    /// so the nested deposit's leaf lands after them and the off-chain note tree rebuilt
    /// from CommitmentInserted still matches `commitments[]` exactly.
    function test_ReentrantDepositDuringAPayoutKeepsTheLeafOrderConsistent() public {
        A5HookAsset tok = new A5HookAsset();
        SaksiPool p2 = _hookPool(tok);
        _depositTo(p2, holder, bytes32(uint256(0x7300)), 100e6);

        uint[11] memory inner;
        inner[0] = ROOT; inner[9] = p2.sourceKeyOf(address(tok)); inner[10] = 0x7301;
        tok.mint(address(tok), 7e6);
        tok.arm(2, address(p2), abi.encodeWithSelector(
            SaksiPool.deposit.selector,
            uint256(7e6), bytes32(uint256(0x7301)), pA, pB, pC, inner, pA, pB, pC,
            _bind(bytes32(uint256(0x7301)), 7e6)
        ));

        uint[7] memory outer;
        outer[0] = NOTE_ROOT; outer[1] = FIELD - 40e6;
        outer[2] = p2.extDataHashOf(payee, address(0), 0);
        outer[3] = 0xF1; outer[4] = 0xF2; outer[5] = 0xF3; outer[6] = 0xF4;
        p2.transact(pA, pB, pC, outer, payee, address(0), 0);

        assertTrue(tok.reenteredOk(), "the nested deposit is a legitimate independent call");
        bytes32[] memory all = p2.allCommitments();
        assertEq(all.length, 4);
        assertEq(all[0], bytes32(uint256(0x7300)), "the original deposit");
        assertEq(all[1], bytes32(uint256(0xF3)), "the outer call's outputs, pushed before the payout");
        assertEq(all[2], bytes32(uint256(0xF4)));
        assertEq(all[3], bytes32(uint256(0x7301)), "then the nested deposit's leaf");
        assertEq(p2.balance(), 100e6 - 40e6 + 7e6, "and the backing reconciles exactly");
    }

    /// The contracts the register trusts to answer it — Cleanverse's Validator and the six
    /// Groth16 verifiers — are held through `view` interfaces, so every call is a STATICCALL
    /// and none of them can write, re-enter, or leave a mark. A hostile Validator can
    /// therefore do nothing but refuse, and a refusal is the safe direction on every path.
    ///
    /// The order below is not cosmetic. A STATICCALL that attempts a write halts
    /// exceptionally and consumes EVERY unit of gas it was forwarded — 63/64 of what the
    /// frame held — so each hostile call costs almost all remaining gas. The positive
    /// control therefore runs first, and only two hostile calls follow it.
    function test_AHostileValidatorCannotReenterAndFailsClosed() public {
        A5EvilValidator evil = new A5EvilValidator();
        evil.setEligible(holder, true);
        address v = address(verifier);
        SaksiPool p2 = new SaksiPool(address(asset), address(evil), v, v, v, v, v, v, ROOT, owner);

        // Positive control: with the hostility off the very same contract admits the
        // deposit, so the refusal below is the STATICCALL and not a broken fixture.
        evil.setHostile(false);
        bytes32 ok_ = bytes32(uint256(0x7401));
        _depositTo(p2, holder, ok_, 10e6);
        assertTrue(p2.commitmentKnown(ok_));
        assertTrue(p2.isVerified(holder));

        evil.setHostile(true);
        assertFalse(p2.isVerified(holder), "the standard view reads a hostile validator as a refusal");

        bytes32 c = bytes32(uint256(0x7400));
        uint[11] memory p;
        p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        vm.prank(holder);
        vm.expectRevert();                                  // the storage write under STATICCALL
        p2.deposit(10e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 10e6));

        assertEq(evil.writes(), 0, "the attempted write never landed");
        assertEq(p2.commitmentCount(), 1, "and nothing entered on the hostile path");
    }

    function test_AHostileVerifierCannotReenterEither() public {
        A5EvilVerifier evil = new A5EvilVerifier();
        address e = address(evil);
        SaksiPool p2 = new SaksiPool(address(asset), address(validator), e, e, e, e, e, e, ROOT, owner);

        bytes32 c = bytes32(uint256(0x7500));
        uint[11] memory p;
        p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        vm.prank(holder);
        vm.expectRevert();
        p2.deposit(10e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 10e6));

        assertEq(evil.writes(), 0, "a verifier cannot leave a mark even on its own storage");
        assertEq(p2.commitmentCount(), 0);
    }

    /// The three `require(asset.transferX(...), "...")` branches. Every mock in the suite
    /// returns true unconditionally, so all three have been dead since they were written —
    /// and a token that signals failure by RETURNING FALSE rather than reverting is common
    /// enough that the CVA might well be one.
    function test_ATokenThatReturnsFalseIsCaughtOnAllThreeLegs() public {
        A5FalseAsset fa = new A5FalseAsset();
        address v = address(verifier);
        SaksiPool p2 = new SaksiPool(address(fa), address(validator), v, v, v, v, v, v, ROOT, owner);
        p2.publishNoteRoot(NOTE_ROOT);
        fa.mint(holder, 1_000e6);

        // leg 1: the deposit pull
        fa.setFailPull(true);
        bytes32 c = bytes32(uint256(0x7600));
        uint[11] memory p;
        p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        vm.prank(holder);
        vm.expectRevert(bytes("transferFrom failed"));
        p2.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 100e6));

        fa.setFailPull(false);
        vm.prank(holder);
        p2.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 100e6));

        // leg 2: the recipient payout
        fa.setFailPay(true, 1);
        uint[7] memory s;
        s[0] = NOTE_ROOT; s[1] = FIELD - 40e6;
        s[2] = p2.extDataHashOf(payee, relay, 5e6);
        s[3] = 0x11; s[4] = 0x12; s[5] = 0x13; s[6] = 0x14;
        vm.expectRevert(bytes("transfer failed"));
        p2.transact(pA, pB, pC, s, payee, relay, 5e6);

        // leg 3: the fee payout, which only fails after the recipient has been paid
        fa.setFailPay(true, 2);
        vm.expectRevert(bytes("fee transfer failed"));
        p2.transact(pA, pB, pC, s, payee, relay, 5e6);

        assertEq(fa.balanceOf(address(p2)), 100e6, "every refused leg unwinds the whole transfer");
        assertEq(fa.balanceOf(payee), 0);
        assertFalse(p2.nullifierUsed(bytes32(uint256(0x11))));
    }

    // =====================================================================
    // 5. THE ERC-3643 / ERC-1400 SURFACE
    // =====================================================================

    /// Every status byte the register can emit, reached, plus the reason each carries. An
    /// integrator switching on these acts on them, so an unreachable code is a dead branch
    /// in their code and a wrong code is a wrong action in production.
    /// SENDER_SANCTIONED is the one reason no earlier pass reached.
    function test_EveryStatusByteIsReachableAndCarriesItsOwnReason() public {
        _deposit(holder, bytes32(uint256(8000)), 100e6);
        bytes1 code; bytes32 why;

        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_OK());
        assertEq(why, bytes32(0), "an allowed transfer carries no reason");

        validator.setEligible(holder, false);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_INVALID_SENDER());
        assertEq(why, bytes32("SENDER_NOT_CREDENTIALED"));
        validator.setEligible(holder, true);

        // The reason no earlier pass reached: a credentialed wallet on the register's own
        // sanctions list. "Sort your credential out" and "you are sanctioned" demand
        // opposite actions, which is the whole argument for the reason byte existing.
        uint256[8] memory list;
        list[0] = pool.sourceKeyOf(holder);
        pool.setDenyList(list);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_INVALID_SENDER());
        assertEq(why, bytes32("SENDER_SANCTIONED"), "distinct from an absent credential");

        list[0] = 0;
        pool.setDenyList(list);
        validator.setEligible(payee, false);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_INVALID_RECEIVER());
        assertEq(why, bytes32("RECIPIENT_NOT_CREDENTIALED"));
        validator.setEligible(payee, true);

        list[0] = pool.sourceKeyOf(payee);
        pool.setDenyList(list);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_INVALID_RECEIVER());
        assertEq(why, bytes32("RECIPIENT_SANCTIONED"));

        list[0] = 0;
        pool.setDenyList(list);
        (code, why) = pool.canTransferWithReason(holder, payee, 100e6 + 1);
        assertEq(code, pool.STATUS_INSUFFICIENT_BALANCE());
        assertEq(why, bytes32("EXCEEDS_BACKING"), "exact at the backing boundary");
        (code, ) = pool.canTransferWithReason(holder, payee, 100e6);
        assertEq(code, pool.STATUS_OK(), "and the boundary itself is allowed");

        pool.setPaused(true);
        (code, why) = pool.canTransferWithReason(holder, payee, 1);
        assertEq(code, pool.STATUS_HALTED());
        assertEq(why, bytes32("REGISTER_PAUSED"), "a halt blames the register, not the parties");

        // All five ERC-1066 bytes are distinct, or an integrator's switch collapses.
        assertTrue(pool.STATUS_OK() != pool.STATUS_HALTED());
        assertTrue(pool.STATUS_INVALID_SENDER() != pool.STATUS_INVALID_RECEIVER());
        assertTrue(pool.STATUS_INSUFFICIENT_BALANCE() != pool.STATUS_OK());
    }

    /// The two predicates must never disagree. `canTransfer` returns a boolean and
    /// `canTransferWithReason` a code, and an integrator may call either — so a state where
    /// one permits and the other refuses is a wrong answer whichever one is believed.
    /// Fuzzed over both edges, the amount, and every combination of credential, sanction
    /// and halt.
    function testFuzz_TheTwoStandardPredicatesNeverDisagree(
        address from, address to, uint256 amount, uint256 state
    ) public {
        _deposit(holder, bytes32(uint256(8100)), 100e6);
        amount = bound(amount, 0, 200e6);

        validator.setEligible(from, state & 1 != 0);
        validator.setEligible(to, state & 2 != 0);
        uint256[8] memory list;
        if (state & 4 != 0) list[0] = pool.sourceKeyOf(from);
        if (state & 8 != 0) list[1] = pool.sourceKeyOf(to);
        pool.setDenyList(list);
        pool.setPaused(state & 16 != 0);

        bool allowed = pool.canTransfer(from, to, amount);
        (bytes1 code, bytes32 why) = pool.canTransferWithReason(from, to, amount);

        assertEq(allowed, code == pool.STATUS_OK(), "the boolean and the code must agree");
        assertEq(allowed, why == bytes32(0), "and only an allowed transfer carries no reason");
        assertTrue(
            code == pool.STATUS_OK() || code == pool.STATUS_HALTED()
                || code == pool.STATUS_INVALID_SENDER() || code == pool.STATUS_INVALID_RECEIVER()
                || code == pool.STATUS_INSUFFICIENT_BALANCE(),
            "no input produces a code outside the documented five"
        );
    }

    /// isVerified is the ADMISSION predicate and nothing else: credentialed and not
    /// sanctioned, for any address, in any state of the register. It deliberately ignores
    /// the halt and the backing — those are transfer-time conditions, not identity ones —
    /// and an integrator reading it as "may transfer" is reading the wrong function.
    function testFuzz_IsVerifiedIsExactlyCredentialedAndNotSanctioned(address who, uint256 state) public {
        validator.setEligible(who, state & 1 != 0);
        uint256[8] memory list;
        if (state & 2 != 0) list[3] = pool.sourceKeyOf(who);
        pool.setDenyList(list);
        pool.setPaused(state & 4 != 0);

        bool expected = (state & 1 != 0) && (state & 2 == 0);
        assertEq(pool.isVerified(who), expected, "credentialed and not sanctioned");
        if (state & 4 != 0) {
            assertFalse(pool.canTransfer(who, who, 0), "a halt stops transfers");
            assertEq(pool.isVerified(who), expected, "but says nothing about identity");
        }
    }

    // =====================================================================
    // FINDINGS
    // =====================================================================

    /// FINDING F9 (HIGH). `EXIT_LEAVES` reserves ONE exit for the WHOLE REGISTER, not one
    /// per position, so the reservation does not do what its comment says it does.
    ///
    /// The guard is `commitments.length + 1 + EXIT_LEAVES > TREE_CAPACITY`, evaluated
    /// against the shared array. Every deposit checks the same two leaves of headroom and
    /// none of them consumes it, so D deposits reserve two leaves between them, not 2D:
    ///
    ///   * a deposit is admitted while length <= CAP - 3, so up to CAP - 2 = 1022 leaves
    ///     of deposits are reachable by ordinary use
    ///   * the transfer circuit is 2-in/2-out and nullifiers must differ, so nullifying D
    ///     notes takes ceil(D/2) transfers and each inserts 2 more leaves
    ///   * draining D deposits therefore costs D + 2*ceil(D/2) ~ 2D leaves in total
    ///
    /// 2D <= 1024 gives D <= 512. The guard admits 1022. So a register that takes more than
    /// 512 deposits can never pay all of them out, and at 1022 leaves exactly ONE transfer
    /// will ever execute again — spending two notes and stranding every other position
    /// permanently, with no owner escape hatch and transact() the only caller of
    /// asset.transfer in the contract.
    ///
    /// Audit4's test_S1 reaches this state and reads it as the correct terminal one
    /// ("nothing is stranded, because every position inside it entered under a guard that
    /// had already reserved the two leaves its exit would need"). That reasoning holds for
    /// ONE position. It does not compose, and this is the counterexample.
    ///
    /// A fix is not a patch: either the guard reserves per-position headroom — which caps
    /// the register at ~512 deposits and should be said out loud — or `levels` goes up,
    /// which is a recompile and a new phase-2 ceremony for every circuit.
    ///
    /// Scope: the capacity guard is source-only, not in the deployed bytecode (SUMMARY.md
    /// lists it under the known gaps). So this does not change what the live pool does — it
    /// changes what the guard, once deployed, would be entitled to claim.
    function test_F9_FINDING_ExitLeavesReservesOneExitForTheRegisterNotOnePerDeposit() public {
        uint256 cap = pool.TREE_CAPACITY();
        _deposit(holder, bytes32(uint256(9000)), 300e6);

        // The deepest state ordinary deposits can reach: at 1021 leaves a deposit still fits
        // (1021 + 1 + 2 == 1024), and it lands at 1022.
        _setLeafCount(cap - 3);
        uint[11] memory p = _pub(holder, bytes32(uint256(9001)));
        vm.prank(holder);
        pool.deposit(1e6, bytes32(uint256(9001)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(9001)), 1e6));
        assertEq(pool.commitmentCount(), cap - 2, "1022 leaves is reachable by deposits alone");

        // From here the register admits exactly ONE more transfer, ever. Both signal sets
        // are built before the expectRevert below: _xfer reads extDataHashOf off the pool,
        // and an expectRevert armed over that read would fire on the wrong call.
        uint[7] memory first = _xfer(1e6, payee, address(0), 0, 20);
        uint[7] memory second = _xfer(1e6, payee, address(0), 0, 21);

        pool.transact(pA, pB, pC, first, payee, address(0), 0);
        assertEq(pool.commitmentCount(), cap, "and it fills the tree");

        vm.expectRevert(SaksiPool.TreeFull.selector);
        pool.transact(pA, pB, pC, second, payee, address(0), 0);

        uint[11] memory p2 = _pub(holder, bytes32(uint256(9002)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.TreeFull.selector);
        pool.deposit(1e6, bytes32(uint256(9002)), pA, pB, pC, p2, pA, pB, pC, _bind(bytes32(uint256(9002)), 1e6));

        assertGt(pool.balance(), 0,
            "FINDING: backing remains and no path in the contract can ever move it out");

        // The bound the guard should have enforced, stated as arithmetic so a fix that
        // changes TREE_CAPACITY or EXIT_LEAVES has to revisit it.
        uint256 drainable = cap / 2;
        uint256 admitted = cap - pool.EXIT_LEAVES();
        assertEq(drainable, 512, "D + 2*ceil(D/2) <= CAP  =>  D <= 512");
        assertEq(admitted, 1022, "FINDING: but the guard admits 1022 deposits");
        assertGt(admitted, drainable, "FINDING: the gap is deposits that can never be paid out");
    }

    /// FINDING F10 (MEDIUM). The register's OWN deny list is never consulted by deposit().
    /// The entry path compares the proof's eight deny signals to storage POSITIONALLY and
    /// checks the source key separately — it never asks whether that source key is one of
    /// the eight. So the contract admits a wallet it publicly reports as sanctioned, and
    /// the whole non-membership check lives in the compliance circuit.
    ///
    /// That is defence-in-depth rather than an exploit: compliance.circom constrains
    /// `eq[j].out === 0` for all eight slots, so a real proof for a key on the list does
    /// not exist. But it is the one control where the contract could check for itself in a
    /// loop it already writes — `_denied` exists a few lines up and is called by the
    /// ERC-3643 views and by nothing else. Its exit-side twin has no such backstop (F11).
    function test_F10_FINDING_TheDenyListIsNotConsultedOnEntry() public {
        uint256[8] memory list;
        list[0] = pool.sourceKeyOf(holder);
        pool.setDenyList(list);

        assertFalse(pool.isVerified(holder), "the register reports this wallet as sanctioned");

        // A proof carrying the register's actual deny list, from the sanctioned wallet.
        bytes32 c = bytes32(uint256(9100));
        uint[11] memory p = _pub(holder, c);
        p[1] = list[0];
        vm.prank(holder);
        pool.deposit(10e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 10e6));

        assertTrue(pool.commitmentKnown(c),
            "FINDING: the contract admits a wallet its own list denies; only the circuit refuses");
    }

    /// FINDING F11 (HIGH). The deny list is not enforced on the EXIT at all — not by the
    /// contract and not by any circuit.
    ///
    /// `transact` gates both edges with `_requireEligible`, which asks Cleanverse's
    /// Validator and nothing else; `_denied` is never called. And unlike the entry path
    /// there is no circuit backstop — transfer.circom's public signals are
    /// [root, publicAmount, extDataHash, inputNullifier[2], outputCommitment[2]] and
    /// nothing else, so it carries no source key and no deny signals to constrain. The
    /// entry path is the opposite: compliance.circom constrains `eq[j].out === 0` against
    /// all eight deny slots, which is why the same omission is only MEDIUM there (F10).
    ///
    /// What still screens the exit is Cleanverse's own rule set — `isBlackList` and
    /// `countryBitmap` are enforced by complianceVerify on both edges. So the exit is not
    /// unscreened; it is screened by THEIR list and not by OURS, and the register's own
    /// sanctions perimeter is admission-only.
    ///
    /// The integrator-visible half is the sharper one: `canTransfer` returns FALSE and
    /// `canTransferWithReason` returns RECIPIENT_SANCTIONED for a payout the register then
    /// executes. The source calls those views "the same pair of checks `transact` makes on
    /// a withdrawal, asked in advance". They are not. (Those views are source-only, not
    /// deployed; the missing `_denied` on the exit is live.)
    ///
    /// A fix is two lines — `if (_denied(recipient)) revert`, and the same for a paid
    /// relayer — costing eight SLOADs on a path that already makes a cross-contract call.
    function test_F11_FINDING_TheDenyListIsNotEnforcedOnTheExit() public {
        _deposit(holder, bytes32(uint256(9200)), 100e6);

        // payee holds a live Cleanverse credential AND sits on this register's deny list.
        // The two lists are independent: Cleanverse's blacklist is theirs, this one is ours.
        uint256[8] memory list;
        list[0] = pool.sourceKeyOf(payee);
        list[1] = pool.sourceKeyOf(relay);
        pool.setDenyList(list);

        assertFalse(pool.canTransfer(holder, payee, 10e6), "the register says no...");
        (bytes1 code, bytes32 why) = pool.canTransferWithReason(holder, payee, 10e6);
        assertEq(code, pool.STATUS_INVALID_RECEIVER());
        assertEq(why, bytes32("RECIPIENT_SANCTIONED"));

        // ...and then pays them anyway, along with a sanctioned relayer.
        uint[7] memory s = _xfer(10e6, payee, relay, 1e6, 30);
        pool.transact(pA, pB, pC, s, payee, relay, 1e6);

        assertEq(asset.balanceOf(payee), 9e6,
            "FINDING: a sanctioned recipient is paid despite canTransfer refusing it");
        assertEq(asset.balanceOf(relay), 1e6,
            "FINDING: and so is a sanctioned relayer");
    }

    /// FINDING F12 (LOW). `canTransferWithReason` tests the credential before the sanction
    /// on each edge, so a wallet that is BOTH uncredentialed and sanctioned is reported as
    /// merely uncredentialed. The two reasons demand opposite handling — one says "come back
    /// when your A-Pass is sorted", the other says "do not deal with this party" — and
    /// masking the second behind the first is the wrong way round for a sanctions control.
    /// A fix tests _denied first on each edge; the code byte is unchanged either way.
    function test_F12_FINDING_SanctionedIsMaskedByNotCredentialed() public {
        uint256[8] memory list;
        list[0] = pool.sourceKeyOf(stranger);
        pool.setDenyList(list);
        validator.setEligible(stranger, false);      // both conditions hold at once

        (bytes1 code, bytes32 why) = pool.canTransferWithReason(stranger, payee, 1);
        assertEq(code, pool.STATUS_INVALID_SENDER());
        assertEq(why, bytes32("SENDER_NOT_CREDENTIALED"),
            "FINDING: the sanction is invisible behind the missing credential");

        // The sanction only surfaces once the credential is granted, which is precisely
        // when an integrator has already been told the problem was the credential.
        validator.setEligible(stranger, true);
        (, why) = pool.canTransferWithReason(stranger, payee, 1);
        assertEq(why, bytes32("SENDER_SANCTIONED"));
    }

    /// FINDING F13 (MEDIUM). A withdrawal to the register ITSELF breaks the one accounting
    /// identity the design rests on: `balance == deposits - withdrawals`. The notes are
    /// burnt, two change outputs are inserted, and `withdrawn - fee` moves from the pool to
    /// the pool. The shielded ledger records that the value left; the balance records that
    /// it never did, and nothing in the tree accounts for the difference.
    ///
    /// Audit4's test_R2 pins the same case from the value side. It is restated here because
    /// it is the exact reason invariant_BackingEqualsWhatEnteredMinusWhatLeft excludes the
    /// pool from its actor set: that is not an omission in the invariant, it is the one
    /// input that falsifies it.
    function test_F13_FINDING_AWithdrawalToTheRegisterItselfBreaksTheBackingIdentity() public {
        _deposit(holder, bytes32(uint256(9300)), 100e6);
        validator.setEligible(address(pool), true);   // Cleanverse credentialing the register

        uint256 deposited = 100e6;
        uint[7] memory s = _xfer(40e6, address(pool), address(0), 0, 40);
        pool.transact(pA, pB, pC, s, address(pool), address(0), 0);
        uint256 withdrawn = 40e6;

        assertEq(pool.balance(), 100e6, "FINDING: the backing never moved");
        assertTrue(pool.balance() != deposited - withdrawn,
            "FINDING: and the register's own accounting identity no longer holds");
        assertTrue(pool.nullifierUsed(bytes32(s[3])), "though the notes were burnt for it");
    }
}
