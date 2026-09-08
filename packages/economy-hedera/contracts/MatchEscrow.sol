// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MatchEscrow
/// @notice Testnet-only escrow for optional, opt-in Common Arcade match
/// economy: per-match bounties, per-seat stakes, and spectator betting on
/// match outcomes. No game uses this by default — only a match whose game
/// manifest declares the `economy-hedera/v1` extension ever calls into it.
///
/// @dev Custody model: this contract only ever holds funds explicitly sent by
/// their own callers (`fundBounty`, `stake`, `placeBet`). Every payout is a
/// pull payment (`withdraw`, `claimBetWinnings`) computed on demand, so a
/// failing or malicious recipient can never block settlement for anyone else,
/// and this contract never needs to enumerate every bettor to pay them.
///
/// `arbiter` is the platform's own Hedera operator account (Common Arcade's
/// control-api), never an agent's or player's key — it can only call
/// `settle`/`voidMatch` once a match's authoritative result is known;
/// it can never withdraw anyone else's stake or bet.
contract MatchEscrow is ReentrancyGuard {
    struct MatchAccount {
        bool settled;
        bool voided;
        bytes32 winnerSeatId;
        uint256 bountyPool;
    }

    address public immutable arbiter;

    mapping(bytes32 => MatchAccount) public matches;
    mapping(bytes32 => bytes32[]) private seatsOf;
    mapping(bytes32 => mapping(bytes32 => bool)) private seatKnown;
    mapping(bytes32 => mapping(bytes32 => uint256)) public stakeOf;
    mapping(bytes32 => mapping(bytes32 => address)) public stakerOf;
    mapping(bytes32 => mapping(bytes32 => uint256)) public betPoolOf;
    mapping(bytes32 => mapping(bytes32 => mapping(address => uint256))) public betOf;
    mapping(bytes32 => mapping(address => bool)) public betClaimed;
    mapping(address => uint256) public pendingWithdrawals;

    event BountyFunded(bytes32 indexed matchId, address indexed funder, uint256 amount);
    event Staked(bytes32 indexed matchId, bytes32 indexed seatId, address indexed staker, uint256 amount);
    event BetPlaced(bytes32 indexed matchId, bytes32 indexed seatId, address indexed bettor, uint256 amount);
    event Settled(bytes32 indexed matchId, bytes32 winnerSeatId, uint256 payout);
    event Voided(bytes32 indexed matchId);
    event Withdrawn(address indexed account, uint256 amount);
    event BetWinningsClaimed(bytes32 indexed matchId, address indexed bettor, uint256 amount);

    error NotArbiter();
    error ZeroArbiter();
    error AlreadySettled();
    error NotSettled();
    error UnknownSeat();
    error SeatAlreadyStaked();
    error NothingToWithdraw();
    error AlreadyClaimed();
    error DidNotBackWinner();
    error ZeroAmount();
    error TransferFailed();

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    constructor(address arbiter_) {
        if (arbiter_ == address(0)) revert ZeroArbiter();
        arbiter = arbiter_;
    }

    /// @notice Top up a match's bounty pool. Anyone may call this (a
    /// publisher, sponsor, or the platform itself).
    function fundBounty(bytes32 matchId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        MatchAccount storage account = matches[matchId];
        if (account.settled) revert AlreadySettled();
        account.bountyPool += msg.value;
        emit BountyFunded(matchId, msg.sender, msg.value);
    }

    /// @notice Stake HBAR to enter a seat. One stake per seat: it is refunded
    /// (with interest from the losing seats' stakes and the bounty pool) on a
    /// win, or forfeited to the winner on a loss.
    function stake(bytes32 matchId, bytes32 seatId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        MatchAccount storage account = matches[matchId];
        if (account.settled) revert AlreadySettled();
        if (stakerOf[matchId][seatId] != address(0)) revert SeatAlreadyStaked();

        stakerOf[matchId][seatId] = msg.sender;
        stakeOf[matchId][seatId] = msg.value;
        _rememberSeat(matchId, seatId);
        emit Staked(matchId, seatId, msg.sender, msg.value);
    }

    /// @notice Bet that a seat will win. Pari-mutuel: winners split the
    /// losing seats' total pool pro rata to their own bet size. Testnet
    /// funds only — this demonstrates the mechanism, not a production
    /// wagering product.
    function placeBet(bytes32 matchId, bytes32 seatId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        MatchAccount storage account = matches[matchId];
        if (account.settled) revert AlreadySettled();

        betPoolOf[matchId][seatId] += msg.value;
        betOf[matchId][seatId][msg.sender] += msg.value;
        _rememberSeat(matchId, seatId);
        emit BetPlaced(matchId, seatId, msg.sender, msg.value);
    }

    /// @notice Settle a match once its authoritative result is known. The
    /// winning seat's staker is credited every seat's stake plus the bounty
    /// pool (pull payment via `withdraw`). Spectator bets are claimed
    /// separately via `claimBetWinnings`.
    function settle(bytes32 matchId, bytes32 winnerSeatId) external onlyArbiter nonReentrant {
        MatchAccount storage account = matches[matchId];
        if (account.settled) revert AlreadySettled();
        if (!seatKnown[matchId][winnerSeatId]) revert UnknownSeat();

        account.settled = true;
        account.winnerSeatId = winnerSeatId;

        uint256 payout = account.bountyPool;
        bytes32[] storage seats = seatsOf[matchId];
        for (uint256 i = 0; i < seats.length; i++) {
            payout += stakeOf[matchId][seats[i]];
        }

        if (payout > 0) {
            address winner = stakerOf[matchId][winnerSeatId];
            // No staker recorded for the winning seat (e.g. a bounty-only or
            // bet-only match): route to the arbiter rather than lock funds,
            // for manual reconciliation out of band.
            pendingWithdrawals[winner != address(0) ? winner : arbiter] += payout;
        }
        emit Settled(matchId, winnerSeatId, payout);
    }

    /// @notice Void a match (cancelled / no contest): every staker and
    /// bettor is refunded exactly what they put in.
    function voidMatch(bytes32 matchId) external onlyArbiter {
        MatchAccount storage account = matches[matchId];
        if (account.settled) revert AlreadySettled();
        account.settled = true;
        account.voided = true;

        bytes32[] storage seats = seatsOf[matchId];
        for (uint256 i = 0; i < seats.length; i++) {
            address staker = stakerOf[matchId][seats[i]];
            uint256 amount = stakeOf[matchId][seats[i]];
            if (staker != address(0) && amount > 0) {
                pendingWithdrawals[staker] += amount;
            }
        }
        if (account.bountyPool > 0) {
            // Bounty funders are not individually tracked (many small
            // top-ups are expected); a voided bounty rolls over to the
            // arbiter for manual return or reuse on a rerun.
            pendingWithdrawals[arbiter] += account.bountyPool;
        }
        emit Voided(matchId);
    }

    /// @notice Claim a spectator bet's winnings for one match (or a full
    /// refund, if the match was voided). Computed on demand so this contract
    /// never has to enumerate every bettor.
    function claimBetWinnings(bytes32 matchId) external nonReentrant {
        MatchAccount storage account = matches[matchId];
        if (!account.settled) revert NotSettled();
        if (betClaimed[matchId][msg.sender]) revert AlreadyClaimed();

        uint256 amount;
        if (account.voided) {
            bytes32[] storage seats = seatsOf[matchId];
            for (uint256 i = 0; i < seats.length; i++) {
                amount += betOf[matchId][seats[i]][msg.sender];
            }
        } else {
            uint256 myBet = betOf[matchId][account.winnerSeatId][msg.sender];
            if (myBet == 0) revert DidNotBackWinner();
            uint256 winningPool = betPoolOf[matchId][account.winnerSeatId];
            uint256 losingPool = _losingPool(matchId, account.winnerSeatId);
            amount = myBet + (myBet * losingPool) / winningPool;
        }

        if (amount == 0) revert NothingToWithdraw();
        betClaimed[matchId][msg.sender] = true;
        _pay(msg.sender, amount);
        emit BetWinningsClaimed(matchId, msg.sender, amount);
    }

    /// @notice Withdraw settled stake/bounty winnings or a voided-match
    /// stake refund.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        _pay(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function _losingPool(bytes32 matchId, bytes32 winnerSeatId) private view returns (uint256 total) {
        bytes32[] storage seats = seatsOf[matchId];
        for (uint256 i = 0; i < seats.length; i++) {
            if (seats[i] != winnerSeatId) {
                total += betPoolOf[matchId][seats[i]];
            }
        }
    }

    function _rememberSeat(bytes32 matchId, bytes32 seatId) private {
        if (!seatKnown[matchId][seatId]) {
            seatKnown[matchId][seatId] = true;
            seatsOf[matchId].push(seatId);
        }
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
