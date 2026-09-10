// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";

contract DeployTest is Test {
    Deploy deploy;
    address admin = address(0xD9303DFc71728f209EF64DD1AD97F5a557AE0Fab);

    function setUp() public {
        deploy = new Deploy();
    }

    function testExplicitEOAOverrideOnEachTestnet() public {
        vm.setEnv("ARCADE_TESTNET_ADMIN", vm.toString(admin));
        uint256[3] memory chains = [uint256(84532), uint256(5042002), uint256(296)];
        for (uint256 i; i < chains.length; ++i) {
            vm.chainId(chains[i]);
            ArcadeEscrow escrow = deploy.run();
            assertEq(escrow.owner(), admin);
        }
        // Environment cheatcodes are process-wide, so exercise the default in
        // this same test instead of racing another test's environment changes.
        vm.chainId(84532);
        vm.setEnv("ARCADE_TESTNET_ADMIN", vm.toString(address(0)));
        vm.setEnv("ARCADE_SAFE_ADDRESS", vm.toString(admin));
        vm.expectRevert("Deploy Safe first");
        deploy.run();
    }

    function testOverrideCannotEnableMainnet() public {
        vm.chainId(8453);
        vm.expectRevert("Testnets only");
        deploy.run();
    }
}
