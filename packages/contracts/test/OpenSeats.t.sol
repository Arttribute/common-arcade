// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {ArcadeEscrowTest} from "./ArcadeEscrow.t.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";

contract OpenSeatsTest is ArcadeEscrowTest {
    bytes32 lobby = keccak256("open-lobby");

    function openLobby(uint256 amount) internal {
        ArcadeEscrow.Terms memory terms = escrow.getMatch(id).terms;
        terms.stake = amount;
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = b;
        vm.prank(resolver);
        escrow.createOpenMatch(lobby, terms, ss);
    }

    function testJoinAssignsAndPaysAtomically() public {
        openLobby(1_000_000);
        assertEq(escrow.recipient(lobby, a), address(0));
        vm.prank(alice);
        token.approve(address(escrow), 0);
        vm.prank(alice);
        vm.expectRevert();
        escrow.stake(lobby, a);
        assertEq(escrow.recipient(lobby, a), address(0));
        assertFalse(escrow.seated(lobby, alice));
        assertEq(escrow.getMatch(lobby).paidSeats, 0);
        vm.prank(alice);
        token.approve(address(escrow), 1_000_000);
        vm.prank(alice);
        escrow.stake(lobby, a);
        assertEq(escrow.recipient(lobby, a), alice);
        assertEq(escrow.getMatch(lobby).prizePool, 1_000_000);
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stake(lobby, a);
        vm.prank(alice);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stake(lobby, b);
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stake(lobby, keccak256("unknown"));
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.WrongPhase.selector);
        escrow.lock(lobby);
        vm.prank(bob);
        escrow.stake(lobby, b);
        vm.prank(resolver);
        escrow.lock(lobby);
        vm.prank(resolver);
        escrow.settle(lobby, a, keccak256("result"));
        assertEq(escrow.claimable(address(token), alice), 1_950_000);
    }

    function testSponsoredSeatsMustJoinBeforeLockAndBetting() public {
        openLobby(0);
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.WrongPhase.selector);
        escrow.lock(lobby);
        vm.prank(fanA);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.placeBet(lobby, a, 1_000_000);
        vm.prank(alice);
        escrow.stake(lobby, a);
        vm.prank(bob);
        escrow.stake(lobby, b);
        vm.prank(sponsor);
        escrow.fundBounty(lobby, 2_000_000);
        vm.prank(fanA);
        escrow.placeBet(lobby, a, 1_000_000);
        vm.prank(fanB);
        escrow.placeBet(lobby, b, 1_000_000);
        vm.prank(resolver);
        escrow.lock(lobby);
        vm.prank(fanA);
        vm.expectRevert(ArcadeEscrow.WrongPhase.selector);
        escrow.placeBet(lobby, a, 1);
        vm.prank(resolver);
        escrow.settle(lobby, a, keccak256("result"));
        vm.prank(fanA);
        escrow.claimBet(lobby);
        assertEq(token.balanceOf(fanA), 1_000_975_000);
    }

    function testUnfilledLobbyRefundsAndDuplicateSeatsRejected() public {
        openLobby(1_000_000);
        vm.prank(alice);
        escrow.stake(lobby, a);
        vm.warp(block.timestamp + 101);
        escrow.voidMatch(lobby);
        escrow.claimRefundFor(lobby, alice);
        assertEq(token.balanceOf(alice), 1_000_000_000);
        ArcadeEscrow.Terms memory terms = escrow.getMatch(id).terms;
        terms.fundingDeadline = uint64(block.timestamp + 100);
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = a;
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidTerms.selector);
        escrow.createOpenMatch(keccak256("duplicates"), terms, ss);
    }
}
