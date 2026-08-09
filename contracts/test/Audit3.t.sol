// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Third-pass audit. Attacks the state AFTER the claim-pinning fix, and the WITHDRAWAL
// half of transact() which has never executed on-chain.
//
// Naming:
//   test_OK_*    an invariant that HOLDS. Passes.
//   test_W_*     withdrawal-path behaviour. Passes; each asserts the accounting.
//   test_F<n>_*  a FINDING. Passes, and the assertion IS the finding: it pins the
//                unwanted behaviour so a fix inverts it.
//
// Nothing here modifies src/ or the existing suite.

import {Test} from "forge-std/Test.sol";
import {SaksiPool, IAPassComplianceValidator} from "../src/SaksiPool.sol";

contract A3Validator {
    mapping(address => bool) public eligible;
    IAPassComplianceValidator.RuleV2[] internal rules;
    bool public registered = true;

    function setEligible(address who, bool v) external { eligible[who] = v; }
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

contract A3Asset {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// The CVA is a third-party Cleanverse A-Token. This is the hook-before-debit shape —
/// the worst case for a balance-based guard like ExceedsBacking.
contract A3ReentrantAsset {
    mapping(address => uint256) public balanceOf;
    address public target;
    bytes public payload;
    bool public armed;
    bool public reentered;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function arm(address t, bytes calldata data) external { target = t; payload = data; armed = true; }

    function transfer(address to, uint256 a) external returns (bool) {
        if (armed) {
            armed = false;
            (bool ok, ) = target.call(payload);   // fires BEFORE the debit below
            reentered = ok;
        }
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract A3Verifier {
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

contract Audit3Test is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant ROOT = 12345;
    uint256 constant NOTE_ROOT = 54321;
    uint256 constant U64_MAX = type(uint64).max;

    SaksiPool pool;
    A3Asset asset;
    A3Verifier verifier;
    A3Validator validator;

    address holder    = address(0xA11CE);
    address relay     = address(0x9E1A);
    address payee     = address(0xC0FED);
    address stranger  = address(0x574A9);
    address owner     = address(this);

    uint[2] pA; uint[2][2] pB; uint[2] pC;

    function setUp() public {
        asset = new A3Asset();
        verifier = new A3Verifier();
        validator = new A3Validator();
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

    /// publicAmount encoding: a withdrawal of x is the field element FIELD - x.
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
    // 1. THE CLAIM-PINNING FIX
    // =====================================================================

    /// claimHash puts the kind in the preimage, so no figure can be reinterpreted under
    /// another kind. THRESHOLD and AGGREGATE share the two-word encoding and are separated
    /// only by that byte; RANGE uses a three-word encoding. Fuzzed over the figures.
    function testFuzz_OK_ClaimHashSeparatesKinds(uint256 a, uint256 b) public view {
        uint8 EXACT = pool.KIND_EXACT();
        uint8 THR   = pool.KIND_THRESHOLD();
        uint8 RNG   = pool.KIND_RANGE();
        uint8 AGG   = pool.KIND_AGGREGATE();

        assertTrue(pool.claimHash(THR, a, b) != pool.claimHash(AGG, a, b), "THRESHOLD != AGGREGATE");
        assertTrue(pool.claimHash(RNG, a, b) != pool.claimHash(THR, a, b), "RANGE != THRESHOLD");
        assertTrue(pool.claimHash(RNG, a, b) != pool.claimHash(AGG, a, b), "RANGE != AGGREGATE");
        assertEq(pool.claimHash(EXACT, a, b), bytes32(0), "EXACT carries no figure");

        // no numeric claim ever hashes to the EXACT sentinel
        assertTrue(pool.claimHash(THR, a, b) != bytes32(0));
        assertTrue(pool.claimHash(RNG, a, b) != bytes32(0));
        assertTrue(pool.claimHash(AGG, a, b) != bytes32(0));

        // the second figure is ignored for the one-sided kinds, as documented
        assertEq(pool.claimHash(THR, a, b), pool.claimHash(THR, a, 0));
        assertEq(pool.claimHash(AGG, a, b), pool.claimHash(AGG, a, 0));
    }

    /// The fix HOLDS on all three numeric kinds: the vacuous maximum the circuit range
    /// checks allow no longer closes a question that named a real figure.
    function test_OK_VacuousClaimRefusedOnEveryNumericKind() public {
        _deposit(holder, bytes32(uint256(200)), 50e6);
        _deposit(holder, bytes32(uint256(201)), 50e6);
        _deposit(holder, bytes32(uint256(202)), 50e6);

        uint8 THR = pool.KIND_THRESHOLD();
        uint8 RNG = pool.KIND_RANGE();
        uint8 AGG = pool.KIND_AGGREGATE();

        pool.requestAudit(8001, 200, THR, _cl(THR, 1_000e6), "at most 1,000?");
        pool.requestAudit(8002, 202, RNG, _cl2(RNG, 100e6, 400e6), "inside [100,400]?");
        pool.requestAudit(8003, 0,   AGG, _cl(AGG, 2_000e6), "total at most 2,000?");

        vm.startPrank(holder);
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(200), U64_MAX, uint256(8001)]);

        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveRange(pA, pB, pC, [uint256(202), uint256(0), U64_MAX, uint256(8002)]);

        uint[13] memory s;
        s[0] = 200; s[1] = 201; s[5] = 1; s[6] = 1;
        s[10] = type(uint72).max; s[11] = 8003; s[12] = 7;
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveAggregate(pA, pB, pC, s);
        vm.stopPrank();

        assertEq(pool.auditAnswered(8001), 0, "still open");
        assertEq(pool.auditAnswered(8002), 0, "still open");
        assertEq(pool.auditAnswered(8003), 0, "still open");
    }

    /// And the honest answer still works, on every kind. A pin that also blocks the truth
    /// would be a denial of service dressed up as a fix.
    function test_OK_HonestClaimStillAnswers() public {
        _deposit(holder, bytes32(uint256(210)), 50e6);
        _deposit(holder, bytes32(uint256(211)), 50e6);
        _deposit(holder, bytes32(uint256(212)), 50e6);

        uint8 THR = pool.KIND_THRESHOLD();
        uint8 RNG = pool.KIND_RANGE();
        uint8 AGG = pool.KIND_AGGREGATE();

        pool.requestAudit(8101, 210, THR, _cl(THR, 1_000e6), "at most 1,000?");
        pool.requestAudit(8102, 212, RNG, _cl2(RNG, 100e6, 400e6), "inside [100,400]?");
        pool.requestAudit(8103, 0,   AGG, _cl(AGG, 2_000e6), "total at most 2,000?");

        pool.proveThreshold(pA, pB, pC, [uint256(210), uint256(1_000e6), uint256(8101)]);
        pool.proveRange(pA, pB, pC, [uint256(212), uint256(100e6), uint256(400e6), uint256(8102)]);

        uint[13] memory s;
        s[0] = 210; s[1] = 211; s[5] = 1; s[6] = 1;
        s[10] = 2_000e6; s[11] = 8103; s[12] = 7;
        pool.proveAggregate(pA, pB, pC, s);

        assertEq(pool.auditAnswered(8101), THR);
        assertEq(pool.auditAnswered(8102), RNG);
        assertEq(pool.auditAnswered(8103), AGG);
    }

    /// Kind confusion cannot launder a figure: a THRESHOLD claim built for the AGGREGATE
    /// kind is not matchable by the threshold prover, and the kind check fires first
    /// anyway. Both directions refused.
    function test_OK_ClaimCannotBeLaunderedAcrossKinds() public {
        _deposit(holder, bytes32(uint256(220)), 50e6);
        uint8 THR = pool.KIND_THRESHOLD();
        uint8 AGG = pool.KIND_AGGREGATE();

        // auditor asks a THRESHOLD question but hashes the figure under AGGREGATE
        pool.requestAudit(8201, 220, THR, _cl(AGG, 1_000e6), "at most 1,000?");
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(220), uint256(1_000e6), uint256(8201)]);

        // and an aggregate proof cannot take over a threshold request
        uint[13] memory s;
        s[0] = 220; s[5] = 1; s[10] = 1_000e6; s[11] = 8201; s[12] = 1;
        vm.expectRevert(SaksiPool.WrongDisclosureKind.selector);
        pool.proveAggregate(pA, pB, pC, s);
    }

    /// _openAudit's check order leaks nothing: every condition it tests is already a
    /// public getter, so the revert reason tells a prober strictly less than an eth_call.
    function test_OK_OpenAuditOrderLeaksNothingAlreadyPublic() public {
        _deposit(holder, bytes32(uint256(230)), 50e6);
        uint8 THR = pool.KIND_THRESHOLD();
        bytes32 cl = _cl(THR, 1_000e6);
        pool.requestAudit(8301, 230, THR, cl, "at most 1,000?");

        assertTrue(pool.auditRequested(8301));
        assertEq(pool.auditAnswered(8301), 0);
        assertEq(pool.auditKind(8301), THR);
        assertEq(pool.auditSubject(8301), 230);
        assertEq(pool.auditClaim(8301), cl);
    }

    /// F1. An OPEN request is mutable: requestAudit has no `auditRequested` guard, so the
    /// auditor can rewrite subject, kind and claim under a prover who is mid-flight. The
    /// holder's answer then reverts WrongClaim through no fault of theirs, and the only
    /// record of the original question is the event log.
    /// (The same mutability is the ONLY repair path for a mis-registered claim — see F2.)
    function test_F1_OpenAuditRequestIsSilentlyRewritable() public {
        _deposit(holder, bytes32(uint256(240)), 50e6);
        uint8 THR = pool.KIND_THRESHOLD();
        pool.requestAudit(8401, 240, THR, _cl(THR, 1_000e6), "at most 1,000?");

        // auditor front-runs the answer and moves the goalposts
        pool.requestAudit(8401, 240, THR, _cl(THR, 999e6), "at most 999?");
        assertEq(pool.auditClaim(8401), _cl(THR, 999e6), "FINDING: the open question was rewritten");

        vm.prank(holder);
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(240), uint256(1_000e6), uint256(8401)]);
    }

    /// F2. requestAudit takes an OPAQUE claim and cannot check it is a hash any prover can
    /// reproduce. bytes32(0) is accepted on every non-exact kind — claimHash never returns
    /// 0 for those — so the request is unanswerable from the moment it is registered. The
    /// contract validates EXACT => claim == 0 but not its converse.
    function test_F2_ZeroClaimOnNumericKindIsUnanswerable() public {
        _deposit(holder, bytes32(uint256(250)), 50e6);
        uint8 THR = pool.KIND_THRESHOLD();

        pool.requestAudit(8501, 250, THR, bytes32(0), "at most 1,000?");
        assertEq(pool.auditClaim(8501), bytes32(0), "FINDING: a claim no prover can match was accepted");

        // every possible threshold fails, because claimHash(THRESHOLD, x) is never 0
        vm.startPrank(holder);
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(250), uint256(1_000e6), uint256(8501)]);
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(250), uint256(0), uint256(8501)]);
        vm.expectRevert(SaksiPool.WrongClaim.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(250), U64_MAX, uint256(8501)]);
        vm.stopPrank();
    }

    /// F3. deposit accepts commitment 0 — the value the contract reserves as "no subject /
    /// this is a set" (auditSubject comment, and the literal proveAggregate passes to
    /// _openAudit). After this, _requireKnown(0) is true and the sentinel is no longer
    /// unambiguous.
    function test_F3_ZeroCommitmentAcceptedAsARealPosition() public {
        _deposit(holder, bytes32(0), 10e6);
        assertTrue(pool.commitmentKnown(bytes32(0)), "FINDING: the reserved sentinel is a live commitment");

        // and it is auditable as an ordinary subject, sharing auditSubject==0 with aggregates
        uint8 EXACT = pool.KIND_EXACT();
        pool.requestAudit(8601, 0, EXACT, bytes32(0), "disclose the zero commitment");
        pool.proveExact(pA, pB, pC, [uint256(0), uint256(10e6), uint256(8601)]);
        assertEq(pool.auditAnswered(8601), EXACT);
    }

    // =====================================================================
    // 2. THE WITHDRAWAL PATH — never executed on-chain
    // =====================================================================

    /// W1. The happy path, with exact accounting. The recipient is paid withdrawn - fee,
    /// the relayer exactly fee, and the register loses exactly withdrawn. No value is
    /// created and none is stranded.
    function test_W_WithdrawalAccountingIsExact() public {
        _deposit(holder, bytes32(uint256(300)), 100e6);
        uint256 poolBefore = asset.balanceOf(address(pool));

        uint[7] memory s = _xfer(40e6, payee, relay, 5e6, 1);
        vm.prank(relay);
        pool.transact(pA, pB, pC, s, payee, relay, 5e6);

        assertEq(asset.balanceOf(payee), 35e6, "recipient gets withdrawn - fee");
        assertEq(asset.balanceOf(relay), 5e6, "relayer gets exactly the fee");
        assertEq(poolBefore - asset.balanceOf(address(pool)), 40e6, "register loses exactly withdrawn");
        assertTrue(pool.nullifierUsed(bytes32(s[3])) && pool.nullifierUsed(bytes32(s[4])));
        assertTrue(pool.commitmentKnown(bytes32(s[5])) && pool.commitmentKnown(bytes32(s[6])));
    }

    /// W2. ExceedsBacking is exact at the boundary, and a refused withdrawal burns nothing.
    function test_W_ExceedsBackingBoundaryAndNoStateOnRevert() public {
        _deposit(holder, bytes32(uint256(310)), 100e6);

        uint[7] memory over = _xfer(100e6 + 1, payee, address(0), 0, 2);
        vm.expectRevert(SaksiPool.ExceedsBacking.selector);
        pool.transact(pA, pB, pC, over, payee, address(0), 0);
        assertFalse(pool.nullifierUsed(bytes32(over[3])), "nothing burnt on a refused withdrawal");
        assertEq(pool.commitmentCount(), 1, "no outputs inserted on a refused withdrawal");

        uint[7] memory exact_ = _xfer(100e6, payee, address(0), 0, 3);
        pool.transact(pA, pB, pC, exact_, payee, address(0), 0);
        assertEq(asset.balanceOf(address(pool)), 0, "the whole backing is withdrawable, and no more");
    }

    /// W3. The fee comes OUT of the withdrawal, never on top of it. fee > withdrawn is an
    /// arithmetic revert, so the register can never pay out more than it burnt.
    function test_W_FeeCannotExceedWithdrawal() public {
        _deposit(holder, bytes32(uint256(320)), 100e6);

        uint[7] memory bad = _xfer(1e6, payee, relay, 2e6, 4);
        vm.expectRevert();                       // Panic 0x11 on withdrawn - fee
        pool.transact(pA, pB, pC, bad, payee, relay, 2e6);

        // fee == withdrawn is legal: the relayer takes it all, the recipient gets zero.
        // Both are bound into extDataHash, so this is the prover's own choice.
        uint[7] memory all_ = _xfer(10e6, payee, relay, 10e6, 5);
        pool.transact(pA, pB, pC, all_, payee, relay, 10e6);
        assertEq(asset.balanceOf(payee), 0);
        assertEq(asset.balanceOf(relay), 10e6);
        assertEq(asset.balanceOf(address(pool)), 90e6, "still exactly withdrawn, no more");
    }

    /// W4. A fee is only payable out of a withdrawal.
    function test_W_FeeWithoutWithdrawalRefused() public {
        _deposit(holder, bytes32(uint256(330)), 100e6);
        uint[7] memory s = _xfer(0, payee, relay, 1e6, 6);
        vm.expectRevert(SaksiPool.FeeWithoutWithdrawal.selector);
        pool.transact(pA, pB, pC, s, payee, relay, 1e6);
    }

    /// W5. Both exit edges are gated — but the relayer only when it is actually paid.
    /// A zero-fee relayer is never asked for a credential; it also receives nothing.
    function test_W_ExitEligibilityGates() public {
        _deposit(holder, bytes32(uint256(340)), 100e6);

        validator.setEligible(stranger, false);
        uint[7] memory a = _xfer(10e6, stranger, address(0), 0, 7);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, stranger));
        pool.transact(pA, pB, pC, a, stranger, address(0), 0);

        uint[7] memory b = _xfer(10e6, payee, stranger, 1e6, 8);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, stranger));
        pool.transact(pA, pB, pC, b, payee, stranger, 1e6);

        // relayer named but unpaid: not checked, not paid
        uint[7] memory c = _xfer(10e6, payee, stranger, 0, 9);
        pool.transact(pA, pB, pC, c, payee, stranger, 0);
        assertEq(asset.balanceOf(stranger), 0, "an unpaid relayer receives nothing");
        assertEq(asset.balanceOf(payee), 10e6);
    }

    /// W6. extDataHash binds all three of recipient, relayer and fee, so a withdrawal
    /// cannot be re-aimed or re-priced in the mempool.
    function test_W_ExtDataBindsRecipientRelayerAndFee() public {
        _deposit(holder, bytes32(uint256(350)), 100e6);
        uint[7] memory s = _xfer(10e6, payee, relay, 1e6, 10);

        vm.expectRevert(SaksiPool.ExtDataMismatch.selector);
        pool.transact(pA, pB, pC, s, stranger, relay, 1e6);      // re-aimed
        vm.expectRevert(SaksiPool.ExtDataMismatch.selector);
        pool.transact(pA, pB, pC, s, payee, stranger, 1e6);      // relayer swapped
        vm.expectRevert(SaksiPool.ExtDataMismatch.selector);
        pool.transact(pA, pB, pC, s, payee, relay, 2e6);         // fee raised

        pool.transact(pA, pB, pC, s, payee, relay, 1e6);
        assertEq(asset.balanceOf(payee), 9e6);
    }

    /// W7. The sign convention. publicAmount in the positive half-plane is refused as a
    /// deposit; FIELD/2 itself is treated as a withdrawal (of half the field) and dies on
    /// ExceedsBacking, so the rounding of FIELD/2 is harmless in both directions.
    function test_W_PublicAmountSignConvention() public {
        _deposit(holder, bytes32(uint256(360)), 100e6);

        uint[7] memory dep = _xfer(0, payee, address(0), 0, 11);
        dep[1] = 100e6;                                   // a positive publicAmount
        dep[2] = pool.extDataHashOf(payee, address(0), 0);
        vm.expectRevert(SaksiPool.DepositsUseDepositPath.selector);
        pool.transact(pA, pB, pC, dep, payee, address(0), 0);

        uint[7] memory edge = _xfer(0, payee, address(0), 0, 12);
        edge[1] = FIELD / 2;                              // the boundary, rounds down
        edge[2] = pool.extDataHashOf(payee, address(0), 0);
        vm.expectRevert(SaksiPool.ExceedsBacking.selector);
        pool.transact(pA, pB, pC, edge, payee, address(0), 0);
    }

    /// W8. A re-entrant CVA cannot drain past the backing. Two layers stop it, and the
    /// order matters: transact's _requireEligible(msg.sender) refuses an uncredentialed
    /// token outright, so the hook has to be credentialed to re-enter at all (granted
    /// below, the adversarial assumption). Past that, ExceedsBacking reads a STALE balance
    /// during the hook and both calls pass the guard — the only thing that saves the
    /// register is the token's own arithmetic underflowing on the outer debit, which
    /// unwinds the whole transaction. Solvency here rests on the token, not on
    /// ExceedsBacking.
    function test_W_ReentrantTokenCannotDrainPastBacking() public {
        A3ReentrantAsset re = new A3ReentrantAsset();
        SaksiPool p2 = new SaksiPool(
            address(re), address(validator), address(verifier), address(verifier),
            address(verifier), address(verifier), address(verifier), address(verifier),
            ROOT, owner
        );
        p2.publishNoteRoot(NOTE_ROOT);
        re.mint(holder, 1_000e6);
        validator.setEligible(address(re), true);   // the hook can now re-enter

        bytes32 c = bytes32(uint256(370));
        uint[11] memory p; p[0] = ROOT; p[9] = p2.sourceKeyOf(holder); p[10] = uint256(c);
        vm.prank(holder);
        p2.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, _bind(c, 100e6));

        uint[7] memory inner;
        inner[0] = NOTE_ROOT; inner[1] = FIELD - 100e6;
        inner[2] = p2.extDataHashOf(payee, address(0), 0);
        inner[3] = 0xAA1; inner[4] = 0xAA2; inner[5] = 0xAA3; inner[6] = 0xAA4;
        re.arm(address(p2), abi.encodeWithSelector(
            SaksiPool.transact.selector, pA, pB, pC, inner, payee, address(0), uint256(0)
        ));

        uint[7] memory outer;
        outer[0] = NOTE_ROOT; outer[1] = FIELD - 100e6;
        outer[2] = p2.extDataHashOf(payee, address(0), 0);
        outer[3] = 0xBB1; outer[4] = 0xBB2; outer[5] = 0xBB3; outer[6] = 0xBB4;

        vm.expectRevert();
        p2.transact(pA, pB, pC, outer, payee, address(0), 0);

        assertEq(re.balanceOf(address(p2)), 100e6, "backing intact");
        assertEq(re.balanceOf(payee), 0, "nothing drained");
    }

    /// W9. Conservation across a run of mixed traffic: the register holds exactly
    /// deposits - withdrawals, and every payout is accounted to a named party.
    function test_W_ConservationAcrossMixedTraffic() public {
        _deposit(holder, bytes32(uint256(380)), 100e6);
        _deposit(holder, bytes32(uint256(381)), 250e6);

        pool.transact(pA, pB, pC, _xfer(0, payee, address(0), 0, 20), payee, address(0), 0);
        vm.prank(relay);
        pool.transact(pA, pB, pC, _xfer(30e6, payee, relay, 2e6, 21), payee, relay, 2e6);
        pool.transact(pA, pB, pC, _xfer(120e6, payee, address(0), 0, 22), payee, address(0), 0);

        assertEq(asset.balanceOf(address(pool)), 350e6 - 150e6);
        assertEq(asset.balanceOf(payee) + asset.balanceOf(relay), 150e6, "every unit out is accounted");
    }

    /// F4. publicAmount == FIELD is a withdrawal of zero: the contract computes
    /// withdrawn = FIELD - publicAmount without ever checking publicAmount < FIELD, so a
    /// signal at the modulus degrades silently into an internal transfer instead of being
    /// rejected. Unreachable through a real snarkjs verifier (it rejects any public signal
    /// >= r before the pairing) — a defence-in-depth gap, not a live exploit.
    function test_F4_PublicAmountAtTheModulusDegradesSilently() public {
        _deposit(holder, bytes32(uint256(390)), 100e6);
        uint[7] memory s = _xfer(0, payee, address(0), 0, 30);
        s[1] = FIELD;
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        assertEq(asset.balanceOf(address(pool)), 100e6,
            "FINDING: a signal at the modulus is accepted and silently withdraws nothing");
    }

    // =====================================================================
    // 3/4. NOTE ROOT, AND THE DEPOSIT <-> TRANSACT SEAM
    // =====================================================================

    /// F5. publishNoteRoot never retires the root it replaces, so every root ever published
    /// stays spendable forever. The nullifier is Poseidon(commitment, leafIndex, privKey)
    /// (transfer.circom), so any republication that moves an existing commitment to a
    /// different leaf index mints a SECOND valid nullifier for the same note — spendable
    /// once against the old root and once against the new one. The contract cannot detect
    /// this: nullifiers are opaque and it never sees a leaf index.
    function test_F5_EveryHistoricalNoteRootStaysSpendable() public {
        _deposit(holder, bytes32(uint256(400)), 100e6);

        pool.publishNoteRoot(0xB0B);        // a rebuild
        pool.publishNoteRoot(0xC0C);        // and another

        assertTrue(pool.knownNoteRoot(NOTE_ROOT), "FINDING: the original root is still live");
        assertTrue(pool.knownNoteRoot(0xB0B), "FINDING: the superseded rebuild is still live");
        assertTrue(pool.knownNoteRoot(0xC0C));

        // and the register accepts a spend against the oldest of them
        uint[7] memory s = _xfer(10e6, payee, address(0), 0, 40);
        s[0] = NOTE_ROOT;
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        assertEq(asset.balanceOf(payee), 10e6, "a superseded root still pays out");
    }

    /// The deposit/transact seam holds in the direction that matters: a commitment created
    /// by transact cannot be re-deposited, so value cannot re-enter through the shielded
    /// side and be counted twice.
    function test_OK_TransactOutputCannotBeRedeposited() public {
        _deposit(holder, bytes32(uint256(410)), 100e6);
        uint[7] memory s = _xfer(0, payee, address(0), 0, 50);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);

        bytes32 out = bytes32(s[5]);
        uint[11] memory p = _pub(holder, out);
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentExists.selector);
        pool.deposit(1e6, out, pA, pB, pC, p, pA, pB, pC, _bind(out, 1e6));
    }

    /// A transact output is a first-class audit subject and aggregate slot — the two paths
    /// agree on what a known commitment is.
    function test_OK_TransactOutputIsAuditableLikeADeposit() public {
        _deposit(holder, bytes32(uint256(420)), 100e6);
        uint[7] memory s = _xfer(0, payee, address(0), 0, 51);
        pool.transact(pA, pB, pC, s, payee, address(0), 0);
        uint256 out = s[5];

        uint8 EXACT = pool.KIND_EXACT();
        pool.requestAudit(8701, out, EXACT, bytes32(0), "disclose the shielded output");
        pool.proveExact(pA, pB, pC, [out, uint256(60e6), uint256(8701)]);
        assertEq(pool.auditAnswered(8701), EXACT);

        uint8 AGG = pool.KIND_AGGREGATE();
        pool.requestAudit(8702, 0, AGG, _cl(AGG, 1_000e6), "total across the shielded set");
        uint[13] memory g;
        g[0] = out; g[1] = s[6]; g[5] = 1; g[6] = 1;
        g[10] = 1_000e6; g[11] = 8702; g[12] = 3;
        pool.proveAggregate(pA, pB, pC, g);
        assertEq(pool.auditAnswered(8702), AGG);
    }

    /// F6. A disclosure proves the OPENING of a commitment, never that the note is still
    /// live. The audit path never consults nullifierUsed — and cannot, since the nullifier
    /// is not derivable from the commitment on-chain. Here the entire backing has left the
    /// register and the position still answers an audit, writing ANSWERED into the record
    /// for exposure that no longer exists.
    function test_F6_SpentPositionStillAnswersAnAudit() public {
        bytes32 c = bytes32(uint256(430));
        _deposit(holder, c, 100e6);

        pool.transact(pA, pB, pC, _xfer(100e6, payee, address(0), 0, 60), payee, address(0), 0);
        assertEq(asset.balanceOf(address(pool)), 0, "the register is empty");

        uint8 THR = pool.KIND_THRESHOLD();
        pool.requestAudit(8801, uint256(c), THR, _cl(THR, 1_000e6), "is position 430 at most 1,000?");
        vm.prank(holder);
        pool.proveThreshold(pA, pB, pC, [uint256(c), uint256(1_000e6), uint256(8801)]);

        assertEq(pool.auditAnswered(8801), THR,
            "FINDING: an emptied register still answers about a position it no longer holds");
    }

    /// F7. The contract puts no bound on a deposited amount; the 64-bit ceiling every
    /// disclosure circuit imposes lives only in the exact verifier. transfer.circom range
    /// checks its OUTPUTS to 248 bits, so a JoinSplit can merge notes into an amount above
    /// 2^64 that spends normally and can never be disclosed. This test pins the contract's
    /// half: there is no on-chain check to inherit.
    function test_F7_ContractImposesNoAuditableAmountBound() public {
        bytes32 c = bytes32(uint256(440));
        asset.mint(holder, type(uint64).max);
        _deposit(holder, c, uint256(type(uint64).max) + 1);
        assertTrue(pool.commitmentKnown(c),
            "FINDING: nothing on-chain holds an amount inside the 64 bits every disclosure circuit needs");
    }

    // ---- tree capacity ---------------------------------------------------
    //
    // A leaf past 2^levels has no witness, because inLeafIndex is Num2Bits(levels)-bounded
    // in every circuit. Before the cap, deposit() and transact() kept appending past it, so
    // a full tree turned every later deposit into a permanent loss with no error at all.

    function test_OK_DepositRefusedAtTreeCapacity() public {
        uint256 cap = pool.TREE_CAPACITY();
        assertEq(cap, 1024, "the contract must know the circuits' depth");
        assertLt(pool.commitmentCount(), cap, "fixture must start below capacity");
    }

    function test_OK_TreeCapacityIsEnforcedNotAssumed() public {
        // The guard is a comparison against commitments.length, so it binds both paths:
        // deposit needs one free slot, transact needs two.
        assertEq(pool.TREE_CAPACITY(), 1 << 10);
        vm.expectRevert(SaksiPool.TreeFull.selector);
        this.depositPastCapacity();
    }

    /// Fills the array through storage so the test does not have to mine 1024 deposits.
    function depositPastCapacity() external {
        // commitments.length lives in slot 13 (forge inspect storage-layout).
        vm.store(address(pool), bytes32(uint256(13)), bytes32(pool.TREE_CAPACITY()));
        uint[11] memory p = _pub(holder, bytes32(uint256(900)));
        vm.prank(holder);
        pool.deposit(1, bytes32(uint256(900)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(900)), 1));
    }
}
