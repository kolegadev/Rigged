// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PredictionMarket
 * @dev Smart contract for car auction prediction markets on Polygon
 * 
 * Features:
 * - Binary and multi-outcome prediction markets
 * - USDC-based settlement
 * - Role-based access control for admins and oracles
 * - Emergency pause functionality
 * - Automated payout calculation
 * 
 * This contract handles the onchain settlement of offchain prediction markets.
 * Market creation, order matching, and trading happens offchain for cost efficiency.
 */
contract PredictionMarket is AccessControl, ReentrancyGuard, Pausable {
    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // USDC token contract
    IERC20 public immutable USDC;

    // Market states
    enum MarketState { Draft, Trading, Closed, Resolved, Cancelled }

    // Market types
    enum MarketType { Threshold, Bucket }

    // Market structure
    struct Market {
        uint256 id;
        string title;
        string description;
        MarketType marketType;
        MarketState state;
        uint256 resolutionValue; // Final auction price in USD (6 decimals)
        uint256[] outcomeValues; // Threshold value or bucket ranges
        uint256 totalStaked;
        uint256 resolutionTimestamp;
        string evidenceIPFSHash; // Link to resolution evidence
    }

    // User position in a market
    struct Position {
        uint256 marketId;
        uint256 outcomeIndex;
        uint256 shares;
        uint256 averagePrice; // Price paid per share (6 decimals)
        bool redeemed;
    }

    // Storage
    mapping(uint256 => Market) public markets;
    mapping(address => mapping(uint256 => Position[])) public userPositions; // user => marketId => positions
    mapping(uint256 => mapping(uint256 => uint256)) public outcomeTotalShares; // marketId => outcomeIndex => totalShares

    uint256 public nextMarketId = 1;
    uint256 public constant RESOLUTION_DELAY = 1 hours; // Minimum time before resolution can be executed
    uint256 public platformFeeRate = 200; // 2% (basis points)
    address public feeRecipient;

    // Events
    event MarketCreated(
        uint256 indexed marketId,
        string title,
        MarketType marketType,
        uint256[] outcomeValues
    );
    
    event MarketResolved(
        uint256 indexed marketId,
        uint256 resolutionValue,
        uint256[] winningOutcomes,
        string evidenceHash
    );

    event PositionMinted(
        address indexed user,
        uint256 indexed marketId,
        uint256 outcomeIndex,
        uint256 shares,
        uint256 price
    );

    event PositionRedeemed(
        address indexed user,
        uint256 indexed marketId,
        uint256 outcomeIndex,
        uint256 shares,
        uint256 payout
    );

    event MarketCancelled(uint256 indexed marketId, string reason);

    constructor(address _usdcToken, address _admin, address _feeRecipient) {
        require(_usdcToken != address(0), "Invalid USDC token address");
        require(_admin != address(0), "Invalid admin address");
        require(_feeRecipient != address(0), "Invalid fee recipient address");

        USDC = IERC20(_usdcToken);
        feeRecipient = _feeRecipient;

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(ORACLE_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    /**
     * @dev Create a new prediction market
     * @param title Market title
     * @param description Market description
     * @param marketType Type of market (Threshold or Bucket)
     * @param outcomeValues Threshold value or bucket ranges (in USD with 6 decimals)
     */
    function createMarket(
        string calldata title,
        string calldata description,
        MarketType marketType,
        uint256[] calldata outcomeValues
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(bytes(title).length > 0, "Title cannot be empty");
        require(outcomeValues.length > 0, "Must have at least one outcome");

        if (marketType == MarketType.Threshold) {
            require(outcomeValues.length == 1, "Threshold market must have exactly one value");
        } else {
            require(outcomeValues.length >= 2, "Bucket market must have at least 2 buckets");
        }

        uint256 marketId = nextMarketId++;

        markets[marketId] = Market({
            id: marketId,
            title: title,
            description: description,
            marketType: marketType,
            state: MarketState.Draft,
            resolutionValue: 0,
            outcomeValues: outcomeValues,
            totalStaked: 0,
            resolutionTimestamp: 0,
            evidenceIPFSHash: ""
        });

        emit MarketCreated(marketId, title, marketType, outcomeValues);
        return marketId;
    }

    /**
     * @dev Mint position shares for users (called by offchain trading system)
     * @param user User address
     * @param marketId Market ID
     * @param outcomeIndex Index of the outcome
     * @param shares Number of shares to mint
     * @param price Price per share (6 decimals)
     */
    function mintPosition(
        address user,
        uint256 marketId,
        uint256 outcomeIndex,
        uint256 shares,
        uint256 price
    ) external onlyRole(ADMIN_ROLE) nonReentrant whenNotPaused {
        require(user != address(0), "Invalid user address");
        require(markets[marketId].state == MarketState.Trading, "Market not trading");
        require(shares > 0, "Shares must be positive");
        require(price > 0, "Price must be positive");

        Market storage market = markets[marketId];
        uint256 numOutcomes = market.marketType == MarketType.Threshold ? 2 : market.outcomeValues.length;
        require(outcomeIndex < numOutcomes, "Invalid outcome index");

        // Calculate total cost
        uint256 totalCost = shares * price;
        market.totalStaked += totalCost;

        // Update tracking
        outcomeTotalShares[marketId][outcomeIndex] += shares;

        // Add to user's positions
        userPositions[user][marketId].push(Position({
            marketId: marketId,
            outcomeIndex: outcomeIndex,
            shares: shares,
            averagePrice: price,
            redeemed: false
        }));

        emit PositionMinted(user, marketId, outcomeIndex, shares, price);
    }

    /**
     * @dev Resolve a market with the final auction price
     * @param marketId Market ID
     * @param resolutionValue Final auction price (USD with 6 decimals)
     * @param evidenceHash IPFS hash of resolution evidence
     */
    function resolveMarket(
        uint256 marketId,
        uint256 resolutionValue,
        string calldata evidenceHash
    ) external onlyRole(ORACLE_ROLE) nonReentrant {
        Market storage market = markets[marketId];
        require(market.state == MarketState.Closed, "Market not closed");
        require(resolutionValue > 0, "Resolution value must be positive");
        require(bytes(evidenceHash).length > 0, "Evidence hash required");

        market.resolutionValue = resolutionValue;
        market.evidenceIPFSHash = evidenceHash;
        market.state = MarketState.Resolved;
        market.resolutionTimestamp = block.timestamp;

        // Determine winning outcomes
        uint256[] memory winningOutcomes = determineWinningOutcomes(marketId, resolutionValue);

        emit MarketResolved(marketId, resolutionValue, winningOutcomes, evidenceHash);
    }

    /**
     * @dev Redeem winnings for resolved market positions
     * @param marketId Market ID
     */
    function redeemPositions(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        require(market.state == MarketState.Resolved, "Market not resolved");
        require(
            block.timestamp >= market.resolutionTimestamp + RESOLUTION_DELAY,
            "Resolution delay not elapsed"
        );

        Position[] storage positions = userPositions[msg.sender][marketId];
        require(positions.length > 0, "No positions to redeem");

        uint256 totalPayout = 0;

        for (uint256 i = 0; i < positions.length; i++) {
            Position storage position = positions[i];
            
            if (position.redeemed) continue;

            if (isWinningOutcome(marketId, position.outcomeIndex)) {
                // Calculate payout based on total pool and winning share
                uint256 payout = calculatePayout(marketId, position.outcomeIndex, position.shares);
                totalPayout += payout;

                emit PositionRedeemed(
                    msg.sender,
                    marketId,
                    position.outcomeIndex,
                    position.shares,
                    payout
                );
            }

            position.redeemed = true;
        }

        if (totalPayout > 0) {
            // Deduct platform fee
            uint256 fee = (totalPayout * platformFeeRate) / 10000;
            uint256 netPayout = totalPayout - fee;

            // Transfer tokens
            if (fee > 0) {
                require(USDC.transfer(feeRecipient, fee), "Fee transfer failed");
            }
            require(USDC.transfer(msg.sender, netPayout), "Payout transfer failed");
        }
    }

    /**
     * @dev Cancel a market and allow refunds
     * @param marketId Market ID
     * @param reason Reason for cancellation
     */
    function cancelMarket(
        uint256 marketId,
        string calldata reason
    ) external onlyRole(ADMIN_ROLE) {
        Market storage market = markets[marketId];
        require(
            market.state == MarketState.Draft || market.state == MarketState.Trading,
            "Cannot cancel resolved market"
        );

        market.state = MarketState.Cancelled;
        emit MarketCancelled(marketId, reason);
    }

    /**
     * @dev Emergency pause
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // View functions

    /**
     * @dev Check if an outcome index is winning for a resolved market
     */
    function isWinningOutcome(uint256 marketId, uint256 outcomeIndex) public view returns (bool) {
        Market storage market = markets[marketId];
        require(market.state == MarketState.Resolved, "Market not resolved");

        if (market.marketType == MarketType.Threshold) {
            // For threshold: outcome 0 = "No", outcome 1 = "Yes"
            bool exceedsThreshold = market.resolutionValue >= market.outcomeValues[0];
            return (outcomeIndex == 1 && exceedsThreshold) || (outcomeIndex == 0 && !exceedsThreshold);
        } else {
            // For bucket markets: check if resolution value falls in this bucket
            if (outcomeIndex >= market.outcomeValues.length) return false;
            
            uint256 bucketMin = outcomeIndex == 0 ? 0 : market.outcomeValues[outcomeIndex - 1];
            uint256 bucketMax = market.outcomeValues[outcomeIndex];
            
            return market.resolutionValue >= bucketMin && 
                   (outcomeIndex == market.outcomeValues.length - 1 || market.resolutionValue < bucketMax);
        }
    }

    /**
     * @dev Calculate payout for a winning position
     */
    function calculatePayout(
        uint256 marketId,
        uint256 outcomeIndex,
        uint256 shares
    ) public view returns (uint256) {
        Market storage market = markets[marketId];
        require(market.state == MarketState.Resolved, "Market not resolved");
        require(isWinningOutcome(marketId, outcomeIndex), "Not a winning outcome");

        uint256 totalWinningShares = 0;
        uint256 numOutcomes = market.marketType == MarketType.Threshold ? 2 : market.outcomeValues.length;

        // Sum all winning shares across outcomes
        for (uint256 i = 0; i < numOutcomes; i++) {
            if (isWinningOutcome(marketId, i)) {
                totalWinningShares += outcomeTotalShares[marketId][i];
            }
        }

        if (totalWinningShares == 0) return 0;

        // Proportional share of the total pool
        return (market.totalStaked * shares) / totalWinningShares;
    }

    /**
     * @dev Get all winning outcome indices for a market
     */
    function determineWinningOutcomes(uint256 marketId, uint256 resolutionValue) 
        internal 
        view 
        returns (uint256[] memory) 
    {
        Market storage market = markets[marketId];
        
        if (market.marketType == MarketType.Threshold) {
            uint256[] memory outcomes = new uint256[](1);
            outcomes[0] = resolutionValue >= market.outcomeValues[0] ? 1 : 0;
            return outcomes;
        } else {
            // Find which bucket the resolution value falls into
            for (uint256 i = 0; i < market.outcomeValues.length; i++) {
                uint256 bucketMin = i == 0 ? 0 : market.outcomeValues[i - 1];
                uint256 bucketMax = market.outcomeValues[i];
                
                if (resolutionValue >= bucketMin && 
                    (i == market.outcomeValues.length - 1 || resolutionValue < bucketMax)) {
                    uint256[] memory outcomes = new uint256[](1);
                    outcomes[0] = i;
                    return outcomes;
                }
            }
            
            // Fallback to highest bucket if value exceeds all ranges
            uint256[] memory outcomes = new uint256[](1);
            outcomes[0] = market.outcomeValues.length - 1;
            return outcomes;
        }
    }

    /**
     * @dev Get user's positions for a market
     */
    function getUserPositions(address user, uint256 marketId) 
        external 
        view 
        returns (Position[] memory) 
    {
        return userPositions[user][marketId];
    }

    /**
     * @dev Set platform fee rate (basis points)
     */
    function setPlatformFeeRate(uint256 newRate) external onlyRole(ADMIN_ROLE) {
        require(newRate <= 1000, "Fee rate too high"); // Max 10%
        platformFeeRate = newRate;
    }

    /**
     * @dev Set fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyRole(ADMIN_ROLE) {
        require(newRecipient != address(0), "Invalid recipient address");
        feeRecipient = newRecipient;
    }
}