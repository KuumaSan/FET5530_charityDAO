// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CharityToken is ERC20 {
    event TokensMinted(address indexed minter, address indexed recipient, uint256 amount);

    constructor(string memory name, string memory symbol, uint256 initialSupply)
    ERC20(name, symbol)
    {
        _mint(msg.sender, initialSupply * 10**decimals());
    }

    /**
     * @dev Minting new tokens - for testing available to all
     */
    function mint(address to, uint256 amount) external {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be greater than zero");

        _mint(to, amount);
        emit TokensMinted(msg.sender, to, amount);
    }

}