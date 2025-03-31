const CharityToken = artifacts.require("CharityToken");

contract('CharityToken', (accounts) => {
    const [admin, user1, user2, user3, minter] = accounts;

    // 代币初始配置
    const TOKEN_NAME = "Charity Governance Token";
    const TOKEN_SYMBOL = "CGT";
    const INITIAL_SUPPLY = web3.utils.toWei('1000000'); // 100万代币，含18位小数

    // 辅助函数：将值转换为ETH单位
    const toEth = (wei) => web3.utils.fromWei(wei.toString(), 'ether');

    let token;

    describe('代币基本功能测试', () => {
        it('应成功部署代币合约', async () => {
            token = await CharityToken.new(TOKEN_NAME, TOKEN_SYMBOL, web3.utils.fromWei(INITIAL_SUPPLY));

            assert.ok(token.address, "合约地址应该存在");

            // 验证代币信息
            const name = await token.name();
            const symbol = await token.symbol();
            const decimals = await token.decimals();

            assert.equal(name, TOKEN_NAME, "代币名称不匹配");
            assert.equal(symbol, TOKEN_SYMBOL, "代币符号不匹配");
            assert.equal(decimals, 18, "代币小数位数应为18");
        });

        it('应正确铸造初始代币供应量', async () => {
            const totalSupply = await token.totalSupply();
            const adminBalance = await token.balanceOf(admin);

            assert.equal(totalSupply.toString(), INITIAL_SUPPLY, "总供应量不匹配");
            assert.equal(adminBalance.toString(), INITIAL_SUPPLY, "部署者余额不匹配");

            console.log(`初始代币供应量: ${toEth(totalSupply)} ${TOKEN_SYMBOL}`);
            console.log(`管理员初始余额: ${toEth(adminBalance)} ${TOKEN_SYMBOL}`);
        });

        it('应能转移代币', async () => {
            // 转移代币给user1
            const amount1 = web3.utils.toWei('50000');
            await token.transfer(user1, amount1, { from: admin });

            // 转移代币给user2
            const amount2 = web3.utils.toWei('25000');
            await token.transfer(user2, amount2, { from: admin });

            // 验证余额
            const adminBalanceAfter = await token.balanceOf(admin);
            const user1Balance = await token.balanceOf(user1);
            const user2Balance = await token.balanceOf(user2);

            // 预期管理员余额 = 初始 - 转移给user1 - 转移给user2
            const expectedAdminBalance = web3.utils.toBN(INITIAL_SUPPLY).sub(web3.utils.toBN(amount1)).sub(web3.utils.toBN(amount2));

            assert.equal(adminBalanceAfter.toString(), expectedAdminBalance.toString(), "管理员余额不正确");
            assert.equal(user1Balance.toString(), amount1, "user1余额不正确");
            assert.equal(user2Balance.toString(), amount2, "user2余额不正确");

            console.log(`转移后余额:`);
            console.log(`- 管理员: ${toEth(adminBalanceAfter)} ${TOKEN_SYMBOL}`);
            console.log(`- User1: ${toEth(user1Balance)} ${TOKEN_SYMBOL}`);
            console.log(`- User2: ${toEth(user2Balance)} ${TOKEN_SYMBOL}`);
        });

        it('应允许授权和代理转账', async () => {
            // User1授权User3代表其转移10000代币
            const allowanceAmount = web3.utils.toWei('10000');
            await token.approve(user3, allowanceAmount, { from: user1 });

            // 检查授权额度
            const allowance = await token.allowance(user1, user3);
            assert.equal(allowance.toString(), allowanceAmount, "授权额度不正确");

            // User3代表User1向User2转账5000代币
            const transferAmount = web3.utils.toWei('5000');
            await token.transferFrom(user1, user2, transferAmount, { from: user3 });

            // 检查余额变化
            const user1BalanceAfter = await token.balanceOf(user1);
            const user2BalanceAfter = await token.balanceOf(user2);
            const allowanceAfter = await token.allowance(user1, user3);

            const expectedUser1Balance = web3.utils.toBN(web3.utils.toWei('50000')).sub(web3.utils.toBN(transferAmount));
            const expectedUser2Balance = web3.utils.toBN(web3.utils.toWei('25000')).add(web3.utils.toBN(transferAmount));
            const expectedAllowance = web3.utils.toBN(allowanceAmount).sub(web3.utils.toBN(transferAmount));

            assert.equal(user1BalanceAfter.toString(), expectedUser1Balance.toString(), "user1余额不正确");
            assert.equal(user2BalanceAfter.toString(), expectedUser2Balance.toString(), "user2余额不正确");
            assert.equal(allowanceAfter.toString(), expectedAllowance.toString(), "剩余授权额度不正确");

            console.log(`代理转账后:`);
            console.log(`- User1余额: ${toEth(user1BalanceAfter)} ${TOKEN_SYMBOL}`);
            console.log(`- User2余额: ${toEth(user2BalanceAfter)} ${TOKEN_SYMBOL}`);
            console.log(`- 剩余授权: ${toEth(allowanceAfter)} ${TOKEN_SYMBOL}`);
        });

        it('应能授予和撤销铸币权限', async () => {
            // 授予minter铸币权限
            const MINTER_ROLE = web3.utils.soliditySha3("MINTER_ROLE");
            await token.grantRole(MINTER_ROLE, minter, { from: admin });

            // 验证权限
            const hasMinterRole = await token.hasRole(MINTER_ROLE, minter);
            assert.isTrue(hasMinterRole, "应该授予铸币权限");

            // minter铸造新代币
            const mintAmount = web3.utils.toWei('5000');
            await token.mint(user3, mintAmount, { from: minter });

            // 验证user3余额和总供应量
            const user3Balance = await token.balanceOf(user3);
            const totalSupplyAfter = await token.totalSupply();

            const expectedTotalSupply = web3.utils.toBN(INITIAL_SUPPLY).add(web3.utils.toBN(mintAmount));

            assert.equal(user3Balance.toString(), mintAmount, "铸造的代币没有正确发送");
            assert.equal(totalSupplyAfter.toString(), expectedTotalSupply.toString(), "总供应量未正确更新");

            console.log(`铸造新代币后:`);
            console.log(`- User3余额: ${toEth(user3Balance)} ${TOKEN_SYMBOL}`);
            console.log(`- 总供应量: ${toEth(totalSupplyAfter)} ${TOKEN_SYMBOL}`);

            // 撤销minter的铸币权限
            await token.revokeRole(MINTER_ROLE, minter, { from: admin });

            // 验证权限被撤销
            const hasMinterRoleAfter = await token.hasRole(MINTER_ROLE, minter);
            assert.isFalse(hasMinterRoleAfter, "铸币权限应该被撤销");

            // 尝试再次铸币应该失败
            try {
                await token.mint(user3, mintAmount, { from: minter });
                assert.fail("铸币操作应该失败");
            } catch (error) {
                assert.include(error.message, "revert", "错误消息应包含revert");
            }
        });

        it('应阻止未授权账户铸造代币', async () => {
            try {
                const mintAmount = web3.utils.toWei('1000');
                await token.mint(user1, mintAmount, { from: user2 });
                assert.fail("未授权账户不应能铸造代币");
            } catch (error) {
                assert.include(error.message, "revert", "错误消息应包含revert");
            }
        });
    });
});