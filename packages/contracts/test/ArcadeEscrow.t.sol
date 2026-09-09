// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";
import {TestUSDC} from "../contracts/TestUSDC.sol";

contract ArcadeEscrowTest is Test {
    ArcadeEscrow escrow;
    TestUSDC token;
    address treasury = address(0x100);
    address resolver = address(0x200);
    address alice = address(0x300);
    address bob = address(0x400);
    address sponsor = address(0x500);
    address fanA = address(0x600);
    address fanB = address(0x700);
    bytes32 id = keccak256("round-one");
    bytes32 a = keccak256("seat-a");
    bytes32 b = keccak256("seat-b");

    function setUp() public {
        vm.chainId(31337);
        token = new TestUSDC();
        escrow = new ArcadeEscrow(treasury);
        vm.startPrank(treasury);
        escrow.setToken(address(token), true);
        escrow.setResolver(resolver, true);
        vm.stopPrank();
        address[5] memory users = [alice, bob, sponsor, fanA, fanB];
        for (uint256 i; i < users.length; ++i) {
            token.mint(users[i], 1_000_000_000);
            vm.prank(users[i]);
            token.approve(address(escrow), type(uint256).max);
        }
        _create(id, 1_000_000);
    }

    function testHederaAssociationChecksResponseAndAuthority() public {
        vm.chainId(296);
        bytes memory callData =
            abi.encodeWithSignature("associateToken(address,address)", address(escrow), address(token));
        vm.mockCall(address(0x167), callData, abi.encode(int64(22)));
        vm.prank(treasury);
        escrow.associateHederaToken(address(token));
        vm.mockCall(address(0x167), callData, abi.encode(int64(194)));
        vm.prank(treasury);
        escrow.associateHederaToken(address(token));
        vm.mockCall(address(0x167), callData, abi.encode(int64(1)));
        vm.prank(treasury);
        vm.expectRevert(ArcadeEscrow.InvalidTerms.selector);
        escrow.associateHederaToken(address(token));
        vm.expectRevert();
        escrow.associateHederaToken(address(token));
    }

    function _create(bytes32 matchId, uint256 stakeAmount) internal {
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = b;
        address[] memory rr = new address[](2);
        rr[0] = alice;
        rr[1] = bob;
        ArcadeEscrow.Terms memory t = ArcadeEscrow.Terms(
            token,
            resolver,
            treasury,
            uint64(block.timestamp + 100),
            uint64(block.timestamp + 1000),
            250,
            stakeAmount,
            true,
            true,
            keccak256("rules"),
            address(0),
            0,
            new ArcadeEscrow.RoyaltyShare[](0)
        );
        vm.prank(resolver);
        escrow.createMatch(matchId, t, ss, rr);
    }

    function testCreatorSharesOneFeeWithoutReducingPlayerPrizeAgain() public {
        bytes32 other = keccak256("creator-round");
        ArcadeEscrow.Terms memory t = escrow.getMatch(id).terms;
        t.creator = address(0x777);
        t.creatorShareBps = 7000;
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = b;
        address[] memory rr = new address[](2);
        rr[0] = alice;
        rr[1] = bob;
        vm.prank(resolver);
        escrow.createMatch(other, t, ss, rr);
        vm.prank(alice);
        escrow.stake(other, a);
        vm.prank(bob);
        escrow.stake(other, b);
        vm.prank(resolver);
        escrow.lock(other);
        vm.prank(resolver);
        escrow.settle(other, a, keccak256("winner"));
        assertEq(escrow.claimable(address(token), alice), 1_950_000);
        assertEq(escrow.claimable(address(token), address(0x777)), 35_000);
        assertEq(escrow.claimable(address(token), treasury), 15_000);
        escrow.withdraw(token, address(0x777));
        assertEq(token.balanceOf(address(0x777)), 35_000);
    }

    function testFuzzRemixRoyaltyConservation(uint16 firstShare, uint16 secondShare) public {
        bytes32 other = keccak256("creator-round");
        ArcadeEscrow.Terms memory t = escrow.getMatch(id).terms;
        t.creator = address(0x777);
        t.creatorShareBps = 7000;
        firstShare = uint16(bound(firstShare, 1, 9999));
        secondShare = uint16(bound(secondShare, 1, 10000 - firstShare));
        t.royalties = new ArcadeEscrow.RoyaltyShare[](2);
        t.royalties[0] = ArcadeEscrow.RoyaltyShare(address(0x888), firstShare);
        t.royalties[1] = ArcadeEscrow.RoyaltyShare(address(0x999), secondShare);
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = b;
        address[] memory rr = new address[](2);
        rr[0] = alice;
        rr[1] = bob;
        vm.prank(resolver);
        escrow.createMatch(other, t, ss, rr);
        vm.prank(alice);
        escrow.stake(other, a);
        vm.prank(bob);
        escrow.stake(other, b);
        vm.prank(resolver);
        escrow.lock(other);
        vm.prank(resolver);
        escrow.settle(other, a, keccak256("winner"));
        assertEq(escrow.claimable(address(token), alice), 1_950_000);
        assertEq(
            escrow.claimable(address(token), address(0x777)) + escrow.claimable(address(token), address(0x888))
                + escrow.claimable(address(token), address(0x999)),
            35_000
        );
        assertEq(escrow.claimable(address(token), treasury), 15_000);
        uint256 creatorRemainder =
            35_000 - (35_000 * uint256(firstShare) / 10000) - (35_000 * uint256(secondShare) / 10000);
        if (creatorRemainder == 0) vm.expectRevert(ArcadeEscrow.NothingToClaim.selector);
        escrow.withdraw(token, address(0x777));
        assertEq(token.balanceOf(address(0x777)), creatorRemainder);
        escrow.withdraw(token, address(0x888));
        escrow.withdraw(token, address(0x999));
        assertEq(
            token.balanceOf(address(0x777)) + token.balanceOf(address(0x888)) + token.balanceOf(address(0x999)), 35_000
        );
    }

    function testRelayedRefundCannotRedirectAgentMoney() public {
        _stake();
        vm.prank(resolver);
        escrow.voidMatch(id);
        uint256 callerBefore = token.balanceOf(fanA);
        uint256 playerBefore = token.balanceOf(alice);
        vm.prank(fanA);
        escrow.claimRefundFor(id, alice);
        assertEq(token.balanceOf(alice), playerBefore + 1_000_000);
        assertEq(token.balanceOf(fanA), callerBefore);
        vm.expectRevert(ArcadeEscrow.NothingToClaim.selector);
        escrow.claimRefundFor(id, alice);
    }

    function _stake() internal {
        vm.prank(alice);
        escrow.stake(id, a);
        vm.prank(bob);
        escrow.stake(id, b);
    }

    function _finish() internal {
        vm.startPrank(resolver);
        escrow.lock(id);
        escrow.settle(id, a, keccak256("replay"));
        vm.stopPrank();
    }

    function testPrizeAndSpectatorAccounting() public {
        _stake();
        vm.prank(sponsor);
        escrow.fundBounty(id, 2_000_000);
        vm.prank(fanA);
        escrow.placeBet(id, a, 1_000_000);
        vm.prank(fanB);
        escrow.placeBet(id, b, 3_000_000);
        _finish();
        assertEq(escrow.claimable(address(token), alice), 3_900_000);
        assertEq(escrow.claimable(address(token), treasury), 175_000);
        vm.prank(fanA);
        escrow.claimBet(id);
        assertEq(token.balanceOf(fanA), 1_002_925_000);
        escrow.withdraw(token, alice);
        escrow.withdraw(token, treasury);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(treasury), 175_000);
    }

    function testVoidRefundsSponsorsPlayersAndBettors() public {
        _stake();
        vm.prank(sponsor);
        escrow.fundBounty(id, 2_000_000);
        vm.prank(fanA);
        escrow.placeBet(id, a, 100);
        vm.prank(resolver);
        escrow.lock(id);
        vm.warp(block.timestamp + 1000);
        vm.prank(fanB);
        escrow.voidMatch(id);
        vm.prank(alice);
        escrow.claimRefund(id);
        vm.prank(bob);
        escrow.claimRefund(id);
        vm.prank(sponsor);
        escrow.claimRefund(id);
        vm.prank(fanA);
        escrow.claimBet(id);
        assertEq(token.balanceOf(sponsor), 1_000_000_000);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(treasury), 0);
    }

    function testCannotDepositAfterLockOrSettleTwice() public {
        _stake();
        _finish();
        vm.expectRevert(ArcadeEscrow.WrongPhase.selector);
        vm.prank(fanA);
        escrow.placeBet(id, a, 1);
        vm.expectRevert(ArcadeEscrow.WrongPhase.selector);
        vm.prank(resolver);
        escrow.settle(id, a, keccak256("other"));
        escrow.withdraw(token, alice);
        vm.expectRevert(ArcadeEscrow.NothingToClaim.selector);
        escrow.withdraw(token, alice);
    }

    function testUnfilledTimeoutAndNoEarlyRefund() public {
        vm.prank(alice);
        escrow.stake(id, a);
        vm.expectRevert(ArcadeEscrow.WrongPhase.selector);
        vm.prank(resolver);
        escrow.lock(id);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        vm.prank(alice);
        escrow.voidMatch(id);
        vm.warp(block.timestamp + 100);
        escrow.voidMatch(id);
        vm.prank(alice);
        escrow.claimRefund(id);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testNoWinningBetsRefundAllBettors() public {
        _stake();
        vm.prank(fanB);
        escrow.placeBet(id, b, 1_000_000);
        _finish();
        vm.prank(fanB);
        escrow.claimBet(id);
        assertEq(token.balanceOf(fanB), 1_000_000_000);
        assertEq(escrow.claimable(address(token), treasury), 50_000);
    }

    function testPauseStillAllowsWithdrawal() public {
        _stake();
        _finish();
        vm.prank(treasury);
        escrow.setPaused(true);
        escrow.withdraw(token, alice);
        assertEq(token.balanceOf(alice), 1_000_950_000);
    }

    function testSeatAndResultAuthority() public {
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        vm.prank(bob);
        escrow.stake(id, a);
        _stake();
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        vm.prank(alice);
        escrow.lock(id);
        vm.prank(resolver);
        escrow.lock(id);
        vm.expectRevert(ArcadeEscrow.InvalidTerms.selector);
        vm.prank(resolver);
        escrow.settle(id, keccak256("unknown"), keccak256("replay"));
    }

    function testBountyOnlyPaysRegisteredRecipient() public {
        bytes32 onlyBounty = keccak256("bounty-only");
        _create(onlyBounty, 0);
        vm.prank(sponsor);
        escrow.fundBounty(onlyBounty, 1_000_000);
        vm.startPrank(resolver);
        escrow.lock(onlyBounty);
        escrow.settle(onlyBounty, b, keccak256("result"));
        vm.stopPrank();
        assertEq(escrow.claimable(address(token), bob), 975_000);
    }

    function testFuzzBetConservation(uint64 x, uint64 y, uint64 z) public {
        uint256 first = bound(x, 1, 100_000_000);
        uint256 second = bound(y, 1, 100_000_000);
        uint256 losing = bound(z, 1, 100_000_000);
        _stake();
        vm.prank(fanA);
        escrow.placeBet(id, a, first);
        vm.prank(sponsor);
        escrow.placeBet(id, a, second);
        vm.prank(fanB);
        escrow.placeBet(id, b, losing);
        _finish();
        vm.prank(fanA);
        escrow.claimBet(id);
        vm.prank(sponsor);
        escrow.claimBet(id);
        escrow.withdraw(token, alice);
        escrow.withdraw(token, treasury);
        assertEq(token.balanceOf(address(escrow)), 0, "All deposits accounted for, including dust");
    }

    function testIndependentMatches() public {
        bytes32 other = keccak256("round-two");
        _create(other, 1_000_000);
        vm.prank(sponsor);
        escrow.fundBounty(other, 123);
        _stake();
        _finish();
        escrow.withdraw(token, alice);
        escrow.withdraw(token, treasury);
        assertEq(token.balanceOf(address(escrow)), 123);
    }
}
