const CharityToken = artifacts.require("CharityToken");
const CharityDAO = artifacts.require("CharityDAO");

contract("CharityDAO - Member Management Tests", accounts => {
    const [admin, member1, member2, nonMember] = accounts;

    let daoInstance;
    let tokenInstance;

    beforeEach(async () => {
        // Deploy a new token contract for each test
        tokenInstance = await CharityToken.new("Charity Token", "CHA", 0);

        // Redeploy contract before each test, providing token address
        daoInstance = await CharityDAO.new(
            [admin],
            1,
            51,
            tokenInstance.address
        );
    });

    it("members can add new members", async () => {
        // Admin adds new member
        await daoInstance.addMember(member1, { from: admin });

        // Check member status
        const isMember = await daoInstance.members(member1);
        const memberCount = await daoInstance.memberCount();

        assert.equal(isMember, true, "Member should be successfully added");
        assert.equal(memberCount.toString(), "2", "Member count should increase");
    });

    it("should trigger MemberAdded event", async () => {
        // Get transaction receipt to check events
        const tx = await daoInstance.addMember(member1, { from: admin });

        // Check if event was triggered
        assert.equal(tx.logs.length, 1, "Should trigger one event");
        assert.equal(tx.logs[0].event, "MemberAdded", "Should be MemberAdded event");
        assert.equal(tx.logs[0].args.member, member1, "Member address should match");
    });

    it("admin can remove other members", async () => {
        // First add a member
        await daoInstance.addMember(member1, { from: admin });

        // Then admin removes the member
        await daoInstance.removeMember(member1, { from: admin });

        // Check member status
        const isMember = await daoInstance.members(member1);
        const memberCount = await daoInstance.memberCount();

        assert.equal(isMember, false, "Member should be successfully removed");
        assert.equal(memberCount.toString(), "1", "Member count should decrease");
    });

    it("cannot remove non-existent members", async () => {
        try {
            await daoInstance.removeMember(nonMember, { from: admin });
            assert.fail("Transaction should fail");
        } catch (error) {
            // Use exact error message from contract
            assert(
                error.message.includes("Address is not a member"),
                "Error should indicate address is not a member: " + error.message
            );
        }
    });


    // Non-admins cannot add or remove members
    it("non-admins cannot add members", async () => {
        // First admin adds member1
        await daoInstance.addMember(member1, { from: admin });

        try {
            // member1 tries to add member2
            await daoInstance.addMember(member2, { from: member1 });
            assert.fail("Transaction should fail");
        } catch (error) {
            assert(
                error.message.includes("Only admin can call this function"),
                "Error should indicate only admin can call: " + error.message
            );
        }
    });

    it("non-admins cannot remove members", async () => {
        // First admin adds member1 and member2
        await daoInstance.addMember(member1, { from: admin });
        await daoInstance.addMember(member2, { from: admin });

        try {
            // member1 tries to remove member2
            await daoInstance.removeMember(member2, { from: member1 });
            assert.fail("Transaction should fail");
        } catch (error) {
            assert(
                error.message.includes("Only admin can call this function"),
                "Error should indicate only admin can call: " + error.message
            );
        }
    });
});