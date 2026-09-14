// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import {OpenSeatsTest} from "./OpenSeats.t.sol";
import {ArcadeEscrow} from "../contracts/ArcadeEscrow.sol";

contract AuthorizedEntryTest is OpenSeatsTest {
    uint256 playerKey = 0xA11CE;
    address player;
    address gameKey = address(0x888);

    function _authorization(uint256 key, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (ArcadeEscrow.TransferAuthorization memory auth)
    {
        auth.from = vm.addr(key);
        auth.value = value;
        auth.validAfter = 0;
        auth.validBefore = block.timestamp + 120;
        auth.nonce = nonce;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        escrow.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                        auth.from,
                        to,
                        value,
                        auth.validAfter,
                        auth.validBefore,
                        nonce
                    )
                )
            )
        );
        (auth.v, auth.r, auth.s) = vm.sign(key, digest);
    }

    function _fundPlayer() internal {
        player = vm.addr(playerKey);
        token.mint(player, 5_000_000);
    }

    function testRelayedEntryAssignsSeatToPayerWithoutGasOrAllowance() public {
        _fundPlayer();
        openLobby(1_000_000);
        ArcadeEscrow.TransferAuthorization memory auth =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"));
        vm.prank(resolver);
        escrow.stakeWithAuthorization(lobby, a, gameKey, auth);
        assertEq(escrow.recipient(lobby, a), player);
        assertEq(escrow.controller(lobby, a), gameKey);
        assertEq(escrow.refundable(lobby, player), 1_000_000);
        assertEq(escrow.refundable(lobby, resolver), 0);
        assertEq(escrow.getMatch(lobby).prizePool, 1_000_000);
        assertEq(token.balanceOf(player), 4_000_000);
        assertEq(token.allowance(player, address(escrow)), 0);
        assertTrue(escrow.creditedAuthorization(address(token), player, keccak256("n1")));
        // The same seat, the same nonce and a second seat for the same wallet all fail.
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stakeWithAuthorization(lobby, b, gameKey, auth);
        ArcadeEscrow.TransferAuthorization memory second =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n2"));
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stakeWithAuthorization(lobby, b, gameKey, second);
        assertEq(token.balanceOf(player), 4_000_000);
    }

    function testOnlyTheResolverMayRelayAndTermsMustMatch() public {
        _fundPlayer();
        openLobby(1_000_000);
        ArcadeEscrow.TransferAuthorization memory auth =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"));
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        escrow.stakeWithAuthorization(lobby, a, bob, auth);
        ArcadeEscrow.TransferAuthorization memory cheap =
            _authorization(playerKey, address(escrow), 999_999, keccak256("n3"));
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stakeWithAuthorization(lobby, a, gameKey, cheap);
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stakeWithAuthorization(lobby, a, address(0), auth);
        // A signature for another recipient cannot fund this escrow.
        ArcadeEscrow.TransferAuthorization memory elsewhere =
            _authorization(playerKey, address(0xBEEF), 1_000_000, keccak256("n4"));
        vm.prank(resolver);
        vm.expectRevert();
        escrow.stakeWithAuthorization(lobby, a, gameKey, elsewhere);
        assertEq(escrow.recipient(lobby, a), address(0));
        assertFalse(escrow.creditedAuthorization(address(token), player, keccak256("n4")));
    }

    function testExpiredAuthorizationLeavesSeatOpen() public {
        _fundPlayer();
        openLobby(1_000_000);
        ArcadeEscrow.TransferAuthorization memory auth =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"));
        vm.warp(block.timestamp + 121);
        vm.prank(resolver);
        vm.expectRevert();
        escrow.stakeWithAuthorization(lobby, a, gameKey, auth);
        assertEq(escrow.recipient(lobby, a), address(0));
        assertEq(escrow.getMatch(lobby).paidSeats, 0);
    }

    function testFrontRunTransferCanBeRecoveredOnce() public {
        _fundPlayer();
        openLobby(1_000_000);
        ArcadeEscrow.TransferAuthorization memory auth =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"));
        // Someone copies the authorization and submits it straight to the token.
        vm.prank(bob);
        token.transferWithAuthorization(
            auth.from,
            address(escrow),
            auth.value,
            auth.validAfter,
            auth.validBefore,
            auth.nonce,
            auth.v,
            auth.r,
            auth.s
        );
        vm.prank(resolver);
        vm.expectRevert();
        escrow.stakeWithAuthorization(lobby, a, gameKey, auth);
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        escrow.recoverAuthorizedStake(lobby, a, bob, auth);
        vm.prank(resolver);
        escrow.recoverAuthorizedStake(lobby, a, gameKey, auth);
        assertEq(escrow.recipient(lobby, a), player);
        assertEq(escrow.refundable(lobby, player), 1_000_000);
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.recoverAuthorizedStake(lobby, b, gameKey, auth);
    }

    function testRecoveryRequiresAUsedNonceAndAMatchingSignature() public {
        _fundPlayer();
        openLobby(1_000_000);
        ArcadeEscrow.TransferAuthorization memory unused =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"));
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.recoverAuthorizedStake(lobby, a, gameKey, unused);
        ArcadeEscrow.TransferAuthorization memory elsewhere =
            _authorization(playerKey, address(0xBEEF), 1_000_000, keccak256("n2"));
        token.transferWithAuthorization(
            elsewhere.from,
            address(0xBEEF),
            elsewhere.value,
            elsewhere.validAfter,
            elsewhere.validBefore,
            elsewhere.nonce,
            elsewhere.v,
            elsewhere.r,
            elsewhere.s
        );
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.recoverAuthorizedStake(lobby, a, gameKey, elsewhere);
        assertEq(escrow.recipient(lobby, a), address(0));
    }

    function testReservedSeatAcceptsOnlyItsRecipient() public {
        _fundPlayer();
        bytes32 reserved = keccak256("reserved");
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = b;
        address[] memory rr = new address[](2);
        rr[0] = player;
        rr[1] = bob;
        ArcadeEscrow.Terms memory terms = escrow.getMatch(id).terms;
        terms.fundingDeadline = uint64(block.timestamp + 1 hours);
        terms.settlementDeadline = uint64(block.timestamp + 2 hours);
        vm.prank(resolver);
        escrow.createMatch(reserved, terms, ss, rr);
        ArcadeEscrow.TransferAuthorization memory auth =
            _authorization(playerKey, address(escrow), terms.stake, keccak256("n1"));
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.stakeWithAuthorization(reserved, b, gameKey, auth);
        vm.prank(resolver);
        escrow.stakeWithAuthorization(reserved, a, gameKey, auth);
        assertTrue(escrow.staked(reserved, a));
    }

    function testFullMatchWithRelayedEntriesPaysTheWinner() public {
        _fundPlayer();
        openLobby(1_000_000);
        uint256 otherKey = 0xB0B;
        token.mint(vm.addr(otherKey), 1_000_000);
        vm.startPrank(resolver);
        escrow.stakeWithAuthorization(
            lobby, a, gameKey, _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"))
        );
        escrow.stakeWithAuthorization(
            lobby, b, vm.addr(otherKey), _authorization(otherKey, address(escrow), 1_000_000, keccak256("n1"))
        );
        escrow.lock(lobby);
        escrow.settle(lobby, a, keccak256("result"));
        vm.stopPrank();
        assertEq(escrow.claimable(address(token), player), 1_950_000);
        escrow.withdraw(token, player);
        assertEq(token.balanceOf(player), 5_950_000);
    }

    function testSponsoredClaimIsResolverOnlyAndFree() public {
        _fundPlayer();
        openLobby(0);
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        escrow.claimSeatFor(lobby, a, bob, bob);
        vm.prank(resolver);
        escrow.claimSeatFor(lobby, a, player, gameKey);
        assertEq(escrow.recipient(lobby, a), player);
        assertEq(escrow.controller(lobby, a), gameKey);
        assertEq(token.balanceOf(player), 5_000_000);
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.claimSeatFor(lobby, b, player, gameKey);
        openLobbyWithId(keccak256("paid"), 1_000_000);
        vm.prank(resolver);
        vm.expectRevert(ArcadeEscrow.InvalidDeposit.selector);
        escrow.claimSeatFor(keccak256("paid"), a, player, gameKey);
    }

    function testCanceledAuthorizationCannotBeCreditedAsAPayment() public {
        _fundPlayer();
        openLobby(1_000_000);
        ArcadeEscrow.TransferAuthorization memory auth =
            _authorization(playerKey, address(escrow), 1_000_000, keccak256("n1"));
        vm.prank(player);
        token.cancelAuthorization(player, auth.nonce);
        // The contract alone cannot tell a cancellation from a transfer; the relayer must not call
        // recovery without the matching transfer event. This documents why recovery is resolver-only.
        vm.prank(bob);
        vm.expectRevert(ArcadeEscrow.Unauthorized.selector);
        escrow.recoverAuthorizedStake(lobby, a, bob, auth);
        vm.prank(resolver);
        vm.expectRevert();
        escrow.stakeWithAuthorization(lobby, a, gameKey, auth);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function openLobbyWithId(bytes32 matchId, uint256 amount) internal {
        ArcadeEscrow.Terms memory terms = escrow.getMatch(id).terms;
        terms.stake = amount;
        bytes32[] memory ss = new bytes32[](2);
        ss[0] = a;
        ss[1] = b;
        vm.prank(resolver);
        escrow.createOpenMatch(matchId, terms, ss);
    }
}
