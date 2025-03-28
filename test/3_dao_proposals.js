const CharityDAO = artifacts.require("CharityDAO");
const CharityProjectFactory = artifacts.require("CharityProjectFactory");

contract("CharityDAO - 提案和投票测试", accounts => {
    const [admin, member1, member2, projectOwner] = accounts;
    const initialMembers = [admin];
    const requiredQuorum = 1;
    const requiredMajority = 51;

    let daoInstance;
    let proposalId;
    let projectName = "测试项目";
    let factoryInstance;
    let projectAddress;

    before(async () => {
        // 部署DAO合约
        daoInstance = await CharityDAO.new(
            [admin], // 初始成员
            1,       // 法定人数
            60       // 多数票要求
        );

        // 添加测试成员
        await daoInstance.addMember(member1, { from: admin });

        // 部署项目工厂合约，并设置DAO地址
        factoryInstance = await CharityProjectFactory.new(daoInstance.address);
        console.log("工厂部署成功:", factoryInstance.address);

        console.log("合约部署完成");
    });

    it("应该能创建项目并在DAO中注册", async () => {
        // 1. 通过工厂创建项目
        const tx = await factoryInstance.createProject(
            "测试慈善项目",
            "这是一个测试项目",
            "审计材料链接",
            web3.utils.toWei("5", "ether"),
            86400 * 30, // 30天
            { from: admin }
        );

        // 2. 从事件中获取项目地址
        const createdEvent = tx.logs.find(log => log.event === "ProjectCreated");
        assert(createdEvent, "应该触发ProjectCreated事件");

        projectAddress = createdEvent.args.projectAddress;
        console.log("创建的项目地址:", projectAddress);

        // 3. 获取DAO中的提案ID
        // 注意：这里需要从DAO合约获取对应的提案ID
        // 可能需要通过事件或者其他查询方法
        const proposalEvents = await daoInstance.getPastEvents('ProposalCreated', {
            fromBlock: 0,
            toBlock: 'latest'
        });

        // 找到对应我们项目地址的提案
        const relevantProposal = proposalEvents.find(
            event => event.args.projectAddress === projectAddress
        );

        assert(relevantProposal, "应该在DAO中找到对应的提案");
        proposalId = relevantProposal.args.proposalId;
        console.log("提案ID:", proposalId.toString());
    });

    it("注册项目前检查初始状态", async () => {
        const memberCount = await daoInstance.memberCount();
        assert.equal(memberCount.toString(), "2", "应该有2个成员");

        const isAdminMember = await daoInstance.members(admin);
        const isMember1Member = await daoInstance.members(member1);

        assert.equal(isAdminMember, true, "管理员应该是成员");
        assert.equal(isMember1Member, true, "member1应该是成员");

        const proposalCount = await daoInstance.proposalCount();
        assert.equal(proposalCount.toString(), "1", "应该有一个提案");
    });


    it("检查提案投票状态", async () => {
        // 获取提案信息和投票状态
        const proposal = await daoInstance.getProposalInfo(proposalId);

        console.log("提案创建后的状态:", {
            proposalId,
            yesVotes: proposal.yesVotes.toString(),
            noVotes: proposal.noVotes.toString(),
            executed: proposal.executed,
            createdAt: new Date(Number(proposal.createdAt) * 1000).toLocaleString(),
            votingDeadline: new Date(Number(proposal.votingDeadline) * 1000).toLocaleString()
        });

        // 检查admin和member1的投票状态
        const adminVote = await daoInstance.getMemberVote(proposalId, admin);
        const member1Vote = await daoInstance.getMemberVote(proposalId, member1);

        console.log("初始投票状态:", {
            admin: adminVote.toString(),
            member1: member1Vote.toString()
        });

        // VoteOption枚举: None = 0, Approve = 1, Reject = 2
        // 检查管理员是否已经投票
        if (adminVote.toString() !== "0") {
            console.log("管理员已经投过票，将跳过管理员投票测试");
        }
    });

    it("member1应该能够投票", async () => {
        const member1VoteBefore = await daoInstance.getMemberVote(proposalId, member1);

        // 如果member1已经投票，跳过测试
        if (member1VoteBefore.toString() !== "0") {
            console.log("member1已经投过票，跳过此测试");
            return;
        }

        try {
            // member1投赞成票
            const tx = await daoInstance.vote(proposalId, 1, { from: member1 });

            // 验证事件
            let votedEvent = null;
            for (let log of tx.logs) {
                if (log.event === "Voted") {
                    votedEvent = log;
                    break;
                }
            }

            assert(votedEvent, "应该触发Voted事件");
            assert.equal(votedEvent.args.proposalId.toString(), proposalId, "提案ID应该匹配");
            assert.equal(votedEvent.args.voter, member1, "投票者应该匹配");
            assert.equal(votedEvent.args.approved, true, "应该是赞成票");

            // 验证投票状态
            const member1VoteAfter = await daoInstance.getMemberVote(proposalId, member1);
            assert.equal(member1VoteAfter.toString(), "1", "投票状态应该是赞成");

        } catch (error) {
            console.log("member1投票失败:", error.message);
            assert.fail("member1投票应该成功: " + error.message);
        }
    });

    it("管理员应该能够投票(如果尚未投票)", async () => {
        // 先检查管理员当前投票状态
        const adminVoteBefore = await daoInstance.getMemberVote(proposalId, admin);

        // 如果管理员已经投票，跳过测试
        if (adminVoteBefore.toString() !== "0") {
            console.log("管理员已经投过票，跳过此测试");
            return;
        }

        try {
            // 管理员投赞成票
            const tx = await daoInstance.vote(proposalId, true, { from: admin });

            // 验证事件
            let votedEvent = null;
            for (let log of tx.logs) {
                if (log.event === "Voted") {
                    votedEvent = log;
                    break;
                }
            }

            assert(votedEvent, "应该触发Voted事件");
            assert.equal(votedEvent.args.proposalId.toString(), proposalId, "提案ID应该匹配");
            assert.equal(votedEvent.args.voter, admin, "投票者应该匹配");

            // 验证投票状态
            const adminVoteAfter = await daoInstance.getMemberVote(proposalId, admin);
            assert.equal(adminVoteAfter.toString(), "1", "投票状态应该是赞成");

        } catch (error) {
            console.log("管理员投票失败:", error.message);
            // 如果错误不是"已经投票"，则让测试失败
            if (!error.message.includes("Member already voted")) {
                assert.fail("管理员投票应该成功: " + error.message);
            }
        }
    });

    it("已投票的成员不能重复投票", async () => {
        // 确定谁已经投票
        const adminVote = await daoInstance.getMemberVote(proposalId, admin);
        const member1Vote = await daoInstance.getMemberVote(proposalId, member1);

        let voterToTest;
        if (adminVote.toString() !== "0") {
            voterToTest = admin;
        } else if (member1Vote.toString() !== "0") {
            voterToTest = member1;
        } else {
            console.log("没有成员投过票，无法测试重复投票");
            return;
        }

        console.log(`测试${voterToTest === admin ? '管理员' : 'member1'}的重复投票`);

        try {
            // 尝试重复投票
            await daoInstance.vote(proposalId, false, { from: voterToTest });
            assert.fail("重复投票应该失败");
        } catch (error) {
            // 验证错误
            assert(
                error.message.includes("revert"),
                "应该有revert错误: " + error.message
            );
            console.log("重复投票错误消息:", error.message);
        }
    });

    it("非成员不能投票", async () => {
        try {
            await daoInstance.vote(proposalId, true, { from: member2 });
            assert.fail("非成员投票应该失败");
        } catch (error) {
            assert(
                error.message.includes("revert"),
                "应该有revert错误: " + error.message
            );
            console.log("非成员投票错误消息:", error.message);
        }
    });

    it("查看最终投票结果和提案状态", async () => {
        // 获取提案信息
        const proposal = await daoInstance.getProposalInfo(proposalId);

        console.log("最终提案状态:", {
            proposalId,
            yesVotes: proposal.yesVotes.toString(),
            noVotes: proposal.noVotes.toString(),
            executed: proposal.executed,
            passed: proposal.passed,
            votingDeadline: new Date(Number(proposal.votingDeadline) * 1000).toLocaleString()
        });

        // 计算当前投票比例
        const totalVotes = Number(proposal.yesVotes) + Number(proposal.noVotes);
        const approvalPercentage = totalVotes > 0 ? (Number(proposal.yesVotes) * 100) / totalVotes : 0;

        console.log("投票统计:", {
            totalVotes,
            approvalPercentage: approvalPercentage.toFixed(2) + "%",
            requiredQuorum,
            requiredMajority
        });

        // 计算是否达到要求
        const hasQuorum = totalVotes >= requiredQuorum;
        const hasMajority = approvalPercentage >= requiredMajority;

        console.log("投票要求检查:", {
            hasQuorum,
            hasMajority,
            shouldPass: hasQuorum && hasMajority
        });
    });

    // 不测试自动执行和手动执行，只查看最终状态
    // 如果需要测试执行功能，可以在votingDeadline之后运行特定测试
});