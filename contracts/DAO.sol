// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title 慈善DAO合约
 * @dev 管理DAO成员、投票流程和项目审核
 */

contract CharityDAO {
    // DAO成员管理
    mapping(address => bool) public members;
    uint256 public memberCount;
    uint256 public requiredQuorum; // 所需法定人数
    uint256 public requiredMajority; // 所需多数票百分比 (例如: 51 表示51%)
    address public admin;

    // 项目状态常量
    uint8 public constant STATUS_PENDING = 0;         // 待审核
    uint8 public constant STATUS_FUNDRAISING = 1;     // 募捐中
    uint8 public constant STATUS_PENDING_RELEASE = 2; // 待释放资金
    uint8 public constant STATUS_COMPLETED = 3;       // 已完成
    uint8 public constant STATUS_REJECTED = 4;        // 已拒绝
    uint256 public constant PRECISION_FACTOR = 100;

    // 投票选项
    enum VoteOption {
        None,
        Approve,
        Reject
    }

    // 提案类型
    enum ProposalType {
        ProjectApproval,  // 项目审批
        FundsRelease      // 资金释放
    }

    // 修改投票权重相关参数
    address public governanceToken;
    uint256 public baseVotingWeight = 1;     // 基础投票权重
    uint256 public maxVotingWeight = 3;      // 最大投票权重（1基础 + 最多2额外）
    uint256 public tokenWeightThreshold = 10000 * 10**18; // 达到最大权重所需的代币数量


    // 提案结构
    struct Proposal {
        uint256 id;
        address projectAddress;
        string projectName;
        address projectOwner;
        uint256 createdAt;
        uint256 votingDeadline;
        ProposalType proposalType;
        uint256 weightedYesVotes; // 加权赞成票
        uint256 weightedNoVotes;  // 加权反对票
        bool executed;
        bool passed;
        mapping(address => VoteOption) votes;
        mapping(address => uint256) voteWeights; // 记录每个投票者的权重
    }

    // 项目注册结构
    struct RegisteredProject {
        address projectAddress;
        string name;
        address owner;
        bool exists;


        uint256 approvalProposalId; // 项目审批提案ID
        uint256 fundsReleaseProposalId; // 资金释放提案ID
    }

    // 存储提案
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    // 存储注册的项目
    mapping(address => RegisteredProject) public registeredProjects;
    address[] public projectAddresses;

    // 事件
    event MemberAdded(address member);
    event MemberRemoved(address member);
    event ProjectRegistered(address projectAddress, string name, address owner);
    event ProposalCreated(uint256 proposalId, address projectAddress, ProposalType proposalType);
    event Voted(uint256 proposalId, address voter, bool approved, uint256 weight);
    event ProposalExecuted(uint256 proposalId, bool passed);
    event VotingWeightUpdated(uint256 baseWeight, uint256 maxWeight, uint256 threshold);

    // 构造函数
    constructor(address[] memory _initialMembers, uint256 _requiredQuorum, uint256 _requiredMajority, address _governanceToken) {
        require(_requiredMajority > 50 && _requiredMajority <= 100, "Majority must be between 51 and 100");

        admin = msg.sender;
        requiredQuorum = _requiredQuorum;
        requiredMajority = _requiredMajority;
        governanceToken = _governanceToken;

        // 添加初始成员
        for (uint i = 0; i < _initialMembers.length; i++) {
            _addMember(_initialMembers[i]);
        }
    }

    // 修饰器：仅管理员
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }

    // 修饰器：仅成员
    modifier onlyMember() {
        require(members[msg.sender], "Only DAO members can call this function");
        _;
    }

    // 修饰器：已注册的项目
    modifier registeredProjectOnly(address _projectAddress) {
        require(registeredProjects[_projectAddress].exists, "Project not registered");
        _;
    }

    // 内部函数：添加成员
    function _addMember(address _member) internal {
        if (!members[_member]) {
            members[_member] = true;
            memberCount++;
            emit MemberAdded(_member);
        }
    }

    /**
     * @dev 添加DAO成员
     * @param _member 新成员地址
     */
    function addMember(address _member) external onlyAdmin {
        _addMember(_member);
    }

    /**
     * @dev 移除DAO成员
     * @param _member 成员地址
     */
    function removeMember(address _member) external onlyAdmin {
        require(members[_member], "Address is not a member");
        members[_member] = false;
        memberCount--;
        emit MemberRemoved(_member);
    }

    /**
     * @dev 修改投票参数
     */
    function updateVotingParams(uint256 _requiredQuorum, uint256 _requiredMajority) external onlyAdmin {
        require(_requiredMajority > 50 && _requiredMajority <= 100, "Majority must be between 51 and 100");
        requiredQuorum = _requiredQuorum;
        requiredMajority = _requiredMajority;
    }

    /**
     * @dev 注册新项目 - 由工厂合约调用
     */
    function registerProject(address _projectAddress, string memory _name, address _owner) external {
        require(!registeredProjects[_projectAddress].exists, "Project already registered");

        // 记录项目信息
        registeredProjects[_projectAddress] = RegisteredProject({
            projectAddress: _projectAddress,
            name: _name,
            owner: _owner,
            exists: true,
            approvalProposalId: 0,
            fundsReleaseProposalId: 0
        });

        projectAddresses.push(_projectAddress);

        // 自动创建项目审批提案
        uint256 proposalId = _createProposal(_projectAddress, _name, _owner, ProposalType.ProjectApproval);
        registeredProjects[_projectAddress].approvalProposalId = proposalId;

        emit ProjectRegistered(_projectAddress, _name, _owner);
    }

    /**
     * @dev 创建提案 (内部函数)
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
        newProposal.votingDeadline = block.timestamp + 7 days; // 默认7天投票期
        newProposal.proposalType = _type;
        newProposal.executed = false;

        emit ProposalCreated(proposalId, _projectAddress, _type);

        return proposalId;
    }

    /**
     * @dev 创建资金释放提案
     * @param _projectAddress 项目地址
     */
    function createFundsReleaseProposal(address _projectAddress)
    external
    registeredProjectOnly(_projectAddress)
    {
        uint256 beforeProposalCount = proposalCount;
        // 验证项目状态为待释放
        // 这需要调用项目合约的状态查询
        (,,,,,,,uint8 status) = ICharityProject(_projectAddress).getProjectDetails();
        require(status == STATUS_PENDING_RELEASE, "Project is not in pending release status");

        // 确保项目没有活跃的资金释放提案
        require(registeredProjects[_projectAddress].fundsReleaseProposalId == 0 ||
        proposals[registeredProjects[_projectAddress].fundsReleaseProposalId].executed,
            "There is already an active funds release proposal");

        // 获取项目信息
        RegisteredProject storage project = registeredProjects[_projectAddress];

        // 创建新的资金释放提案
        uint256 proposalId = _createProposal(
            _projectAddress,
            project.name,
            project.owner,
            ProposalType.FundsRelease
        );

        assert(proposalCount > beforeProposalCount);
        // 更新项目的资金释放提案ID
        project.fundsReleaseProposalId = proposalId;
    }

    /**
     * @dev 投票 - 修改为支持加权投票
     * @param _proposalId 提案ID
     * @param _approve 是否赞成
     */
    function vote(uint256 _proposalId, bool _approve) external onlyMember {
        // 首先检查提案是否存在
        require(_proposalId < proposalCount, "Proposal does not exist");

        Proposal storage proposal = proposals[_proposalId];

        require(block.timestamp < proposal.votingDeadline, "Voting period has ended");
        require(!proposal.executed, "Proposal already executed");
        require(proposal.votes[msg.sender] == VoteOption.None, "Member already voted");

        // 计算投票者的权重
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

        // 如果达到法定人数和多数票要求，自动执行
        if (_canExecuteProposal(proposal)) {
            _executeProposal(_proposalId);
        }
    }


    /**
     * @dev 检查提案是否可以执行 - 修改为使用加权投票
     */
    function _canExecuteProposal(Proposal storage proposal) internal view returns (bool) {
        // 计算总的可能投票权重 - 注意这里calculateVotingWeight现在返回的值已经乘以PRECISION_FACTOR
        uint256 totalPossibleWeight = 0;
        address member;

        for (uint256 i = 0; i < projectAddresses.length; i++) {
            member = projectAddresses[i];
            if (members[member]) {
                totalPossibleWeight += calculateVotingWeight(member);
            }

            // 也检查项目所有者
            member = registeredProjects[projectAddresses[i]].owner;
            if (members[member]) {
                totalPossibleWeight += calculateVotingWeight(member);
            }
        }

        uint256 totalVotedWeight = proposal.weightedYesVotes + proposal.weightedNoVotes;

        // 检查是否达到法定人数（基于权重）
        // 注意：requiredQuorum在这里被解释为成员比例，所以不需要乘以PRECISION_FACTOR
        uint256 quorumWeight = (totalPossibleWeight * requiredQuorum) / memberCount;
        if (totalVotedWeight < quorumWeight) {
            return false; // 未达到法定人数
        }

        // 判断提案是否可以确定结果
        // 1. 赞成票权重已经达到多数 - 可以执行并通过
        // 这里不需要修改，因为百分比计算中的权重已经包含精度因子，会相互抵消
        if ((proposal.weightedYesVotes * 100) / totalPossibleWeight >= requiredMajority) {
            return true;
        }

        // 2. 反对票权重太多，使得不可能达到多数 - 可以执行但不通过
        uint256 remainingWeight = totalPossibleWeight - totalVotedWeight;
        if ((proposal.weightedYesVotes + remainingWeight) * 100 / totalPossibleWeight < requiredMajority) {
            return true;
        }

        return false;
    }


    /**
 * @dev 执行提案 (内部函数) - 修改为使用加权投票，支持小数点权重
 */
    function _executeProposal(uint256 _proposalId) internal {
        Proposal storage proposal = proposals[_proposalId];

        require(!proposal.executed, "Proposal already executed");

        // 计算结果 - 使用加权投票
        uint256 totalVotedWeight = proposal.weightedYesVotes + proposal.weightedNoVotes;
        uint256 approvalPercentage = totalVotedWeight > 0 ? (proposal.weightedYesVotes * 100) / totalVotedWeight : 0;

        // 计算总可能权重 - 与_canExecuteProposal函数相同的计算
        uint256 totalPossibleWeight = 0;
        address member;

        for (uint256 i = 0; i < projectAddresses.length; i++) {
            member = projectAddresses[i];
            if (members[member]) {
                totalPossibleWeight += calculateVotingWeight(member);
            }

            // 也检查项目所有者
            member = registeredProjects[projectAddresses[i]].owner;
            if (members[member]) {
                totalPossibleWeight += calculateVotingWeight(member);
            }
        }

        // 与_canExecuteProposal保持一致的quorum计算
        uint256 quorumWeight = (totalPossibleWeight * requiredQuorum) / memberCount;
        bool passed = totalVotedWeight >= quorumWeight && approvalPercentage >= requiredMajority;

        proposal.passed = passed;
        proposal.executed = true;

        // 根据提案类型执行操作
        if (passed) {
            if (proposal.proposalType == ProposalType.ProjectApproval) {
                // 将项目状态改为募捐中
                ICharityProject(proposal.projectAddress).updateStatus(STATUS_FUNDRAISING);
            } else if (proposal.proposalType == ProposalType.FundsRelease) {
                // 释放资金
                ICharityProject(proposal.projectAddress).releaseFunds();
            }
        } else {
            // 如果提案被拒绝
            if (proposal.proposalType == ProposalType.ProjectApproval) {
                // 设置项目状态为已拒绝
                ICharityProject(proposal.projectAddress).updateStatus(STATUS_REJECTED);
            } else if (proposal.proposalType == ProposalType.FundsRelease) {
                // 如果资金释放被拒绝，项目可以重新提交或进入拒绝状态
                // 这里简单地将项目设回募捐中状态
                ICharityProject(proposal.projectAddress).updateStatus(STATUS_FUNDRAISING);
            }
        }

        emit ProposalExecuted(_proposalId, passed);
    }


    /**
     * @dev 手动执行提案 - 投票期结束后可以调用
     */
    function executeProposal(uint256 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];

        require(!proposal.executed, "Proposal already executed");
        require(block.timestamp >= proposal.votingDeadline, "Voting period not ended yet");

        _executeProposal(_proposalId);
    }

    /**
 * @dev 计算平方根的辅助函数
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
 * @dev 计算投票权重
 * 使用平方根函数计算，确保权重随代币数量增加而增长，但增长速度减缓
 */
    function calculateVotingWeight(address _voter) public view returns (uint256) {
        if (!members[_voter]) {
            return 0; // 非成员没有投票权
        }

        // 基础权重 × 精度因子 (例如 100)
        uint256 baseWeight = baseVotingWeight * 100;

        // 如果没有设置代币地址，直接返回基础权重
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

        // 如果没有代币，只有基础权重
        if (tokenBalance == 0) {
            return baseWeight;
        }

        // 改进的非线性权重计算，保留小数点位数
        uint256 normalizedBalance = (tokenBalance * 10000) / tokenWeightThreshold;
        if (normalizedBalance > 10000) normalizedBalance = 10000;

        // 使用精确计算保留小数点
        uint256 sqrtValue = sqrt(normalizedBalance * 100); // 增加精度
        uint256 maxAdditionalWeight = (maxVotingWeight - baseVotingWeight) * 100;
        uint256 additionalWeight = (maxAdditionalWeight * sqrtValue) / 1000; // 调整除数以匹配精度
        uint256 finalWeight = baseWeight + additionalWeight;

        return finalWeight; // 最终权重已乘以100
    }

    /**
     * @dev 获取提案信息 - 修改返回值包含加权投票
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
     * @dev 获取成员投票选择
     */
    function getMemberVote(uint256 _proposalId, address _member) external view returns (VoteOption) {
        return proposals[_proposalId].votes[_member];
    }

    /**
     * @dev 获取成员在某提案的投票权重
     */
    function getMemberVoteWeight(uint256 _proposalId, address _member) external view returns (uint256) {
        return proposals[_proposalId].voteWeights[_member];
    }

    /**
     * @dev 获取当前成员的投票权重
     */
    function getMyVotingWeight() external view returns (uint256) {
        return calculateVotingWeight(msg.sender);
    }

    /**
     * @dev 获取所有待审核提案
     */
    function getPendingProposals() external view returns (uint256[] memory) {
        uint256 count = 0;

        // 首先计算待审核提案的数量
        for (uint256 i = 0; i < proposalCount; i++) {
            if (!proposals[i].executed) {
                count++;
            }
        }

        // 创建结果数组
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;

        // 填充结果数组
        for (uint256 i = 0; i < proposalCount; i++) {
            if (!proposals[i].executed) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    /**
     * @dev 获取项目数量
     */
    function getProjectCount() external view returns (uint256) {
        return projectAddresses.length;
    }

    /**
     * @dev 获取项目列表
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

// 接口声明，用于与CharityProject合约交互
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
        uint8
    );
}