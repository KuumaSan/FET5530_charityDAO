// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CharityProject.sol";
import "./DAO.sol"; // 导入DAO合约

/**
 * @title 慈善项目工厂合约
 * @dev 用于创建和管理慈善项目的工厂合约
 */
contract CharityProjectFactory {
    // DAO合约地址
    address public daoAddress;

    // 治理代币地址
    address public governanceToken;

    // 添加管理员地址
    address public admin;

    // 项目映射和列表
    mapping(address => bool) public projectExists;
    address[] public projects;

    // 事件
    event ProjectCreated(address projectAddress, string name, address owner);
    event AdminChanged(address newAdmin);

    /**
     * @dev 构造函数
     * @param _daoAddress DAO合约地址
     * @param _tokenAddress 治理代币地址
     */
    constructor(address _daoAddress, address _tokenAddress) {
        daoAddress = _daoAddress;
        governanceToken = _tokenAddress;
        admin = msg.sender; // 设置部署者为初始管理员
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
            msg.sender,   // 项目创建者
            daoAddress,   // DAO地址
            governanceToken  // 传递治理代币地址
        );

        address projectAddress = address(newProject);

        // 记录项目
        projectExists[projectAddress] = true;
        projects.push(projectAddress);

        // 通知DAO合约有新项目待审核 - 使用导入的DAO接口
        CharityDAO dao = CharityDAO(daoAddress);
        dao.registerProject(projectAddress, _name, msg.sender);

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
     * @dev 更新DAO地址
     * @param _newDaoAddress 新的DAO合约地址
     */
    function updateDaoAddress(address _newDaoAddress) external {
        require(msg.sender == admin || msg.sender == daoAddress, "Unauthorized");
        daoAddress = _newDaoAddress;
    }

    /**
     * @dev 更新治理代币地址
     * @param _newTokenAddress 新的治理代币地址
     */
    function updateGovernanceToken(address _newTokenAddress) external {
        require(msg.sender == admin || msg.sender == daoAddress, "Unauthorized");
        governanceToken = _newTokenAddress;

        // 注意：这只会更新工厂的引用，不会更新已创建的项目
    }

    /**
     * @dev 更新管理员地址
     * @param _newAdmin 新的管理员地址
     */
    function updateAdmin(address _newAdmin) external {
        require(msg.sender == admin, "Only admin can change admin");
        admin = _newAdmin;
        emit AdminChanged(_newAdmin);
    }
}