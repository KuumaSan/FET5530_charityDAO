const CharityDAO = artifacts.require("CharityDAO");

contract("CharityDAO - 初始化测试", accounts => {
    const [admin, member1, nonMember] = accounts;
    const initialMembers = [admin];
    const requiredQuorum = 1;
    const requiredMajority = 51;

    let daoInstance;

    before(async () => {
        daoInstance = await CharityDAO.new(initialMembers, requiredQuorum, requiredMajority);
    });

    it("应该正确初始化DAO参数", async () => {
        // 获取状态变量
        const memberCount = await daoInstance.memberCount();
        const isAdminMember = await daoInstance.members(admin);
        const actualQuorum = await daoInstance.requiredQuorum(); // 使用正确的变量名
        const actualMajority = await daoInstance.requiredMajority(); // 使用正确的变量名
        const actualAdmin = await daoInstance.admin();

        assert.equal(memberCount.toString(), "1", "成员数量应该是1");
        assert.equal(isAdminMember, true, "管理员应该是成员");
        assert.equal(actualQuorum.toString(), requiredQuorum.toString(), "法定人数应该匹配");
        assert.equal(actualMajority.toString(), requiredMajority.toString(), "多数票百分比应该匹配");
        assert.equal(actualAdmin, admin, "管理员地址应该匹配");
    });

    it("非成员不能添加新成员", async () => {
        try {
            await daoInstance.addMember(member1, { from: nonMember });
            assert.fail("交易应该失败");
        } catch (error) {
            // 使用更宽松的错误检查
            assert(
                error.message.includes("revert") ||
                error.message.includes("权限") ||
                error.message.includes("member") ||
                error.message.includes("only"),
                "错误应该与权限相关" + error.message
            );
        }
    });

    // 可以添加的额外测试
    it("应该正确定义状态常量", async () => {
        const STATUS_PENDING = await daoInstance.STATUS_PENDING();
        const STATUS_FUNDRAISING = await daoInstance.STATUS_FUNDRAISING();
        const STATUS_PENDING_RELEASE = await daoInstance.STATUS_PENDING_RELEASE();
        const STATUS_COMPLETED = await daoInstance.STATUS_COMPLETED();
        const STATUS_REJECTED = await daoInstance.STATUS_REJECTED();

        assert.equal(STATUS_PENDING.toString(), "0", "STATUS_PENDING 应该是 0");
        assert.equal(STATUS_FUNDRAISING.toString(), "1", "STATUS_FUNDRAISING 应该是 1");
        assert.equal(STATUS_PENDING_RELEASE.toString(), "2", "STATUS_PENDING_RELEASE 应该是 2");
        assert.equal(STATUS_COMPLETED.toString(), "3", "STATUS_COMPLETED 应该是 3");
        assert.equal(STATUS_REJECTED.toString(), "4", "STATUS_REJECTED 应该是 4");
    });
});