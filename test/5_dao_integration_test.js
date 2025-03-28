// integrationTest.js - 慈善DAO系统集成测试

const CharityDAO = artifacts.require("CharityDAO");
const CharityProjectFactory = artifacts.require("CharityProjectFactory");
const CharityProject = artifacts.require("CharityProject");

contract("慈善DAO系统 - 集成测试", accounts => {
    // 角色分配
    const [admin, member1, member2, projectOwner, donor1, donor2] = accounts;

    // DAO参数
    const initialMembers = [admin, member1, member2];
    const requiredQuorum = 2;     // 法定人数
    const requiredMajority = 51;  // 多数票百分比要求

    // 项目参数
    const projectName = "希望工程";
    const projectDescription = "为贫困地区儿童提供教育支持";
    const auditMaterials = "ipfs://QmInitialAuditMaterialsHash";
    const targetAmount = web3.utils.toWei("5", "ether");  // 5 ETH
    const duration = 60 * 60 * 24 * 30;  // 30天项目期限

    // 状态常量
    const STATUS_PENDING = 0;         // 待审核
    const STATUS_FUNDRAISING = 1;     // 募捐中
    const STATUS_PENDING_RELEASE = 2; // 待释放资金
    const STATUS_COMPLETED = 3;       // 已完成
    const STATUS_REJECTED = 4;        // 已拒绝

    // 系统合约实例
    let daoInstance;
    let factoryInstance;
    let projectAddress;
    let projectInstance;

    // 提案ID
    let approvalProposalId;
    let fundsReleaseProposalId;

    it("完整慈善项目生命周期测试", async () => {
        try {
            // STEP 1: 系统初始化与部署
            console.log("\n======== STEP 1: 系统初始化与部署 ========");

            // 部署DAO合约
            daoInstance = await CharityDAO.new(initialMembers, requiredQuorum, requiredMajority);
            console.log(`DAO合约部署成功, 地址: ${daoInstance.address}`);

            // 验证DAO初始化参数
            const memberCount = await daoInstance.memberCount();
            const quorum = await daoInstance.requiredQuorum();
            const majority = await daoInstance.requiredMajority();

            console.log(`DAO初始成员数: ${memberCount}`);
            console.log(`DAO法定人数要求: ${quorum}`);
            console.log(`DAO多数票要求: ${majority}%`);

            assert.equal(memberCount.toString(), initialMembers.length.toString(), "DAO成员数量不匹配");
            assert.equal(quorum.toString(), requiredQuorum.toString(), "法定人数不匹配");
            assert.equal(majority.toString(), requiredMajority.toString(), "多数票要求不匹配");

            // 部署项目工厂合约
            factoryInstance = await CharityProjectFactory.new(daoInstance.address);
            console.log(`项目工厂合约部署成功, 地址: ${factoryInstance.address}`);

            // STEP 2: 创建慈善项目
            console.log("\n======== STEP 2: 创建慈善项目 ========");

            // 通过工厂创建项目
            console.log(`开始创建项目 "${projectName}"...`);
            const tx = await factoryInstance.createProject(
                projectName,
                projectDescription,
                auditMaterials,
                targetAmount,
                duration,
                { from: projectOwner }
            );

            // 从事件中获取项目地址
            const projectCreatedEvent = tx.logs.find(log => log.event === "ProjectCreated");
            projectAddress = projectCreatedEvent.args.projectAddress;
            console.log(`项目创建成功, 地址: ${projectAddress}`);

            // 获取项目合约实例
            projectInstance = await CharityProject.at(projectAddress);

            // 验证项目初始信息
            const projectDetails = await projectInstance.getProjectDetails();
            console.log(`项目名称: ${projectDetails[0]}`);
            console.log(`项目描述: ${projectDetails[1]}`);
            console.log(`目标金额: ${web3.utils.fromWei(projectDetails[3], "ether")} ETH`);
            console.log(`项目所有者: ${projectDetails[6]}`);
            console.log(`项目初始状态: ${projectDetails[7]}`);

            assert.equal(projectDetails[0], projectName, "项目名称不匹配");
            assert.equal(projectDetails[6], projectOwner, "项目所有者不匹配");
            assert.equal(projectDetails[7], STATUS_PENDING, "项目初始状态应为待审核");

            // STEP 3: 项目审批流程
            console.log("\n======== STEP 3: 项目审批流程 ========");

            // 验证项目在DAO中注册
            const registeredProject = await daoInstance.registeredProjects(projectAddress);
            console.log(`项目在DAO中注册状态: ${registeredProject.exists ? "已注册" : "未注册"}`);
            assert.equal(registeredProject.exists, true, "项目应在DAO中注册");

            // 获取审批提案ID
            approvalProposalId = registeredProject.approvalProposalId.toNumber();
            console.log(`项目审批提案ID: ${approvalProposalId}`);

            // 获取提案详情
            let proposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
            console.log(`提案创建时间: ${new Date(proposalInfo.createdAt * 1000).toLocaleString()}`);
            console.log(`提案投票截止时间: ${new Date(proposalInfo.votingDeadline * 1000).toLocaleString()}`);

            // DAO成员投票
            console.log("DAO成员开始投票...");
            await daoInstance.vote(approvalProposalId, true, { from: admin });
            console.log(`${admin} 投票: 赞成`);

            await daoInstance.vote(approvalProposalId, true, { from: member1 });
            console.log(`${member1} 投票: 赞成`);

            // 获取投票后的提案状态
            proposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
            console.log(`投票结果: ${proposalInfo.yesVotes}票赞成, ${proposalInfo.noVotes}票反对`);
            console.log(`提案状态: ${proposalInfo.executed ? "已执行" : "未执行"}, ${proposalInfo.passed ? "已通过" : "未通过"}`);

            // 验证提案已执行并通过
            assert.equal(proposalInfo.executed, true, "提案应已执行");
            assert.equal(proposalInfo.passed, true, "提案应已通过");

            // 验证项目状态已更新
            const statusAfterApproval = (await projectInstance.status()).toNumber();
            console.log(`审批后项目状态: ${statusAfterApproval}`);
            assert.equal(statusAfterApproval, STATUS_FUNDRAISING, "项目状态应更新为募捐中");

            // STEP 4: 项目募集资金
            console.log("\n======== STEP 4: 项目募集资金 ========");

            // 获取项目初始余额
            const initialProjectBalance = await web3.eth.getBalance(projectAddress);
            console.log(`项目初始余额: ${web3.utils.fromWei(initialProjectBalance, "ether")} ETH`);

            // 捐赠者1捐款
            const donation1 = web3.utils.toWei("2", "ether");
            await projectInstance.donate({ from: donor1, value: donation1 });
            console.log(`捐赠者1 (${donor1}) 捐款: ${web3.utils.fromWei(donation1, "ether")} ETH`);

            // 捐赠者2捐款
            const donation2 = web3.utils.toWei("3", "ether");
            await projectInstance.donate({ from: donor2, value: donation2 });
            console.log(`捐赠者2 (${donor2}) 捐款: ${web3.utils.fromWei(donation2, "ether")} ETH`);

            // 获取捐款后项目余额
            const projectBalanceAfterDonations = await web3.eth.getBalance(projectAddress);
            console.log(`捐款后项目余额: ${web3.utils.fromWei(projectBalanceAfterDonations, "ether")} ETH`);

            // 验证项目筹集金额
            const raisedAmount = await projectInstance.raisedAmount();
            console.log(`项目已筹集金额: ${web3.utils.fromWei(raisedAmount, "ether")} ETH`);

            const totalDonations = web3.utils.toBN(donation1).add(web3.utils.toBN(donation2));
            assert.equal(raisedAmount.toString(), totalDonations.toString(), "筹集金额不匹配");

            // 验证捐赠记录
            const donor1Donation = await projectInstance.donations(donor1);
            const donor2Donation = await projectInstance.donations(donor2);

            assert.equal(donor1Donation.toString(), donation1, "捐赠者1的捐款记录不匹配");
            assert.equal(donor2Donation.toString(), donation2, "捐赠者2的捐款记录不匹配");

            // STEP 5: 申请释放资金
            console.log("\n======== STEP 5: 申请释放资金 ========");

            // 项目方更新审计材料
            const updatedAuditMaterials = "ipfs://QmUpdatedAuditMaterialsHash";
            await projectInstance.updateAuditMaterials(updatedAuditMaterials, { from: projectOwner });
            console.log(`项目方更新审计材料: ${updatedAuditMaterials}`);

            // 项目方申请释放资金
            await projectInstance.requestFundsRelease({ from: projectOwner });
            console.log(`项目方 (${projectOwner}) 申请释放资金`);

            // 验证项目状态
            const statusAfterRequest = (await projectInstance.status()).toNumber();
            console.log(`申请后项目状态: ${statusAfterRequest}`);
            assert.equal(statusAfterRequest, STATUS_PENDING_RELEASE, "项目状态应更新为待释放资金");

            // STEP 6: 创建资金释放提案
            console.log("\n======== STEP 6: 创建资金释放提案 ========");

            // 创建资金释放提案
            const releaseTx = await daoInstance.createFundsReleaseProposal(projectAddress, { from: member1 });
            console.log(`成员 ${member1} 创建资金释放提案`);

            // 获取释放提案ID
            const releaseProposalEvent = releaseTx.logs.find(log => log.event === "ProposalCreated");
            fundsReleaseProposalId = releaseProposalEvent.args.proposalId.toNumber();
            console.log(`资金释放提案ID: ${fundsReleaseProposalId}`);

            // 获取更新后的项目记录
            const updatedProject = await daoInstance.registeredProjects(projectAddress);
            console.log(`项目资金释放提案ID: ${updatedProject.fundsReleaseProposalId.toString()}`);

            assert.equal(updatedProject.fundsReleaseProposalId.toString(), fundsReleaseProposalId.toString(), "资金释放提案ID不匹配");

            // STEP 7: 资金释放投票
            console.log("\n======== STEP 7: 资金释放投票 ========");

            // 记录项目方初始余额
            const initialOwnerBalance = web3.utils.toBN(await web3.eth.getBalance(projectOwner));
            console.log(`项目方初始余额: ${web3.utils.fromWei(initialOwnerBalance, "ether")} ETH`);

            // DAO成员投票
            console.log("DAO成员开始投票...");
            await daoInstance.vote(fundsReleaseProposalId, true, { from: admin });
            console.log(`${admin} 投票: 赞成`);

            await daoInstance.vote(fundsReleaseProposalId, true, { from: member1 });
            console.log(`${member1} 投票: 赞成`);

            // 获取投票后的提案状态
            const releaseProposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
            console.log(`投票结果: ${releaseProposalInfo.yesVotes}票赞成, ${releaseProposalInfo.noVotes}票反对`);
            console.log(`提案状态: ${releaseProposalInfo.executed ? "已执行" : "未执行"}, ${releaseProposalInfo.passed ? "已通过" : "未通过"}`);

            // 验证提案已执行并通过
            assert.equal(releaseProposalInfo.executed, true, "提案应已执行");
            assert.equal(releaseProposalInfo.passed, true, "提案应已通过");

            // STEP 8: 验证资金释放结果
            console.log("\n======== STEP 8: 验证资金释放结果 ========");

            // 验证项目状态
            const finalStatus = (await projectInstance.status()).toNumber();
            console.log(`最终项目状态: ${finalStatus}`);
            assert.equal(finalStatus, STATUS_COMPLETED, "项目状态应更新为已完成");

            // 验证项目余额
            const finalProjectBalance = await web3.eth.getBalance(projectAddress);
            console.log(`项目最终余额: ${web3.utils.fromWei(finalProjectBalance, "ether")} ETH`);

            // 验证项目方余额增加
            const finalOwnerBalance = web3.utils.toBN(await web3.eth.getBalance(projectOwner));
            console.log(`项目方最终余额: ${web3.utils.fromWei(finalOwnerBalance, "ether")} ETH`);
            console.log(`项目方余额增加: ${web3.utils.fromWei(finalOwnerBalance.sub(initialOwnerBalance), "ether")} ETH`);

            // 项目余额应接近零且项目方余额应增加
            assert(web3.utils.toBN(finalProjectBalance).lt(web3.utils.toBN(web3.utils.toWei("0.01", "ether"))), "项目余额应接近零");
            assert(finalOwnerBalance.gt(initialOwnerBalance), "项目方余额应增加");

            // STEP 9: 系统状态一致性验证
            console.log("\n======== STEP 9: 系统状态一致性验证 ========");

            // 验证DAO中的项目记录
            const finalProject = await daoInstance.registeredProjects(projectAddress);

            console.log("DAO中的项目记录:");
            console.log(`- 是否存在: ${finalProject.exists}`);
            console.log(`- 项目名称: ${finalProject.name}`);
            console.log(`- 项目所有者: ${finalProject.owner}`);
            console.log(`- 审批提案ID: ${finalProject.approvalProposalId}`);
            console.log(`- 资金释放提案ID: ${finalProject.fundsReleaseProposalId}`);

            assert.equal(finalProject.exists, true, "项目记录应存在");
            assert.equal(finalProject.name, projectName, "项目名称应匹配");
            assert.equal(finalProject.owner, projectOwner, "项目所有者应匹配");

            // 再次验证两个提案状态
            const finalApprovalProposal = await daoInstance.getProposalInfo(approvalProposalId);
            const finalReleaseProposal = await daoInstance.getProposalInfo(fundsReleaseProposalId);

            console.log("最终审批提案状态:");
            console.log(`- 是否执行: ${finalApprovalProposal.executed}`);
            console.log(`- 是否通过: ${finalApprovalProposal.passed}`);

            console.log("最终资金释放提案状态:");
            console.log(`- 是否执行: ${finalReleaseProposal.executed}`);
            console.log(`- 是否通过: ${finalReleaseProposal.passed}`);

            assert.equal(finalApprovalProposal.executed && finalApprovalProposal.passed, true, "审批提案应已执行并通过");
            assert.equal(finalReleaseProposal.executed && finalReleaseProposal.passed, true, "资金释放提案应已执行并通过");

            console.log("\n✅ 集成测试成功完成！慈善项目完整生命周期流程验证通过");

        } catch (error) {
            console.error("\n❌ 集成测试失败:");
            console.error(error.message);
            console.error("错误堆栈:", error.stack);
            assert.fail("集成测试应该成功完成: " + error.message);
        }
    });

    it("拒绝项目流程测试", async () => {
        try {
            console.log("\n======== 开始拒绝项目流程测试 ========");

            // 创建一个新项目用于测试拒绝流程
            const rejectProjectName = "待拒绝项目";
            const rejectTx = await factoryInstance.createProject(
                rejectProjectName,
                "这是一个将被拒绝的测试项目",
                "ipfs://rejectProject",
                web3.utils.toWei("2", "ether"),
                duration,
                { from: projectOwner }
            );

            const rejectProjectEvent = rejectTx.logs.find(log => log.event === "ProjectCreated");
            const rejectProjectAddress = rejectProjectEvent.args.projectAddress;
            console.log(`待拒绝项目创建成功, 地址: ${rejectProjectAddress}`);

            const rejectProjectInstance = await CharityProject.at(rejectProjectAddress);

            // 获取项目提案ID
            const rejectRegisteredProject = await daoInstance.registeredProjects(rejectProjectAddress);
            const rejectProposalId = rejectRegisteredProject.approvalProposalId.toNumber();
            console.log(`待拒绝项目的审批提案ID: ${rejectProposalId}`);

            // 验证初始状态
            const initialStatus = (await rejectProjectInstance.status()).toNumber();
            assert.equal(initialStatus, STATUS_PENDING, "项目初始状态应为待审核");

            // DAO成员投反对票
            console.log("DAO成员投反对票...");
            await daoInstance.vote(rejectProposalId, false, { from: admin });
            console.log(`${admin} 投票: 反对`);

            await daoInstance.vote(rejectProposalId, false, { from: member1 });
            console.log(`${member1} 投票: 反对`);

            // 获取投票后的提案状态
            const rejectProposalInfo = await daoInstance.getProposalInfo(rejectProposalId);
            console.log(`投票结果: ${rejectProposalInfo.yesVotes}票赞成, ${rejectProposalInfo.noVotes}票反对`);
            console.log(`提案状态: ${rejectProposalInfo.executed ? "已执行" : "未执行"}, ${rejectProposalInfo.passed ? "已通过" : "未通过"}`);

            // 验证提案已执行但未通过
            assert.equal(rejectProposalInfo.executed, true, "提案应已执行");
            assert.equal(rejectProposalInfo.passed, false, "提案应标记为未通过");

            // 验证项目状态已更新为已拒绝
            const finalStatus = (await rejectProjectInstance.status()).toNumber();
            console.log(`拒绝后项目状态: ${finalStatus}`);
            assert.equal(finalStatus, STATUS_REJECTED, "项目状态应更新为已拒绝");

            // 尝试向被拒绝的项目捐款（应该失败）
            try {
                await rejectProjectInstance.donate({ from: donor1, value: web3.utils.toWei("0.1", "ether") });
                assert.fail("向被拒绝项目捐款应该失败");
            } catch (error) {
                assert(error.message.includes("revert"), "应当发生回滚");
                console.log("✅ 验证通过: 无法向被拒绝项目捐款");
            }

            console.log("\n✅ 拒绝项目流程测试成功完成！");

        } catch (error) {
            console.error("\n❌ 拒绝项目流程测试失败:");
            console.error(error.message);
            console.error("错误堆栈:", error.stack);
            assert.fail("拒绝项目流程测试应该成功完成: " + error.message);
        }
    });

    it("边界条件和错误处理测试", async () => {
        try {
            console.log("\n======== 开始边界条件和错误处理测试 ========");

            // 测试1: 非管理员不能添加成员
            console.log("\n测试1: 非管理员不能添加成员");
            try {
                await daoInstance.addMember(donor1, { from: member1 });
                assert.fail("非管理员不应能添加成员");
            } catch (error) {
                assert(error.message.includes("revert"), "应当发生回滚");
                console.log("✅ 验证通过: 非管理员不能添加成员");
            }

            // 测试2: 非项目所有者不能申请释放资金
            console.log("\n测试2: 非项目所有者不能申请释放资金");
            try {
                await projectInstance.requestFundsRelease({ from: donor1 });
                assert.fail("非项目所有者不应能申请释放资金");
            } catch (error) {
                assert(error.message.includes("revert"), "应当发生回滚");
                console.log("✅ 验证通过: 非项目所有者不能申请释放资金");
            }

            // 测试3: 非DAO不能更新项目状态
            console.log("\n测试3: 非DAO不能更新项目状态");
            try {
                await projectInstance.updateStatus(STATUS_COMPLETED, { from: admin });
                assert.fail("非DAO不应能更新项目状态");
            } catch (error) {
                assert(error.message.includes("revert"), "应当发生回滚");
                console.log("✅ 验证通过: 非DAO不能更新项目状态");
            }

            // 测试4: 非成员不能在DAO中投票
            console.log("\n测试4: 非成员不能在DAO中投票");
            try {
                await daoInstance.vote(approvalProposalId, true, { from: donor1 });
                assert.fail("非成员不应能在DAO中投票");
            } catch (error) {
                assert(error.message.includes("revert"), "应当发生回滚");
                console.log("✅ 验证通过: 非成员不能在DAO中投票");
            }

            // 测试5: 不能对已执行的提案投票
            console.log("\n测试5: 不能对已执行的提案投票");
            try {
                await daoInstance.vote(approvalProposalId, true, { from: member2 });
                assert.fail("不应能对已执行的提案投票");
            } catch (error) {
                assert(error.message.includes("revert"), "应当发生回滚");
                console.log("✅ 验证通过: 不能对已执行的提案投票");
            }

            console.log("\n✅ 边界条件和错误处理测试成功完成！系统安全机制工作正常");

        } catch (error) {
            console.error("\n❌ 边界条件和错误处理测试失败:");
            console.error(error.message);
            console.error("错误堆栈:", error.stack);
            assert.fail("边界条件和错误处理测试应该成功完成: " + error.message);
        }
    });
});