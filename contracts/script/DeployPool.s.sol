// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SaksiPool} from "../src/SaksiPool.sol";

/// Redeploy only the pool, reusing verifiers already on chain. The verifiers are
/// stateless pairing checks — nothing about them is per-register, so redeploying them
/// alongside the pool would burn gas to produce identical bytecode at a new address.
contract DeployPool is Script {
    function run() external {
        address[6] memory v = [
            vm.envAddress("V_COMPLIANCE"),
            vm.envAddress("V_TRANSFER"),
            vm.envAddress("V_EXACT"),
            vm.envAddress("V_THRESHOLD"),
            vm.envAddress("V_RANGE"),
            vm.envAddress("V_AGGREGATE")
        ];

        vm.startBroadcast();
        SaksiPool pool = new SaksiPool(
            vm.envAddress("ASSET"),
            vm.envAddress("VALIDATOR"),
            v[0], v[1], v[2], v[3], v[4], v[5],
            vm.envUint("ASP_ROOT"),
            vm.envAddress("DEPLOYER_ADDRESS")
        );
        vm.stopBroadcast();

        console.log("SaksiPool", address(pool));
    }
}
