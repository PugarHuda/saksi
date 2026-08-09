// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ComplianceVerifier} from "../src/verifiers/complianceVerifier.sol";

/// Proves the Stellar-era compliance circuit verifies unchanged on EVM.
/// Public signals: [aspRoot, denyList[8], sourceKey, bindHash] = 11
contract CompliancePortTest is Test {
    ComplianceVerifier v;
    function setUp() public { v = new ComplianceVerifier(); }

    function _pA() internal pure returns (uint[2] memory) { return [uint256(0x0b8d41224c0135824ec4c098addf9449d26641c3a29f503083964651445f9946), uint256(0x1a4508f03e45fd0324a547ab20412789c4e28ac29cbeb78f83b850ac63c40068)]; }
    function _pB() internal pure returns (uint[2][2] memory) {
        return [[uint256(0x0076013c15f349adc60c9407fe45a4327b711a019b13a1e73d3850ffad62a6e9), uint256(0x2a8e512a69f670f7a28d1ca483da178d2354de9348fdb339869de68612056f07)], [uint256(0x2b9038e7365c0a559524d203d33c1c632c2f8c7c35d9c27704bb24b371d2f97d), uint256(0x0a8ef6ec9bb3a3f1a2c4e6d34c430b7fce37f95c898a2401122a39d5d9d8c01d)]];
    }
    function _pC() internal pure returns (uint[2] memory) { return [uint256(0x2ebaa222292028410e78a8d8470e3b924004ed9aba002c1e6c841ab01887ef66), uint256(0x158dc05fb08ec701f8b14a7cec4229055fece37440e77f17c2e1d943637e600a)]; }
    function _pub() internal pure returns (uint[11] memory) { return [uint256(0x2423044f05b21f80bcf35ed67245a44e821a58f1b1918ca2484901bdbd3d13ee), uint256(0x0d153155ec1671a58a8840aea992de71a0dc3874720f52a682e1a54bd83469a6), uint256(0x1ec1f09b45e0e33dd307b4957244585eb023842a0fbd2e06e69f7c1335a7513b), uint256(0x0fd82f652cb6e2dffa47999c215317efa0027a5d259fdc8837531022e14e299d), uint256(0x0acce5d3cbd0bae10a31b99b98a1407e0ae79267b289917c0c35726428a15c7e), uint256(0x238dfda9c6d4313020ef35e630c136e2da7a55485aa0492fe30247a8c0012915), uint256(0x21a12e3994210caa50bb74a7b0cdb7b1af19b3a35f490e8ea1022e4ba7ab57f7), uint256(0x26c08f73ce240e564c325d37c98327c31bb5d1c241737f292b7f3bccb9fd38f5), uint256(0x0123d13694172eb5a79b47de4880aaf7458a152bb83eec526cffd665aad7e558), uint256(0x2d2a0694b41d8d8e286f785ac5fa0bdaf6b24d4527b9f9e20d8a838c35ce203e), uint256(0x000000000000000000000000000000000000000000000000000000003ade68b1)]; }

    function test_RealProofVerifies() public view {
        assertTrue(v.verifyProof(_pA(), _pB(), _pC(), _pub()), "genuine proof must verify");
    }

    function test_TamperedAspRootRejected() public view {
        uint[11] memory p = _pub();
        p[0] = p[0] ^ 1;
        assertFalse(v.verifyProof(_pA(), _pB(), _pC(), p), "tampered aspRoot must not verify");
    }

    function test_TamperedProofRejected() public view {
        uint[2] memory a2 = _pA(); a2[0] = a2[0] ^ 1;
        assertFalse(v.verifyProof(a2, _pB(), _pC(), _pub()), "tampered proof must not verify");
    }

    function test_GasCost() public view {
        uint g = gasleft();
        v.verifyProof(_pA(), _pB(), _pC(), _pub());
        console.log("compliance verifyProof gas:", g - gasleft());
    }
}
