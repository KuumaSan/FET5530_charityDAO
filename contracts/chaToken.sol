// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CharityToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(string memory name, string memory symbol, uint256 initialSupply)
    ERC20(name, symbol)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        // 初始供应量铸造给部署者
        _mint(msg.sender, initialSupply * 10**decimals());
    }

    /**
     * @dev 铸造新代币，只有拥有MINTER_ROLE的地址可以调用
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @dev 授予其他合约（如DAO合约）铸造权限
     */
    function grantMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(MINTER_ROLE, account);
    }
}