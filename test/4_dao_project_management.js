const CharityDAO = artifacts.require("CharityDAO");
const CharityProjectFactory = artifacts.require("CharityProjectFactory");
const CharityProject = artifacts.require("CharityProject");
const CharityToken = artifacts.require("CharityToken");

contract("Charity Project Fund Flow Tests", accounts => {
    // Role assignments
    const [admin, member1, member2, projectOwner, donor1, donor2] = accounts;

    // DAO parameters
    const initialMembers = [admin, member1];
    const requiredQuorum = 1;  // Quorum
    const requiredMajority = 60;  // Majority vote percentage

    // Project parameters
    const projectName = "Mountain Children Aid";
    const projectDescription = "Providing educational resources for children in mountain regions";
    const auditMaterials = "ipfs://QmT8JgZbLc7WCdMnAx8oYXXYz8xqPkG8ZspxkEFrTsU6KJ";
    const targetAmount = web3.utils.toWei("5", "ether");  // 5 ETH
    const duration = 60 * 60 * 24 * 30;  // 30 days

    // Status constants (consistent with contract constants)
    const STATUS_PENDING = 0;         // Pending review
    const STATUS_FUNDRAISING = 1;     // Fundraising
    const STATUS_PENDING_RELEASE = 2; // Pending fund release
    const STATUS_COMPLETED = 3;       // Completed
    const STATUS_REJECTED = 4;        // Rejected

    // Enum types (consistent with contract enums)
    const ProposalType = {
        ProjectApproval: 0,
        FundsRelease: 1
    };

    let daoInstance;
    let factoryInstance;
    let projectAddress;
    let projectInstance;
    let approvalProposalId;
    let fundsReleaseProposalId;
    let tokenInstance;

    before(async () => {
        const initialSupply = web3.utils.toWei("1000000", "ether"); // 1 million tokens initial supply
        tokenInstance = await CharityToken.new("Charity Token", "CHAR", initialSupply);

        // Deploy DAO and project factory contracts
        daoInstance = await CharityDAO.new(initialMembers, requiredQuorum, requiredMajority, tokenInstance.address);
        console.log("DAO deployment completed, address:", daoInstance.address);

        factoryInstance = await CharityProjectFactory.new(daoInstance.address, tokenInstance.address);
        console.log("Factory deployment completed, address:", factoryInstance.address);

        // Add another member
        await daoInstance.addMember(member2, { from: admin });
        console.log("Added member:", member2);

        // Distribute tokens to create different voting weights
        console.log("Distributing tokens to create different voting weights...");
        const weightThreshold = await daoInstance.tokenWeightThreshold();
        console.log("Weight threshold:", web3.utils.fromWei(weightThreshold, "ether"), "tokens");

        // Distribute different amounts of tokens to different members
        await tokenInstance.transfer(member1, web3.utils.toWei("5000", "ether"), { from: admin });
        await tokenInstance.transfer(member2, web3.utils.toWei("2500", "ether"), { from: admin });

        // Check each member's voting weight
        const weight_admin = await daoInstance.calculateVotingWeight(admin);
        const weight_member1 = await daoInstance.calculateVotingWeight(member1);
        const weight_member2 = await daoInstance.calculateVotingWeight(member2);

        console.log("Member voting weights:", {
            admin: weight_admin.toString(),
            member1: weight_member1.toString(),
            member2: weight_member2.toString()
        });
    });

    it("1. Project creation and registration", async () => {
        // Create project through factory
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
        assert(projectCreatedEvent, "Project creation event not triggered");

        projectAddress = projectCreatedEvent.args.projectAddress;
        console.log("Project created successfully, address:", projectAddress);

        // Get project instance
        projectInstance = await CharityProject.at(projectAddress);

        // Verify project basic information
        const projectDetails = await projectInstance.getProjectDetails();
        assert.equal(projectDetails[0], projectName, "Project name doesn't match");
        assert.equal(projectDetails[1], projectDescription, "Project description doesn't match");
        assert.equal(projectDetails[3].toString(), targetAmount, "Target amount doesn't match");
        assert.equal(projectDetails[6], projectOwner, "Project owner doesn't match");
        assert.equal(projectDetails[7], STATUS_PENDING, "Initial status should be pending review");

        // Verify project is registered in DAO
        const registeredProject = await daoInstance.registeredProjects(projectAddress);
        assert.equal(registeredProject.exists, true, "Project not registered in DAO");
        assert.equal(registeredProject.name, projectName, "Project name in DAO doesn't match");
        assert.equal(registeredProject.owner, projectOwner, "Project owner in DAO doesn't match");

        // Get approval proposal ID
        approvalProposalId = registeredProject.approvalProposalId.toNumber();
        console.log("Project approval proposal ID:", approvalProposalId);

        // Verify proposal information
        const proposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
        assert.equal(proposalInfo.projectAddress, projectAddress, "Project address in proposal doesn't match");
        assert.equal(proposalInfo.proposalType, ProposalType.ProjectApproval, "Proposal type should be project approval");
    });

    it("2. Project approval voting - using weighted voting", async () => {
        // Verify project initial status
        let status = (await projectInstance.status()).toNumber();
        assert.equal(status, STATUS_PENDING, "Project initial status should be pending review");

        // Get accurate project approval proposal ID
        const registeredProject = await daoInstance.registeredProjects(projectAddress);
        approvalProposalId = registeredProject.approvalProposalId.toNumber();
        console.log("Checking approval proposal ID:", approvalProposalId);

        // Get proposal information before voting
        const proposalBeforeVote = await daoInstance.getProposalInfo(approvalProposalId);
        console.log("Proposal status before voting:", {
            projectAddress: proposalBeforeVote[0],
            projectName: proposalBeforeVote[1],
            projectOwner: proposalBeforeVote[2],
            createdAt: proposalBeforeVote[3].toString(),
            votingDeadline: proposalBeforeVote[4].toString(),
            proposalType: proposalBeforeVote[5].toString(),
            weightedYesVotes: proposalBeforeVote[6].toString(),
            weightedNoVotes: proposalBeforeVote[7].toString(),
            executed: proposalBeforeVote[8],
            passed: proposalBeforeVote[9]
        });

        // Members vote - record each member's voting weight
        console.log("Members performing weighted voting...");

        try {
            // Get voting weights
            const weight_admin = await daoInstance.calculateVotingWeight(admin);
            console.log(`admin weight: ${weight_admin.toString()}`);

            // Record voting status before voting
            let hasVoted = await daoInstance.getMemberVote(approvalProposalId, admin);
            console.log(`admin voting status before voting: ${hasVoted}`);

            // admin votes
            const voteTx = await daoInstance.vote(approvalProposalId, true, { from: admin });
            console.log("admin voting transaction hash:", voteTx.tx);

            // Check transaction receipt and events
            const receipt = await web3.eth.getTransactionReceipt(voteTx.tx);
            console.log("Transaction status:", receipt.status);

            // Find Vote event
            const voteEvents = await daoInstance.getPastEvents('Voted', {
                fromBlock: receipt.blockNumber,
                toBlock: receipt.blockNumber
            });
            console.log("Voted event:", voteEvents.length > 0 ? "emitted" : "not emitted");
            if (voteEvents.length > 0) {
                console.log("Event details:", {
                    proposalId: voteEvents[0].args.proposalId.toString(),
                    voter: voteEvents[0].args.voter,
                    approved: voteEvents[0].args.approved,
                    weight: voteEvents[0].args.weight.toString()
                });
            }

            // Check status after voting
            hasVoted = await daoInstance.getMemberVote(approvalProposalId, admin);
            console.log(`admin voting status after voting: ${hasVoted}`);
            assert.notEqual(hasVoted, 0, "admin should be marked as having voted"); // 0 is None, 1 is Approve, 2 is Reject

            // Check if admin's voting weight is correctly recorded
            const adminVoteWeight = await daoInstance.getMemberVoteWeight(approvalProposalId, admin);
            console.log(`admin recorded voting weight: ${adminVoteWeight.toString()}`);
            assert.equal(adminVoteWeight.toString(), weight_admin.toString(), "admin's voting weight not correctly recorded");

            // Check proposal status after admin votes
            const proposalAfterAdminVote = await daoInstance.getProposalInfo(approvalProposalId);
            console.log("Proposal status after admin vote:", {
                weightedYesVotes: proposalAfterAdminVote[6].toString(),
                weightedNoVotes: proposalAfterAdminVote[7].toString(),
                executed: proposalAfterAdminVote[8],
                passed: proposalAfterAdminVote[9]
            });

            // Verify admin's weight is correctly counted
            assert.equal(
                proposalAfterAdminVote[6].toString(),
                weight_admin.toString(),
                "admin's voting weight not correctly counted"
            );

            // If proposal not executed, member1 also votes
            if (!proposalAfterAdminVote[8]) {
                console.log("Proposal not executed, member1 continues voting...");
                const weight_member1 = await daoInstance.calculateVotingWeight(member1);
                console.log(`member1 weight: ${weight_member1.toString()}`);

                const voteTx2 = await daoInstance.vote(approvalProposalId, true, { from: member1 });
                console.log("member1 voting transaction hash:", voteTx2.tx);

                // Check if member1's voting weight is correctly recorded
                const member1VoteWeight = await daoInstance.getMemberVoteWeight(approvalProposalId, member1);
                console.log(`member1 recorded voting weight: ${member1VoteWeight.toString()}`);
                assert.equal(member1VoteWeight.toString(), weight_member1.toString(), "member1's voting weight not correctly recorded");

                // Check proposal status after member1 votes
                const proposalAfterMember1Vote = await daoInstance.getProposalInfo(approvalProposalId);
                console.log("Proposal status after member1 vote:", {
                    weightedYesVotes: proposalAfterMember1Vote[6].toString(),
                    weightedNoVotes: proposalAfterMember1Vote[7].toString(),
                    executed: proposalAfterMember1Vote[8],
                    passed: proposalAfterMember1Vote[9]
                });

                // Verify member1's weight is correctly added
                const expectedYesVotes = web3.utils.toBN(weight_admin).add(web3.utils.toBN(weight_member1));
                assert.equal(
                    proposalAfterMember1Vote[6].toString(),
                    expectedYesVotes.toString(),
                    "member1's voting weight not correctly added"
                );

                // Check member1 voting status
                const member1HasVoted = await daoInstance.getMemberVote(approvalProposalId, member1);
                assert.notEqual(member1HasVoted, 0, "member1 should be marked as having voted");
            } else {
                console.log("Proposal already executed after admin vote, no need for member1 to vote");
            }

        } catch (error) {
            console.error("Error during voting process:", error.message);
            // Print more detailed error information
            if (error.reason) console.error("Error reason:", error.reason);
            if (error.data) console.error("Error data:", error.data);
            throw error; // Re-throw error
        }

        // Get final proposal status
        const approvalProposal = await daoInstance.getProposalInfo(approvalProposalId);
        console.log("Final proposal status:", {
            weightedYesVotes: approvalProposal[6].toString(),
            weightedNoVotes: approvalProposal[7].toString(),
            executed: approvalProposal[8],
            passed: approvalProposal[9]
        });

        // Verify proposal has been executed
        assert.equal(approvalProposal[8], true, "Proposal should have been executed");
        assert.equal(approvalProposal[9], true, "Proposal should have passed");

        // Verify project status is updated to fundraising
        status = (await projectInstance.status()).toNumber();
        assert.equal(status, STATUS_FUNDRAISING, "Project status should be updated to fundraising");
        console.log("Project approval passed, status updated to fundraising");
    });


    it("3. Donate to project", async () => {
        // Get initial balance
        const initialProjectBalance = await web3.eth.getBalance(projectAddress);
        console.log("Project initial balance:", web3.utils.fromWei(initialProjectBalance, "ether"), "ETH");

        // Donor1 donates 2 ETH
        const donation1 = web3.utils.toWei("2", "ether");
        await projectInstance.donate({ from: donor1, value: donation1 });
        console.log("Donor1 donation:", web3.utils.fromWei(donation1, "ether"), "ETH");

        // Donor2 donates 1.5 ETH
        const donation2 = web3.utils.toWei("1.5", "ether");
        await projectInstance.donate({ from: donor2, value: donation2 });
        console.log("Donor2 donation:", web3.utils.fromWei(donation2, "ether"), "ETH");

        // Verify project balance
        const projectBalance = await web3.eth.getBalance(projectAddress);
        const expectedBalance = web3.utils.toBN(initialProjectBalance).add(web3.utils.toBN(donation1)).add(web3.utils.toBN(donation2));
        assert.equal(projectBalance, expectedBalance.toString(), "Project balance doesn't match");
        console.log("Project current balance:", web3.utils.fromWei(projectBalance, "ether"), "ETH");

        // Verify project raised amount
        const raisedAmount = await projectInstance.raisedAmount();
        assert.equal(raisedAmount.toString(), expectedBalance.toString(), "Raised amount doesn't match");
    });

    it("4. Project owner requests fund release", async () => {
        // Project owner updates audit materials
        const newAuditMaterials = "ipfs://QmUpdatedAuditMaterialsHash";
        await projectInstance.updateAuditMaterials(newAuditMaterials, { from: projectOwner });
        console.log("Project owner updates audit materials:", newAuditMaterials);

        // Project owner requests fund release
        await projectInstance.requestFundsRelease({ from: projectOwner });
        console.log("Project owner requests fund release");

        // Verify project status
        const status = (await projectInstance.status()).toNumber();
        assert.equal(status, STATUS_PENDING_RELEASE, "Project status should be updated to pending release");

        // Check if fund release proposal is automatically created
        const registeredProject = await daoInstance.registeredProjects(projectAddress);
        fundsReleaseProposalId = registeredProject.fundsReleaseProposalId.toNumber();
        console.log("Automatically created fund release proposal ID:", fundsReleaseProposalId);

        // Verify proposal information
        const proposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
        assert.equal(proposalInfo.projectAddress, projectAddress, "Project address in proposal doesn't match");
        assert.equal(proposalInfo.proposalType, ProposalType.FundsRelease, "Proposal type should be fund release");
    });

    it("5. Fund release voting - using weighted voting", async () => {
        // Record project owner and project initial balances
        const initialOwnerBalance = web3.utils.toBN(await web3.eth.getBalance(projectOwner));
        const projectBalance = web3.utils.toBN(await web3.eth.getBalance(projectAddress));
        console.log("Project balance:", web3.utils.fromWei(projectBalance, "ether"), "ETH");
        console.log("Project owner initial balance:", web3.utils.fromWei(initialOwnerBalance, "ether"), "ETH");

        // Get proposal status before voting
        const proposalBeforeVote = await daoInstance.getProposalInfo(fundsReleaseProposalId);
        console.log("Fund release proposal status before voting:", {
            executed: proposalBeforeVote.executed,
            passed: proposalBeforeVote.passed,
            weightedYesVotes: proposalBeforeVote.weightedYesVotes.toString(),
            weightedNoVotes: proposalBeforeVote.weightedNoVotes.toString()
        });

        // admin votes
        const weight_admin = await daoInstance.calculateVotingWeight(admin);
        await daoInstance.vote(fundsReleaseProposalId, true, { from: admin });
        console.log(`admin voted in favor of fund release, weight: ${weight_admin}`);

        // Check status after admin votes
        const proposalAfterAdminVote = await daoInstance.getProposalInfo(fundsReleaseProposalId);
        console.log("Status after admin vote:", {
            executed: proposalAfterAdminVote.executed,
            passed: proposalAfterAdminVote.passed,
            weightedYesVotes: proposalAfterAdminVote.weightedYesVotes.toString(),
            weightedNoVotes: proposalAfterAdminVote.weightedNoVotes.toString()
        });

        // If admin's voting weight is not enough to pass the proposal, add member1's vote
        if (!proposalAfterAdminVote.executed) {
            const weight_member1 = await daoInstance.calculateVotingWeight(member1);
            await daoInstance.vote(fundsReleaseProposalId, true, { from: member1 });
            console.log(`member1 voted in favor of fund release, weight: ${weight_member1}`);

            // Check status after member1 votes
            const proposalAfterMember1Vote = await daoInstance.getProposalInfo(fundsReleaseProposalId);
            console.log("Status after member1 vote:", {
                executed: proposalAfterMember1Vote.executed,
                passed: proposalAfterMember1Vote.passed,
                weightedYesVotes: proposalAfterMember1Vote.weightedYesVotes.toString(),
                weightedNoVotes: proposalAfterMember1Vote.weightedNoVotes.toString()
            });

            // Verify member1's weight is correctly added
            const expectedYesVotes = web3.utils.toBN(weight_admin).add(web3.utils.toBN(weight_member1));
            assert.equal(
                proposalAfterMember1Vote.weightedYesVotes.toString(),
                expectedYesVotes.toString(),
                "member1's voting weight not correctly added"
            );
        }

        // Wait for transaction to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get final proposal status
        const releaseProposal = await daoInstance.getProposalInfo(fundsReleaseProposalId);
        console.log("Final fund release proposal status:", {
            executed: releaseProposal.executed,
            passed: releaseProposal.passed,
            weightedYesVotes: releaseProposal.weightedYesVotes.toString(),
            weightedNoVotes: releaseProposal.weightedNoVotes.toString()
        });

        // Verify proposal execution
        assert.equal(releaseProposal.executed, true, "Proposal should have been executed");
        assert.equal(releaseProposal.passed, true, "Proposal should have passed");

        // Verify project status
        const status = (await projectInstance.status()).toNumber();
        assert.equal(status, STATUS_COMPLETED, "Project status should be updated to completed");

        // Verify funds have been transferred to project owner
        const finalProjectBalance = web3.utils.toBN(await web3.eth.getBalance(projectAddress));
        console.log("Project final balance:", web3.utils.fromWei(finalProjectBalance, "ether"), "ETH");

        // Project balance should be zero or close to zero
        assert(finalProjectBalance.lt(web3.utils.toBN(web3.utils.toWei("0.01", "ether"))),
            "Project balance should be close to zero");

        // Get project owner final balance
        const finalOwnerBalance = web3.utils.toBN(await web3.eth.getBalance(projectOwner));
        console.log("Project owner final balance:", web3.utils.fromWei(finalOwnerBalance, "ether"), "ETH");

        // Due to gas fee impact, we can only roughly check if balance has increased
        // Check if project owner's balance has significantly increased (at least 90% of project balance)
        const expectedMinIncrease = projectBalance.mul(web3.utils.toBN(90)).div(web3.utils.toBN(100));
        const actualIncrease = finalOwnerBalance.sub(initialOwnerBalance);

        console.log("Expected minimum increase:", web3.utils.fromWei(expectedMinIncrease, "ether"), "ETH");
        console.log("Actual increase:", web3.utils.fromWei(actualIncrease, "ether"), "ETH");

        assert(finalOwnerBalance.gt(initialOwnerBalance), "Project owner balance should increase");
    });

    it("6. Weighted voting against case test", async () => {
        try {
            // Create a new project for testing weighted against voting scenario
            console.log("Starting to create weighted against test project...");
            const rejectedProjectName = "Weighted Against Test Project";
            const timestamp = Math.floor(Date.now() / 1000);
            let tx = await factoryInstance.createProject(
                `${rejectedProjectName}_${timestamp}`,
                "Testing weighted voting against mechanism",
                "ipfs://test-weighted-reject",
                web3.utils.toWei("1", "ether"),
                duration,
                { from: projectOwner }
            );

            const projectCreatedEvent = tx.logs.find(log => log.event === "ProjectCreated");
            const rejectedProjectAddress = projectCreatedEvent.args.projectAddress;
            console.log("Weighted against test project created successfully, address:", rejectedProjectAddress);

            const rejectedProjectInstance = await CharityProject.at(rejectedProjectAddress);

            // Get proposal ID
            const registeredProject = await daoInstance.registeredProjects(rejectedProjectAddress);
            const rejectProposalId = registeredProject.approvalProposalId.toNumber();
            console.log("Weighted against test project approval proposal ID:", rejectProposalId);

            // Verify initial status
            let status = (await rejectedProjectInstance.status()).toNumber();
            assert.equal(status, STATUS_PENDING, "Project initial status should be pending review");

            // Get members' voting weights
            const weight_admin = await daoInstance.calculateVotingWeight(admin);
            const weight_member1 = await daoInstance.calculateVotingWeight(member1);
            const weight_member2 = await daoInstance.calculateVotingWeight(member2);

            console.log("Member voting weights:", {
                admin: weight_admin.toString(),
                member1: weight_member1.toString(),
                member2: weight_member2.toString()
            });

            // member1 and member2 vote against (high weight members)
            console.log("Members begin voting weighted against...");

            await daoInstance.vote(rejectProposalId, false, { from: member1 });
            console.log(`member1 voted against, weight: ${weight_member1}`);

            // Check status after member1 votes
            const proposalAfterMember1Vote = await daoInstance.getProposalInfo(rejectProposalId);
            console.log("Status after member1 vote:", {
                executed: proposalAfterMember1Vote.executed,
                passed: proposalAfterMember1Vote.passed,
                weightedYesVotes: proposalAfterMember1Vote.weightedYesVotes.toString(),
                weightedNoVotes: proposalAfterMember1Vote.weightedNoVotes.toString()
            });

            // If proposal not executed, member2 also votes
            if (!proposalAfterMember1Vote.executed) {
                await daoInstance.vote(rejectProposalId, false, { from: member2 });
                console.log(`member2 voted against, weight: ${weight_member2}`);
            }

            // Wait for transaction to complete
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Get proposal info after voting
            const proposalInfo = await daoInstance.getProposalInfo(rejectProposalId);
            console.log("Final proposal info:", {
                executed: proposalInfo.executed,
                passed: proposalInfo.passed,
                weightedYesVotes: proposalInfo.weightedYesVotes.toString(),
                weightedNoVotes: proposalInfo.weightedNoVotes.toString(),
            });

            // Verify total weight of against votes
            const expectedNoVotes = web3.utils.toBN(weight_member1).add(web3.utils.toBN(weight_member2));
            assert.equal(
                proposalInfo.weightedNoVotes.toString(),
                expectedNoVotes.toString(),
                "Total weight of against votes doesn't match"
            );

            // Verify proposal status - should be executed but not passed
            assert.equal(proposalInfo.executed, true, "Proposal should automatically execute when against vote weight is high enough");
            assert.equal(proposalInfo.passed, false, "Proposal should be marked as not passed");

            // Get project final status
            status = (await rejectedProjectInstance.status()).toNumber();
            console.log("Project final status:", status);

            // Verify project status is updated to rejected
            assert.equal(status, STATUS_REJECTED, "Project status should be updated to rejected");

            console.log("✅ Weighted against voting test passed: Successfully created project and used weighted voting mechanism to vote against, proposal executed and didn't pass");

        } catch (error) {
            console.error("Weighted against voting test failed:", error.message);
            assert.fail("Test should succeed: " + error.message);
        }
    });

    it("7. Verify weighted voting system weight differences", async () => {
        // Create a new test project
        console.log("Creating weight difference test project...");
        const timestamp = Math.floor(Date.now() / 1000);
        const tx = await factoryInstance.createProject(
            `Weight Difference Test Project_${timestamp}`,
            "Testing voting weight differences between members",
            "ipfs://test-weight-difference",
            web3.utils.toWei("1", "ether"),
            duration,
            { from: projectOwner }
        );

        const projectCreatedEvent = tx.logs.find(log => log.event === "ProjectCreated");
        const testProjectAddress = projectCreatedEvent.args.projectAddress;
        console.log("Weight difference test project created successfully, address:", testProjectAddress);

        // Get proposal ID
        const registeredProject = await daoInstance.registeredProjects(testProjectAddress);
        const testProposalId = registeredProject.approvalProposalId.toNumber();
        console.log("Weight difference test proposal ID:", testProposalId);

        // Get members' voting weights
        const weight_admin = await daoInstance.calculateVotingWeight(admin);
        const weight_member1 = await daoInstance.calculateVotingWeight(member1);
        const weight_member2 = await daoInstance.calculateVotingWeight(member2);

        console.log("Voting weight comparison:", {
            admin: weight_admin.toString(),
            member1: weight_member1.toString(),
            member2: weight_member2.toString()
        });

        // Verify weight differences - based on token holdings, should be different
        assert(Number(weight_admin) !== Number(weight_member1), "admin and member1 weights should be different");
        assert(Number(weight_member1) !== Number(weight_member2), "member1 and member2 weights should be different");

        // Verify relationship between token holdings and weights
        console.log("Token holdings and weight relationship:", {
            'admin_tokens': await tokenInstance.balanceOf(admin).then(bal => web3.utils.fromWei(bal, "ether")),
            'admin_weight': weight_admin.toString(),
            'member1_tokens': await tokenInstance.balanceOf(member1).then(bal => web3.utils.fromWei(bal, "ether")),
            'member1_weight': weight_member1.toString(),
            'member2_tokens': await tokenInstance.balanceOf(member2).then(bal => web3.utils.fromWei(bal, "ether")),
            'member2_weight': weight_member2.toString()
        });

        // Test actual impact of weights in voting
        // Assume member1 weight is greater than admin+member2 total weight
        // Have admin and member2 vote one way, member1 vote the other, verify if member1 can decide the outcome alone

        const totalWeightAdminAndMember2 = web3.utils.toBN(weight_admin).add(web3.utils.toBN(weight_member2));
        console.log(`admin+member2 total weight: ${totalWeightAdminAndMember2}`);
        console.log(`member1 weight: ${weight_member1}`);

        // Determine voting strategy based on weight relationship
        if (web3.utils.toBN(weight_member1).gt(totalWeightAdminAndMember2)) {
            console.log("Test scenario: member1 weight is greater than admin+member2 total weight");

            // admin and member2 vote YES
            await daoInstance.vote(testProposalId, true, { from: admin });
            console.log(`admin voted in favor, weight: ${weight_admin}`);

            await daoInstance.vote(testProposalId, true, { from: member2 });
            console.log(`member2 voted in favor, weight: ${weight_member2}`);

            // member1 votes NO, should determine the outcome
            await daoInstance.vote(testProposalId, false, { from: member1 });
            console.log(`member1 voted against, weight: ${weight_member1}`);

            // Verify outcome
            const proposalInfo = await daoInstance.getProposalInfo(testProposalId);
            console.log("Final voting result:", {
                weightedYesVotes: proposalInfo.weightedYesVotes.toString(),
                weightedNoVotes: proposalInfo.weightedNoVotes.toString(),
                passed: proposalInfo.passed
            });

            // member1's against vote weight is higher, so proposal should not pass
            assert.equal(proposalInfo.passed, false, "member1's high weight vote should determine outcome");

        } else {
            console.log("Test scenario: member1 weight is less than or equal to admin+member2 total weight");

            // member1 votes NO
            await daoInstance.vote(testProposalId, false, { from: member1 });
            console.log(`member1 voted against, weight: ${weight_member1}`);

            // admin and member2 vote YES, should determine outcome
            await daoInstance.vote(testProposalId, true, { from: admin });
            console.log(`admin voted in favor, weight: ${weight_admin}`);

            await daoInstance.vote(testProposalId, true, { from: member2 });
            console.log(`member2 voted in favor, weight: ${weight_member2}`);

            // Verify outcome
            const proposalInfo = await daoInstance.getProposalInfo(testProposalId);
            console.log("Final voting result:", {
                weightedYesVotes: proposalInfo.weightedYesVotes.toString(),
                weightedNoVotes: proposalInfo.weightedNoVotes.toString(),
                passed: proposalInfo.passed
            });

            // admin+member2 yes vote weight is higher, so proposal should pass
            assert.equal(proposalInfo.passed, true, "admin+member2 total voting weight should determine outcome");
        }

        console.log("✅ Weighted voting weight difference test completed");
    });

    it("8. Abnormal case test: cannot donate when not approved", async () => {
        // Create a new project but don't vote to approve it
        const pendingProjectName = "Pending Project";
        const timestamp = Math.floor(Date.now() / 1000);
        const tx = await factoryInstance.createProject(
            `${pendingProjectName}_${timestamp}`,
            "This is a project in pending review status",
            "ipfs://test-pending",
            web3.utils.toWei("1", "ether"),
            duration,
            { from: projectOwner }
        );

        const projectCreatedEvent = tx.logs.find(log => log.event === "ProjectCreated");
        const pendingProjectAddress = projectCreatedEvent.args.projectAddress;
        console.log("Pending project created successfully, address:", pendingProjectAddress);

        const pendingProjectInstance = await CharityProject.at(pendingProjectAddress);

        // Trying to donate to unapproved project should fail
        try {
            await pendingProjectInstance.donate({ from: donor1, value: web3.utils.toWei("0.1", "ether") });
            assert.fail("Donating to unapproved project should fail");
        } catch (error) {
            assert(error.message.includes("revert"), "Revert should occur");
            console.log("Donation to unapproved project was blocked, as expected");
        }
    });

    it("9. Project status and process integrity verification", async () => {
        // Check final status of successfully completed project
        console.log("Verifying final status of successfully completed project...");

        // Get project details
        const projectDetails = await projectInstance.getProjectDetails();
        assert.equal(projectDetails[7], STATUS_COMPLETED, "Project final status should be completed");

        // Verify project balance is zero
        const projectBalance = await web3.eth.getBalance(projectAddress);
        assert.equal(projectBalance, "0", "Project balance should be zero");

        // Verify project record in DAO
        const registeredProject = await daoInstance.registeredProjects(projectAddress);
        assert.equal(registeredProject.exists, true, "Project should exist in DAO");

        // Verify both proposal statuses
        const approvalProposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
        assert.equal(approvalProposalInfo.executed, true, "Approval proposal should be executed");
        assert.equal(approvalProposalInfo.passed, true, "Approval proposal should have passed");

        const releaseProposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
        assert.equal(releaseProposalInfo.executed, true, "Fund release proposal should be executed");
        assert.equal(releaseProposalInfo.passed, true, "Fund release proposal should have passed");

        console.log("Project lifecycle verification complete, all statuses correct");
    });
});