// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import ERC20 interface
interface IERC20 {
    function mint(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

// Import DAO interface definition
interface ICharityDAO {
    function createFundsReleaseProposal(address _projectAddress) external;
}

/**
 * @title Charity Project Contract
 * @dev Child contract created by factory contract, manages a single charity project
 */
contract CharityProject {
    // Project status constants
    uint8 public constant STATUS_PENDING = 0;         // Pending review
    uint8 public constant STATUS_FUNDRAISING = 1;     // Fundraising
    uint8 public constant STATUS_PENDING_RELEASE = 2; // Pending funds release
    uint8 public constant STATUS_COMPLETED = 3;       // Completed
    uint8 public constant STATUS_REJECTED = 4;        // Rejected

    // Project basic information
    string public projectName;
    string public description;
    string public auditMaterials; // IPFS hash or other storage proof
    uint256 public targetAmount;
    uint256 public deadline;
    uint256 public raisedAmount;
    address public owner;
    address public daoAddress;
    uint8 public status;
    mapping(address => bool) public refunded;    // Refund records - tracks which addresses have received refunds

    // Governance token address
    address public governanceToken;

    // Token reward ratio (how many tokens to reward per 1 wei donated, default is 100, meaning 100 tokens for 1 ETH donated)
    uint256 public rewardRatio = 100;

    // Donation records
    mapping(address => uint256) public donations;
    address[] public donors;

    // Events
    event DonationReceived(address donor, uint256 amount);
    event TokenRewarded(address donor, uint256 amount);
    event FundsReleased(uint256 amount);
    event StatusChanged(uint8 newStatus);
    event AuditMaterialsUpdated(string newMaterials);
    event RewardRatioUpdated(uint256 newRatio);
    // Add event to record failures
    event TokenRewardFailed(address donor, uint256 amount);
    // Event definitions - added to the event declaration area at the beginning of the contract
    event RefundProcessed(address donor, uint256 amount);
    event RefundFailed(address donor, uint256 amount);

    /**
     * @dev Constructor, initializes the project
     */
    constructor(
        string memory _name,
        string memory _description,
        string memory _auditMaterials,
        uint256 _targetAmount,
        uint256 _duration,
        address _owner,
        address _daoAddress,
        address _tokenAddress
    ) {
        projectName = _name;
        description = _description;
        auditMaterials = _auditMaterials;
        targetAmount = _targetAmount;
        deadline = block.timestamp + _duration;
        owner = _owner;
        daoAddress = _daoAddress;
        status = STATUS_PENDING; // Initial status is pending review
        governanceToken = _tokenAddress; // Set governance token
    }

    // Modifier: Only DAO can call
    modifier onlyDAO() {
        require(msg.sender == daoAddress, "Only DAO can call this function");
        _;
    }

    // Modifier: Only project creator can call
    modifier onlyOwner() {
        require(msg.sender == owner, "Only project owner can call this function");
        _;
    }

    /**
     * @dev Update project status - only DAO can call
     * @param _newStatus New status
     */
    function updateStatus(uint8 _newStatus) external onlyDAO {
        status = _newStatus;
        emit StatusChanged(_newStatus);
    }

    /**
     * @dev User donation and receive token rewards
     */
    function donate() external payable {
        require(status == STATUS_FUNDRAISING, "Project is not in fundraising status");
        require(block.timestamp <= deadline, "Fundraising deadline has passed");

        // If first donation, add to donors list
        if (donations[msg.sender] == 0) {
            donors.push(msg.sender);
        }

        // Record donation
        donations[msg.sender] += msg.value;
        raisedAmount += msg.value;

        // Distribute token rewards
        if (governanceToken != address(0)) {
            uint256 tokenReward = msg.value * rewardRatio / 1 ether;
            // Calculate complete token amount (including 18 decimal places)
            uint256 tokenRewardWithDecimals = tokenReward * 10**18;
            try IERC20(governanceToken).mint(msg.sender, tokenRewardWithDecimals) {
                emit TokenRewarded(msg.sender, tokenReward);
            } catch {
                // If minting fails (possibly because token contract doesn't support mint or caller lacks permission), don't distribute rewards
                // But don't block the donation process
                // Can add an event to record the failure
                emit TokenRewardFailed(msg.sender, tokenReward);
            }
        }

        emit DonationReceived(msg.sender, msg.value);
    }

    /**
     * @dev Update audit materials - used when requesting funds release
     * @param _newMaterials New audit materials
     */
    function updateAuditMaterials(string memory _newMaterials) external onlyOwner {
        auditMaterials = _newMaterials;
        emit AuditMaterialsUpdated(_newMaterials);
    }

    /**
     * @dev Request funds release - called by project owner
     */
    function requestFundsRelease() external onlyOwner {
        require(status == STATUS_FUNDRAISING, "Project is not in fundraising status");
        status = STATUS_PENDING_RELEASE;
        emit StatusChanged(STATUS_PENDING_RELEASE);

        // Call DAO contract to create funds release proposal
        ICharityDAO(daoAddress).createFundsReleaseProposal(address(this));
    }

    /**
     * @dev Release funds to project owner - only DAO can call
     */
    function releaseFunds() external onlyDAO {
        require(status == STATUS_PENDING_RELEASE, "Project is not in pending release status");

        uint256 amount = address(this).balance;
        (bool success, ) = owner.call{value: amount}("");
        require(success, "Transfer failed");

        status = STATUS_COMPLETED;
        emit FundsReleased(amount);
        emit StatusChanged(STATUS_COMPLETED);
    }

    /**
     * @dev Refund funds to donors - only DAO can call (when project is rejected)
     */
    /**
 * @dev Refund funds to all donors - only DAO can call (when project is rejected)
 * Batch refund to all donors
 */
    function refundAll() external onlyDAO {
        require(status == STATUS_REJECTED ,
            "Project is not in refundable or rejected status");

        // Record total amount successfully refunded
        uint256 totalRefunded = 0;

        for (uint i = 0; i < donors.length; i++) {
            address donor = donors[i];
            uint256 amount = donations[donor];

            if (amount > 0 && !refunded[donor]) {
                // Mark as refunded to prevent reentrancy attacks
                refunded[donor] = true;

                // Send refund
                (bool success, ) = donor.call{value: amount}("");

                if (success) {
                    // Refund successful, update statistics
                    totalRefunded += amount;
                    emit RefundProcessed(donor, amount);
                } else {
                    // Refund failed, restore state
                    refunded[donor] = false;
                    emit RefundFailed(donor, amount);
                }
            }
        }

        // Update project raised amount
        if (totalRefunded > 0) {
            raisedAmount -= totalRefunded;
        }
    }

    /**
     * @dev Get project details
     */
    function getProjectDetails() external view returns (
        string memory,
        string memory,
        string memory,
        uint256,
        uint256,
        uint256,
        address,
        uint8,
        address,      // Governance token address
        uint256       // Token reward ratio
    ) {
        return (
            projectName,
            description,
            auditMaterials,
            targetAmount,
            deadline,
            raisedAmount,
            owner,
            status,
            governanceToken,
            rewardRatio
        );
    }

    /**
     * @dev Get all donors
     */
    function getDonors() external view returns (address[] memory) {
        return donors;
    }

    /**
     * @dev Update governance token address - only DAO can call
     */
    function updateGovernanceToken(address _newTokenAddress) external onlyDAO {
        governanceToken = _newTokenAddress;
    }

    /**
     * @dev Update token reward ratio - only DAO can call
     * @param _newRatio New reward ratio (how many tokens to reward per 1 ETH donated)
     */
    function updateRewardRatio(uint256 _newRatio) external onlyDAO {
        rewardRatio = _newRatio;
        emit RewardRatioUpdated(_newRatio);
    }
}