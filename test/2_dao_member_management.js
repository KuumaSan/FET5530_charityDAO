const CharityToken = artifacts.require("CharityToken");
const CharityDAO = artifacts.require("CharityDAO");

contract("CharityDAO - 成员管理测试", accounts => {
    const [admin, member1, member2, nonMember] = accounts;

    let daoInstance;
    let tokenInstance;

    beforeEach(async () => {
        // 为每次测试部署一个新的代币合约
        tokenInstance = await CharityToken.new("Charity Token", "CHA", 0);

        // 每个测试前重新部署合约，提供代币地址
        daoInstance = await CharityDAO.new(
            [admin],
            1,
            51,
            tokenInstance.address
        );
    });

    it("成员可以添加新成员", async () => {
        // 管理员添加新成员
        await daoInstance.addMember(member1, { from: admin });

        // 检查成员状态
        const isMember = await daoInstance.members(member1);
        const memberCount = await daoInstance.memberCount();

        assert.equal(isMember, true, "成员应该被成功添加");
        assert.equal(memberCount.toString(), "2", "成员数量应该增加");
    });

    it("应该触发MemberAdded事件", async () => {
        // 获取交易收据以检查事件
        const tx = await daoInstance.addMember(member1, { from: admin });

        // 检查事件是否被触发
        assert.equal(tx.logs.length, 1, "应该触发一个事件");
        assert.equal(tx.logs[0].event, "MemberAdded", "应该是MemberAdded事件");
        assert.equal(tx.logs[0].args.member, member1, "成员地址应该匹配");
    });

    it("管理员可以移除其他成员", async () => {
        // 先添加成员
        await daoInstance.addMember(member1, { from: admin });

        // 然后由管理员移除成员
        await daoInstance.removeMember(member1, { from: admin });

        // 检查成员状态
        const isMember = await daoInstance.members(member1);
        const memberCount = await daoInstance.memberCount();

        assert.equal(isMember, false, "成员应该被成功移除");
        assert.equal(memberCount.toString(), "1", "成员数量应该减少");
    });

    it("不能移除不存在的成员", async () => {
        try {
            await daoInstance.removeMember(nonMember, { from: admin });
            assert.fail("交易应该失败");
        } catch (error) {
            // 使用合约中的精确错误消息
            assert(
                error.message.includes("Address is not a member"),
                "错误应该提示地址不是成员: " + error.message
            );
        }
    });


    // 非管理员不能添加或移除成员
    it("非管理员不能添加成员", async () => {
        // 先让管理员添加member1
        await daoInstance.addMember(member1, { from: admin });

        try {
            // member1尝试添加member2
            await daoInstance.addMember(member2, { from: member1 });
            assert.fail("交易应该失败");
        } catch (error) {
            assert(
                error.message.includes("Only admin can call this function"),
                "错误应该提示只有管理员可以调用: " + error.message
            );
        }
    });

    it("非管理员不能移除成员", async () => {
        // 先让管理员添加member1和member2
        await daoInstance.addMember(member1, { from: admin });
        await daoInstance.addMember(member2, { from: admin });

        try {
            // member1尝试移除member2
            await daoInstance.removeMember(member2, { from: member1 });
            assert.fail("交易应该失败");
        } catch (error) {
            assert(
                error.message.includes("Only admin can call this function"),
                "错误应该提示只有管理员可以调用: " + error.message
            );
        }
    });
});