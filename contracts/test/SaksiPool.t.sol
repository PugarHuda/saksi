// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SaksiPool, IAPassComplianceValidator, Ownable} from "../src/SaksiPool.sol";

/// Stands in for Cleanverse's CVI Compliance Validator. The live contract is called
/// directly on Monad Ã¢â‚¬â€ see ops/validator.mjs and the deployment notes Ã¢â‚¬â€ so this only has
/// to reproduce its decision, not its rule engine.
contract MockValidator {
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
        delete rules;
        rules.push(r);
    }
    function addRuleV2FromContract(IAPassComplianceValidator.RuleV2 calldata r) external { rules.push(r); }
    function removeRuleV2FromContract(uint256 i) external {
        rules[i] = rules[rules.length - 1];
        rules.pop();
    }
}

contract MockAsset {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// The real-proof path is covered by CompliancePortTest against the exported Groth16
/// verifier. These mocks isolate the pool's own bookkeeping and binding checks from
/// the pairing maths, so a failure here names a policy bug rather than a crypto one.
contract MockVerifier {
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

contract SaksiPoolTest is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant ROOT = 12345;
    uint256 constant NOTE_ROOT = 54321;

    SaksiPool pool;
    MockAsset asset;
    MockVerifier verifier;
    MockValidator validator;
    address holder = address(0xA11CE);
    address owner  = address(this);

    uint[2] pA; uint[2][2] pB; uint[2] pC;

    function setUp() public {
        asset = new MockAsset();
        verifier = new MockVerifier();
        validator = new MockValidator();
        address v = address(verifier);
        pool = new SaksiPool(address(asset), address(validator), v, v, v, v, v, v, ROOT, owner);
        asset.mint(holder, 1_000e6);
        pool.publishNoteRoot(NOTE_ROOT);

        // Everyone the happy paths use holds a live credential; individual tests revoke.
        validator.setEligible(holder, true);
        validator.setEligible(owner, true);
    }

    /// Public signals the pool will accept for `who` depositing `commitment`.
    function _pub(address who, bytes32 commitment) internal view returns (uint[11] memory p) {
        p[0] = ROOT;
        for (uint256 i = 0; i < 8; i++) p[1 + i] = 0; // deny list starts empty
        p[9] = pool.sourceKeyOf(who);
        p[10] = uint256(commitment) % FIELD;
    }

    /// The value-binding signals: [commitment, disclosedAmount, contextHash]. The real
    /// proof opens the commitment and shows it contains exactly this amount; here the
    /// mock verifier stands in for the pairing, so only the pinning is under test.
    function _bind(bytes32 c, uint256 amount) internal pure returns (uint[3] memory s) {
        s[0] = uint256(c) % FIELD;
        s[1] = amount;
        s[2] = 0;   // entry binding carries no audit context â€” nobody asked a question
    }

    function _deposit(address who, bytes32 c, uint256 amt) internal {
        // Build the signals first: _pub() calls into the pool, and an external call
        // would otherwise consume the prank before deposit() ever sees it.
        uint[11] memory p = _pub(who, c);
        vm.prank(who);
        pool.deposit(amt, c, pA, pB, pC, p, pA, pB, pC, _bind(c, amt));
    }

    /// A withdrawal of `out` to `to`, spending two notes and creating two.
    function _transferSignals(uint256 out, address to, uint256 nonce)
        internal view returns (uint[7] memory s)
    {
        s[0] = NOTE_ROOT;
        s[1] = out == 0 ? 0 : FIELD - out;         // negative publicAmount == withdrawal
        s[2] = pool.extDataHashOf(to, address(0), 0);
        s[3] = 0x1000 + nonce;
        s[4] = 0x2000 + nonce;
        s[5] = 0x3000 + nonce;
        s[6] = 0x4000 + nonce;
    }

    // ---- entry ------------------------------------------------------------

    function test_DepositRecordsCommitmentAndPullsAsset() public {
        _deposit(holder, bytes32(uint256(1)), 100e6);
        assertEq(pool.commitmentCount(), 1);
        assertTrue(pool.commitmentKnown(bytes32(uint256(1))));
        assertEq(asset.balanceOf(address(pool)), 100e6);
    }

    function test_ProofBoundToCaller() public {
        // A proof built for `holder` must not work from another wallet. The other wallet
        // is given a live credential so the Validator gate passes and the test isolates
        // the binding failure rather than tripping on eligibility first.
        validator.setEligible(address(0xBEEF), true);
        uint[11] memory p = _pub(holder, bytes32(uint256(2)));
        vm.prank(address(0xBEEF));
        vm.expectRevert(SaksiPool.SourceKeyMismatch.selector);
        pool.deposit(100e6, bytes32(uint256(2)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(2)), 100e6));
    }

    /// The attack the value binding exists to stop: transfer one unit, commit to a
    /// million. Eligibility passes, membership passes, and without this check the
    /// register would insert a note worth a million against a unit of backing.
    function test_CommitmentMustOpenToTheAmountTransferred() public {
        bytes32 c = bytes32(uint256(0xB1AD));
        uint[11] memory p = _pub(holder, c);
        uint[3] memory forged = _bind(c, 1_000_000e6);   // proof says a million
        vm.prank(holder);
        vm.expectRevert(SaksiPool.AmountNotBound.selector);
        pool.deposit(1, c, pA, pB, pC, p, pA, pB, pC, forged);   // one unit actually moves
    }

    /// The binding proof must be about the note being inserted, not a different one.
    function test_BindingProofMustNameThisCommitment() public {
        bytes32 c = bytes32(uint256(0xB2AD));
        uint[11] memory p = _pub(holder, c);
        uint[3] memory other = _bind(bytes32(uint256(0xDEAD)), 100e6);
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
        pool.deposit(100e6, c, pA, pB, pC, p, pA, pB, pC, other);
    }

    // ---- gate one: Cleanverse's Validator ---------------------------------

    /// The credential is checked in the transaction that moves the value, so a wallet
    /// frozen after it was admitted cannot enter again.
    function test_ValidatorRefusesIneligibleDepositor() public {
        validator.setEligible(holder, false);
        uint[11] memory p = _pub(holder, bytes32(uint256(12)));
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, holder));
        pool.deposit(100e6, bytes32(uint256(12)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(12)), 100e6));
    }

    /// The two gates are independent. Holding a live credential is not membership of the
    /// association set the issuer anchored, and vice versa Ã¢â‚¬â€ this is what stops the
    /// register inheriting whichever gate happens to be the weaker one.
    function test_ValidGateOneStillFailsGateTwo() public {
        pool.retireRoot(ROOT);                       // still eligible, no longer in the set
        uint[11] memory p = _pub(holder, bytes32(uint256(13)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.UnknownRoot.selector);
        pool.deposit(100e6, bytes32(uint256(13)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(13)), 100e6));
    }

    /// Leaving is an edge too: the recipient of a withdrawal must itself be eligible to
    /// receive the asset.
    function test_WithdrawalRefusedToIneligibleRecipient() public {
        _deposit(holder, bytes32(uint256(14)), 100e6);
        address stranger = address(0xC0FFEE);         // no credential
        uint[7] memory s = _transferSignals(10e6, stranger, 9);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, stranger));
        pool.transact(pA, pB, pC, s, stranger, address(0), 0);
    }

    /// A pure internal transfer moves no value out, so there is no recipient to gate.
    function test_InternalTransferNeedsNoRecipientCheck() public {
        _deposit(holder, bytes32(uint256(15)), 100e6);
        uint[7] memory s = _transferSignals(0, address(0xC0FFEE), 10);
        pool.transact(pA, pB, pC, s, address(0xC0FFEE), address(0), 0);
        assertEq(asset.balanceOf(address(pool)), 100e6);
    }

    /// An unregistered pool must not degrade into an open one: the Validator reverts,
    /// and that revert propagates rather than being read as "allowed".
    function test_UnregisteredPoolFailsClosed() public {
        validator.setRegistered(false);
        uint[11] memory p = _pub(holder, bytes32(uint256(16)));
        vm.prank(holder);
        vm.expectRevert();
        pool.deposit(100e6, bytes32(uint256(16)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(16)), 100e6));
    }

    function test_OwnerManagesThePerimeter() public {
        IAPassComplianceValidator.RuleV2 memory r =
            IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 30, 0, 0);
        pool.setRule(r);
        assertEq(pool.activeRules().length, 1);
        assertEq(pool.activeRules()[0].minTier, 30);

        pool.addRule(IAPassComplianceValidator.RuleV2(bytes2(0), bytes2(0), 50, 0, 0));
        assertEq(pool.activeRules().length, 2);

        vm.prank(address(0xBAD));
        vm.expectRevert(Ownable.NotOwner.selector);
        pool.setRule(r);
    }

    function test_ProofBoundToCommitment() public {
        // Same caller, but the proof commits to a different note than the one inserted.
        uint[11] memory p = _pub(holder, bytes32(uint256(3)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
        pool.deposit(100e6, bytes32(uint256(4)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(4)), 100e6));
    }

    function test_DenyListMustMatchChainState() public {
        uint256[8] memory list;
        list[0] = 999;
        pool.setDenyList(list);
        uint[11] memory p = _pub(holder, bytes32(uint256(5))); // still carries the old empty list
        vm.prank(holder);
        vm.expectRevert(SaksiPool.DenyListMismatch.selector);
        pool.deposit(100e6, bytes32(uint256(5)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(5)), 100e6));
    }

    function test_RetiredRootFreezesHolder() public {
        // The revocation story: drop the root the holder can prove against.
        pool.retireRoot(ROOT);
        uint[11] memory p = _pub(holder, bytes32(uint256(6)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.UnknownRoot.selector);
        pool.deposit(100e6, bytes32(uint256(6)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(6)), 100e6));
    }

    function test_RotatedRootKeepsOldOneUsable() public {
        pool.rotateRoot(999);
        _deposit(holder, bytes32(uint256(7)), 10e6); // in-flight proof on the old root still lands
        assertEq(pool.commitmentCount(), 1);
        assertTrue(pool.knownRoot(999));
    }

    function test_InvalidProofRejected() public {
        verifier.set(false);
        uint[11] memory p = _pub(holder, bytes32(uint256(8)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.InvalidProof.selector);
        pool.deposit(100e6, bytes32(uint256(8)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(8)), 100e6));
    }

    function test_DuplicateCommitmentRejected() public {
        _deposit(holder, bytes32(uint256(9)), 10e6);
        uint[11] memory p = _pub(holder, bytes32(uint256(9)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentExists.selector);
        pool.deposit(10e6, bytes32(uint256(9)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(9)), 10e6));
    }

    function test_PauseBlocksEntry() public {
        pool.setPaused(true);
        uint[11] memory p = _pub(holder, bytes32(uint256(11)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.Paused.selector);
        pool.deposit(10e6, bytes32(uint256(11)), pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(11)), 10e6));
    }

    // ---- the shielded middle ----------------------------------------------

    function test_TransactWithdrawsAndInsertsOutputs() public {
        _deposit(holder, bytes32(uint256(20)), 100e6);
        uint[7] memory s = _transferSignals(40e6, holder, 1);
        pool.transact(pA, pB, pC, s, holder, address(0), 0);

        assertEq(asset.balanceOf(address(pool)), 60e6);
        assertEq(pool.commitmentCount(), 3);            // 1 deposit + 2 outputs
        assertTrue(pool.nullifierUsed(bytes32(s[3])));
    }

    function test_DoubleSpendRejected() public {
        _deposit(holder, bytes32(uint256(21)), 100e6);
        uint[7] memory s = _transferSignals(10e6, holder, 2);
        pool.transact(pA, pB, pC, s, holder, address(0), 0);

        // Same nullifiers, fresh output commitments: still refused.
        uint[7] memory again = _transferSignals(10e6, holder, 2);
        again[5] = 0x9001; again[6] = 0x9002;
        vm.expectRevert(SaksiPool.NullifierUsed.selector);
        pool.transact(pA, pB, pC, again, holder, address(0), 0);
    }

    /// Re-aiming a valid withdrawal at another recipient must fail: the destination
    /// is inside the proof, not beside it.
    function test_WithdrawalBoundToRecipient() public {
        _deposit(holder, bytes32(uint256(22)), 100e6);
        uint[7] memory s = _transferSignals(10e6, holder, 3);
        vm.expectRevert(SaksiPool.ExtDataMismatch.selector);
        pool.transact(pA, pB, pC, s, address(0xBEEF), address(0), 0);
    }

    function test_TransactRejectsUnknownNoteRoot() public {
        uint[7] memory s = _transferSignals(0, holder, 4);
        s[0] = 777;
        vm.expectRevert(SaksiPool.UnknownNoteRoot.selector);
        pool.transact(pA, pB, pC, s, holder, address(0), 0);
    }

    /// Value may only enter through deposit(), the edge that carries the CVI proof.
    function test_TransactCannotBeUsedToEnter() public {
        uint[7] memory s = _transferSignals(0, holder, 5);
        s[1] = 5e6;                                     // a positive publicAmount
        vm.expectRevert(SaksiPool.DepositsUseDepositPath.selector);
        pool.transact(pA, pB, pC, s, holder, address(0), 0);
    }

    function test_TransactRejectsInvalidProof() public {
        _deposit(holder, bytes32(uint256(23)), 100e6);
        verifier.set(false);
        uint[7] memory s = _transferSignals(10e6, holder, 6);
        vm.expectRevert(SaksiPool.InvalidProof.selector);
        pool.transact(pA, pB, pC, s, holder, address(0), 0);
    }

    // ---- answerability -----------------------------------------------------

    function test_OnlyAuditorRaisesRequest() public {
        // Read the constant before the prank: an external call would consume it and the
        // revert would never be reached.
        uint8 threshold = pool.KIND_THRESHOLD();

        vm.prank(address(0xBAD));
        vm.expectRevert(SaksiPool.NotAuditor.selector);
        pool.requestAudit(77, 1, threshold, "concentration cap");

        pool.requestAudit(77, 1, threshold, "concentration cap");
        assertTrue(pool.auditRequested(77));
        assertEq(pool.auditSubject(77), 1);
        assertEq(pool.auditKind(77), threshold);
    }

    /// The point of registering the question first: an answer with no question
    /// attached is refused, so a proof cannot be produced for a request that was
    /// never made.
    function test_DisclosureNeedsAnOpenRequest() public {
        _deposit(holder, bytes32(uint256(30)), 50e6);
        uint[3] memory s = [uint256(30), 1_000e6, 4242];
        vm.expectRevert(SaksiPool.NoSuchAudit.selector);
        pool.proveThreshold(pA, pB, pC, s);
    }

    function test_ThresholdDisclosureAnswersAndClosesTheRequest() public {
        _deposit(holder, bytes32(uint256(31)), 50e6);
        pool.requestAudit(4243, 31, pool.KIND_THRESHOLD(), "no holder above 1,000");
        uint[3] memory s = [uint256(31), 1_000e6, 4243];

        pool.proveThreshold(pA, pB, pC, s);
        assertEq(pool.auditAnswered(4243), pool.KIND_THRESHOLD());

        // A second answer to the same question is refused; the record is the answer.
        vm.expectRevert(SaksiPool.AuditClosed.selector);
        pool.proveThreshold(pA, pB, pC, s);
    }

    /// A disclosure must be about a position this register actually holds.
    function test_DisclosureAboutUnknownCommitmentRejected() public {
        pool.requestAudit(4244, 0xDEAD, pool.KIND_THRESHOLD(), "unknown note");
        uint[3] memory s = [uint256(0xDEAD), 1_000e6, 4244];
        vm.expectRevert(SaksiPool.UnknownCommitment.selector);
        pool.proveThreshold(pA, pB, pC, s);
    }

    function test_RangeDisclosure() public {
        _deposit(holder, bytes32(uint256(32)), 50e6);
        pool.requestAudit(4245, 32, pool.KIND_RANGE(), "reportable bracket");
        uint[4] memory s = [uint256(32), 10e6, 100e6, 4245];
        pool.proveRange(pA, pB, pC, s);
        assertEq(pool.auditAnswered(4245), pool.KIND_RANGE());
    }

    function test_AggregateDisclosureChecksActiveSlotsOnly() public {
        _deposit(holder, bytes32(uint256(40)), 10e6);
        _deposit(holder, bytes32(uint256(41)), 20e6);
        pool.requestAudit(4246, 0, pool.KIND_AGGREGATE(), "jurisdiction exposure");

        uint[13] memory s;
        s[0] = 40; s[1] = 41; s[2] = 0xBEEF; s[3] = 0; s[4] = 0;   // slot 2 is padding
        s[5] = 1;  s[6] = 1;  s[7] = 0;      s[8] = 0; s[9] = 0;
        s[10] = 500e6;   // cap
        s[11] = 4246;    // context
        s[12] = 7;       // nonce

        pool.proveAggregate(pA, pB, pC, s);
        assertEq(pool.auditAnswered(4246), pool.KIND_AGGREGATE());
    }

    function test_AggregateRejectsActiveSlotNotInRegister() public {
        _deposit(holder, bytes32(uint256(42)), 10e6);
        pool.requestAudit(4247, 0, pool.KIND_AGGREGATE(), "jurisdiction exposure");

        uint[13] memory s;
        s[0] = 42; s[1] = 0xBEEF;                 // slot 1 is not a known commitment
        s[5] = 1;  s[6] = 1;                      // ...but is flagged active
        s[10] = 500e6; s[11] = 4247; s[12] = 7;

        vm.expectRevert(SaksiPool.UnknownCommitment.selector);
        pool.proveAggregate(pA, pB, pC, s);
    }

    function test_ExactDisclosure() public {
        _deposit(holder, bytes32(uint256(50)), 25e6);
        pool.requestAudit(4248, 50, pool.KIND_EXACT(), "exact position");
        uint[3] memory s = [uint256(50), 25e6, 4248];
        pool.proveExact(pA, pB, pC, s);
        assertEq(pool.auditAnswered(4248), pool.KIND_EXACT());
    }

    /// A stranger must not be able to close someone else's audit with an answer about
    /// their own throwaway note. Before the subject was pinned, one unit bought the
    /// permanent right to write a false answer into the record.
    function test_StrangerCannotAnswerSomeoneElsesQuestion() public {
        _deposit(holder, bytes32(uint256(60)), 50e6);       // the position asked about
        validator.setEligible(address(0xA77ACC), true);
        asset.mint(address(0xA77ACC), 1);
        _deposit(address(0xA77ACC), bytes32(uint256(61)), 1); // the attacker's throwaway

        pool.requestAudit(4250, 60, pool.KIND_THRESHOLD(), "is position 60 under the cap");

        uint[3] memory theirs = [uint256(61), type(uint64).max, 4250];
        vm.prank(address(0xA77ACC));
        vm.expectRevert(SaksiPool.WrongSubject.selector);
        pool.proveThreshold(pA, pB, pC, theirs);

        // The real holder's answer still lands.
        pool.proveThreshold(pA, pB, pC, [uint256(60), 1_000e6, 4250]);
        assertEq(pool.auditAnswered(4250), pool.KIND_THRESHOLD());
    }

    /// An exact-disclosure demand must not be satisfiable by a weaker statement.
    function test_KindCannotBeDowngraded() public {
        _deposit(holder, bytes32(uint256(62)), 50e6);
        pool.requestAudit(4251, 62, pool.KIND_EXACT(), "disclose position 62 in full");
        vm.expectRevert(SaksiPool.WrongDisclosureKind.selector);
        pool.proveThreshold(pA, pB, pC, [uint256(62), type(uint64).max, 4251]);
    }

    /// Six bytes32 values share each field residue. A commitment that is not itself a
    /// field element enters the register under a key no disclosure can ever name.
    function test_CommitmentMustBeAFieldElement() public {
        bytes32 alias_ = bytes32(uint256(70) + FIELD);
        uint[11] memory p = _pub(holder, bytes32(uint256(70)));
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
        pool.deposit(10e6, alias_, pA, pB, pC, p, pA, pB, pC, _bind(bytes32(uint256(70)), 10e6));
    }

    /// The entry binding must not double as an answer to an audit request.
    function test_EntryBindingCarriesNoAuditContext() public {
        bytes32 c = bytes32(uint256(71));
        uint[11] memory p = _pub(holder, c);
        uint[3] memory withCtx = [uint256(71), 10e6, 4252];   // a context hash it should not carry
        vm.prank(holder);
        vm.expectRevert(SaksiPool.CommitmentNotBound.selector);
        pool.deposit(10e6, c, pA, pB, pC, p, pA, pB, pC, withCtx);
    }

    /// A revoked holder keeps the note but loses the ability to move it through this
    /// contract. The exit is a live check rather than a circuit constraint — see the note
    /// in transact() — but leaving it unchecked made "the position freezes" simply false.
    function test_RevokedHolderCannotWithdraw() public {
        _deposit(holder, bytes32(uint256(80)), 100e6);
        validator.setEligible(holder, false);               // credential withdrawn
        uint[7] memory s = _transferSignals(100e6, holder, 20);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(SaksiPool.ValidatorRefused.selector, holder));
        pool.transact(pA, pB, pC, s, holder, address(0), 0);
    }

    function test_CannotWithdrawMoreThanTheRegisterHolds() public {
        _deposit(holder, bytes32(uint256(81)), 10e6);
        uint[7] memory s = _transferSignals(999e6, holder, 21);
        vm.expectRevert(SaksiPool.ExceedsBacking.selector);
        pool.transact(pA, pB, pC, s, holder, address(0), 0);
    }

    function test_FeeOnAnInternalTransferIsRefused() public {
        _deposit(holder, bytes32(uint256(82)), 10e6);
        uint[7] memory s = _transferSignals(0, holder, 22);
        s[2] = pool.extDataHashOf(holder, owner, 5e6);
        vm.expectRevert(SaksiPool.FeeWithoutWithdrawal.selector);
        pool.transact(pA, pB, pC, s, holder, owner, 5e6);
    }

    function test_OwnershipCannotBeRenouncedToZero() public {
        vm.expectRevert(Ownable.ZeroOwner.selector);
        pool.transferOwnership(address(0));
    }

    /// validator/register checks the EIP-191 signature against this.
    function test_ExposesOwnerForValidatorRegistration() public view {
        assertEq(pool.owner(), owner);
    }
}
