// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CharityProject.sol";
import "./DAO.sol";

/**
 * @title Charity Project Factory Contract
 * @dev Factory contract for creating and managing charity projects
 */
contract CharityProjectFactory {
    // DAO contract address
    address public daoAddress;

    // Governance token address
    address public governanceToken;

    // Add admin address
    address public admin;

    // Project mapping and list
    mapping(address => bool) public projectExists;
    address[] public projects;

    // Events
    event ProjectCreated(address projectAddress, string name, address owner);
    event AdminChanged(address newAdmin);

    /**
     * @dev Constructor
     * @param _daoAddress DAO contract address
     * @param _tokenAddress Governance token address
     */
    constructor(address _daoAddress, address _tokenAddress) {
        daoAddress = _daoAddress;
        governanceToken = _tokenAddress;
        admin = msg.sender; // Set deployer as initial admin
    }

    /**
     * @dev Create new charity project
     * @param _name Project name
     * @param _description Project description
     * @param _auditMaterials Audit materials
     * @param _targetAmount Target amount
     * @param _duration Fundraising duration (seconds)
     * @return Address of the newly created project contract
     */
    function createProject(
        string memory _name,
        string memory _description,
        string memory _auditMaterials,
        uint256 _targetAmount,
        uint256 _duration
    ) external returns (address) {
        // Create new project contract
        CharityProject newProject = new CharityProject(
            _name,
            _description,
            _auditMaterials,
            _targetAmount,
            _duration,
            msg.sender,   // Project creator
            daoAddress,   // DAO address
            governanceToken  // Pass governance token address
        );

        address projectAddress = address(newProject);

        // Record project
        projectExists[projectAddress] = true;
        projects.push(projectAddress);

        // Notify DAO contract of new project pending review - using imported DAO interface
        CharityDAO dao = CharityDAO(daoAddress);
        dao.registerProject(projectAddress, _name, msg.sender);

        // Trigger event
        emit ProjectCreated(projectAddress, _name, msg.sender);

        return projectAddress;
    }

    /**
     * @dev Get total number of projects
     */
    function getProjectCount() external view returns (uint256) {
        return projects.length;
    }

    /**
     * @dev Batch retrieve project addresses
     * @param _start Starting index
     * @param _limit Number to retrieve
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
     * @dev Update DAO address
     * @param _newDaoAddress New DAO contract address
     */
    function updateDaoAddress(address _newDaoAddress) external {
        require(msg.sender == admin || msg.sender == daoAddress, "Unauthorized");
        daoAddress = _newDaoAddress;
    }

    /**
     * @dev Update governance token address
     * @param _newTokenAddress New governance token address
     */
    function updateGovernanceToken(address _newTokenAddress) external {
        require(msg.sender == admin || msg.sender == daoAddress, "Unauthorized");
        governanceToken = _newTokenAddress;

    }

    /**
     * @dev Update admin address
     * @param _newAdmin New admin address
     */
    function updateAdmin(address _newAdmin) external {
        require(msg.sender == admin, "Only admin can change admin");
        admin = _newAdmin;
        emit AdminChanged(_newAdmin);
    }
}