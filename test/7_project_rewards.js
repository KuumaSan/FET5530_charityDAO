const CharityToken = artifacts.require("CharityToken");
const CharityProject = artifacts.require("CharityProject");
const DAO = artifacts.require("CharityDAO");
const ProjFactory = artifacts.require("CharityProjectFactory");

const { BN, expectRevert, expectEvent } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');

contract("慈善项目代币奖励测试", accounts => {
    const [deployer, daoAdmin, projectOwner, donor1, donor2, donor3] = accounts;

    // 初始配置
    const tokenName = "Charity Governance Token";
    const tokenSymbol = "CGT";
    const initialSupply = new BN('1000000');

    const projectName = "Test Charity Project";
    const projectDesc = "A project for testing token rewards";
    const auditMaterials = "ipfs://Qm...";
    const targetAmount = web3.utils.toWei('10', 'ether');
    const duration = 86400 * 30; // 30天

    let token, dao, factory, project;
    let projectAddress;

    // 部署所有合约
    beforeEach(async () => {
        // 1. 部署代币合约
        token = await CharityToken.new(tokenName, tokenSymbol, initialSupply, { from: deployer });

        // 2. 部署DAO合约
        dao = await DAO.new(
            [daoAdmin],           // 初始成员
            1,                    // 法定人数
            51,                   // 多数票百分比 (51%)
            { from: daoAdmin }
        );
        // 3. 部署项目工厂合约
        factory = await ProjFactory.new(dao.address, token.address, { from: deployer });

        // 4. 授权项目合约可以铸造代币
        const MINTER_ROLE = await token.MINTER_ROLE();
        await token.grantRole(MINTER_ROLE, factory.address, { from: deployer });

        // 6. 创建项目
        const tx = await factory.createProject(
            projectName,
            projectDesc,
            auditMaterials,
            targetAmount,
            duration,
            { from: projectOwner }
        );

        // 获取项目地址（从事件中提取）
        const event = tx.logs.find(log => log.event === 'ProjectCreated');
        projectAddress = event.args.projectAddress;
        project = await CharityProject.at(projectAddress);
        await token.grantRole(MINTER_ROLE, projectAddress, { from: deployer });

        // 查询DAO中注册的项目信息
        const registeredProject = await dao.registeredProjects(projectAddress);
        const approvalProposalId = registeredProject.approvalProposalId.toNumber();

        // DAO成员投票批准项目
        await dao.vote(approvalProposalId, true, { from: daoAdmin });

        // 如果需要，手动执行提案
        // 判断提案是否自动执行
        const proposalInfo = await dao.getProposalInfo(approvalProposalId);
        if (!proposalInfo.executed) {
            // 如果提案没有自动执行，手动执行
            await dao.executeProposal(approvalProposalId, { from: daoAdmin });
        }
    });

    describe("基本代币奖励功能", () => {
        it("用户捐款后应收到相应数量的代币", async () => {
            // 捐款金额
            const donationAmount = web3.utils.toWei('1', 'ether');

            // 查询捐赠前代币余额
            const tokenBalanceBefore = await token.balanceOf(donor1);

            // 执行捐款
            const tx = await project.donate({ from: donor1, value: donationAmount });

            // 查询捐赠后代币余额
            const tokenBalanceAfter = await token.balanceOf(donor1);

            // 计算期望的代币奖励 (1 ETH * 100 = 100代币)
            const expectedReward = new BN(donationAmount).mul(new BN('100')).div(new BN(web3.utils.toWei('1', 'ether')));

            // 验证余额增加量是否符合预期
            assert.equal(
                tokenBalanceAfter.sub(tokenBalanceBefore).toString(),
                expectedReward.toString(),
                "代币奖励数量不匹配"
            );

            // 验证是否触发了TokenRewarded事件
            expectEvent(tx, 'TokenRewarded', {
                donor: donor1,
                amount: expectedReward
            });
        });
    });

    describe("权限控制与错误处理", () => {
        it("项目非募捐状态时不能捐款", async () => {
            // 1. 部署新项目
            const newProjectTx = await factory.createProject(
                "Non-Fundraising Test Project",
                "For testing donation rejection",
                "ipfs://test...",
                web3.utils.toWei('5', 'ether'),
                86400 * 15,
                { from: projectOwner }
            );
            const newProjectEvent = newProjectTx.logs.find(log => log.event === 'ProjectCreated');
            const newProjectAddress = newProjectEvent.args.projectAddress;
            const newProject = await CharityProject.at(newProjectAddress);

            // 2. 授权项目铸造代币
            const MINTER_ROLE = await token.MINTER_ROLE();
            await token.grantRole(MINTER_ROLE, newProjectAddress, { from: deployer });

            // 3-4. 批准项目
            const registeredProject = await dao.registeredProjects(newProjectAddress);
            const approvalProposalId = registeredProject.approvalProposalId.toNumber();
            await dao.vote(approvalProposalId, true, { from: daoAdmin });

            // 确保提案已执行
            const proposalInfoAfterVote = await dao.getProposalInfo(approvalProposalId);
            if (!proposalInfoAfterVote.executed) {
                await dao.executeProposal(approvalProposalId, { from: daoAdmin });
            }

            // 5. 确认项目在募捐状态
            const projectStatus = await newProject.status();
            assert.equal(projectStatus.toString(), '1', "项目应处于募捐状态");

            // 6-7. 申请释放资金并获取提案ID
            const beforeReleaseRequestProposalCount = await dao.proposalCount();
            await newProject.requestFundsRelease({ from: projectOwner });
            const afterReleaseRequestProposalCount = await dao.proposalCount();

            // 确定资金释放提案ID
            const fundsReleaseProposalId = afterReleaseRequestProposalCount.toNumber() - 1;

            // 8-9. DAO成员投票赞成资金释放提案
            await dao.vote(fundsReleaseProposalId, true, { from: daoAdmin });

            // 10. 执行提案
            const proposalAfterVote = await dao.getProposalInfo(fundsReleaseProposalId);
            if (!proposalAfterVote.executed) {
                await dao.executeProposal(fundsReleaseProposalId, { from: daoAdmin });
            }

            // 11. 获取项目最终状态
            const finalStatus = await newProject.status();
            assert.equal(finalStatus.toString(), '3', "项目应处于已完成状态");

            // 12. 验证捐款拒绝
            try {
                await newProject.donate({
                    from: donor1,
                    value: web3.utils.toWei('1', 'ether')
                });
                assert.fail("项目不在募捐状态，捐款应该被拒绝");
            } catch (error) {
                assert(error.message.includes("Project is not in fundraising status"),
                    "错误应该是因为项目不在募捐状态");
            }
        });

        it("即使代币合约出错，捐款流程也应该继续", async () => {
            // 撤销项目合约的铸币权限，模拟代币合约出错
            const MINTER_ROLE = await token.MINTER_ROLE();
            await token.revokeRole(MINTER_ROLE, project.address, { from: deployer });

            // 执行捐款
            const donationAmount = web3.utils.toWei('1', 'ether');
            const tx = await project.donate({ from: donor3, value: donationAmount });

            // 检查捐款是否被记录
            const donation = await project.donations(donor3);
            assert.equal(donation.toString(), donationAmount, "捐款应该被正确记录");

            // 检查代币余额是否仍为0（因为铸币失败）
            const tokenBalance = await token.balanceOf(donor3);
            assert.equal(tokenBalance.toString(), '0', "不应获得代币（因为铸币失败）");

            // 检查DonationReceived事件是否仍被触发
            expectEvent(tx, 'DonationReceived', {
                donor: donor3,
                amount: new BN(donationAmount)
            });
        });
    });

    describe("集成测试", () => {
        it("多个用户捐款并获得奖励", async () => {
            // 多位用户捐款不同金额
            const donations = [
                { donor: donor1, amount: web3.utils.toWei('1.5', 'ether') },
                { donor: donor2, amount: web3.utils.toWei('0.8', 'ether') },
                { donor: donor3, amount: web3.utils.toWei('2.2', 'ether') }
            ];

            // 记录初始代币余额
            const initialBalances = {};
            for (const { donor } of donations) {
                initialBalances[donor] = await token.balanceOf(donor);
            }

            // 执行所有捐款
            for (const { donor, amount } of donations) {
                await project.donate({ from: donor, value: amount });
            }

            // 验证每个用户的代币奖励
            const rewardRatio = await project.rewardRatio();

            for (const { donor, amount } of donations) {
                const finalBalance = await token.balanceOf(donor);
                const expectedReward = new BN(amount).mul(rewardRatio).div(new BN(web3.utils.toWei('1', 'ether')));
                const actualReward = finalBalance.sub(initialBalances[donor]);

                assert.equal(
                    actualReward.toString(),
                    expectedReward.toString(),
                    `用户 ${donor} 的代币奖励不匹配`
                );
            }
        });

        it("项目完成后，参与者依然持有代币", async () => {
            // 用户捐款
            await project.donate({ from: donor1, value: web3.utils.toWei('5', 'ether') });
            await project.donate({ from: donor2, value: web3.utils.toWei('5', 'ether') });

            // 记录持有代币数量
            const donor1Tokens = await token.balanceOf(donor1);
            const donor2Tokens = await token.balanceOf(donor2);

            // 项目所有者申请释放资金
            await project.requestFundsRelease({ from: projectOwner });

            // 找到资金释放提案
            const registeredProject = await dao.registeredProjects(project.address);
            const fundsReleaseProposalId = registeredProject.fundsReleaseProposalId.toNumber();

            // DAO成员投票赞成资金释放提案
            await dao.vote(fundsReleaseProposalId, true, { from: daoAdmin });

            // 验证项目状态为已完成
            const status = await project.status();
            assert.equal(status.toString(), '3', "项目状态应为已完成");

            // 验证捐赠者依然持有代币
            assert.equal(
                (await token.balanceOf(donor1)).toString(),
                donor1Tokens.toString(),
                "项目完成后捐赠者应保留代币"
            );

            assert.equal(
                (await token.balanceOf(donor2)).toString(),
                donor2Tokens.toString(),
                "项目完成后捐赠者应保留代币"
            );
        });
    });
});