const CharityDAO = artifacts.require("CharityDAO");
const CharityProjectFactory = artifacts.require("CharityProjectFactory");
const CharityProject = artifacts.require("CharityProject");
const CHT = artifacts.require("CharityToken"); // Added token contract

contract("Charity DAO System - Integration Test (Weighted Voting Version)", accounts => {
    // Role assignments
    const [admin, member1, member2, projectOwner, donor1, donor2] = accounts;

    // DAO parameters
    const initialMembers = [admin, member1, member2];
    const requiredQuorum = 2;     // Quorum
    const requiredMajority = 51;  // Majority vote percentage requirement

    // Project parameters
    const projectName = "Hope Project";
    const projectDescription = "Providing educational support for children in poor areas";
    const auditMaterials = "ipfs://QmInitialAuditMaterialsHash";
    const targetAmount = web3.utils.toWei("5", "ether");  // 5 ETH
    const duration = 60 * 60 * 24 * 30;  // 30 days project duration

    // Status constants
    const STATUS_PENDING = 0;         // Pending review
    const STATUS_FUNDRAISING = 1;     // Fundraising
    const STATUS_PENDING_RELEASE = 2; // Pending fund release
    const STATUS_COMPLETED = 3;       // Completed
    const STATUS_REJECTED = 4;        // Rejected

    // System contract instances
    let tokenInstance;
    let daoInstance;
    let factoryInstance;
    let projectAddress;
    let projectInstance;

    // Proposal IDs
    let approvalProposalId;
    let fundsReleaseProposalId;

    // Initialize token distribution before testing
    before(async () => {
        // Deploy token contract
        const initialSupply = web3.utils.toWei("1000000", "ether"); // 1 million tokens initial supply
        tokenInstance = await CHT.new("Charity Token", "CGT", initialSupply);
        // Allocate initial tokens to test accounts
        await tokenInstance.mint(admin, web3.utils.toWei("1000", "ether"));
        await tokenInstance.mint(member1, web3.utils.toWei("800", "ether"));
        await tokenInstance.mint(member2, web3.utils.toWei("600", "ether"));

        console.log("Token initialization complete:");
        console.log(`Admin token balance: ${web3.utils.fromWei(await tokenInstance.balanceOf(admin), "ether")} CGT`);
        console.log(`Member1 token balance: ${web3.utils.fromWei(await tokenInstance.balanceOf(member1), "ether")} CGT`);
        console.log(`Member2 token balance: ${web3.utils.fromWei(await tokenInstance.balanceOf(member2), "ether")} CGT`);
    });

    it("Complete charity project lifecycle test", async () => {
        try {
            // STEP 1: System initialization and deployment
            console.log("\n======== STEP 1: System Initialization and Deployment ========");

            // Deploy DAO contract, including token address
            daoInstance = await CharityDAO.new(initialMembers, requiredQuorum, requiredMajority, tokenInstance.address);
            console.log(`DAO contract deployed successfully, address: ${daoInstance.address}`);

            // Verify DAO initialization parameters
            const memberCount = await daoInstance.memberCount();
            const quorum = await daoInstance.requiredQuorum();
            const majority = await daoInstance.requiredMajority();
            const CHTAddress = await daoInstance.governanceToken();

            assert.equal(memberCount.toString(), initialMembers.length.toString(), "DAO member count doesn't match");
            assert.equal(quorum.toString(), requiredQuorum.toString(), "Quorum doesn't match");
            assert.equal(majority.toString(), requiredMajority.toString(), "Majority requirement doesn't match");
            assert.equal(CHTAddress, tokenInstance.address, "Governance token address doesn't match");

            // Check each member's voting weight
            for (const member of initialMembers) {
                const weight = await daoInstance.calculateVotingWeight(member);
                console.log(`${member} voting weight: ${weight.toString()}`);
                // Verify weight is related to token balance
                const tokenBalance = await tokenInstance.balanceOf(member);
                console.log(`${member} token balance: ${web3.utils.fromWei(tokenBalance, "ether")} CGT`);
            }

            // Deploy project factory contract
            factoryInstance = await CharityProjectFactory.new(daoInstance.address,tokenInstance.address);
            console.log(`Project factory contract deployed successfully, address: ${factoryInstance.address}`);

            // STEP 2: Create charity project
            console.log("\n======== STEP 2: Create Charity Project ========");

            // Create project through factory
            console.log(`Starting to create project "${projectName}"...`);
            const tx = await factoryInstance.createProject(
                projectName,
                projectDescription,
                auditMaterials,
                targetAmount,
                duration,
                { from: projectOwner }
            );

            // Get project address from event
            const projectCreatedEvent = tx.logs.find(log => log.event === "ProjectCreated");
            projectAddress = projectCreatedEvent.args.projectAddress;
            console.log(`Project created successfully, address: ${projectAddress}`);

            // Get project contract instance
            projectInstance = await CharityProject.at(projectAddress);

            // Verify project initial information
            const projectDetails = await projectInstance.getProjectDetails();
            console.log(`Project name: ${projectDetails[0]}`);
            console.log(`Project description: ${projectDetails[1]}`);
            console.log(`Target amount: ${web3.utils.fromWei(projectDetails[3], "ether")} ETH`);
            console.log(`Project owner: ${projectDetails[6]}`);
            console.log(`Project initial status: ${projectDetails[7]}`);
            console.log(`Governance token address: ${projectDetails[8]}`);  // New: Check governance token address in project

            assert.equal(projectDetails[0], projectName, "Project name doesn't match");
            assert.equal(projectDetails[6], projectOwner, "Project owner doesn't match");
            assert.equal(projectDetails[7], STATUS_PENDING, "Project initial status should be pending review");
            assert.equal(projectDetails[8], tokenInstance.address, "Governance token address in project doesn't match");

            // STEP 3: Project approval process
            console.log("\n======== STEP 3: Project Approval Process ========");

            // Verify project is registered in DAO
            const registeredProject = await daoInstance.registeredProjects(projectAddress);
            console.log(`Project registration status in DAO: ${registeredProject.exists ? "Registered" : "Not registered"}`);
            assert.equal(registeredProject.exists, true, "Project should be registered in DAO");

            // Get approval proposal ID
            approvalProposalId = registeredProject.approvalProposalId.toNumber();
            console.log(`Project approval proposal ID: ${approvalProposalId}`);

            // Get proposal details
            let proposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
            console.log(`Proposal creation time: ${new Date(proposalInfo.createdAt * 1000).toLocaleString()}`);
            console.log(`Proposal voting deadline: ${new Date(proposalInfo.votingDeadline * 1000).toLocaleString()}`);
            console.log(`Proposal initial status: Weighted Yes votes=${proposalInfo.weightedYesVotes}, Weighted No votes=${proposalInfo.weightedNoVotes}`);

            // DAO members vote - now using weighted voting
            console.log("DAO members start casting weighted votes...");

            // Admin votes
            const adminWeight = await daoInstance.calculateVotingWeight(admin);
            await daoInstance.vote(approvalProposalId, true, { from: admin });
            console.log(`${admin} votes: Yes, weight: ${adminWeight}`);

            // Get proposal status after Admin vote
            let afterAdminVote = await daoInstance.getProposalInfo(approvalProposalId);
            console.log(`After Admin vote: Weighted Yes votes=${afterAdminVote.weightedYesVotes}, Weighted No votes=${afterAdminVote.weightedNoVotes}, Required weight to pass=${requiredMajority.toString()}`);
            console.log(`Proposal status: ${proposalInfo.executed ? "Executed" : "Not executed"}, ${proposalInfo.passed ? "Passed" : "Not passed"}`);

            // Member1 votes
            const member1Weight = await daoInstance.calculateVotingWeight(member1);
            await daoInstance.vote(approvalProposalId, true, { from: member1 });
            console.log(`${member1} votes: Yes, weight: ${member1Weight}`);

            // Get proposal status after voting
            proposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
            console.log(`Voting result: Weighted Yes votes=${proposalInfo.weightedYesVotes}, Weighted No votes=${proposalInfo.weightedNoVotes}`);
            console.log(`Proposal status: ${proposalInfo.executed ? "Executed" : "Not executed"}, ${proposalInfo.passed ? "Passed" : "Not passed"}`);

            // Verify proposal has been executed and passed
            assert.equal(proposalInfo.executed, true, "Proposal should be executed");
            assert.equal(proposalInfo.passed, true, "Proposal should have passed");
            assert.equal(proposalInfo.weightedYesVotes.toString(), adminWeight.add(member1Weight).toString(), "Weighted yes vote calculation incorrect");

            // Verify project status has been updated
            const statusAfterApproval = (await projectInstance.status()).toNumber();
            console.log(`Project status after approval: ${statusAfterApproval}`);
            assert.equal(statusAfterApproval, STATUS_FUNDRAISING, "Project status should be updated to fundraising");

            // STEP 4: Project fundraising
            console.log("\n======== STEP 4: Project Fundraising ========");

            //await tokenInstance.grantMinterRole(projectInstance.address, {from: admin});


            // Get donors' initial token balances
            const donor1InitialTokenBalance = await tokenInstance.balanceOf(donor1);
            const donor2InitialTokenBalance = await tokenInstance.balanceOf(donor2);
            console.log(`Donor1 initial token balance: ${web3.utils.fromWei(donor1InitialTokenBalance, "ether")} CGT`);
            console.log(`Donor2 initial token balance: ${web3.utils.fromWei(donor2InitialTokenBalance, "ether")} CGT`);

            // Get project initial balance
            const initialProjectBalance = await web3.eth.getBalance(projectAddress);
            console.log(`Project initial balance: ${web3.utils.fromWei(initialProjectBalance, "ether")} ETH`);

            // Donor1 donates
            const donation1 = web3.utils.toWei("2", "ether");
            await projectInstance.donate({ from: donor1, value: donation1 });
            console.log(`Donor1 (${donor1}) donates: ${web3.utils.fromWei(donation1, "ether")} ETH`);

            // Donor2 donates
            const donation2 = web3.utils.toWei("3", "ether");
            await projectInstance.donate({ from: donor2, value: donation2 });
            console.log(`Donor2 (${donor2}) donates: ${web3.utils.fromWei(donation2, "ether")} ETH`);

            // Get project balance after donations
            const projectBalanceAfterDonations = await web3.eth.getBalance(projectAddress);
            console.log(`Project balance after donations: ${web3.utils.fromWei(projectBalanceAfterDonations, "ether")} ETH`);

            // Verify project raised amount
            const raisedAmount = await projectInstance.raisedAmount();
            console.log(`Project raised amount: ${web3.utils.fromWei(raisedAmount, "ether")} ETH`);

            const totalDonations = web3.utils.toBN(donation1).add(web3.utils.toBN(donation2));
            assert.equal(raisedAmount.toString(), totalDonations.toString(), "Raised amount doesn't match");

            // Verify donation records
            const donor1Donation = await projectInstance.donations(donor1);
            const donor2Donation = await projectInstance.donations(donor2);

            assert.equal(donor1Donation.toString(), donation1, "Donor1's donation record doesn't match");
            assert.equal(donor2Donation.toString(), donation2, "Donor2's donation record doesn't match");

            // Verify token rewards
            const donor1FinalTokenBalance = await tokenInstance.balanceOf(donor1);
            const donor2FinalTokenBalance = await tokenInstance.balanceOf(donor2);

            const donor1TokenReward = donor1FinalTokenBalance.sub(web3.utils.toBN(donor1InitialTokenBalance));
            const donor2TokenReward = donor2FinalTokenBalance.sub(web3.utils.toBN(donor2InitialTokenBalance));

            console.log(`Donor1 token reward: ${web3.utils.fromWei(donor1TokenReward, "ether")} CGT`);
            console.log(`Donor2 token reward: ${web3.utils.fromWei(donor2TokenReward, "ether")} CGT`);
            // Verify reward calculation is correct
            const rewardRatio = await projectInstance.rewardRatio();
            const baseReward1 = web3.utils.toBN(donation1).mul(web3.utils.toBN(rewardRatio)).div(web3.utils.toBN(web3.utils.toWei("1", "ether")));
            const baseReward2 = web3.utils.toBN(donation2).mul(web3.utils.toBN(rewardRatio)).div(web3.utils.toBN(web3.utils.toWei("1", "ether")));

// Add 18 decimal places to match the actual minted tokens
            const expectedDonor1Reward = baseReward1.mul(web3.utils.toBN(10).pow(web3.utils.toBN(18)));
            const expectedDonor2Reward = baseReward2.mul(web3.utils.toBN(10).pow(web3.utils.toBN(18)));

            console.log(`Expected Donor1 reward (base): ${baseReward1.toString()}`);
            console.log(`Expected Donor1 reward (human readable): ${web3.utils.fromWei(expectedDonor1Reward, "ether")} CGT`);

// 4. Verify with correct expected values
            assert.equal(donor1TokenReward.toString(), expectedDonor1Reward.toString(), "Donor1's token reward calculation is incorrect");
            assert.equal(donor2TokenReward.toString(), expectedDonor2Reward.toString(), "Donor2's token reward calculation is incorrect");
            const balancedn1 = await tokenInstance.balanceOf(donor1);
            function formatTokenAmount(amount) {
                return web3.utils.fromWei(amount, "ether"); // Using ether unit, actually 10^18
            }

            console.log(`dn1 balance: ${formatTokenAmount(balancedn1)} CGT`);
            // STEP 5: Request fund release
            console.log("\n======== STEP 5: Request Fund Release ========");

            // Project owner updates audit materials
            const updatedAuditMaterials = "ipfs://QmUpdatedAuditMaterialsHash";
            await projectInstance.updateAuditMaterials(updatedAuditMaterials, { from: projectOwner });
            console.log(`Project owner updates audit materials: ${updatedAuditMaterials}`);

            // Project owner requests fund release
            await projectInstance.requestFundsRelease({ from: projectOwner });
            console.log(`Project owner (${projectOwner}) requests fund release`);

            // Verify project status
            const statusAfterRequest = (await projectInstance.status()).toNumber();
            console.log(`Project status after request: ${statusAfterRequest}`);
            assert.equal(statusAfterRequest, STATUS_PENDING_RELEASE, "Project status should be updated to pending fund release");

            // Verify fund release proposal is automatically created in DAO
            const updatedProject = await daoInstance.registeredProjects(projectAddress);
            fundsReleaseProposalId = updatedProject.fundsReleaseProposalId.toNumber();
            console.log(`Automatically created fund release proposal ID: ${fundsReleaseProposalId}`);
            assert(fundsReleaseProposalId > 0, "Fund release proposal should be created");

            // STEP 6: Fund release voting
            console.log("\n======== STEP 6: Fund Release Voting ========");

            // Record project owner's initial balance
            const initialOwnerBalance = web3.utils.toBN(await web3.eth.getBalance(projectOwner));
            console.log(`Project owner initial balance: ${web3.utils.fromWei(initialOwnerBalance, "ether")} ETH`);

            // Get fund release proposal initial status
            let releaseProposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
            console.log(`Fund release proposal initial status: Weighted Yes votes=${releaseProposalInfo.weightedYesVotes}, Weighted No votes=${releaseProposalInfo.weightedNoVotes}`);

            // DAO members vote - using weighted voting
            console.log("DAO members start weighted voting on fund release proposal...");

            // Admin votes
            await daoInstance.vote(fundsReleaseProposalId, true, { from: admin });
            console.log(`${admin} votes: Yes, weight: ${adminWeight}`);

            // Get proposal status after Admin vote
            let afterReleaseAdminVote = await daoInstance.getProposalInfo(fundsReleaseProposalId);
            console.log(`Fund release proposal after Admin vote: Weighted Yes votes=${afterReleaseAdminVote.weightedYesVotes}, Weighted No votes=${afterReleaseAdminVote.weightedNoVotes}`);
            console.log(`Proposal status: ${afterReleaseAdminVote.executed ? "Executed" : "Not executed"}, ${afterReleaseAdminVote.passed ? "Passed" : "Not passed"}`);

            // Member1 votes
            await daoInstance.vote(fundsReleaseProposalId, true, { from: member1 });
            console.log(`${member1} votes: Yes, weight: ${member1Weight}`);

            // Get final proposal status
            releaseProposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
            console.log(`Final voting result: Weighted Yes votes=${releaseProposalInfo.weightedYesVotes}, Weighted No votes=${releaseProposalInfo.weightedNoVotes}`);
            console.log(`Proposal status: ${releaseProposalInfo.executed ? "Executed" : "Not executed"}, ${releaseProposalInfo.passed ? "Passed" : "Not passed"}`);

            // Verify proposal has been executed and passed
            assert.equal(releaseProposalInfo.executed, true, "Proposal should be executed");
            assert.equal(releaseProposalInfo.passed, true, "Proposal should have passed");
            assert.equal(releaseProposalInfo.weightedYesVotes.toString(), adminWeight.add(member1Weight).toString(), "Weighted yes vote calculation incorrect");

            // STEP 7: Verify fund release results
            console.log("\n======== STEP 7: Verify Fund Release Results ========");

            // Verify project status
            const finalStatus = (await projectInstance.status()).toNumber();
            console.log(`Final project status: ${finalStatus}`);
            assert.equal(finalStatus, STATUS_COMPLETED, "Project status should be updated to completed");

            // Verify project balance
            const finalProjectBalance = await web3.eth.getBalance(projectAddress);
            console.log(`Project final balance: ${web3.utils.fromWei(finalProjectBalance, "ether")} ETH`);

            // Verify project owner balance increase
            const finalOwnerBalance = web3.utils.toBN(await web3.eth.getBalance(projectOwner));
            console.log(`Project owner final balance: ${web3.utils.fromWei(finalOwnerBalance, "ether")} ETH`);
            console.log(`Project owner balance increase: ${web3.utils.fromWei(finalOwnerBalance.sub(initialOwnerBalance), "ether")} ETH`);

            // Project balance should be close to zero and project owner balance should increase
            assert(web3.utils.toBN(finalProjectBalance).lt(web3.utils.toBN(web3.utils.toWei("0.01", "ether"))), "Project balance should be close to zero");
            assert(finalOwnerBalance.gt(initialOwnerBalance), "Project owner balance should increase");

            // STEP 8: System state consistency verification
            console.log("\n======== STEP 8: System State Consistency Verification ========");

            // Verify project record in DAO
            const finalProject = await daoInstance.registeredProjects(projectAddress);

            console.log("Project record in DAO:");
            console.log(`- Exists: ${finalProject.exists}`);
            console.log(`- Project name: ${finalProject.name}`);
            console.log(`- Project owner: ${finalProject.owner}`);
            console.log(`- Approval proposal ID: ${finalProject.approvalProposalId}`);
            console.log(`- Fund release proposal ID: ${finalProject.fundsReleaseProposalId}`);

            assert.equal(finalProject.exists, true, "Project record should exist");
            assert.equal(finalProject.name, projectName, "Project name should match");
            assert.equal(finalProject.owner, projectOwner, "Project owner should match");

            // Verify both proposal statuses again
            const finalApprovalProposal = await daoInstance.getProposalInfo(approvalProposalId);
            const finalReleaseProposal = await daoInstance.getProposalInfo(fundsReleaseProposalId);

            console.log("Final approval proposal status:");
            console.log(`- Executed: ${finalApprovalProposal.executed}`);
            console.log(`- Passed: ${finalApprovalProposal.passed}`);
            console.log(`- Weighted Yes votes: ${finalApprovalProposal.weightedYesVotes}`);
            console.log(`- Weighted No votes: ${finalApprovalProposal.weightedNoVotes}`);

            console.log("Final fund release proposal status:");
            console.log(`- Executed: ${finalReleaseProposal.executed}`);
            console.log(`- Passed: ${finalReleaseProposal.passed}`);
            console.log(`- Weighted Yes votes: ${finalReleaseProposal.weightedYesVotes}`);
            console.log(`- Weighted No votes: ${finalReleaseProposal.weightedNoVotes}`);

            assert.equal(finalApprovalProposal.executed && finalApprovalProposal.passed, true, "Approval proposal should be executed and passed");
            assert.equal(finalReleaseProposal.executed && finalReleaseProposal.passed, true, "Fund release proposal should be executed and passed");

            console.log("\n✅ Integration test successfully completed! Complete charity project lifecycle process verified - using weighted voting system");

        } catch (error) {
            console.error("\n❌ Integration test failed:");
            console.error(error.message);
            console.error("Error stack:", error.stack);
            assert.fail("Integration test should complete successfully: " + error.message);
        }
    });

    it("Weighted voting against case test", async () => {
        try {
            console.log("\n======== Starting Weighted Voting Against Case Test ========");

            // Create a new project for testing rejection process
            const rejectProjectName = "Project to Reject";
            const rejectTx = await factoryInstance.createProject(
                rejectProjectName,
                "This is a test project that will be rejected through weighted voting",
                "ipfs://rejectProject",
                web3.utils.toWei("2", "ether"),
                duration,
                { from: projectOwner }
            );

            const rejectProjectEvent = rejectTx.logs.find(log => log.event === "ProjectCreated");
            const rejectProjectAddress = rejectProjectEvent.args.projectAddress;
            console.log(`Project to reject created successfully, address: ${rejectProjectAddress}`);

            const rejectProjectInstance = await CharityProject.at(rejectProjectAddress);

            // Get project proposal ID
            const rejectRegisteredProject = await daoInstance.registeredProjects(rejectProjectAddress);
            const rejectProposalId = rejectRegisteredProject.approvalProposalId.toNumber();
            console.log(`Approval proposal ID for project to reject: ${rejectProposalId}`);

            // Verify initial status
            const initialStatus = (await rejectProjectInstance.status()).toNumber();
            assert.equal(initialStatus, STATUS_PENDING, "Project initial status should be pending review");

            // Get each member's voting weight
            const adminWeight = await daoInstance.calculateVotingWeight(admin);
            const member1Weight = await daoInstance.calculateVotingWeight(member1);
            const member2Weight = await daoInstance.calculateVotingWeight(member2);

            console.log("Member voting weights:");
            console.log(`- Admin: ${adminWeight.toString()}`);
            console.log(`- Member1: ${member1Weight.toString()}`);
            console.log(`- Member2: ${member2Weight.toString()}`);

            // 3. DAO members vote to approve the project, setting it to fundraising status
            console.log("DAO members voting to approve project...");
            await daoInstance.vote(rejectProposalId, true, { from: admin });
            await daoInstance.vote(rejectProposalId, true, { from: member1 });
            // 4. Verify project status changes to fundraising
            const statusAfterApproval = (await rejectProjectInstance.status()).toNumber();
            console.log(`Project status after approval: ${statusAfterApproval}`);
            assert.equal(statusAfterApproval, STATUS_FUNDRAISING, "Project status should be updated to fundraising");

            // 5. Donate to project
            console.log("Donating to project...");
            await rejectProjectInstance.donate({ from: donor1, value: web3.utils.toWei("0.5", "ether") });
            await rejectProjectInstance.donate({ from: donor2, value: web3.utils.toWei("1.0", "ether") });

            // 6. Verify project has received donations
            const projectBalancebefore = await web3.eth.getBalance(rejectProjectInstance.address);
            console.log(`Project balance after donations: ${web3.utils.fromWei(projectBalancebefore, "ether")} ETH`);
            assert(web3.utils.toBN(projectBalancebefore).gt(web3.utils.toBN(0)), "Project should have balance");

            // 7. Project owner requests fund release
            console.log("Project owner requests fund release...");
            await rejectProjectInstance.requestFundsRelease({ from: projectOwner });

            // 8. Verify project status is pending fund release
            const statusAfterRequest = (await rejectProjectInstance.status()).toNumber();
            console.log(`Project status after fund release request: ${statusAfterRequest}`);
            assert.equal(statusAfterRequest, STATUS_PENDING_RELEASE, "Project status should be pending fund release");

            // 9. Get fund release proposal ID
            const updatedRefundProject = await daoInstance.registeredProjects(rejectProjectInstance.address);
            const fundsReleaseProposalId = updatedRefundProject.fundsReleaseProposalId.toNumber();
            console.log(`Fund release proposal ID: ${fundsReleaseProposalId}`);

            // 10. Record donors' balances before rejection
            const donor1BalanceBefore = web3.utils.toBN(await web3.eth.getBalance(donor1));
            const donor2BalanceBefore = web3.utils.toBN(await web3.eth.getBalance(donor2));
            console.log(`Donor1 balance before rejection: ${web3.utils.fromWei(donor1BalanceBefore, "ether")} ETH`);
            console.log(`Donor2 balance before rejection: ${web3.utils.fromWei(donor2BalanceBefore, "ether")} ETH`);

            // 11. DAO members vote to reject fund release
            console.log("DAO members voting to reject fund release...");
            await daoInstance.vote(fundsReleaseProposalId, false, { from: admin });
            await daoInstance.vote(fundsReleaseProposalId, false, { from: member2 });

            // 12. Verify project status changes to rejected
            const statusAfterRejection = (await rejectProjectInstance.status()).toNumber();
            console.log(`Project status after rejection: ${statusAfterRejection}`);
            assert.equal(statusAfterRejection, STATUS_REJECTED, "Project status should be updated to rejected");

            // 13. Get donors' balances after rejection
            const donor1BalanceAfter = web3.utils.toBN(await web3.eth.getBalance(donor1));
            const donor2BalanceAfter = web3.utils.toBN(await web3.eth.getBalance(donor2));
            console.log(`Donor1 balance after rejection: ${web3.utils.fromWei(donor1BalanceAfter, "ether")} ETH`);
            console.log(`Donor2 balance after rejection: ${web3.utils.fromWei(donor2BalanceAfter, "ether")} ETH`);
            // Try to donate to a rejected project (should fail)
            try {
                await rejectProjectInstance.donate({ from: donor1, value: web3.utils.toWei("0.1", "ether") });
                assert.fail("Donating to a rejected project should fail");
            } catch (error) {
                assert(error.message.includes("revert"), "Revert should occur");
                console.log("✅ Verification passed: Cannot donate to rejected project");
            }

            console.log("\n✅ Weighted voting against case test successfully completed!");

        } catch (error) {
            console.error("\n❌ Weighted voting against case test failed:");
            console.error(error.message);
            console.error("Error stack:", error.stack);
            assert.fail("Weighted voting against case test should complete successfully: " + error.message);
        }
    });

    it("Edge cases and error handling test", async () => {
        try {
            console.log("\n======== Starting Edge Cases and Error Handling Test ========");

            const adminWeight = await daoInstance.calculateVotingWeight(admin);
            const member1Weight = await daoInstance.calculateVotingWeight(member1);
            const member2Weight = await daoInstance.calculateVotingWeight(member2);
            // Test 1: Non-admin cannot add members
            console.log("\nTest 1: Non-admin cannot add members");
            try {
                await daoInstance.addMember(donor1, { from: member1 });
                assert.fail("Non-admin should not be able to add members");
            } catch (error) {
                assert(error.message.includes("revert"), "Revert should occur");
                console.log("✅ Verification passed: Non-admin cannot add members");
            }

            // Test 2: Non-project owner cannot request fund release
            console.log("\nTest 2: Non-project owner cannot request fund release");
            try {
                await projectInstance.requestFundsRelease({ from: donor1 });
                assert.fail("Non-project owner should not be able to request fund release");
            } catch (error) {
                assert(error.message.includes("revert"), "Revert should occur");
                console.log("✅ Verification passed: Non-project owner cannot request fund release");
            }

            // Test 3: Non-DAO cannot update project status
            console.log("\nTest 3: Non-DAO cannot update project status");
            try {
                await projectInstance.updateStatus(STATUS_COMPLETED, { from: admin });
                assert.fail("Non-DAO should not be able to update project status");
            } catch (error) {
                assert(error.message.includes("revert"), "Revert should occur");
                console.log("✅ Verification passed: Non-DAO cannot update project status");
            }

            // Test 4: Non-members cannot vote in DAO
            console.log("\nTest 4: Non-members cannot vote in DAO");
            try {
                await daoInstance.vote(approvalProposalId, true, { from: donor1 });
                assert.fail("Non-members should not be able to vote in DAO");
            } catch (error) {
                assert(error.message.includes("revert"), "Revert should occur");
                console.log("✅ Verification passed: Non-members cannot vote in DAO");
            }

            // Test 5: Cannot vote on executed proposals
            console.log("\nTest 5: Cannot vote on executed proposals");
            try {
                await daoInstance.vote(approvalProposalId, true, { from: member2 });
                assert.fail("Should not be able to vote on executed proposals");
            } catch (error) {
                assert(error.message.includes("revert"), "Revert should occur");
                console.log("✅ Verification passed: Cannot vote on executed proposals");
            }

            // Test 6: Weight impact on voting results (new)
            console.log("\nTest 6: Testing weight impact on voting results");

            // Create a new test project
            const testWeightProjectName = "Weight Test Project";
            const testWeightTx = await factoryInstance.createProject(
                testWeightProjectName,
                "For testing impact of different weights on voting results",
                "ipfs://weightTestProject",
                web3.utils.toWei("1", "ether"),
                duration,
                { from: projectOwner }
            );

            const testWeightProjectEvent = testWeightTx.logs.find(log => log.event === "ProjectCreated");
            const testWeightProjectAddress = testWeightProjectEvent.args.projectAddress;
            console.log(`Weight test project created successfully, address: ${testWeightProjectAddress}`);

            // Get project proposal ID
            const testWeightRegisteredProject = await daoInstance.registeredProjects(testWeightProjectAddress);
            const testWeightProposalId = testWeightRegisteredProject.approvalProposalId.toNumber();
            console.log(`Weight test project approval proposal ID: ${testWeightProposalId}`);

            // Assume admin weight > member1 weight + member2 weight, test one vote veto effect
            // Admin votes in favor
            await daoInstance.vote(testWeightProposalId, true, { from: admin });
            console.log(`${admin} votes: In favor, weight: ${adminWeight}`);

            // Member1 and Member2 vote against
            await daoInstance.vote(testWeightProposalId, false, { from: member1 });
            console.log(`${member1} votes: Against, weight: ${member1Weight}`);

            await daoInstance.vote(testWeightProposalId, false, { from: member2 });
            console.log(`${member2} votes: Against, weight: ${member2Weight}`);

            // Get final proposal status
            const testWeightProposalInfo = await daoInstance.getProposalInfo(testWeightProposalId);
            console.log(`Voting result: Weighted Yes votes=${testWeightProposalInfo.weightedYesVotes}, Weighted No votes=${testWeightProposalInfo.weightedNoVotes}`);
            console.log(`Proposal status: ${testWeightProposalInfo.executed ? "Executed" : "Not executed"}, ${testWeightProposalInfo.passed ? "Passed" : "Not passed"}`);

            // Analyze voting result
            if (adminWeight.gt(member1Weight.add(member2Weight))) {
                console.log("High weight member (admin) vote outweighs two low weight members' against votes");
                assert.equal(testWeightProposalInfo.passed, true, "Due to admin's higher weight, proposal should pass");
            } else {
                console.log("Two low weight members' against votes together outweigh high weight member's in favor vote");
                assert.equal(testWeightProposalInfo.passed, false, "Due to higher total against weight, proposal should be rejected");
            }

            console.log(`Admin weight: ${adminWeight.toString()}`);
            console.log(`Member1+Member2 total weight: ${member1Weight.add(member2Weight).toString()}`);
            console.log(`Weight comparison result: ${adminWeight.gt(member1Weight.add(member2Weight)) ? "Admin weight is larger" : "Member1+Member2 total weight is larger"}`);

            console.log("\n✅ Edge cases and error handling test successfully completed! System security mechanisms working properly");

        } catch (error) {
            console.error("\n❌ Edge cases and error handling test failed:");
            console.error(error.message);
            console.error("Error stack:", error.stack);
            assert.fail("Edge cases and error handling test should complete successfully: " + error.message);
        }
    });
});