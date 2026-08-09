// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SaksiPool} from "../src/SaksiPool.sol";
import {ComplianceVerifier} from "../src/verifiers/complianceVerifier.sol";
import {TransferVerifier} from "../src/verifiers/transferVerifier.sol";
import {DisclosureVerifier} from "../src/verifiers/disclosureVerifier.sol";
import {ThresholdDisclosureVerifier} from "../src/verifiers/thresholdDisclosureVerifier.sol";
import {RangeDisclosureVerifier} from "../src/verifiers/rangeDisclosureVerifier.sol";
import {AggregateDisclosureVerifier} from "../src/verifiers/aggregateDisclosureVerifier.sol";

/// forge script script/Deploy.s.sol --rpc-url $MONAD_RPC --broadcast --private-key $DEPLOYER_PK
///
/// The verifiers go in an array rather than six named locals: eleven constructor
/// arguments plus six names overflows the stack slots solc will allocate without via-ir,
/// and via-ir triples the compile time for no benefit here.
contract Deploy is Script {
    function run() external {
        // v[0] compliance · v[1] transfer · v[2] exact · v[3] threshold · v[4] range · v[5] aggregate
        address[6] memory v;

        vm.startBroadcast();

        v[0] = address(new ComplianceVerifier());
        v[1] = address(new TransferVerifier());
        v[2] = address(new DisclosureVerifier());
        v[3] = address(new ThresholdDisclosureVerifier());
        v[4] = address(new RangeDisclosureVerifier());
        v[5] = address(new AggregateDisclosureVerifier());

        SaksiPool pool = new SaksiPool(
            vm.envAddress("ASSET"),
            vm.envAddress("VALIDATOR"),
            v[0], v[1], v[2], v[3], v[4], v[5],
            vm.envUint("ASP_ROOT"),
            vm.envAddress("DEPLOYER_ADDRESS")
        );

        vm.stopBroadcast();

        console.log("complianceVerifier  ", v[0]);
        console.log("transferVerifier    ", v[1]);
        console.log("exactVerifier       ", v[2]);
        console.log("thresholdVerifier   ", v[3]);
        console.log("rangeVerifier       ", v[4]);
        console.log("aggregateVerifier   ", v[5]);
        console.log("SaksiPool           ", address(pool));
    }
}
