const CharityDAO = artifacts.require("CharityDAO");
const CharityProjectFactory = artifacts.require("CharityProjectFactory");
const CharityToken = artifacts.require("CharityToken");

/**
 * Deploy CharityDAO and CharityProjectFactory contracts
 * @param {Object} deployer - Truffle deployment tool
 * @param {String} network - Current network name for deployment
 * @param {Array} accounts - List of accounts on the current network
 */
module.exports = async function(deployer, network, accounts) {
    try {
        console.log("----- Starting CharityDAO System Deployment -----");
        console.log("Deployment account:", accounts[0]);
        console.log("Network:", network);

        // Check if there's a token contract
        let tokenAddress;

        await deployer.deploy(CharityToken, "Charity Token", "CHT", "1000000");
        const tokenInstance = await CharityToken.deployed();
        tokenAddress = tokenInstance.address;
        // Directly check member mapping
        console.log("Token deployment successful! Address:", tokenAddress);

        // Deployment parameters
        const initialMembers = [accounts[0]]; // Initial DAO member is the deployment account
        const quorum = 1; // Minimum quorum
        const majorityPercentage = 51; // Percentage of majority votes needed to pass a proposal


        console.log("Initial members:", initialMembers);
        console.log("Quorum:", quorum);
        console.log("Majority percentage:", majorityPercentage, "%");

        // Step 1: Deploy CharityDAO contract
        console.log("\nDeploying CharityDAO contract...");
        await deployer.deploy(CharityDAO, initialMembers, quorum, majorityPercentage, tokenAddress);
        const daoInstance = await CharityDAO.deployed();
        console.log("CharityDAO contract address:", daoInstance.address);

        // Print initial DAO state
        // Use public state variable memberCount instead of getMemberCount function
        const memberCount = await daoInstance.memberCount();
        console.log("Initial member count:", memberCount.toString());


        const isMember = await daoInstance.members(accounts[0]);
        console.log("Is deployment account a member:", isMember);

        // Step 2: Deploy CharityProjectFactory contract
        console.log("\nDeploying CharityProjectFactory contract...");
        await deployer.deploy(CharityProjectFactory, daoInstance.address, tokenAddress);
        const factoryInstance = await CharityProjectFactory.deployed();
        console.log("CharityProjectFactory contract address:", factoryInstance.address);

        // Verify Factory settings
        const daoAddress = await factoryInstance.daoAddress();
        console.log("DAO address in factory contract:", daoAddress);
        console.log("Verification: DAO address matches =", daoAddress === daoInstance.address);

        // Print contract interaction instructions
        console.log("\n----- Deployment Complete -----");
        console.log("CharityDAO address:", daoInstance.address);
        console.log("CharityProjectFactory address:", factoryInstance.address);
        console.log("\nUse these addresses to interact with contracts in your application");
        console.log("Example: const dao = await CharityDAO.at('" + daoInstance.address + "');");

    } catch (error) {
        console.error("\nDeployment failed:");
        console.error(error);
        throw error; // Re-throw the error to ensure Truffle knows the deployment failed
    }
};