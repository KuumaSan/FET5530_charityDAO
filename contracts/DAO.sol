// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Charity DAO Contract
 * @dev Manages DAO members, voting processes, and project reviews
 */


contract CharityDAO {
    // DAO member management
    mapping(address => bool) public members;
    uint256 public memberCount;
    uint256 public requiredQuorum; // Required quorum
    uint256 public requiredMajority; // Required majority percentage (e.g., 51 means 51%)
    address public admin;
    address[] public memberAddresses; // Array storing all member addresses

    // Project status constants
    uint8 public constant STATUS_PENDING = 0;         // Pending review
    uint8 public constant STATUS_FUNDRAISING = 1;     // Fundraising
    uint8 public constant STATUS_PENDING_RELEASE = 2; // Pending funds release
    uint8 public constant STATUS_COMPLETED = 3;       // Completed
    uint8 public constant STATUS_REJECTED = 4;        // Rejected
    uint256 public constant PRECISION_FACTOR = 100;


    // Vote options
    enum VoteOption {
        None,
        Approve,
        Reject
    }

    // Proposal types
    enum ProposalType {
        ProjectApproval,  // Project approval
        FundsRelease      // Funds release
    }

    // Parameters for modifying voting weight
    address public governanceToken;
    uint256 public baseVotingWeight = 1;     // Base voting weight
    uint256 public maxVotingWeight = 3;      // Maximum voting weight (1 base + max 2 additional)
    uint256 public tokenWeightThreshold = 10000 * 10**18; // Token amount needed to reach maximum weight


    // Proposal structure
    struct Proposal {
        uint256 id;
        address projectAddress;
        string projectName;
        address projectOwner;
        uint256 createdAt;
        uint256 votingDeadline;
        ProposalType proposalType;
        uint256 weightedYesVotes; // Weighted yes votes
        uint256 weightedNoVotes;  // Weighted no votes
        bool executed;
        bool passed;
        mapping(address => VoteOption) votes;
        mapping(address => uint256) voteWeights; // Record each voter's weight
    }

    // Project registration structure
    struct RegisteredProject {
        address projectAddress;
        string name;
        address owner;
        bool exists;


        uint256 approvalProposalId; // Project approval proposal ID
        uint256 fundsReleaseProposalId; // Funds release proposal ID
    }

    // Store proposals
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    // Store registered projects
    mapping(address => RegisteredProject) public registeredProjects;
    address[] public projectAddresses;

    // Events
    event MemberAdded(address member);
    event MemberRemoved(address member);
    event ProjectRegistered(address projectAddress, string name, address owner);
    event ProposalCreated(uint256 proposalId, address projectAddress, ProposalType proposalType);
    event Voted(uint256 proposalId, address voter, bool approved, uint256 weight);
    event ProposalExecuted(uint256 proposalId, bool passed);
    event VotingWeightUpdated(uint256 baseWeight, uint256 maxWeight, uint256 threshold);
    event DebugWeight(string message, uint256 value);
    event RefundsTriggered(address projectAddress);
    event RefundsFailed(address projectAddress);

    // Constructor
    constructor(address[] memory _initialMembers, uint256 _requiredQuorum, uint256 _requiredMajority, address _governanceToken) {
        require(_requiredMajority > 50 && _requiredMajority <= 100, "Majority must be between 51 and 100");

        admin = msg.sender;
        requiredQuorum = _requiredQuorum;
        requiredMajority = _requiredMajority;
        governanceToken = _governanceToken;

        // Add initial members
        for (uint i = 0; i < _initialMembers.length; i++) {
            _addMember(_initialMembers[i]);
        }
    }

    // Modifier: Admin only
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }

    // Modifier: Member only
    modifier onlyMember() {
        require(members[msg.sender], "Only DAO members can call this function");
        _;
    }

    // Modifier: Registered project only
    modifier registeredProjectOnly(address _projectAddress) {
        require(registeredProjects[_projectAddress].exists, "Project not registered");
        _;
    }

    // Internal function: Add member
    function _addMember(address _member) internal {
        if (!members[_member]) {
            members[_member] = true;
            memberCount++;
            memberAddresses.push(_member); // Add to array
            emit MemberAdded(_member);
        }
    }

    /**
     * @dev Add DAO member
     * @param _member New member address
     */
    function addMember(address _member) external onlyAdmin {
        _addMember(_member);
    }

    /**
     * @dev Remove DAO member
     * @param _member Member address
     */
    function removeMember(address _member) external onlyAdmin {
        require(members[_member], "Address is not a member");
        members[_member] = false;
        memberCount--;
        // Remove member from array
        for (uint256 i = 0; i < memberAddresses.length; i++) {
            if (memberAddresses[i] == _member) {
                // Replace the element to be deleted with the last element, then delete the last element
                // This method doesn't preserve array order, but saves gas
                memberAddresses[i] = memberAddresses[memberAddresses.length - 1];
                memberAddresses.pop();
                break;
            }
        }
        emit MemberRemoved(_member);
    }

    /**
     * @dev Modify voting parameters
     */
    function updateVotingParams(uint256 _requiredQuorum, uint256 _requiredMajority) external onlyAdmin {
        require(_requiredMajority > 50 && _requiredMajority <= 100, "Majority must be between 51 and 100");
        requiredQuorum = _requiredQuorum;
        requiredMajority = _requiredMajority;
    }

    /**
     * @dev Register new project - called by factory contract
     */
    function registerProject(address _projectAddress, string memory _name, address _owner) external {
        require(!registeredProjects[_projectAddress].exists, "Project already registered");

        // Record project information
        registeredProjects[_projectAddress] = RegisteredProject({
            projectAddress: _projectAddress,
            name: _name,
            owner: _owner,
            exists: true,
            approvalProposalId: 0,
            fundsReleaseProposalId: 0
        });

        projectAddresses.push(_projectAddress);

        // Automatically create project approval proposal
        uint256 proposalId = _createProposal(_projectAddress, _name, _owner, ProposalType.ProjectApproval);
        registeredProjects[_projectAddress].approvalProposalId = proposalId;

        emit ProjectRegistered(_projectAddress, _name, _owner);
    }

    /**
     * @dev Create proposal (internal function)
     */
    function _createProposal(
        address _projectAddress,
        string memory _projectName,
        address _projectOwner,
        ProposalType _type
    ) internal returns (uint256) {
        uint256 proposalId = proposalCount++;
        Proposal storage newProposal = proposals[proposalId];

        newProposal.id = proposalId;
        newProposal.projectAddress = _projectAddress;
        newProposal.projectName = _projectName;
        newProposal.projectOwner = _projectOwner;
        newProposal.createdAt = block.timestamp;
        newProposal.votingDeadline = block.timestamp + 7 days; // Default 7-day voting period
        newProposal.proposalType = _type;
        newProposal.executed = false;

        emit ProposalCreated(proposalId, _projectAddress, _type);

        return proposalId;
    }

    /**
     * @dev Create funds release proposal
     * @param _projectAddress Project address
     */
    function createFundsReleaseProposal(address _projectAddress)
    external
    registeredProjectOnly(_projectAddress)
    {
        uint256 beforeProposalCount = proposalCount;
        // Verify project status is pending release
        // This requires calling the project contract's status query
        (,,,,,,,uint8 status,,) = ICharityProject(_projectAddress).getProjectDetails();
        require(status == STATUS_PENDING_RELEASE, "Project is not in pending release status");

        // Ensure project doesn't have an active funds release proposal
        require(registeredProjects[_projectAddress].fundsReleaseProposalId == 0 ||
        proposals[registeredProjects[_projectAddress].fundsReleaseProposalId].executed,
            "There is already an active funds release proposal");

        // Get project information
        RegisteredProject storage project = registeredProjects[_projectAddress];

        // Create new funds release proposal
        uint256 proposalId = _createProposal(
            _projectAddress,
            project.name,
            project.owner,
            ProposalType.FundsRelease
        );

        assert(proposalCount > beforeProposalCount);
        // Update project's funds release proposal ID
        project.fundsReleaseProposalId = proposalId;
    }

    /**
     * @dev Vote - modified to support weighted voting
     * @param _proposalId Proposal ID
     * @param _approve Whether to approve
     */
    function vote(uint256 _proposalId, bool _approve) external onlyMember {

        // First check if proposal exists
        require(_proposalId < proposalCount, "Proposal does not exist");

        Proposal storage proposal = proposals[_proposalId];

        require(block.timestamp < proposal.votingDeadline, "Voting period has ended");
        require(!proposal.executed, "Proposal already executed");
        require(proposal.votes[msg.sender] == VoteOption.None, "Member already voted");

        // Calculate voter's weight
        uint256 voterWeight = calculateVotingWeight(msg.sender);
        proposal.voteWeights[msg.sender] = voterWeight;

        if (_approve) {
            proposal.weightedYesVotes += voterWeight;
            proposal.votes[msg.sender] = VoteOption.Approve;
        } else {
            proposal.weightedNoVotes += voterWeight;
            proposal.votes[msg.sender] = VoteOption.Reject;
        }

        emit Voted(_proposalId, msg.sender, _approve, voterWeight);

        // If quorum and majority requirements are met, automatically execute
        if (_canExecuteProposal(proposal)) {
            _executeProposal(_proposalId);
        }
    }


    /**
     * @dev Check if proposal can be executed - modified to use weighted voting
     */
    function _canExecuteProposal(Proposal storage proposal) internal view returns (bool) {
        // Calculate total possible voting weight - note that calculateVotingWeight now returns a value multiplied by PRECISION_FACTOR
        uint256 totalPossibleWeight = 0;

        // Use member array to calculate total weight
        for (uint256 i = 0; i < memberAddresses.length; i++) {
            address memberAddr = memberAddresses[i];
            if (members[memberAddr]) { // Confirm it's a valid member
                totalPossibleWeight += calculateVotingWeight(memberAddr);
            }
        }

        uint256 totalVotedWeight = proposal.weightedYesVotes + proposal.weightedNoVotes;

        // Check if quorum is reached (based on weight)
        // Note: requiredQuorum is interpreted here as member proportion, so no need to multiply by PRECISION_FACTOR
        // Prevent division by zero - check memberCount
        if (memberCount == 0) {
            return false; // No members, can't reach quorum
        }
        uint256 quorumWeight = (totalPossibleWeight * requiredQuorum) / memberCount;
        if (totalVotedWeight < quorumWeight) {
            return false; // Quorum not reached
        }

        // Prevent division by zero - check totalPossibleWeight
        if (totalPossibleWeight == 0) {
            return false; // No possible weight, can't reach majority
        }

        // Determine if proposal result can be decided
        // 1. Yes vote weight has reached majority - can execute and pass
        // No need to modify here, as the weights in percentage calculation already include precision factor, which will cancel out
        if ((proposal.weightedYesVotes * 100) / totalPossibleWeight >= requiredMajority) {
            return true;
        }

        // 2. Check if no votes have reached majority - can execute but not pass
        if ((proposal.weightedNoVotes * 100) / totalPossibleWeight > (100 - requiredMajority)) {
            return true;
        }

        return false;
    }


    /**
 * @dev Execute proposal (internal function) - modified to use weighted voting, supports decimal point weights
 */
    function _executeProposal(uint256 _proposalId) internal {
        Proposal storage proposal = proposals[_proposalId];

        require(!proposal.executed, "Proposal already executed");

        // Calculate total possible weight
        uint256 totalPossibleWeight = 0;
        for (uint256 i = 0; i < memberAddresses.length; i++) {
            address memberAddr = memberAddresses[i];
            if (members[memberAddr]) {
                totalPossibleWeight += calculateVotingWeight(memberAddr);
            }
        }

        // Check if proposal can pass
        bool canPass = (proposal.weightedYesVotes * 100) / totalPossibleWeight >= requiredMajority;

        // Check if proposal definitely cannot pass
        bool canFail = (proposal.weightedNoVotes * 100) / totalPossibleWeight > (100 - requiredMajority);

        // If result is determined (can pass or definitely cannot pass), execute proposal
        if (canPass || canFail) {
            proposal.passed = canPass;
            proposal.executed = true;

            // Execute actions based on proposal type and pass status
            if (proposal.passed) {
                if (proposal.proposalType == ProposalType.ProjectApproval) {
                    ICharityProject(proposal.projectAddress).updateStatus(STATUS_FUNDRAISING);
                } else if (proposal.proposalType == ProposalType.FundsRelease) {
                    ICharityProject(proposal.projectAddress).releaseFunds();
                }
            } else {
                if (proposal.proposalType == ProposalType.ProjectApproval) {
                    ICharityProject(proposal.projectAddress).updateStatus(STATUS_REJECTED);
                } else if (proposal.proposalType == ProposalType.FundsRelease) {
                    // Set status to rejected instead of returning to fundraising
                    ICharityProject(proposal.projectAddress).updateStatus(STATUS_REJECTED);
                    // Try refunding
                    try ICharityProject(proposal.projectAddress).refundAll() {
                        emit RefundsTriggered(proposal.projectAddress);
                    } catch {
                        emit RefundsFailed(proposal.projectAddress);
                    }
                }
            }

            emit ProposalExecuted(_proposalId, proposal.passed);
        }
    }


    /**
     * @dev Manually execute proposal - can be called after voting period ends
     */
    function executeProposal(uint256 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];

        require(!proposal.executed, "Proposal already executed");
        require(block.timestamp >= proposal.votingDeadline, "Voting period not ended yet");

        _executeProposal(_proposalId);
    }

    /**
 * @dev Helper function for calculating square root
 */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        uint256 y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }

        return y;
    }

