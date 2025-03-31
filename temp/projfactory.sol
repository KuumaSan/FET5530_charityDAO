// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title 慈善项目合约
 * @dev 由工厂合约创建的子合约，管理单个慈善项目
 */

contract CharityProject {
    // 项目状态常量
    uint8 public constant STATUS_PENDING = 0;         // 待审核
    uint8 public constant STATUS_FUNDRAISING = 1;     // 募捐中
    uint8 public constant STATUS_PENDING_RELEASE = 2; // 待释放资金
    uint8 public constant STATUS_COMPLETED = 3;       // 已完成
    uint8 public constant STATUS_REJECTED = 4;        // 已拒绝

    // 项目基本信息
    string public projectName;
    string public description;
    string public auditMaterials; // IPFS哈希或其他存储证明
    uint256 public targetAmount;
    uint256 public deadline;
    uint256 public raisedAmount;
    address public owner;
    address public daoAddress;
    uint8 public status;

    // 捐赠记录
    mapping(address => uint256) public donations;
    address[] public donors;

    // 事件
    event DonationReceived(address donor, uint256 amount);
    event FundsReleased(uint256 amount);
    event StatusChanged(uint8 newStatus);
    event AuditMaterialsUpdated(string newMaterials);

    /**
     * @dev 构造函数，初始化项目
     */
    constructor(
        string memory _name,
        string memory _description,
        string memory _auditMaterials,
        uint256 _targetAmount,
        uint256 _duration,
        address _owner,
        address _daoAddress
    ) {
        projectName = _name;
        description = _description;
        auditMaterials = _auditMaterials;
        targetAmount = _targetAmount;
        deadline = block.timestamp + _duration;
        owner = _owner;
        daoAddress = _daoAddress;
        status = STATUS_PENDING; // 初始状态为待审核
    }

    // 修饰器：仅DAO可调用
    modifier onlyDAO() {
        require(msg.sender == daoAddress, "Only DAO can call this function");
        _;
    }

    // 修饰器：仅项目创建者可调用
    modifier onlyOwner() {
        require(msg.sender == owner, "Only project owner can call this function");
        _;
    }

    /**
     * @dev 更新项目状态 - 仅DAO可调用
     * @param _newStatus 新状态
     */
    function updateStatus(uint8 _newStatus) external onlyDAO {
        status = _newStatus;
        emit StatusChanged(_newStatus);
    }

    /**
     * @dev 用户捐款
     */
    function donate() external payable {
        require(status == STATUS_FUNDRAISING, "Project is not in fundraising status");
        require(block.timestamp <= deadline, "Fundraising deadline has passed");

        // 如果是首次捐款，添加到捐赠者列表
        if (donations[msg.sender] == 0) {
            donors.push(msg.sender);
        }

        donations[msg.sender] += msg.value;
        raisedAmount += msg.value;

        emit DonationReceived(msg.sender, msg.value);
    }

    /**
     * @dev 更新审核材料 - 申请释放资金时使用
     * @param _newMaterials 新的审核材料
     */
    function updateAuditMaterials(string memory _newMaterials) external onlyOwner {
        auditMaterials = _newMaterials;
        emit AuditMaterialsUpdated(_newMaterials);
    }

    /**
     * @dev 申请释放资金 - 由项目所有者调用
     */
    function requestFundsRelease() external onlyOwner {
        require(status == STATUS_FUNDRAISING, "Project is not in fundraising status");
        status = STATUS_PENDING_RELEASE;
        emit StatusChanged(STATUS_PENDING_RELEASE);
    }

    /**
     * @dev 释放资金到项目方 - 仅DAO可调用
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
     * @dev 退还资金给捐赠者 - 仅DAO可调用（项目被拒绝时）
     */
    function refundAll() external onlyDAO {
        require(status == STATUS_REJECTED, "Project is not rejected");

        for (uint i = 0; i < donors.length; i++) {
            address donor = donors[i];
            uint256 amount = donations[donor];

            if (amount > 0) {
                donations[donor] = 0;
                (bool success, ) = donor.call{value: amount}("");
                if (!success) {
                    // 如果退款失败，恢复捐款记录
                    donations[donor] = amount;
                }
            }
        }
    }

    /**
     * @dev 获取项目详细信息
     */
    function getProjectDetails() external view returns (
        string memory,
        string memory,
        string memory,
        uint256,
        uint256,
        uint256,
        address,
        uint8
    ) {
        return (
            projectName,
            description,
            auditMaterials,
            targetAmount,
            deadline,
            raisedAmount,
            owner,
            status
        );
    }
}

/**
 * @title 慈善项目工厂合约
 * @dev 用于创建和管理慈善项目的工厂合约
 */
contract CharityProjectFactory {
    // DAO合约地址
    address public daoAddress;

    // 项目映射和列表
    mapping(address => bool) public projectExists;
    address[] public projects;

    // 事件
    event ProjectCreated(address projectAddress, string name, address owner);

    /**
     * @dev 构造函数
     * @param _daoAddress DAO合约地址
     */
    constructor(address _daoAddress) {
        daoAddress = _daoAddress;
    }

    /**
     * @dev 创建新的慈善项目
     * @param _name 项目名称
     * @param _description 项目描述
     * @param _auditMaterials 审核材料
     * @param _targetAmount 目标金额
     * @param _duration 募集持续时间（秒）
     * @return 新创建的项目合约地址
     */
    function createProject(
        string memory _name,
        string memory _description,
        string memory _auditMaterials,
        uint256 _targetAmount,
        uint256 _duration
    ) external returns (address) {
        // 创建新的项目合约
        CharityProject newProject = new CharityProject(
            _name,
            _description,
            _auditMaterials,
            _targetAmount,
            _duration,
            msg.sender, // 项目创建者
            daoAddress  // DAO地址
        );

        address projectAddress = address(newProject);

        // 记录项目
        projectExists[projectAddress] = true;
        projects.push(projectAddress);

        // 通知DAO合约有新项目待审核（这需要DAO合约实现相应接口）
        // DAO合约有一个registerProject方法
        (bool success, ) = daoAddress.call(
            abi.encodeWithSignature("registerProject(address,string,address)",
                projectAddress,
                _name,
                msg.sender)
        );

        require(success, "Failed to register project with DAO");

        // 触发事件
        emit ProjectCreated(projectAddress, _name, msg.sender);

        return projectAddress;
    }

    /**
     * @dev 获取所有项目的数量
     */
    function getProjectCount() external view returns (uint256) {
        return projects.length;
    }

    /**
     * @dev 批量获取项目地址
     * @param _start 起始索引
     * @param _limit 要获取的数量
     */
    function getProjects(uint256 _start, uint256 _limit) external view returns (address[] memory) {
        require(_start < projects.length, "Start index out of bounds");

        uint256 end = _start + _limit;
        if (end > projects.length) {
            end = projects.length;
        }

        uint256 size = end - _start;
        address[] memory result = new address[](size);

        for (uint256 i = 0; i < size; i++) {
            result[i] = projects[_start + i];
        }

        return result;
    }

    /**
     * @dev 更新DAO地址（如需要）
     * @param _newDaoAddress 新的DAO合约地址
     */
    function updateDaoAddress(address _newDaoAddress) external {
        // 管理员权限检查
        // require(msg.sender == admin, "Only admin can update DAO address");

        daoAddress = _newDaoAddress;
    }
}