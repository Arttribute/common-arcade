// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {OpenSeatsTest} from "./OpenSeats.t.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";

contract SeatControllerTest is OpenSeatsTest {
    function testClaimBindsControlButKeepsFundsWithPayer() public {
        openLobby(1_000_000);
        address gameKey = address(0x888);
        vm.prank(alice);
        escrow.stakeWithController(lobby, a, gameKey);
        assertEq(escrow.controller(lobby, a), gameKey);
        assertEq(escrow.recipient(lobby, a), alice);
        assertEq(escrow.refundable(lobby, alice), 1_000_000);
        assertEq(escrow.refundable(lobby, gameKey), 0);
        vm.prank(gameKey);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        escrow.setController(lobby, a, gameKey);
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        escrow.setController(lobby, a, bob);
        vm.prank(alice);
        escrow.setController(lobby, a, alice);
        assertEq(escrow.controller(lobby, a), alice);
    }

    function testPaymentRevertCannotClaimControl() public {
        openLobby(1_000_000);
        vm.prank(alice);
        token.approve(address(escrow), 0);
        vm.prank(alice);
        vm.expectRevert();
        escrow.stakeWithController(lobby, a, bob);
        assertEq(escrow.controller(lobby, a), address(0));
        assertEq(escrow.recipient(lobby, a), address(0));
    }

    function testCannotClaimWithZeroControllerOrReplaceAnOccupiedSeat() public {
        openLobby(0);
        vm.prank(alice);
        vm.expectRevert(ArcadeEscrow.InvalidTerms.selector);
        escrow.stakeWithController(lobby, a, address(0));
        vm.prank(alice);
        escrow.stakeWithController(lobby, a, alice);
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stakeWithController(lobby, a, bob);
        assertEq(escrow.controller(lobby, a), alice);
    }
}