/**
 * @dev Calculate voting weight
 * Uses square root function, ensuring weight increases with token amount but at a diminishing rate
 */
    function calculateVotingWeight(address _voter) public view returns (uint256) {
        if (!members[_voter]) {
            return 0; // Non-members have no voting rights
        }

        // Base weight × precision factor (e.g., 100)
        uint256 baseWeight = baseVotingWeight * 100;

        // If no token address is set, return base weight directly
        if (governanceToken == address(0)) {
            return baseWeight;
        }

        uint256 tokenBalance = 0;
        (bool success, bytes memory data) = governanceToken.staticcall(
            abi.encodeWithSignature("balanceOf(address)", _voter)
        );

        if (success && data.length >= 32) {
            tokenBalance = abi.decode(data, (uint256));
        }

        // If no tokens, only base weight
        if (tokenBalance == 0) {
            return baseWeight;
        }

        // Improved non-linear weight calculation, preserving decimal places
        uint256 normalizedBalance = (tokenBalance * 10000) / tokenWeightThreshold;
        if (normalizedBalance > 10000) normalizedBalance = 10000;

        // Use precise calculation to preserve decimal places
        uint256 sqrtValue = sqrt(normalizedBalance * 100); // Increase precision
        uint256 maxAdditionalWeight = (maxVotingWeight - baseVotingWeight) * 100;
        uint256 additionalWeight = (maxAdditionalWeight * sqrtValue) / 1000; // Adjust divisor to match precision
        uint256 finalWeight = baseWeight + additionalWeight;

        return finalWeight; // Final weight is multiplied by 100
    }

    /**
     * @dev Get proposal information - modified return values to include weighted votes
     */
    function getProposalInfo(uint256 _proposalId) external view returns (
        address projectAddress,
        string memory projectName,
        address projectOwner,
        uint256 createdAt,
        uint256 votingDeadline,
        ProposalType proposalType,
        uint256 weightedYesVotes,
        uint256 weightedNoVotes,
        bool executed,
        bool passed
    ) {
        Proposal storage proposal = proposals[_proposalId];

        return (
            proposal.projectAddress,
            proposal.projectName,
            proposal.projectOwner,
            proposal.createdAt,
            proposal.votingDeadline,
            proposal.proposalType,
            proposal.weightedYesVotes,
            proposal.weightedNoVotes,
            proposal.executed,
            proposal.passed
        );
    }

    /**
     * @dev Get member vote choice
     */
    function getMemberVote(uint256 _proposalId, address _member) external view returns (VoteOption) {
        return proposals[_proposalId].votes[_member];
    }

    /**
     * @dev Get member's voting weight for a proposal
     */
    function getMemberVoteWeight(uint256 _proposalId, address _member) external view returns (uint256) {
        return proposals[_proposalId].voteWeights[_member];
    }

    /**
     * @dev Get current member's voting weight
     */
    function getMyVotingWeight() external view returns (uint256) {
        return calculateVotingWeight(msg.sender);
    }

    /**
     * @dev Get all pending proposals
     */
    function getPendingProposals() external view returns (uint256[] memory) {
        uint256 count = 0;

        // First count the number of pending proposals
        for (uint256 i = 0; i < proposalCount; i++) {
            if (!proposals[i].executed) {
                count++;
            }
        }

        // Create result array
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;

        // Fill result array
        for (uint256 i = 0; i < proposalCount; i++) {
            if (!proposals[i].executed) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    /**
     * @dev Get project count
     */
    function getProjectCount() external view returns (uint256) {
        return projectAddresses.length;
    }

    /**
     * @dev Get project list
     */
    function getProjects(uint256 _start, uint256 _limit) external view returns (address[] memory) {
        require(_start < projectAddresses.length, "Start index out of bounds");

        uint256 end = _start + _limit;
        if (end > projectAddresses.length) {
            end = projectAddresses.length;
        }

        uint256 size = end - _start;
        address[] memory result = new address[](size);

        for (uint256 i = 0; i < size; i++) {
            result[i] = projectAddresses[_start + i];
        }

        return result;
    }
}

// Interface declaration for interacting with CharityProject contract
interface ICharityProject {
    function updateStatus(uint8 _newStatus) external;
    function releaseFunds() external;
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
    );
    function refundAll() external;
    function enableRefunds() external;
}