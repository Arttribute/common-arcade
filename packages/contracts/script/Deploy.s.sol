// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";

interface ISafe {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

contract Deploy is Script {
    function run() external returns (ArcadeEscrow escrow) {
        require(block.chainid == 84532 || block.chainid == 5042002 || block.chainid == 296, "Testnets only");
        address governance = vm.envAddress("ARCADE_SAFE_ADDRESS");
        require(governance.code.length > 0, "Deploy Safe first");
        uint256 threshold = ISafe(governance).getThreshold();
        require(threshold >= 2 && threshold <= ISafe(governance).getOwners().length, "Safe must use >=2 signers");
        vm.startBroadcast(); // Use --account encrypted-keystore; no raw key in argv or deployment files.
        escrow = new ArcadeEscrow(governance);
        vm.stopBroadcast();
        console2.log("Chain", block.chainid);
        console2.log("ArcadeEscrow", address(escrow));
        console2.log("Safe governance and treasury", governance);
        // Token and resolver authorization are separate Safe transactions, prepared by the SDK.
    }
}
