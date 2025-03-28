// migrations/1_deploy_contracts.js

// 导入合约
const CharityDAO = artifacts.require("CharityDAO");
const CharityProjectFactory = artifacts.require("CharityProjectFactory");

/**
 * 部署 CharityDAO 和 CharityProjectFactory 合约
 * @param {Object} deployer - Truffle 部署工具
 * @param {String} network - 当前部署的网络名称
 * @param {Array} accounts - 当前网络上的账户列表
 */
module.exports = async function(deployer, network, accounts) {
    try {
        console.log("----- 开始部署 CharityDAO 系统 -----");
        console.log("部署账户:", accounts[0]);
        console.log("网络:", network);

        // 部署参数
        const initialMembers = [accounts[0]]; // 初始 DAO 成员为部署账户
        const quorum = 1; // 最小法定人数
        const majorityPercentage = 51; // 通过提案所需的多数票百分比

        console.log("初始成员:", initialMembers);
        console.log("法定人数:", quorum);
        console.log("多数票百分比:", majorityPercentage, "%");

        // 步骤 1: 部署 CharityDAO 合约
        console.log("\n正在部署 CharityDAO 合约...");
        await deployer.deploy(CharityDAO, initialMembers, quorum, majorityPercentage);
        const daoInstance = await CharityDAO.deployed();
        console.log("CharityDAO 合约地址:", daoInstance.address);

        // 打印 DAO 初始状态
        // 使用公共状态变量 memberCount 而不是 getMemberCount 函数
        const memberCount = await daoInstance.memberCount();
        console.log("初始成员数量:", memberCount.toString());

        // 直接检查成员映射
        const isMember = await daoInstance.members(accounts[0]);
        console.log("部署账户是否为成员:", isMember);

        // 步骤 2: 部署 CharityProjectFactory 合约
        console.log("\n正在部署 CharityProjectFactory 合约...");
        await deployer.deploy(CharityProjectFactory, daoInstance.address);
        const factoryInstance = await CharityProjectFactory.deployed();
        console.log("CharityProjectFactory 合约地址:", factoryInstance.address);

        // 验证 Factory 设置
        const daoAddress = await factoryInstance.daoAddress();
        console.log("工厂合约中的 DAO 地址:", daoAddress);
        console.log("验证: DAO 地址是否匹配 =", daoAddress === daoInstance.address);

        // 打印合约交互说明
        console.log("\n----- 部署完成 -----");
        console.log("CharityDAO 地址:", daoInstance.address);
        console.log("CharityProjectFactory 地址:", factoryInstance.address);
        console.log("\n使用这些地址在应用程序中与合约交互");
        console.log("示例: const dao = await CharityDAO.at('" + daoInstance.address + "');");

    } catch (error) {
        console.error("\n部署失败:");
        console.error(error);
        throw error; // 重新抛出错误以确保 Truffle 知道部署失败
    }
};