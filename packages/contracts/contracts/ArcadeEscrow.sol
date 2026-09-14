// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice EIP-3009 signed transfers, as used by x402 "exact" payments and Circle USDC.
interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice Game-neutral, single-winner prize pools and optional pari-mutuel spectator pools.
/// @dev The snapshotted resolver is trusted to report the authoritative game result.
///      This contract verifies accounting, not game execution. No upgrades or admin asset sweep.
contract ArcadeEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Status {
        Absent,
        Funding,
        Locked,
        Settled,
        Voided
    }

    struct RoyaltyShare {
        address recipient;
        uint16 bps;
    }

    struct Terms {
        IERC20 token;
        address resolver;
        address treasury;
        uint64 fundingDeadline;
        uint64 settlementDeadline;
        uint16 feeBps;
        uint256 stake;
        bool bounties;
        bool betting;
        bytes32 rulesHash;
        address creator;
        uint16 creatorShareBps;
        RoyaltyShare[] royalties;
    }

    /// @notice A payer-signed EIP-3009 transfer to this contract.
    struct TransferAuthorization {
        address from;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    struct MatchAccount {
        Terms terms;
        Status status;
        uint256 prizePool;
        uint256 betPool;
        uint256 paidSeats;
        bytes32 winner;
        bytes32 resultHash;
        uint256 remainingBetShares;
        uint256 remainingBetPayout;
    }
    mapping(bytes32 => MatchAccount) private accounts;
    mapping(bytes32 => bytes32[]) private seats;
    mapping(bytes32 => mapping(bytes32 => address)) public recipient;
    mapping(bytes32 => mapping(bytes32 => bool)) public staked;
    mapping(bytes32 => mapping(address => uint256)) public refundable;
    mapping(bytes32 => mapping(bytes32 => uint256)) public outcomePool;
    mapping(bytes32 => mapping(bytes32 => mapping(address => uint256))) public bets;
    mapping(bytes32 => mapping(address => uint256)) public totalBets;
    mapping(bytes32 => mapping(address => bool)) public betClaimed;
    mapping(address => mapping(address => uint256)) public claimable;
    mapping(address => bool) public allowedTokens;
    mapping(address => bool) public resolvers;
    mapping(bytes32 => bool) public openSeats;
    mapping(bytes32 => mapping(bytes32 => bool)) public registeredSeat;
    mapping(bytes32 => mapping(address => bool)) public seated;
    // Gameplay authority only. Recipients, refunds and winnings always stay with the payer.
    mapping(bytes32 => mapping(bytes32 => address)) public controller;
    // token => payer => EIP-3009 nonce already credited to a seat.
    mapping(address => mapping(address => mapping(bytes32 => bool))) public creditedAuthorization;
    bool public paused;
    uint16 public constant MAX_FEE_BPS = 1000;

    error InvalidTerms();
    error Unauthorized();
    error WrongPhase();
    error InvalidDeposit();
    error NothingToClaim();
    event MatchCreated(bytes32 indexed matchId, address indexed token, bytes32 rulesHash, address resolver);
    event Deposited(bytes32 indexed matchId, address indexed payer, uint8 kind, bytes32 seatId, uint256 amount);
    event ControllerAssigned(bytes32 indexed matchId, bytes32 indexed seatId, address controller);
    event AuthorizedEntry(
        bytes32 indexed matchId, bytes32 indexed seatId, address indexed player, bytes32 nonce, bool recovered
    );
    event Locked(bytes32 indexed matchId);
    event Settled(bytes32 indexed matchId, bytes32 indexed winner, bytes32 resultHash, uint256 prize, uint256 fee);
    event Voided(bytes32 indexed matchId);
    event Claimed(address indexed token, address indexed recipient, uint256 amount);
    event RevenueShared(bytes32 indexed matchId, address indexed creator, uint256 creatorFee, uint256 platformFee);
    event TokenAllowed(address indexed token, bool allowed);
    event ResolverAllowed(address indexed resolver, bool allowed);
    event PauseChanged(bool paused);

    constructor(address governance) Ownable(governance) {}

    function setToken(address token, bool allowed) external onlyOwner {
        if (allowed && token.code.length == 0) revert InvalidTerms();
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @notice HTS requires the receiving contract to associate itself with the token.
    /// @dev Only exposed on Hedera; governance selects the allowlisted token.
    function associateHederaToken(address token) external onlyOwner {
        if ((block.chainid != 296 && block.chainid != 295) || !allowedTokens[token]) revert InvalidTerms();
        (bool ok, bytes memory data) =
            address(0x167).call(abi.encodeWithSignature("associateToken(address,address)", address(this), token));
        if (!ok || data.length < 32) revert InvalidTerms();
        int64 response = abi.decode(data, (int64));
        // SUCCESS or TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT.
        if (response != 22 && response != 194) revert InvalidTerms();
    }

    function setResolver(address resolver, bool allowed) external onlyOwner {
        if (resolver == address(0)) revert InvalidTerms();
        resolvers[resolver] = allowed;
        emit ResolverAllowed(resolver, allowed);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    // Renouncing governance would make emergency controls unusable.
    function renounceOwnership() public pure override {
        revert Unauthorized();
    }

    function getMatch(bytes32 id) external view returns (MatchAccount memory) {
        return accounts[id];
    }

    function getSeats(bytes32 id) external view returns (bytes32[] memory) {
        return seats[id];
    }

    /// @dev matchId must include deployment domain + game release + round; never reuse a pool.
    function createMatch(bytes32 id, Terms calldata terms, bytes32[] calldata seatIds, address[] calldata recipients)
        external
    {
        _createMatch(id, terms, seatIds, recipients, false);
    }

    /// @notice Create a lobby whose players claim and fund their own seats.
    function createOpenMatch(bytes32 id, Terms calldata terms, bytes32[] calldata seatIds) external {
        _createMatch(id, terms, seatIds, new address[](seatIds.length), true);
    }

    function _createMatch(
        bytes32 id,
        Terms calldata terms,
        bytes32[] calldata seatIds,
        address[] memory recipients,
        bool open
    ) private {
        if (paused || !resolvers[msg.sender] || terms.resolver != msg.sender) {
            revert Unauthorized();
        }
        if (
            accounts[id].status != Status.Absent || id == bytes32(0) || terms.rulesHash == bytes32(0)
                || !allowedTokens[address(terms.token)] || terms.treasury != owner() || terms.feeBps > MAX_FEE_BPS
                || terms.creatorShareBps > 9000 || (terms.creator == address(0) && terms.creatorShareBps != 0)
                || terms.fundingDeadline <= block.timestamp || terms.settlementDeadline <= terms.fundingDeadline
                || terms.settlementDeadline > block.timestamp + 7 days || seatIds.length < 2 || seatIds.length > 64
                || seatIds.length != recipients.length
        ) revert InvalidTerms();
        if (terms.royalties.length > 8) revert InvalidTerms();
        uint256 totalRoyaltyBps;
        for (uint256 i; i < terms.royalties.length; ++i) {
            if (terms.royalties[i].recipient == address(0) || terms.royalties[i].bps == 0) revert InvalidTerms();
            totalRoyaltyBps += terms.royalties[i].bps;
        }
        if (totalRoyaltyBps > 10000) revert InvalidTerms();
        for (uint256 i; i < seatIds.length; ++i) {
            if (seatIds[i] == bytes32(0) || (!open && recipients[i] == address(0)) || registeredSeat[id][seatIds[i]]) {
                revert InvalidTerms();
            }
            registeredSeat[id][seatIds[i]] = true;
            recipient[id][seatIds[i]] = recipients[i];
            seats[id].push(seatIds[i]);
        }
        openSeats[id] = open;
        accounts[id].terms = terms;
        accounts[id].status = Status.Funding;
        emit MatchCreated(id, address(terms.token), terms.rulesHash, terms.resolver);
    }

    function stake(bytes32 id, bytes32 seatId) external nonReentrant {
        _stake(id, seatId, msg.sender);
    }

    /// @notice Claim, fund and authorize a game-only key in the same transaction.
    function stakeWithController(bytes32 id, bytes32 seatId, address gameController) external nonReentrant {
        if (gameController == address(0)) revert InvalidTerms();
        _stake(id, seatId, gameController);
    }

    /// @notice Recover controls on another device without moving the seat or its funds.
    function setController(bytes32 id, bytes32 seatId, address gameController) external {
        if (recipient[id][seatId] != msg.sender || !staked[id][seatId]) revert Unauthorized();
        if (gameController == address(0)) revert InvalidTerms();
        controller[id][seatId] = gameController;
        emit ControllerAssigned(id, seatId, gameController);
    }

    function _stake(bytes32 id, bytes32 seatId, address gameController) private {
        MatchAccount storage m = _funding(id);
        _seat(id, m, seatId, msg.sender, gameController);
        if (m.terms.stake != 0) _receive(m.terms.token, m.terms.stake);
    }

    /// @notice Gasless x402 entry: the resolver relays the payer's signed USDC transfer.
    /// @dev The payer, not the relayer, owns the seat, refunds and winnings. Resolver-only, so a
    ///      copied authorization cannot be replayed here with a different seat or controller.
    function stakeWithAuthorization(
        bytes32 id,
        bytes32 seatId,
        address gameController,
        TransferAuthorization calldata auth
    ) external nonReentrant {
        MatchAccount storage m = _authorizedEntry(id, gameController, auth);
        _seat(id, m, seatId, auth.from, gameController);
        uint256 beforeBalance = m.terms.token.balanceOf(address(this));
        IERC3009(address(m.terms.token))
            .transferWithAuthorization(
                auth.from,
                address(this),
                auth.value,
                auth.validAfter,
                auth.validBefore,
                auth.nonce,
                auth.v,
                auth.r,
                auth.s
            );
        if (m.terms.token.balanceOf(address(this)) - beforeBalance != auth.value) revert InvalidDeposit();
        emit AuthorizedEntry(id, seatId, auth.from, auth.nonce, false);
    }

    /// @notice Credit an entry whose signed transfer to this contract was submitted directly to the token.
    /// @dev The signature must commit to this contract and the stake, and the token must report the nonce used.
    ///      The resolver confirms the matching transfer event before calling, because EIP-3009
    ///      cancelAuthorization also marks a nonce used without moving funds.
    function recoverAuthorizedStake(
        bytes32 id,
        bytes32 seatId,
        address gameController,
        TransferAuthorization calldata auth
    ) external nonReentrant {
        MatchAccount storage m = _authorizedEntry(id, gameController, auth);
        IERC3009 token = IERC3009(address(m.terms.token));
        if (!token.authorizationState(auth.from, auth.nonce)) revert InvalidDeposit();
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                        auth.from,
                        address(this),
                        auth.value,
                        auth.validAfter,
                        auth.validBefore,
                        auth.nonce
                    )
                )
            )
        );
        (address signer, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, auth.v, auth.r, auth.s);
        if (error != ECDSA.RecoverError.NoError || signer != auth.from) revert InvalidDeposit();
        _seat(id, m, seatId, auth.from, gameController);
        emit AuthorizedEntry(id, seatId, auth.from, auth.nonce, true);
    }

    /// @notice Gasless entry to a sponsored (zero-stake) open seat, relayed for a player-signed request.
    function claimSeatFor(bytes32 id, bytes32 seatId, address player, address gameController) external nonReentrant {
        MatchAccount storage m = _funding(id);
        _resolver(m);
        if (m.terms.stake != 0 || !openSeats[id] || player == address(0) || gameController == address(0)) {
            revert InvalidDeposit();
        }
        _seat(id, m, seatId, player, gameController);
    }

    function _authorizedEntry(bytes32 id, address gameController, TransferAuthorization calldata auth)
        private
        returns (MatchAccount storage m)
    {
        m = _funding(id);
        _resolver(m);
        if (
            m.terms.stake == 0 || auth.value != m.terms.stake || auth.from == address(0) || gameController == address(0)
        ) {
            revert InvalidDeposit();
        }
        address token = address(m.terms.token);
        if (creditedAuthorization[token][auth.from][auth.nonce]) revert InvalidDeposit();
        creditedAuthorization[token][auth.from][auth.nonce] = true;
    }

    /// @dev Assigns and accounts for a seat. Callers must move exactly `terms.stake` from `payer`.
    function _seat(bytes32 id, MatchAccount storage m, bytes32 seatId, address payer, address gameController) private {
        if (openSeats[id]) {
            if (!registeredSeat[id][seatId] || recipient[id][seatId] != address(0) || seated[id][payer]) {
                revert InvalidDeposit();
            }
            // Assignment and payment are atomic: a failed transfer leaves the seat open.
            recipient[id][seatId] = payer;
            seated[id][payer] = true;
        } else if (recipient[id][seatId] != payer || m.terms.stake == 0) {
            revert InvalidDeposit();
        }
        if (staked[id][seatId]) revert InvalidDeposit();
        staked[id][seatId] = true;
        ++m.paidSeats;
        m.prizePool += m.terms.stake;
        refundable[id][payer] += m.terms.stake;
        controller[id][seatId] = gameController;
        emit ControllerAssigned(id, seatId, gameController);
        emit Deposited(id, payer, 0, seatId, m.terms.stake);
    }

    function fundBounty(bytes32 id, uint256 amount) external nonReentrant {
        MatchAccount storage m = _funding(id);
        if (!m.terms.bounties || amount == 0) revert InvalidDeposit();
        m.prizePool += amount;
        refundable[id][msg.sender] += amount;
        _receive(m.terms.token, amount);
        emit Deposited(id, msg.sender, 1, bytes32(0), amount);
    }

    function placeBet(bytes32 id, bytes32 seatId, uint256 amount) external nonReentrant {
        MatchAccount storage m = _funding(id);
        if (!m.terms.betting || amount == 0 || recipient[id][seatId] == address(0)) revert InvalidDeposit();
        bets[id][seatId][msg.sender] += amount;
        totalBets[id][msg.sender] += amount;
        outcomePool[id][seatId] += amount;
        m.betPool += amount;
        _receive(m.terms.token, amount);
        emit Deposited(id, msg.sender, 2, seatId, amount);
    }

    /// @notice Must be confirmed BEFORE the worker deals cards or reveals observations.
    function lock(bytes32 id) external {
        MatchAccount storage m = accounts[id];
        _resolver(m);
        if (
            m.status != Status.Funding || block.timestamp >= m.terms.fundingDeadline
                || ((m.terms.stake != 0 || openSeats[id]) && m.paidSeats != seats[id].length)
        ) revert WrongPhase();
        m.status = Status.Locked;
        emit Locked(id);
    }

    function settle(bytes32 id, bytes32 winner, bytes32 resultHash) external {
        MatchAccount storage m = accounts[id];
        _resolver(m);
        if (m.status != Status.Locked || block.timestamp >= m.terms.settlementDeadline) revert WrongPhase();
        if (recipient[id][winner] == address(0) || resultHash == bytes32(0)) revert InvalidTerms();
        m.status = Status.Settled;
        m.winner = winner;
        m.resultHash = resultHash;
        uint256 prizeFee = Math.mulDiv(m.prizePool, m.terms.feeBps, 10000);
        uint256 winningShares = outcomePool[id][winner];
        // No winning bets: every spectator gets their principal back, with zero fee.
        uint256 betFee = winningShares == 0 ? 0 : Math.mulDiv(m.betPool - winningShares, m.terms.feeBps, 10000);
        m.remainingBetShares = winningShares;
        m.remainingBetPayout = m.betPool - betFee;
        claimable[address(m.terms.token)][recipient[id][winner]] += m.prizePool - prizeFee;
        uint256 creatorFee = Math.mulDiv(prizeFee + betFee, m.terms.creatorShareBps, 10000);
        uint256 royalties;
        for (uint256 i; i < m.terms.royalties.length; ++i) {
            uint256 amount = Math.mulDiv(creatorFee, m.terms.royalties[i].bps, 10000);
            royalties += amount;
            claimable[address(m.terms.token)][m.terms.royalties[i].recipient] += amount;
        }
        claimable[address(m.terms.token)][m.terms.creator] += creatorFee - royalties;
        claimable[address(m.terms.token)][m.terms.treasury] += prizeFee + betFee - creatorFee;
        emit RevenueShared(id, m.terms.creator, creatorFee, prizeFee + betFee - creatorFee);
        emit Settled(id, winner, resultHash, m.prizePool - prizeFee, prizeFee + betFee);
    }

    /// @notice Resolver can void; anyone can refund abandoned or unfilled matches after timeout.
    function voidMatch(bytes32 id) external {
        MatchAccount storage m = accounts[id];
        if (m.status != Status.Funding && m.status != Status.Locked) revert WrongPhase();
        bool expired =
            block.timestamp >= (m.status == Status.Funding ? m.terms.fundingDeadline : m.terms.settlementDeadline);
        if (!expired && msg.sender != owner() && msg.sender != m.terms.resolver) revert Unauthorized();
        m.status = Status.Voided;
        emit Voided(id);
    }

    function claimRefund(bytes32 id) external nonReentrant {
        _claimRefund(id, msg.sender);
    }

    /// @notice A relayer can pay gas to refund an agent; funds still go only to its recorded wallet.
    function claimRefundFor(bytes32 id, address beneficiary) external nonReentrant {
        _claimRefund(id, beneficiary);
    }

    function _claimRefund(bytes32 id, address beneficiary) private {
        MatchAccount storage m = accounts[id];
        if (m.status != Status.Voided) revert WrongPhase();
        uint256 amount = refundable[id][beneficiary];
        if (amount == 0) revert NothingToClaim();
        refundable[id][beneficiary] = 0;
        m.terms.token.safeTransfer(beneficiary, amount);
        emit Claimed(address(m.terms.token), beneficiary, amount);
    }

    function claimBet(bytes32 id) external nonReentrant {
        _claimBet(id, msg.sender);
    }

    function claimBetFor(bytes32 id, address beneficiary) external nonReentrant {
        _claimBet(id, beneficiary);
    }

    function _claimBet(bytes32 id, address beneficiary) private {
        MatchAccount storage m = accounts[id];
        if (m.status != Status.Settled && m.status != Status.Voided) revert WrongPhase();
        if (betClaimed[id][beneficiary]) revert NothingToClaim();
        uint256 amount;
        if (m.status == Status.Voided || outcomePool[id][m.winner] == 0) {
            amount = totalBets[id][beneficiary];
        } else {
            uint256 shares = bets[id][m.winner][beneficiary];
            if (shares == 0) revert NothingToClaim();
            // Last claimant receives rounding dust; no admin sweep of customer balances.
            amount = shares == m.remainingBetShares
                ? m.remainingBetPayout
                : Math.mulDiv(
                    shares,
                    m.betPool - Math.mulDiv(m.betPool - outcomePool[id][m.winner], m.terms.feeBps, 10000),
                    outcomePool[id][m.winner]
                );
            m.remainingBetShares -= shares;
            m.remainingBetPayout -= amount;
        }
        if (amount == 0) revert NothingToClaim();
        betClaimed[id][beneficiary] = true;
        m.terms.token.safeTransfer(beneficiary, amount);
        emit Claimed(address(m.terms.token), beneficiary, amount);
    }

    /// @notice Anyone may trigger a payout, but it always goes to the recorded beneficiary.
    function withdraw(IERC20 token, address beneficiary) external nonReentrant {
        uint256 amount = claimable[address(token)][beneficiary];
        if (amount == 0) revert NothingToClaim();
        claimable[address(token)][beneficiary] = 0;
        token.safeTransfer(beneficiary, amount);
        emit Claimed(address(token), beneficiary, amount);
    }

    function _funding(bytes32 id) private view returns (MatchAccount storage m) {
        m = accounts[id];
        if (paused || m.status != Status.Funding || block.timestamp >= m.terms.fundingDeadline) revert WrongPhase();
    }

    function _resolver(MatchAccount storage m) private view {
        if (msg.sender != m.terms.resolver || !resolvers[msg.sender]) revert Unauthorized();
    }

    function _receive(IERC20 token, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert InvalidDeposit();
    }
}
