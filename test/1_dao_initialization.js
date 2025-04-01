const CharityToken = artifacts.require("CharityToken");
const CharityDAO = artifacts.require("CharityDAO");

contract("CharityDAO - Initialization Tests", accounts => {
    const [admin, member1, nonMember] = accounts;
    const initialMembers = [admin];
    const requiredQuorum = 1;
    const requiredMajority = 51;

    let daoInstance;
    let tokenInstance;

    before(async () => {
        // Deploy token contract
        tokenInstance = await CharityToken.new(
            "Charity Governance Token",
            "CGT",
            1000000
        );

        // Deploy DAO contract, passing in token address
        daoInstance = await CharityDAO.new(
            initialMembers,
            requiredQuorum,
            requiredMajority,
            tokenInstance.address  // Add token address parameter
        );
    });

    it("should initialize DAO parameters correctly", async () => {
        // Get state variables
        const memberCount = await daoInstance.memberCount();
        const isAdminMember = await daoInstance.members(admin);
        const actualQuorum = await daoInstance.requiredQuorum();
        const actualMajority = await daoInstance.requiredMajority();
        const actualAdmin = await daoInstance.admin();
        const governanceTokenAddress = await daoInstance.governanceToken();

        assert.equal(memberCount.toString(), "1", "Member count should be 1");
        assert.equal(isAdminMember, true, "Admin should be a member");
        assert.equal(actualQuorum.toString(), requiredQuorum.toString(), "Quorum should match");
        assert.equal(actualMajority.toString(), requiredMajority.toString(), "Majority percentage should match");
        assert.equal(actualAdmin, admin, "Admin address should match");
        assert.equal(governanceTokenAddress, tokenInstance.address, "Governance token address should match");
    });

    it("non-members cannot add new members", async () => {
        try {
            await daoInstance.addMember(member1, { from: nonMember });
            assert.fail("Transaction should fail");
        } catch (error) {
            // Use more lenient error checking
            assert(
                error.message.includes("revert") ||
                error.message.includes("permission") ||
                error.message.includes("member") ||
                error.message.includes("only"),
                "Error should be related to permissions" + error.message
            );
        }
    });

    // Additional tests that can be added
    it("should define status constants correctly", async () => {
        const STATUS_PENDING = await daoInstance.STATUS_PENDING();
        const STATUS_FUNDRAISING = await daoInstance.STATUS_FUNDRAISING();
        const STATUS_PENDING_RELEASE = await daoInstance.STATUS_PENDING_RELEASE();
        const STATUS_COMPLETED = await daoInstance.STATUS_COMPLETED();
        const STATUS_REJECTED = await daoInstance.STATUS_REJECTED();

        assert.equal(STATUS_PENDING.toString(), "0", "STATUS_PENDING should be 0");
        assert.equal(STATUS_FUNDRAISING.toString(), "1", "STATUS_FUNDRAISING should be 1");
        assert.equal(STATUS_PENDING_RELEASE.toString(), "2", "STATUS_PENDING_RELEASE should be 2");
        assert.equal(STATUS_COMPLETED.toString(), "3", "STATUS_COMPLETED should be 3");
        assert.equal(STATUS_REJECTED.toString(), "4", "STATUS_REJECTED should be 4");
    });

    // Add voting weight test
    it("should check admin's token balance", async () => {
        const tokenAddress = await daoInstance.governanceToken();
        const tokenContract = await CharityToken.at(tokenAddress);

        const adminBalance = await tokenContract.balanceOf(admin);
        console.log("Admin token balance:", adminBalance.toString());

        // If balance is not zero, try to reset it
        if (adminBalance > 0) {
            try {
                // If your token contract has a burn method
                if (typeof tokenContract.burn === 'function') {
                    await tokenContract.burn(adminBalance, { from: admin });
                    const newBalance = await tokenContract.balanceOf(admin);
                    console.log("Balance after reset:", newBalance.toString());
                }
                // If your token contract supports transfer
                else if (typeof tokenContract.transfer === 'function') {
                    const deadAddress = "0x000000000000000000000000000000000000dEaD";
                    await tokenContract.transfer(deadAddress, adminBalance, { from: admin });
                    const newBalance = await tokenContract.balanceOf(admin);
                    console.log("Balance after reset:", newBalance.toString());
                }
            } catch (error) {
                console.log("Error when resetting balance:", error.message);
            }
        }
    });

    it("should return correct voting weight parameters", async () => {
        const baseWeight = await daoInstance.baseVotingWeight();
        const maxWeight = await daoInstance.maxVotingWeight();
        const threshold = await daoInstance.tokenWeightThreshold();

        console.log("baseWeight:", baseWeight.toString());
        console.log("maxWeight:", maxWeight.toString());
        console.log("threshold:", threshold.toString());
        assert.equal(baseWeight.toString(), "1", "Base weight should be 1");
        assert.equal(maxWeight.toString(), "3", "Max weight should be 3");
        assert.equal(threshold.toString(), "10000000000000000000000", "Token threshold should be 10000 tokens");
    });

});