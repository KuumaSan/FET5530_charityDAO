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

    // 提案结构
    struct Proposal {
        uint256 id;
        address projectAddress;
        string projectName;
        address projectOwner;
        uint256 createdAt;
        uint256 votingDeadline;
        ProposalType proposalType;
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
        bool passed;
        mapping(address => VoteOption) votes;
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
    event Voted(uint256 proposalId, address voter, bool approved);
    event ProposalExecuted(uint256 proposalId, bool passed);

    // 构造函数
    constructor(address[] memory _initialMembers, uint256 _requiredQuorum, uint256 _requiredMajority) {
        require(_requiredMajority > 50 && _requiredMajority <= 100, "Majority must be between 51 and 100");

        admin = msg.sender;
        requiredQuorum = _requiredQuorum;
        requiredMajority = _requiredMajority;

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
        // 这里可以添加安全检查，确认调用者是受信任的工厂合约
        // require(msg.sender == factoryAddress, "Only factory can register projects");

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

        // 更新项目的资金释放提案ID
        project.fundsReleaseProposalId = proposalId;
    }

    /**
     * @dev 投票
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

        if (_approve) {
            proposal.yesVotes++;
            proposal.votes[msg.sender] = VoteOption.Approve;
        } else {
            proposal.noVotes++;
            proposal.votes[msg.sender] = VoteOption.Reject;
        }

        emit Voted(_proposalId, msg.sender, _approve);

        // 如果达到法定人数和多数票要求，自动执行
        if (_canExecuteProposal(proposal)) {
            _executeProposal(_proposalId);
        }
    }


    /**
     * @dev 检查提案是否可以执行
     */
    function _canExecuteProposal(Proposal storage proposal) internal view returns (bool) {
        uint256 totalMembers = memberCount;
        uint256 totalVotes = proposal.yesVotes + proposal.noVotes;

        // 检查是否达到法定人数
        if (totalVotes < requiredQuorum) {
            return false; // 未达到法定人数
        }

        // 判断提案是否可以确定结果
        // 1. 赞成票已经达到多数 - 可以执行并通过
        if ((proposal.yesVotes * 100) / totalMembers >= requiredMajority) {
            return true;
        }

        // 2. 反对票太多，使得不可能达到多数 - 可以执行但不通过
        // 计算剩余可能的票数
        uint256 remainingVotes = totalMembers - totalVotes;
        // 即使所有剩余票都投赞成，也无法达到多数
        if ((proposal.yesVotes + remainingVotes) * 100 / totalMembers < requiredMajority) {
            return true;
        }

        return false;
    }

    /**
     * @dev 执行提案 (内部函数)
     */
    function _executeProposal(uint256 _proposalId) internal {
        Proposal storage proposal = proposals[_proposalId];

        require(!proposal.executed, "Proposal already executed");

        // 计算结果
        uint256 totalVotes = proposal.yesVotes + proposal.noVotes;
        uint256 approvalPercentage = totalVotes > 0 ? (proposal.yesVotes * 100) / totalVotes : 0;
        bool passed = totalVotes >= requiredQuorum && approvalPercentage >= requiredMajority;

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
     * @dev 获取提案信息
     */
    function getProposalInfo(uint256 _proposalId) external view returns (
        address projectAddress,
        string memory projectName,
        address projectOwner,
        uint256 createdAt,
        uint256 votingDeadline,
        ProposalType proposalType,
        uint256 yesVotes,
        uint256 noVotes,
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
            proposal.yesVotes,
            proposal.noVotes,
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