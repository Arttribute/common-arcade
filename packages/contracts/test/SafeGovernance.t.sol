// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {Safe} from "../lib/safe-contracts/contracts/Safe.sol";
import {SafeProxy} from "../lib/safe-contracts/contracts/proxies/SafeProxy.sol";
import {Enum} from "../lib/safe-contracts/contracts/common/Enum.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";
import {TestUSDC} from "../contracts/TestUSDC.sol";

contract SafeGovernanceTest is Test {
    Safe safe;
    ArcadeEscrow escrow;
    TestUSDC token;
    uint256 first = 101;
    uint256 second = 202;

    function setUp() public {
        vm.chainId(31337);
        if (vm.addr(first) > vm.addr(second)) (first, second) = (second, first);
        Safe singleton = new Safe();
        safe = Safe(payable(address(new SafeProxy(address(singleton)))));
        address[] memory owners = new address[](2);
        owners[0] = vm.addr(first);
        owners[1] = vm.addr(second);
        safe.setup(owners, 2, address(0), "", address(0), address(0), 0, payable(address(0)));
        token = new TestUSDC();
        escrow = new ArcadeEscrow(address(safe));
    }

    function signature(uint256 key, bytes32 hash) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, hash);
        return abi.encodePacked(r, s, v);
    }

    function testActualTwoOfTwoSafeControlsTokenAndResolver() public {
        bytes memory data = abi.encodeCall(ArcadeEscrow.setToken, (address(token), true));
        bytes32 hash = safe.getTransactionHash(
            address(escrow), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        bytes memory signatures = bytes.concat(signature(first, hash), signature(second, hash));
        assertTrue(
            safe.execTransaction(
                address(escrow), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
            )
        );
        assertTrue(escrow.allowedTokens(address(token)));
        assertEq(escrow.owner(), address(safe));
        assertEq(safe.getThreshold(), 2);
        data = abi.encodeCall(ArcadeEscrow.setResolver, (address(0x999), true));
        hash = safe.getTransactionHash(
            address(escrow), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        signatures = bytes.concat(signature(first, hash), signature(second, hash));
        assertTrue(
            safe.execTransaction(
                address(escrow), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
            )
        );
        assertTrue(escrow.resolvers(address(0x999)));
    }

    function testOneSignerCannotAuthorizePayments() public {
        bytes memory data = abi.encodeCall(ArcadeEscrow.setToken, (address(token), true));
        bytes32 hash = safe.getTransactionHash(
            address(escrow), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        bytes memory signatures = signature(first, hash);
        vm.expectRevert("GS020");
        safe.execTransaction(
            address(escrow), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
        );
        assertFalse(escrow.allowedTokens(address(token)));
    }
}
