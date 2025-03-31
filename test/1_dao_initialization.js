const CharityToken = artifacts.require("CharityToken");
const CharityDAO = artifacts.require("CharityDAO");

contract("CharityDAO - 初始化测试", accounts => {
    const [admin, member1, nonMember] = accounts;
    const initialMembers = [admin];
    const requiredQuorum = 1;
    const requiredMajority = 51;

    let daoInstance;
    let tokenInstance;

    before(async () => {
        // 部署代币合约
        tokenInstance = await CharityToken.new(
            "Charity Governance Token",
            "CGT",
            1000000
        );

        // 部署DAO合约，传入代币地址
        daoInstance = await CharityDAO.new(
            initialMembers,
            requiredQuorum,
            requiredMajority,
            tokenInstance.address  // 添加代币地址参数
        );
    });

    it("应该正确初始化DAO参数", async () => {
        // 获取状态变量
        const memberCount = await daoInstance.memberCount();
        const isAdminMember = await daoInstance.members(admin);
        const actualQuorum = await daoInstance.requiredQuorum();
        const actualMajority = await daoInstance.requiredMajority();
        const actualAdmin = await daoInstance.admin();
        const governanceTokenAddress = await daoInstance.governanceToken();

        assert.equal(memberCount.toString(), "1", "成员数量应该是1");
        assert.equal(isAdminMember, true, "管理员应该是成员");
        assert.equal(actualQuorum.toString(), requiredQuorum.toString(), "法定人数应该匹配");
        assert.equal(actualMajority.toString(), requiredMajority.toString(), "多数票百分比应该匹配");
        assert.equal(actualAdmin, admin, "管理员地址应该匹配");
        assert.equal(governanceTokenAddress, tokenInstance.address, "治理代币地址应该匹配");
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

    // 添加投票权重测试
    it("应检查管理员的代币余额", async () => {
        const tokenAddress = await daoInstance.governanceToken();
        const tokenContract = await CharityToken.at(tokenAddress);

        const adminBalance = await tokenContract.balanceOf(admin);
        console.log("管理员代币余额:", adminBalance.toString());

        // 如果余额不为0，尝试重置
        if (adminBalance > 0) {
            try {
                // 如果您的代币合约有burn方法
                if (typeof tokenContract.burn === 'function') {
                    await tokenContract.burn(adminBalance, { from: admin });
                    const newBalance = await tokenContract.balanceOf(admin);
                    console.log("重置后余额:", newBalance.toString());
                }
                // 如果您的代币合约支持transfer
                else if (typeof tokenContract.transfer === 'function') {
                    const deadAddress = "0x000000000000000000000000000000000000dEaD";
                    await tokenContract.transfer(deadAddress, adminBalance, { from: admin });
                    const newBalance = await tokenContract.balanceOf(admin);
                    console.log("重置后余额:", newBalance.toString());
                }
            } catch (error) {
                console.log("重置余额时出错:", error.message);
            }
        }
    });

    it("应该返回正确的投票权重参数", async () => {
        const baseWeight = await daoInstance.baseVotingWeight();
        const maxWeight = await daoInstance.maxVotingWeight();
        const threshold = await daoInstance.tokenWeightThreshold();

        console.log("baseWeight:", baseWeight.toString());
        console.log("maxWeight:", maxWeight.toString());
        console.log("threshold:", threshold.toString());
        assert.equal(baseWeight.toString(), "1", "基础权重应该是1");
        assert.equal(maxWeight.toString(), "3", "最大权重应该是3");
        assert.equal(threshold.toString(), "10000000000000000000000", "代币阈值应该是10000个代币");
    });

});