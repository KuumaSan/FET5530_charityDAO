// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 导入ERC20接口
interface IERC20 {
    function mint(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

// 导入DAO接口定义
interface ICharityDAO {
    function createFundsReleaseProposal(address _projectAddress) external;
}

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

    // 治理代币地址
    address public governanceToken;

    // 代币奖励比例 (每捐赠1 wei奖励多少代币，默认为100，即捐赠1 ETH奖励100代币)
    uint256 public rewardRatio = 100;

    // 捐赠记录
    mapping(address => uint256) public donations;
    address[] public donors;

    // 事件
    event DonationReceived(address donor, uint256 amount);
    event TokenRewarded(address donor, uint256 amount);
    event FundsReleased(uint256 amount);
    event StatusChanged(uint8 newStatus);
    event AuditMaterialsUpdated(string newMaterials);
    event RewardRatioUpdated(uint256 newRatio);

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
        status = STATUS_PENDING; // 初始状态为待审核
        governanceToken = _tokenAddress; // 设置治理代币
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
     * @dev 用户捐款并获得代币奖励
     */
    function donate() external payable {
        require(status == STATUS_FUNDRAISING, "Project is not in fundraising status");
        require(block.timestamp <= deadline, "Fundraising deadline has passed");

        // 如果是首次捐款，添加到捐赠者列表
        if (donations[msg.sender] == 0) {
            donors.push(msg.sender);
        }

        // 记录捐赠
        donations[msg.sender] += msg.value;
        raisedAmount += msg.value;

        // 发放代币奖励
        if (governanceToken != address(0)) {
            uint256 tokenReward = msg.value * rewardRatio / 1 ether;

            // 尝试铸造代币给捐赠者
            try IERC20(governanceToken).mint(msg.sender, tokenReward) {
                emit TokenRewarded(msg.sender, tokenReward);
            } catch {
                // 如果铸造失败（可能因为代币合约不支持mint或调用者无权限），则不发放奖励
                // 但不阻止捐赠流程
            }
        }

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

        // 调用DAO合约创建资金释放提案
        ICharityDAO(daoAddress).createFundsReleaseProposal(address(this));
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
        uint8,
        address,      // 治理代币地址
        uint256       // 代币奖励比例
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
     * @dev 获取所有捐赠者
     */
    function getDonors() external view returns (address[] memory) {
        return donors;
    }

    /**
     * @dev 更新治理代币地址 - 仅DAO可调用
     */
    function updateGovernanceToken(address _newTokenAddress) external onlyDAO {
        governanceToken = _newTokenAddress;
    }

    /**
     * @dev 更新代币奖励比例 - 仅DAO可调用
     * @param _newRatio 新的奖励比例 (每捐赠1 ETH奖励多少代币)
     */
    function updateRewardRatio(uint256 _newRatio) external onlyDAO {
        rewardRatio = _newRatio;
        emit RewardRatioUpdated(_newRatio);
    }
}