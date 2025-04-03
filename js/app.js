// App initialization
const App = {
    web3: null,
    account: null,
    daoContract: null,
    factoryContract: null,
    tokenContract: null,

    // Status constants from the contract
    STATUS: {
        PENDING: 0,
        FUNDRAISING: 1,
        PENDING_RELEASE: 2,
        COMPLETED: 3,
        REJECTED: 4
    },

    // Proposal types from the contract
    PROPOSAL_TYPE: {
        PROJECT_APPROVAL: 0,
        FUNDS_RELEASE: 1
    },

    // Vote options from the contract
    VOTE_OPTION: {
        NONE: 0,
        APPROVE: 1,
        REJECT: 2
    },

    // Initialize the app
    init: async function () {
        console.log("Initializing app...");

        // Initialize navigation
        App.initNavigation();

        // Setup event listeners
        document.getElementById('connect-wallet').addEventListener('click', App.connectWallet);
        document.getElementById('add-member-btn').addEventListener('click', App.addMember);
        document.getElementById('create-project-btn').addEventListener('click', App.createProject);
        document.getElementById('back-to-projects').addEventListener('click', App.showProjectsList);

        // Tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tabGroup = this.parentElement;
                tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Handle tab switching logic
                const tabId = this.getAttribute('data-tab');
                if (tabId.includes('projects')) {
                    App.loadProjects(tabId);
                } else if (tabId.includes('proposals')) {
                    App.loadProposals(tabId);
                }
            });
        });

        // Check if MetaMask is already connected
        if (window.ethereum) {
            App.web3 = new Web3(window.ethereum);

            // Setup MetaMask event listeners
            window.ethereum.on('accountsChanged', function (accounts) {
                console.log("MetaMask accounts changed:", accounts);
                if (accounts.length > 0) {
                    App.account = accounts[0];
                    App.loadAccount();
                    App.loadDaoInfo();
                    App.loadProjects('all-projects');
                    App.loadProposals('active-proposals');
                } else {
                    // User disconnected all accounts
                    App.account = null;
                    document.getElementById('account-address').textContent = 'Not connected';
                    document.getElementById('account-balance').textContent = '0';
                    document.getElementById('member-status').textContent = 'Unknown';
                    document.getElementById('admin-status').textContent = 'No';
                    document.getElementById('dao-management').classList.add('hidden');
                    document.getElementById('project-creation').classList.add('hidden');
                    document.getElementById('add-member-section').classList.add('hidden');
                }
            });

            window.ethereum.on('chainChanged', function () {
                console.log("MetaMask chain changed, reloading...");
                window.location.reload();
            });

            // Try to get accounts without prompting
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    console.log("Found connected accounts:", accounts);
                    App.account = accounts[0];
                    await App.loadAccount();
                    await App.loadContracts();
                    await App.loadDaoInfo();
                    await App.loadProjects('all-projects');
                    await App.loadProposals('active-proposals');

                    // Show sections that require connection
                    document.getElementById('project-creation').classList.remove('hidden');
                    if (await App.isMember()) {
                        document.getElementById('dao-management').classList.remove('hidden');
                        document.getElementById('member-status').textContent = 'Yes';
                        document.getElementById('admin-status').textContent = await App.isAdmin() ? 'Yes' : 'No';
                    }
                }
            } catch (error) {
                console.error("Error checking for connected accounts:", error);
            }
        }

        // 新增代币分发按钮监听器
        const distributeTokensBtn = document.getElementById('distribute-tokens-btn');
        if (distributeTokensBtn) {
            distributeTokensBtn.addEventListener('click', App.distributeTokens);
        }

        console.log("App initialization complete");
    },

    // Connect wallet
    connectWallet: async function () {
        console.log("Connecting wallet...");

        if (window.ethereum) {
            App.web3 = new Web3(window.ethereum);
            try {
                // Request account access
                console.log("Requesting accounts...");
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                console.log("Accounts received:", accounts);

                if (accounts.length > 0) {
                    App.account = accounts[0];

                    // Update UI
                    document.getElementById('account-address').textContent = App.account;

                    // Get balance
                    const balance = await App.web3.eth.getBalance(App.account);
                    document.getElementById('account-balance').textContent = App.web3.utils.fromWei(balance, 'ether');

                    // Load contracts and data
                    await App.loadContracts();
                    await App.loadDaoInfo();
                    await App.loadProjects('all-projects');
                    await App.loadProposals('active-proposals');

                    // Check if user is a DAO member or admin
                    const isMember = await App.isMember();
                    const isAdmin = await App.isAdmin();

                    // 只有非 Member 且非 Admin 的普通用户才能看到 project-creation
                    if (!isMember && !isAdmin) {
                        document.getElementById('project-creation').classList.remove('hidden');
                    } else {
                        document.getElementById('project-creation').classList.add('hidden');
                    }

                    // DAO management 部分的显示逻辑
                    if (isMember || isAdmin) {
                        document.getElementById('dao-management').classList.remove('hidden');
                        document.getElementById('member-status').textContent = 'Yes';
                        document.getElementById('admin-status').textContent = isAdmin ? 'Yes' : 'No';

                        // 只有管理员可以看到 Add Member 部分
                        if (isAdmin) {
                            document.getElementById('add-member-section').classList.remove('hidden');
                        } else {
                            document.getElementById('add-member-section').classList.add('hidden');
                        }
                    } else {
                        document.getElementById('member-status').textContent = 'No';
                        document.getElementById('admin-status').textContent = 'No';
                        document.getElementById('dao-management').classList.add('hidden');
                        document.getElementById('add-member-section').classList.add('hidden');
                    }

                    // 更新连接按钮文本
                    await App.updateConnectButtonText(isAdmin, isMember);

                    console.log("Wallet connected successfully");
                } else {
                    console.error("No accounts found after connection request");
                    alert("Failed to connect wallet. Please make sure MetaMask is unlocked and try again.");
                }
            } catch (error) {
                console.error("Error connecting wallet:", error);
                alert("Failed to connect wallet: " + (error.message || "Unknown error"));
            }
        } else {
            console.log('Non-Ethereum browser detected. You should consider trying MetaMask!');
            alert('Please install MetaMask to use this dApp!');
        }
    },

    // Load user account
    loadAccount: async function () {
        if (!App.web3) return;

        try {
            const accounts = await App.web3.eth.getAccounts();
            App.account = accounts[0];

            // 更新 UI
            const addressElement = document.getElementById('account-address');
            const balanceElement = document.getElementById('account-balance');
            const memberStatusElement = document.getElementById('member-status');
            const adminStatusElement = document.getElementById('admin-status');

            if (addressElement) addressElement.textContent = App.account;

            // 获取余额
            if (App.account) {
                const balance = await App.web3.eth.getBalance(App.account);
                if (balanceElement) balanceElement.textContent = App.web3.utils.fromWei(balance, 'ether');
            }

            // 检查是否是 DAO 成员或管理员
            if (App.daoContract) {
                const isMember = await App.isMember();
                const isAdmin = await App.isAdmin();

                if (memberStatusElement) memberStatusElement.textContent = isMember ? 'Yes' : 'No';
                if (adminStatusElement) adminStatusElement.textContent = isAdmin ? 'Yes' : 'No';

                // 更新连接按钮文本
                await App.updateConnectButtonText(isAdmin, isMember);

                // 控制导航项的显示
                const createProjectNav = document.querySelector('.create-project-nav');
                const daoManagementNav = document.querySelector('.dao-management-nav');
                const addMemberSection = document.getElementById('add-member-section');

                if (isMember || isAdmin) {
                    if (createProjectNav) createProjectNav.style.display = 'none';
                    if (daoManagementNav) daoManagementNav.style.display = 'block';

                    if (isAdmin && addMemberSection) {
                        addMemberSection.classList.remove('hidden');
                    } else if (addMemberSection) {
                        addMemberSection.classList.add('hidden');
                    }
                } else {
                    if (createProjectNav) createProjectNav.style.display = 'block';
                    if (daoManagementNav) daoManagementNav.style.display = 'none';
                    if (addMemberSection) addMemberSection.classList.add('hidden');
                }
            }
        } catch (error) {
            console.error("Error in loadAccount:", error);
        }
    },

    // Load contracts - UPDATED
    loadContracts: async function () {
        try {
            console.log("Loading contracts...");

            // 加载 DAO 合约
            const daoResponse = await fetch('build/contracts/CharityDAO.json');
            const daoData = await daoResponse.json();
            App.daoContract = TruffleContract(daoData);
            App.daoContract.setProvider(window.ethereum);

            // 加载工厂合约
            const factoryResponse = await fetch('build/contracts/CharityProjectFactory.json');
            const factoryData = await factoryResponse.json();
            App.factoryContract = TruffleContract(factoryData);
            App.factoryContract.setProvider(window.ethereum);

            // 获取已部署的合约实例
            const daoInstance = await App.daoContract.deployed();
            const factoryInstance = await App.factoryContract.deployed();

            // 更新 UI
            document.getElementById('dao-address').textContent = daoInstance.address;
            document.getElementById('factory-address').textContent = factoryInstance.address;

            // 获取代币地址并加载代币合约
            const tokenAddress = await daoInstance.governanceToken();
            const tokenResponse = await fetch('build/contracts/CharityToken.json');
            const tokenData = await tokenResponse.json();
            App.tokenContract = TruffleContract(tokenData);
            App.tokenContract.setProvider(window.ethereum);

            // 确保代币合约地址已设置正确
            if (tokenAddress) {
                document.getElementById('token-address').textContent = tokenAddress;
                console.log("Token contract address:", tokenAddress);
            } else {
                console.error("Token address not found in DAO contract");
            }

            console.log("Contracts loaded successfully");
            return true;
        } catch (error) {
            console.error("Error loading contracts:", error);
            return false;
        }
    },

    // Load DAO information
    loadDaoInfo: async function () {
        if (!App.daoContract || !App.account) return;

        try {
            const daoInstance = await App.daoContract.deployed();

            // 获取基本 DAO 信息
            const memberCount = await daoInstance.memberCount();
            const isMember = await daoInstance.members(App.account);
            const isAdmin = await App.isAdmin();
            const requiredQuorum = await daoInstance.requiredQuorum();
            const requiredMajority = await daoInstance.requiredMajority();

            // 获取代币信息 (新增)
            if (App.tokenContract) {
                const tokenInstance = await App.tokenContract.deployed();
                const tokenName = await tokenInstance.name();
                const tokenSymbol = await tokenInstance.symbol();
                const totalSupply = await tokenInstance.totalSupply();
                const userTokenBalance = await tokenInstance.balanceOf(App.account);

                // 更新 Token 信息 UI
                document.getElementById('token-name').textContent = tokenName;
                document.getElementById('token-symbol').textContent = tokenSymbol;
                document.getElementById('token-supply').textContent =
                    App.web3.utils.fromWei(totalSupply, 'ether');
                document.getElementById('token-balance').textContent =
                    App.web3.utils.fromWei(userTokenBalance, 'ether');

                // 如果是管理员，显示代币分发区域
                if (isAdmin) {
                    document.getElementById('token-distribution-section').classList.remove('hidden');
                } else {
                    document.getElementById('token-distribution-section').classList.add('hidden');
                }

                // 显示投票权重 (如果是 DAO 成员)
                if (isMember) {
                    try {
                        const votingWeight = await daoInstance.calculateVotingWeight(App.account);
                        const formattedWeight = parseFloat(votingWeight) / 100; // 转换为小数
                        document.getElementById('voting-weight').textContent = formattedWeight.toFixed(2);
                    } catch (error) {
                        console.error("Error loading voting weight:", error);
                    }
                }
            }

            // 更新 UI
            document.getElementById('member-count').textContent = memberCount.toString();
            document.getElementById('required-quorum').textContent = requiredQuorum.toString();
            document.getElementById('required-majority').textContent = requiredMajority.toString();
            document.getElementById('member-status').textContent = isMember ? 'Yes' : 'No';
            document.getElementById('admin-status').textContent = isAdmin ? 'Yes' : 'No';

        } catch (error) {
            console.error("Error loading DAO info:", error);
        }
    },

    // Check if current account is a DAO member
    isMember: async function () {
        if (!App.daoContract || !App.account) return false;

        try {
            const daoInstance = await App.daoContract.deployed();
            return await daoInstance.members(App.account);
        } catch (error) {
            console.error("Error checking membership:", error);
            return false;
        }
    },

    // Check if current account is an admin
    isAdmin: async function () {
        if (!App.daoContract || !App.account) return false;

        try {
            const daoInstance = await App.daoContract.deployed();
            const admin = await daoInstance.admin();
            return App.account.toLowerCase() === admin.toLowerCase();
        } catch (error) {
            console.error("Error checking admin status:", error);
            return false;
        }
    },

    // Add a new DAO member
    addMember: async function () {
        if (!App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        const newMemberAddress = document.getElementById('new-member-address').value;
        if (!newMemberAddress || !Web3.utils.isAddress(newMemberAddress)) {
            alert('Please enter a valid Ethereum address');
            return;
        }

        try {
            const daoInstance = await App.daoContract.deployed();

            // Add member
            await daoInstance.addMember(newMemberAddress, { from: App.account });

            alert('Member added successfully!');

            // Clear input and refresh DAO info
            document.getElementById('new-member-address').value = '';
            await App.loadDaoInfo();
        } catch (error) {
            console.error("Error adding member:", error);
            alert('Failed to add member. Make sure you are the admin.');
        }
    },

    // Create a new project
    createProject: async function () {
        if (!App.factoryContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        // Get form values
        const name = document.getElementById('project-name').value;
        const description = document.getElementById('project-description').value;
        const materials = document.getElementById('project-materials').value;
        const targetEth = document.getElementById('project-target').value;
        const durationDays = document.getElementById('project-duration').value;

        // Validate inputs
        if (!name || !description || !materials || !targetEth || !durationDays) {
            alert('Please fill in all fields');
            return;
        }

        // Convert to contract parameters
        const targetAmount = App.web3.utils.toWei(targetEth, 'ether');
        const duration = durationDays * 24 * 60 * 60;

        try {
            const factoryInstance = await App.factoryContract.deployed();

            // Show loading state - maintain button style, just disable it
            const createBtn = document.getElementById('create-project-btn');
            createBtn.disabled = true;
            createBtn.classList.add('btn-loading');

            // Create project
            await factoryInstance.createProject(
                name,
                description,
                materials,
                targetAmount,
                duration,
                { from: App.account }
            );

            // Reset form and UI
            document.getElementById('project-name').value = '';
            document.getElementById('project-description').value = '';
            document.getElementById('project-materials').value = '';
            document.getElementById('project-target').value = '';
            document.getElementById('project-duration').value = '';

            // Restore button state
            createBtn.disabled = false;
            createBtn.classList.remove('btn-loading');

            alert('Project created successfully!');
            // Refresh projects list
            await App.loadProjects('all-projects');
        } catch (error) {
            console.error("Error creating project:", error);
            alert('Failed to create project. Please try again.');

            // Restore button state
            const createBtn = document.getElementById('create-project-btn');
            createBtn.disabled = false;
            createBtn.classList.remove('btn-loading');
        }
    },

    // Helper function to get status name
    getStatusName: function (statusCode) {
        switch (statusCode) {
            case App.STATUS.PENDING:
                return 'Pending Approval';
            case App.STATUS.FUNDRAISING:
                return 'Fundraising';
            case App.STATUS.PENDING_RELEASE:
                return 'Pending Release';
            case App.STATUS.COMPLETED:
                return 'Completed';
            case App.STATUS.REJECTED:
                return 'Rejected';
            default:
                return 'Unknown';
        }
    },

    // Helper function to get proposal type name
    getProposalTypeName: function (typeCode) {
        switch (parseInt(typeCode)) {
            case App.PROPOSAL_TYPE.PROJECT_APPROVAL:
                return 'Project Approval';
            case App.PROPOSAL_TYPE.FUNDS_RELEASE:
                return 'Funds Release';
            default:
                return 'Unknown';
        }
    },

    // Show projects list and hide project details
    showProjectsList: function () {
        document.getElementById('projects-section').classList.remove('hidden');
        document.getElementById('project-details-section').classList.add('hidden');
    },

    // Load projects based on tab
    loadProjects: async function (tabId) {
        if (!App.factoryContract) return;

        const projectsList = document.getElementById('projects-list');
        projectsList.innerHTML = '<p id="loading-projects">Loading projects...</p>';

        try {
            const factoryInstance = await App.factoryContract.deployed();

            // Get project count
            const projectCount = await factoryInstance.getProjectCount();
            console.log(`Total projects: ${projectCount}`);

            if (projectCount == 0) {
                projectsList.innerHTML = '<p>No projects found</p>';
                return;
            }

            // Get projects in batches
            const batchSize = 10;
            const projects = [];

            for (let i = 0; i < projectCount; i += batchSize) {
                const batch = await factoryInstance.getProjects(i, Math.min(batchSize, projectCount - i));
                projects.push(...batch);
            }

            console.log(`Retrieved ${projects.length} projects`);

            // Clear loading message
            projectsList.innerHTML = '';

            // Filter projects based on tab
            let filteredProjects = [];

            if (tabId === 'all-projects') {
                filteredProjects = projects;
            } else {
                // Load each project's details to filter by status
                for (const projectAddress of projects) {
                    try {
                        const projectContract = await App.getProjectContract(projectAddress);
                        const status = parseInt(await projectContract.methods.status().call());
                        console.log(`Project ${projectAddress} has status: ${status} (${App.getStatusName(status)})`);

                        if (
                            (tabId === 'pending-projects' && status === App.STATUS.PENDING) ||
                            (tabId === 'fundraising-projects' && status === App.STATUS.FUNDRAISING) ||
                            (tabId === 'pending-release-projects' && status === App.STATUS.PENDING_RELEASE) ||
                            (tabId === 'completed-projects' && status === App.STATUS.COMPLETED)
                        ) {
                            filteredProjects.push(projectAddress);
                        }
                    } catch (error) {
                        console.error(`Error checking project ${projectAddress} status:`, error);
                    }
                }
            }

            console.log(`Filtered to ${filteredProjects.length} projects for tab: ${tabId}`);

            if (filteredProjects.length === 0) {
                projectsList.innerHTML = '<p>No projects found in this category</p>';
                return;
            }

            // Create project cards
            for (const projectAddress of filteredProjects) {
                await App.createProjectCard(projectAddress, projectsList);
            }
        } catch (error) {
            console.error("Error loading projects:", error);
            projectsList.innerHTML = '<p>Error loading projects. Please try again.</p>';
        }
    },

    // Create a project card
    createProjectCard: async function (projectAddress, container) {
        try {
            const projectContract = await App.getProjectContract(projectAddress);

            // Get project details
            const name = await projectContract.methods.projectName().call();
            const description = await projectContract.methods.description().call();
            const targetAmount = App.web3.utils.fromWei(await projectContract.methods.targetAmount().call(), 'ether');
            const deadline = new Date((await projectContract.methods.deadline().call()) * 1000);
            const raisedAmount = App.web3.utils.fromWei(await projectContract.methods.raisedAmount().call(), 'ether');
            const status = parseInt(await projectContract.methods.status().call());

            // Clone the template
            const template = document.getElementById('project-card-template');
            const projectCard = document.importNode(template.content, true);

            // Fill in the data
            projectCard.querySelector('.project-title').textContent = name;
            projectCard.querySelector('.project-description').textContent =
                description.length > 100 ? description.substring(0, 100) + '...' : description;
            projectCard.querySelector('.project-status').textContent = App.getStatusName(status);
            projectCard.querySelector('.project-target').textContent = targetAmount;
            projectCard.querySelector('.project-raised').textContent = raisedAmount;
            projectCard.querySelector('.project-deadline').textContent = deadline.toLocaleDateString();

            // Add status-specific styling
            const statusClass = App.getStatusName(status).toLowerCase().replace(' ', '-');
            projectCard.querySelector('.project-card').classList.add(statusClass);

            // Add event listener to view button
            projectCard.querySelector('.view-project-btn').addEventListener('click', function () {
                App.showProjectDetails(projectAddress);
            });

            // Add the card to the container
            container.appendChild(projectCard);
        } catch (error) {
            console.error("Error creating project card:", error);
        }
    },

    // Show project details - updated to handle all states properly
    showProjectDetails: async function (projectAddress) {
        try {
            // Hide projects list and show details section
            document.getElementById('projects-section').classList.add('hidden');
            document.getElementById('project-details-section').classList.remove('hidden');

            const detailsCard = document.getElementById('project-details-card');
            detailsCard.innerHTML = '<p>Loading project details...</p>';

            const projectContract = await App.getProjectContract(projectAddress);

            // Get project details
            const name = await projectContract.methods.projectName().call();
            const description = await projectContract.methods.description().call();
            const auditMaterials = await projectContract.methods.auditMaterials().call();
            const targetAmount = App.web3.utils.fromWei(await projectContract.methods.targetAmount().call(), 'ether');
            const deadline = new Date((await projectContract.methods.deadline().call()) * 1000);
            const raisedAmount = App.web3.utils.fromWei(await projectContract.methods.raisedAmount().call(), 'ether');
            const owner = await projectContract.methods.owner().call();
            const status = parseInt(await projectContract.methods.status().call());

            // Get DAO instance to check proposal details
            const daoInstance = await App.daoContract.deployed();

            // Get registered project info from DAO
            const registeredProject = await daoInstance.registeredProjects(projectAddress);

            // Create HTML for project details
            let html = `
                <div class="project-header">
                    <div class="project-header-info">
                        <h3>${name}</h3>
                        <p>Created by: ${owner.substring(0, 8)}...${owner.substring(owner.length - 6)}</p>
                    </div>
                    <div class="project-header-status status-${App.getStatusName(status).toLowerCase().replace(' ', '-')}">
                        ${App.getStatusName(status)}
                    </div>
                </div>
                
                <div class="project-info-grid">
                    <div class="project-info-item">
                        <h4>Target Amount</h4>
                        <p>${targetAmount} ETH</p>
                    </div>
                    <div class="project-info-item">
                        <h4>Raised Amount</h4>
                        <p>${raisedAmount} ETH</p>
                    </div>
                    <div class="project-info-item">
                        <h4>Deadline</h4>
                        <p>${deadline.toLocaleDateString()}</p>
                    </div>
                    <div class="project-info-item">
                        <h4>Progress</h4>
                        <p>${Math.min(Math.round((raisedAmount / targetAmount) * 100), 100)}%</p>
                    </div>
                </div>
                
                <div class="project-description-full">
                    <h4>Description</h4>
                    <p>${description}</p>
                </div>`;

            // Add donations section
            html += `<div class="donations-section">
                <h4>Donation History</h4>`;

            try {
                // Get donors list
                const donors = [];
                let index = 0;

                // Loop to get all donors until we reach the end of the array
                while (true) {
                    try {
                        const donor = await projectContract.methods.donors(index).call();
                        if (donor !== '0x0000000000000000000000000000000000000000') {
                            donors.push(donor);
                        }
                        index++;
                    } catch (error) {
                        break; // End of array reached, exit loop
                    }
                }

                if (donors.length > 0) {
                    html += `
                    <table class="donations-table">
                        <thead>
                            <tr>
                                <th>Donor Address</th>
                                <th>Amount (ETH)</th>
                            </tr>
                        </thead>
                        <tbody>`;

                    // Get each donor's donation amount
                    for (const donor of donors) {
                        const amount = await projectContract.methods.donations(donor).call();
                        const amountInEth = App.web3.utils.fromWei(amount, 'ether');

                        // Display truncated donor address
                        const truncatedAddress = `${donor.substring(0, 8)}...${donor.substring(donor.length - 4)}`;

                        html += `
                        <tr>
                            <td>${truncatedAddress}</td>
                            <td>${amountInEth} ETH</td>
                        </tr>`;
                    }

                    html += `
                        </tbody>
                    </table>`;
                } else {
                    html += `<p>No donations yet</p>`;
                }
            } catch (error) {
                console.error("Error loading donations:", error);
                html += `<p>No donations yet</p>`;
            }

            html += `</div>`;

            // Add status-specific information
            if (status == App.STATUS.COMPLETED) {
                html += `
                    <div class="project-completion-info">
                        <h4>Project Completed</h4>
                        <p>This project has been successfully completed and funds have been released to the project owner.</p>
                    </div>
                `;
            }

            // Add voting information for Pending state
            if (status == App.STATUS.PENDING) {
                // Get the approval proposal ID
                const approvalProposalId = registeredProject.approvalProposalId;
                console.log("Project Approval Proposal ID:", approvalProposalId.toString());

                // Get proposal details including weighted votes
                const proposalInfo = await daoInstance.getProposalInfo(approvalProposalId);
                console.log("Proposal Info for pending project:", proposalInfo);

                // Get weighted vote counts and format properly
                const yesVotes = proposalInfo[6];
                const noVotes = proposalInfo[7];

                // Convert from contract representation (with 2 decimal places) to display format
                const weightedYesVotes = parseFloat(yesVotes) / 100;
                const weightedNoVotes = parseFloat(noVotes) / 100;

                const executed = proposalInfo[8];
                const passed = proposalInfo[9];
                const votingDeadline = new Date(proposalInfo[4] * 1000);

                // Get DAO voting requirements
                const memberCount = await daoInstance.memberCount();
                const requiredQuorum = await daoInstance.requiredQuorum();
                const requiredMajority = await daoInstance.requiredMajority();

                // Calculate voting statistics
                const totalVotes = weightedYesVotes + weightedNoVotes;
                const quorumReached = totalVotes >= requiredQuorum;
                const majorityReached = weightedYesVotes > 0 && (weightedYesVotes * 100 / totalVotes) >= requiredMajority;

                // Add approval voting information section
                html += `
                    <div class="project-voting-info">
                        <h4>Project Approval Voting</h4>
                        <div class="voting-stats">
                            <div class="voting-stat">
                                <span>Yes Votes:</span>
                                <span>${weightedYesVotes.toFixed(2)}</span>
                            </div>
                            <div class="voting-stat">
                                <span>No Votes:</span>
                                <span>${weightedNoVotes.toFixed(2)}</span>
                            </div>
                            <div class="voting-stat">
                                <span>Total Votes:</span>
                                <span>${totalVotes.toFixed(2)} (${memberCount} members)</span>
                            </div>
                            <div class="voting-stat">
                                <span>Quorum:</span>
                                <span>${quorumReached ? 'Reached' : 'Not Reached'} (${requiredQuorum} required)</span>
                            </div>
                            <div class="voting-stat">
                                <span>Majority:</span>
                                <span>${majorityReached ? 'Reached' : 'Not Reached'} (${requiredMajority}% required)</span>
                            </div>
                            <div class="voting-stat">
                                <span>Voting Deadline:</span>
                                <span>${votingDeadline.toLocaleString()}</span>
                            </div>
                            <div class="voting-stat">
                                <span>Status:</span>
                                <span>${executed ? (passed ? 'Approved' : 'Rejected') : 'Voting in Progress'}</span>
                            </div>
                        </div>
                    </div>
                `;

                // Check if current user has already voted on this proposal
                if (App.account) {
                    const userVote = await daoInstance.getMemberVote(approvalProposalId, App.account);
                    console.log("Current user vote on approval:", userVote.toString());

                    if (parseInt(userVote) > 0) {
                        // Get the user's vote weight
                        const userVoteWeight = await daoInstance.getMemberVoteWeight(approvalProposalId, App.account);
                        const formattedWeight = parseFloat(userVoteWeight) / 100;

                        html += `
                            <div class="user-vote-info">
                                <p>You have voted: <strong>${userVote == 1 ? 'Yes' : 'No'}</strong> with a weight of <strong>${formattedWeight.toFixed(2)}</strong></p>
                            </div>
                        `;
                    }
                }
            }

            // Add voting information for Pending Release status
            if (status == App.STATUS.PENDING_RELEASE) {
                // Get the funds release proposal ID
                const fundsReleaseProposalId = registeredProject.fundsReleaseProposalId;
                console.log("Funds Release Proposal ID:", fundsReleaseProposalId.toString());

                // Get proposal details
                const proposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
                console.log("Proposal Info:", proposalInfo);

                // Get weighted vote counts (format the fractional values properly)
                const yesVotes = proposalInfo[6].toString();
                const noVotes = proposalInfo[7].toString();
                const weightedYesVotes = parseFloat(yesVotes) / 100;
                const weightedNoVotes = parseFloat(noVotes) / 100;

                const executed = proposalInfo[8];
                const passed = proposalInfo[9];
                const votingDeadline = new Date(proposalInfo[4] * 1000);

                // Get DAO voting requirements
                const memberCount = await daoInstance.memberCount();
                const requiredQuorum = await daoInstance.requiredQuorum();
                const requiredMajority = await daoInstance.requiredMajority();

                // Calculate voting statistics
                const totalVotes = weightedYesVotes + weightedNoVotes;
                const quorumReached = totalVotes >= requiredQuorum;
                const majorityReached = weightedYesVotes > 0 && (weightedYesVotes * 100 / totalVotes) >= requiredMajority;

                // Add voting information section
                html += `
                    <div class="project-voting-info">
                        <h4>Funds Release Voting</h4>
                        <div class="voting-stats">
                            <div class="voting-stat">
                                <span>Yes Votes:</span>
                                <span>${weightedYesVotes.toFixed(2)}</span>
                            </div>
                            <div class="voting-stat">
                                <span>No Votes:</span>
                                <span>${weightedNoVotes.toFixed(2)}</span>
                            </div>
                            <div class="voting-stat">
                                <span>Total Votes:</span>
                                <span>${totalVotes.toFixed(2)} (${memberCount} members)</span>
                            </div>
                            <div class="voting-stat">
                                <span>Quorum:</span>
                                <span>${quorumReached ? 'Reached' : 'Not Reached'} (${requiredQuorum} required)</span>
                            </div>
                            <div class="voting-stat">
                                <span>Majority:</span>
                                <span>${majorityReached ? 'Reached' : 'Not Reached'} (${requiredMajority}% required)</span>
                            </div>
                            <div class="voting-stat">
                                <span>Voting Deadline:</span>
                                <span>${votingDeadline.toLocaleString()}</span>
                            </div>
                            <div class="voting-stat">
                                <span>Status:</span>
                                <span>${executed ? (passed ? 'Approved' : 'Rejected') : 'Voting in Progress'}</span>
                            </div>
                        </div>
                    </div>
                `;

                // Check if current user has already voted
                if (App.account) {
                    const userVote = await daoInstance.getMemberVote(fundsReleaseProposalId, App.account);
                    console.log("Current user vote:", userVote.toString());

                    if (parseInt(userVote) > 0) {
                        // Get the user's vote weight if they've voted
                        const userVoteWeight = await daoInstance.getMemberVoteWeight(fundsReleaseProposalId, App.account);
                        const formattedWeight = parseFloat(userVoteWeight) / 100;

                        html += `
                            <div class="user-vote-info">
                                <p>You have voted: <strong>${userVote == 1 ? 'Yes' : 'No'}</strong> with a weight of <strong>${formattedWeight.toFixed(2)}</strong></p>
                            </div>
                        `;
                    }
                }
            }

            // In PENDING_RELEASE or COMPLETED states, show audit materials
            if (status == App.STATUS.PENDING_RELEASE || status == App.STATUS.COMPLETED) {
                const auditData = App.getProjectAuditMaterials(projectAddress);
                if (auditData) {
                    html += `
                        <div class="submitted-audit-materials">
                            <h4>Submitted Audit Materials</h4>
                            <div class="audit-text">
                                <h5>Description</h5>
                                <p>${auditData.text}</p>
                            </div>
                            <div class="audit-files">
                                <h5>Supporting Documents</h5>
                                <p>
                                    <a href="${auditData.fileData}" 
                                       download="${auditData.originalName}"
                                       class="download-link">
                                        Download ${auditData.originalName}
                                    </a>
                                </p>
                                <small class="text-muted">
                                    Submitted by: ${auditData.submitter.substring(0, 8)}...${auditData.submitter.substring(36)}
                                    on ${new Date(auditData.timestamp).toLocaleString()}
                                </small>
                            </div>
                        </div>
                    `;
                }
            }

            // Add project actions section
            html += `<div class="project-actions">`;

            // Add action buttons based on project status and user role
            if (status == App.STATUS.FUNDRAISING) {
                // THIS IS THE DONATION FORM THAT WAS MISSING
                html += `
                    <div class="donation-form">
                        <h4>Make a Donation</h4>
                        <div class="form-group">
                            <label for="donation-amount">Amount (ETH)</label>
                            <input type="number" id="donation-amount" min="0.01" step="0.01" placeholder="0.00">
                        </div>
                        <button id="donate-btn">Donate</button>
                    </div>
                `;

                // Add request funds button for project owner
                if (App.account && App.account.toLowerCase() === owner.toLowerCase()) {
                    html += `
                        <div class="audit-materials-submission">
                            <h4>Submit Audit Materials for Funds Release</h4>
                            <div class="form-group">
                                <label for="audit-text">Audit Description</label>
                                <textarea id="audit-text" class="form-control" rows="4" 
                                    placeholder="Please describe your project progress and fund usage..."></textarea>
                            </div>
                            <div class="form-group">
                                <label for="audit-file">Supporting Documents</label>
                                <input type="file" id="audit-file" class="form-control" 
                                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">
                                <small class="form-text text-muted">Accepted formats: PDF, Images, Word documents</small>
                            </div>
                            <button id="request-funds-btn" class="secondary-btn">Request Funds Release</button>
                        </div>
                    `;
                }
            }

            // DAO member actions
            if (await App.isMember()) {
                if (status == App.STATUS.PENDING) {
                    // Check if user has already voted on project approval
                    const hasVotedOnApproval = await App.hasVotedOnProposalType(projectAddress, App.PROPOSAL_TYPE.PROJECT_APPROVAL);

                    if (!hasVotedOnApproval) {
                        html += `<button id="approve-project-btn" class="secondary-btn">Approve Project</button>`;
                        html += `<button id="reject-project-btn" class="secondary-btn">Reject Project</button>`;
                    } else {
                        html += `<p>You have already voted on this project approval.</p>`;
                    }
                } else if (status == App.STATUS.PENDING_RELEASE) {
                    // Check if user has already voted on funds release
                    const hasVotedOnFundsRelease = await App.hasVotedOnProposalType(projectAddress, App.PROPOSAL_TYPE.FUNDS_RELEASE);

                    // Get the funds release proposal ID
                    const registeredProject = await daoInstance.registeredProjects(projectAddress);
                    const fundsReleaseProposalId = registeredProject.fundsReleaseProposalId;

                    // Check if proposal is executed
                    const proposalInfo = await daoInstance.getProposalInfo(fundsReleaseProposalId);
                    const executed = proposalInfo[8];

                    console.log("Has voted on funds release:", hasVotedOnFundsRelease);
                    console.log("Funds release proposal executed:", executed);

                    // Only show voting buttons if user hasn't voted on funds release and proposal isn't executed
                    if (!hasVotedOnFundsRelease && !executed) {
                        html += `<button id="release-funds-btn" class="secondary-btn">Vote to Release Funds</button>`;
                        html += `<button id="reject-release-btn" class="secondary-btn">Vote to Reject Release</button>`;
                        console.log("Adding funds release voting buttons");
                    } else {
                        console.log("Not adding funds release voting buttons because user already voted or proposal executed");
                    }

                    // Show execute button if voting deadline has passed and proposal isn't executed
                    const votingDeadline = new Date(proposalInfo[4] * 1000);
                    if (Date.now() > votingDeadline && !executed) {
                        html += `<button id="execute-release-btn" class="primary-btn">Execute Funds Release Decision</button>`;
                    }
                }
            }

            html += `</div>`;

            // Set the HTML content
            detailsCard.innerHTML = html;

            // Safely add event listeners to buttons

            // FUNDRAISING state buttons
            if (status == App.STATUS.FUNDRAISING) {
                const donateBtn = document.getElementById('donate-btn');
                if (donateBtn) {
                    donateBtn.addEventListener('click', function () {
                        App.donateToProject(projectAddress);
                    });
                }

                if (App.account && App.account.toLowerCase() === owner.toLowerCase()) {
                    const requestFundsBtn = document.getElementById('request-funds-btn');
                    if (requestFundsBtn) {
                        requestFundsBtn.addEventListener('click', function () {
                            App.requestFundsRelease(projectAddress);
                        });
                    }
                }
            }

            // DAO member action buttons
            if (await App.isMember()) {
                // PENDING state buttons
                if (status == App.STATUS.PENDING) {
                    const approveProjectBtn = document.getElementById('approve-project-btn');
                    const rejectProjectBtn = document.getElementById('reject-project-btn');

                    if (approveProjectBtn) {
                        approveProjectBtn.addEventListener('click', function () {
                            App.voteOnProjectApproval(projectAddress, true);
                        });
                    }

                    if (rejectProjectBtn) {
                        rejectProjectBtn.addEventListener('click', function () {
                            App.voteOnProjectApproval(projectAddress, false);
                        });
                    }
                }
                // PENDING_RELEASE state buttons
                else if (status == App.STATUS.PENDING_RELEASE) {
                    const releaseFundsBtn = document.getElementById('release-funds-btn');
                    const rejectReleaseBtn = document.getElementById('reject-release-btn');
                    const executeReleaseBtn = document.getElementById('execute-release-btn');

                    if (releaseFundsBtn) {
                        releaseFundsBtn.addEventListener('click', function () {
                            App.voteOnFundsRelease(projectAddress, true);
                        });
                    }

                    if (rejectReleaseBtn) {
                        rejectReleaseBtn.addEventListener('click', function () {
                            App.voteOnFundsRelease(projectAddress, false);
                        });
                    }

                    if (executeReleaseBtn) {
                        executeReleaseBtn.addEventListener('click', function () {
                            App.executeFundsRelease(projectAddress);
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Error showing project details:", error);
            document.getElementById('project-details-card').innerHTML = '<p>Error loading project details. Please try again.</p>';
        }
    },

    // Donate to a project - FIXED
    donateToProject: async function (projectAddress) {
        if (!App.web3 || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        const amount = document.getElementById('donation-amount').value;
        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            alert('Please enter a valid donation amount');
            return;
        }

        try {
            const projectContract = await App.getProjectContract(projectAddress);
            const daoInstance = await App.daoContract.deployed();
            const tokenAddress = await daoInstance.governanceToken();

            // Create token contract instance
            const tokenContract = new App.web3.eth.Contract(
                App.tokenContract.abi,
                tokenAddress
            );

            // Get token info and reward ratio from project contract
            let tokenSymbol = 'TOKEN';
            let rewardRatio = 100; // Default ratio (1 ETH = 100 tokens)

            try {
                // Get project details including token address and reward ratio
                const projectDetails = await projectContract.methods.getProjectDetails().call();
                console.log("Project details:", projectDetails);

                // Get token symbol
                tokenSymbol = await tokenContract.methods.symbol().call();

                // Get reward ratio from project - typically at index 9 in the details array
                if (projectDetails.length > 9) {
                    rewardRatio = parseInt(projectDetails[9]);
                }

                console.log(`Donation info: ${amount} ETH, Reward ratio: ${rewardRatio}, Token: ${tokenSymbol}`);
            } catch (error) {
                console.error("Error getting token reward info:", error);
                // Continue even if token info retrieval fails
            }

            // Calculate expected token reward
            const expectedTokens = amount * rewardRatio;

            // Show confirmation with token reward info
            const tokenMessage = `\n\nYou will receive approximately ${expectedTokens} ${tokenSymbol} tokens as a reward!`;
            if (!confirm(`Are you sure you want to donate ${amount} ETH to this project?${tokenMessage}`)) {
                return;
            }

            // Check donor's initial token balance for later verification
            const initialTokenBalance = await tokenContract.methods.balanceOf(App.account).call();
            console.log(`Initial token balance: ${App.web3.utils.fromWei(initialTokenBalance, 'ether')} ${tokenSymbol}`);

            // Execute donation
            const weiAmount = App.web3.utils.toWei(amount, 'ether');
            const tx = await projectContract.methods.donate().send({
                from: App.account,
                value: weiAmount
            });

            // Check for token reward event in transaction logs
            let tokenRewardReceived = false;
            if (tx.events && tx.events.TokenRewarded) {
                const rewardEvent = tx.events.TokenRewarded;
                console.log("Token reward event found:", rewardEvent);
                tokenRewardReceived = true;
            }

            // Check final token balance to verify reward
            const finalTokenBalance = await tokenContract.methods.balanceOf(App.account).call();
            const tokenDifference = App.web3.utils.toBN(finalTokenBalance).sub(App.web3.utils.toBN(initialTokenBalance));
            console.log(`Final token balance: ${App.web3.utils.fromWei(finalTokenBalance, 'ether')} ${tokenSymbol}`);
            console.log(`Token reward received: ${App.web3.utils.fromWei(tokenDifference, 'ether')} ${tokenSymbol}`);

            // Update success message based on actual token receipt
            let successMessage = `Donation successful! Thank you for your contribution of ${amount} ETH.`;

            if (tokenDifference.gt(App.web3.utils.toBN('0'))) {
                const actualTokens = App.web3.utils.fromWei(tokenDifference, 'ether');
                successMessage += `\n\nYou have been rewarded with ${actualTokens} ${tokenSymbol} tokens!`;
            } else if (tokenRewardReceived) {
                successMessage += `\n\nYou have been rewarded with tokens! Check your balance.`;
            } else {
                successMessage += `\n\nToken rewards may be processed separately.`;
            }

            alert(successMessage);

            // Refresh token balance and project details
            await App.loadDaoInfo();
            await App.showProjectDetails(projectAddress);
        } catch (error) {
            console.error("Error donating:", error);
            alert('Failed to donate: ' + error.message);
        }
    },

    // Request funds release (project owner)
    requestFundsRelease: async function (projectAddress) {
        if (!App.web3 || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            const projectContract = await App.getProjectContract(projectAddress);

            // Get audit materials
            const auditText = document.getElementById('audit-text').value.trim();
            const auditFile = document.getElementById('audit-file').files[0];

            if (!auditText) {
                alert('Please provide audit description');
                return;
            }

            if (!auditFile) {
                alert('Please upload supporting documents');
                return;
            }

            // Save audit materials with project address
            await App.saveAuditMaterials(auditText, auditFile, projectAddress);

            // Continue with funds release request
            const status = parseInt(await projectContract.methods.status().call());
            if (status !== App.STATUS.FUNDRAISING) {
                alert('Project must be in Fundraising state to request funds release');
                return;
            }

            // Request funds release
            await projectContract.methods.requestFundsRelease().send({ from: App.account });

            alert('Funds release request submitted successfully with audit materials!');

            // Refresh views
            await App.loadProposals('active-proposals');
            await App.loadProjects('all-projects');
            await App.loadProjects('pending-release-projects');
            App.showProjectDetails(projectAddress);

        } catch (error) {
            console.error("Error requesting funds release:", error);
            alert('Failed to request funds release: ' + (error.message || 'Unknown error'));
        }
    },

    // Vote on project approval (DAO members) - FIXED
    voteOnProjectApproval: async function (projectAddress, approve) {
        if (!App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            const daoInstance = await App.daoContract.deployed();

            // Get the project's approval proposal ID
            const registeredProject = await daoInstance.registeredProjects(projectAddress);
            const proposalId = registeredProject.approvalProposalId;

            console.log("Voting on project approval proposal:", proposalId.toString(), "with vote:", approve ? "approve" : "reject");

            // Check if user has already voted on this specific proposal
            const userVote = await daoInstance.getMemberVote(proposalId, App.account);
            if (parseInt(userVote) > 0) {
                alert('You have already voted on this project approval proposal');
                return;
            }

            // The vote function expects: 
            // 1 = YES/APPROVE
            // 2 = NO/REJECT
            const voteOption = approve ? 1 : 2;

            // Vote on the proposal using the numeric vote option
            await daoInstance.vote(proposalId, voteOption, { from: App.account });

            // Get voting weight
            const userVoteWeight = await daoInstance.getMemberVoteWeight(proposalId, App.account);
            const formattedWeight = parseFloat(userVoteWeight) / 100;

            alert(`Vote cast successfully! You voted to ${approve ? 'approve' : 'reject'} the project with a weight of ${formattedWeight.toFixed(2)}.`);

            // Refresh proposals and project details
            await App.loadProposals('active-proposals');
            await App.showProjectDetails(projectAddress);
        } catch (error) {
            console.error("Error voting on project approval:", error);
            alert('Failed to vote: ' + error.message);
        }
    },

    // Vote on funds release (DAO members) - FIXED
    voteOnFundsRelease: async function (projectAddress, approve) {
        if (!App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            const daoInstance = await App.daoContract.deployed();

            // Get the project's funds release proposal ID
            const registeredProject = await daoInstance.registeredProjects(projectAddress);
            const proposalId = registeredProject.fundsReleaseProposalId;

            console.log("Voting on funds release proposal:", proposalId.toString(), "with vote:", approve ? "approve" : "reject");

            // Check if user has already voted on this specific proposal
            const userVote = await daoInstance.getMemberVote(proposalId, App.account);
            if (parseInt(userVote) > 0) {
                alert('You have already voted on this funds release proposal');
                return;
            }

            // The vote function expects: 
            // 1 = YES/APPROVE
            // 2 = NO/REJECT
            const voteOption = approve ? 1 : 2;

            // Vote on the proposal using the numeric vote option
            await daoInstance.vote(proposalId, voteOption, { from: App.account });

            // Get voting weight
            const userVoteWeight = await daoInstance.getMemberVoteWeight(proposalId, App.account);
            const formattedWeight = parseFloat(userVoteWeight) / 100;

            alert(`Vote cast successfully! You voted to ${approve ? 'approve' : 'reject'} the funds release with a weight of ${formattedWeight.toFixed(2)}.`);

            // Refresh proposals and project details
            await App.loadProposals('active-proposals');
            await App.showProjectDetails(projectAddress);
        } catch (error) {
            console.error("Error voting on funds release:", error);
            alert('Failed to vote: ' + error.message);
        }
    },

    // Load proposals
    loadProposals: async function (tabId) {
        if (!App.daoContract) return;

        const proposalsList = document.getElementById('proposals-list');
        proposalsList.innerHTML = '<p id="loading-proposals">Loading proposals...</p>';

        try {
            const daoInstance = await App.daoContract.deployed();

            // Get proposal count
            const proposalCount = await daoInstance.proposalCount();

            if (proposalCount == 0) {
                proposalsList.innerHTML = '<p>No proposals found</p>';
                return;
            }

            // Get all proposals
            const proposals = [];

            for (let i = 0; i < proposalCount; i++) {
                const proposalInfo = await daoInstance.getProposalInfo(i);
                proposals.push({
                    id: i,
                    projectAddress: proposalInfo[0],
                    projectName: proposalInfo[1],
                    projectOwner: proposalInfo[2],
                    createdAt: proposalInfo[3],
                    votingDeadline: proposalInfo[4],
                    proposalType: proposalInfo[5],
                    yesVotes: proposalInfo[6],
                    noVotes: proposalInfo[7],
                    executed: proposalInfo[8],
                    passed: proposalInfo[9]
                });
            }

            // Filter proposals based on tab
            let filteredProposals = [];

            if (tabId === 'active-proposals') {
                filteredProposals = proposals.filter(p => !p.executed);
            } else if (tabId === 'past-proposals') {
                filteredProposals = proposals.filter(p => p.executed);
            }

            // Clear loading message
            proposalsList.innerHTML = '';

            if (filteredProposals.length === 0) {
                proposalsList.innerHTML = '<p>No proposals found in this category</p>';
                return;
            }

            // Create proposal cards
            for (const proposal of filteredProposals) {
                await App.createProposalCard(proposal, proposalsList);
            }
        } catch (error) {
            console.error("Error loading proposals:", error);
            proposalsList.innerHTML = '<p>Error loading proposals. Please try again.</p>';
        }
    },

    // Create a proposal card
    createProposalCard: async function (proposal, container) {
        try {
            // Clone the template
            const template = document.getElementById('proposal-card-template');
            const proposalCard = document.importNode(template.content, true);

            // Fill in the data
            proposalCard.querySelector('.proposal-title').textContent =
                `Proposal #${proposal.id}: ${proposal.projectName}`;

            proposalCard.querySelector('.proposal-type').textContent =
                App.getProposalTypeName(proposal.proposalType);

            proposalCard.querySelector('.proposal-project').textContent =
                `${proposal.projectName} (${proposal.projectAddress.substring(0, 8)}...)`;

            const deadline = new Date(proposal.votingDeadline * 1000);
            proposalCard.querySelector('.proposal-deadline').textContent =
                deadline.toLocaleString();

            // 转换加权投票为显示格式
            const weightedYesVotes = parseFloat(proposal.yesVotes) / 100;
            const weightedNoVotes = parseFloat(proposal.noVotes) / 100;

            proposalCard.querySelector('.proposal-yes-votes').textContent = weightedYesVotes.toFixed(2);
            proposalCard.querySelector('.proposal-no-votes').textContent = weightedNoVotes.toFixed(2);

            // Set status text
            let statusText = '';
            if (proposal.executed) {
                statusText = proposal.passed ? 'Passed' : 'Rejected';
            } else {
                statusText = 'Voting in Progress';
                if (Date.now() > deadline) {
                    statusText += ' (Ready for Execution)';
                }
            }
            proposalCard.querySelector('.proposal-status').textContent = statusText;

            // Show/hide action buttons based on proposal state
            const voteYesBtn = proposalCard.querySelector('.vote-yes-btn');
            const voteNoBtn = proposalCard.querySelector('.vote-no-btn');
            const executeBtn = proposalCard.querySelector('.execute-proposal-btn');

            // Hide the voting buttons on proposal cards - voting will be done via project details
            voteYesBtn.style.display = 'none';
            voteNoBtn.style.display = 'none';

            // Check if user is a DAO member
            const isMember = await App.isMember();

            // Only show execute button if proposal is not executed, voting deadline has passed, and user is a member
            if (!proposal.executed && Date.now() > deadline && isMember) {
                executeBtn.addEventListener('click', function (e) {
                    e.stopPropagation(); // Prevent card click when clicking execute button
                    App.executeProposal(proposal.id);
                });
            } else {
                executeBtn.style.display = 'none';
            }

            // Add click event to the whole card to navigate to project details
            const cardElement = proposalCard.querySelector('.proposal-card');
            cardElement.style.cursor = 'pointer';
            cardElement.addEventListener('click', function () {
                // Navigate to Projects tab and show project details
                // First find and click the Projects nav link
                document.querySelector('.nav-link[data-section="projects-section"]').click();

                // Then show project details for this proposal's project
                App.showProjectDetails(proposal.projectAddress);
            });

            // Add 'View Project Details' button instead of voting buttons
            const viewDetailsBtn = document.createElement('button');
            viewDetailsBtn.className = 'secondary-btn';
            viewDetailsBtn.textContent = 'View Project Details';
            viewDetailsBtn.addEventListener('click', function (e) {
                e.stopPropagation(); // Prevent card click when clicking button
                // Navigate to Projects tab and show project details
                document.querySelector('.nav-link[data-section="projects-section"]').click();
                App.showProjectDetails(proposal.projectAddress);
            });

            // Add the button to the proposal actions
            const proposalActions = proposalCard.querySelector('.proposal-actions');
            proposalActions.appendChild(viewDetailsBtn);

            // Add the card to the container
            container.appendChild(proposalCard);
        } catch (error) {
            console.error("Error creating proposal card:", error);
        }
    },

    // Vote on a proposal
    voteOnProposal: async function (proposalId, approve) {
        if (!App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            const daoInstance = await App.daoContract.deployed();

            // Get proposal details to confirm it exists and is not executed
            const proposalInfo = await daoInstance.getProposalInfo(proposalId);
            if (proposalInfo[8]) { // proposalInfo[8] is executed flag
                alert('This proposal has already been executed.');
                return;
            }

            // Convert approve boolean to the correct vote option value
            const voteOption = approve ? 1 : 2; // 1 = YES, 2 = NO

            // Vote with the correct vote option parameter
            await daoInstance.vote(proposalId, voteOption, { from: App.account });

            // Get updated vote weight
            const userVoteWeight = await daoInstance.getMemberVoteWeight(proposalId, App.account);
            const formattedWeight = parseFloat(userVoteWeight) / 100;

            alert(`Vote cast successfully! You voted to ${approve ? 'approve' : 'reject'} the proposal with a voting weight of ${formattedWeight.toFixed(2)}.`);

            // Refresh the proposal view
            await App.loadProposals('active-proposals');
            await App.loadProposals('past-proposals');

            // If we're in project details view, refresh it properly
            const projectDetailsSection = document.getElementById('project-details-section');
            if (!projectDetailsSection.classList.contains('hidden')) {
                const projectAddress = proposalInfo[0]; // The project address
                if (projectAddress) {
                    await App.showProjectDetails(projectAddress);
                }
            }
        } catch (error) {
            console.error("Error voting:", error);
            alert('Failed to vote: ' + error.message);
        }
    },

    // Execute a proposal
    executeProposal: async function (proposalId) {
        if (!App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            const daoInstance = await App.daoContract.deployed();

            // Execute the proposal
            await daoInstance.executeProposal(proposalId, { from: App.account });

            alert('Proposal executed successfully!');

            // Refresh proposals and projects
            await App.loadProposals('active-proposals');
            await App.loadProposals('past-proposals');
            await App.loadProjects('all-projects');

            // Also refresh the specific tabs where the project might appear
            if (document.querySelector('.tab-btn[data-tab="fundraising-projects"].active')) {
                await App.loadProjects('fundraising-projects');
            }

            // After executing a proposal
            const proposalInfo = await daoInstance.getProposalInfo(proposalId);
            await App.checkProjectStatus(proposalInfo[0]); // proposalInfo[0] is the project address

            if (parseInt(proposalInfo[5]) === App.PROPOSAL_TYPE.PROJECT_APPROVAL && proposalInfo[9]) {
                // Switch to fundraising tab
                document.querySelector('.tab-btn[data-tab="fundraising-projects"]').click();
            }
        } catch (error) {
            console.error("Error executing proposal:", error);
            alert('Failed to execute proposal. Make sure the voting period has ended.');
        }
    },

    // Helper function to get a project contract instance
    getProjectContract: async function (projectAddress) {
        try {
            // Load CharityProject contract ABI
            const response = await fetch('build/contracts/CharityProject.json');
            const data = await response.json();

            // Create contract instance
            return new App.web3.eth.Contract(data.abi, projectAddress);
        } catch (error) {
            console.error("Error getting project contract:", error);
            throw error;
        }
    },

    // Debug function to check project status
    checkProjectStatus: async function (projectAddress) {
        try {
            const projectContract = await App.getProjectContract(projectAddress);
            const status = parseInt(await projectContract.methods.status().call());
            console.log(`Project ${projectAddress} status: ${status} (${App.getStatusName(status)})`);
            return status;
        } catch (error) {
            console.error("Error checking project status:", error);
            return null;
        }
    },

    // Execute funds release decision
    executeFundsRelease: async function (projectAddress) {
        if (!App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            const daoInstance = await App.daoContract.deployed();

            // Get the project's funds release proposal ID
            const registeredProject = await daoInstance.registeredProjects(projectAddress);
            const proposalId = registeredProject.fundsReleaseProposalId;

            // Get proposal details to check if it passed
            const proposalInfo = await daoInstance.getProposalInfo(proposalId);
            const executed = proposalInfo[8];

            if (executed) {
                alert('This proposal has already been executed.');
                return;
            }

            // Execute the proposal
            await daoInstance.executeProposal(proposalId, { from: App.account });

            // Check if the proposal passed
            const updatedProposalInfo = await daoInstance.getProposalInfo(proposalId);
            const passed = updatedProposalInfo[9];

            if (passed) {
                // If proposal passed, release funds to project owner
                const projectContract = await App.getProjectContract(projectAddress);

                // Get project owner
                const owner = await projectContract.methods.owner().call();

                // Get project status to verify it's in PENDING_RELEASE state
                const status = parseInt(await projectContract.methods.status().call());

                if (status === App.STATUS.PENDING_RELEASE) {
                    // Release funds to project owner
                    await projectContract.methods.releaseFunds().send({ from: App.account });

                    alert(`Funds release approved and executed! Funds have been transferred to the project owner (${owner.substring(0, 8)}...${owner.substring(owner.length - 6)}).`);
                } else {
                    alert('Funds release proposal approved, but project is not in the correct state for funds release.');
                }
            } else {
                alert('Funds release proposal was rejected.');
            }

            // Refresh project details and proposals
            await App.loadProposals('active-proposals');
            await App.loadProposals('past-proposals');
            await App.loadProjects('all-projects');

            // Refresh the specific tabs where the project might appear
            await App.loadProjects('pending-release-projects');
            await App.loadProjects('completed-projects');

            // Update the project details view
            App.showProjectDetails(projectAddress);
        } catch (error) {
            console.error("Error executing funds release decision:", error);
            alert('Failed to execute funds release decision: ' + (error.message || 'Unknown error'));
        }
    },

    // Check if user has voted on a specific proposal type
    hasVotedOnProposalType: async function (projectAddress, proposalType) {
        if (!App.daoContract || !App.account) return false;

        try {
            const daoInstance = await App.daoContract.deployed();
            const registeredProject = await daoInstance.registeredProjects(projectAddress);

            // Get the appropriate proposal ID based on type
            let proposalId;
            if (proposalType === App.PROPOSAL_TYPE.PROJECT_APPROVAL) {
                proposalId = registeredProject.approvalProposalId;
            } else if (proposalType === App.PROPOSAL_TYPE.FUNDS_RELEASE) {
                proposalId = registeredProject.fundsReleaseProposalId;
            } else {
                return false;
            }

            // Check if user has voted on this proposal
            const userVote = await daoInstance.getMemberVote(proposalId, App.account);
            return parseInt(userVote) > 0;
        } catch (error) {
            console.error("Error checking if user voted:", error);
            return false;
        }
    },

    // Add new function to check if user is admin
    isAdmin: async function () {
        if (!App.daoContract || !App.account) return false;

        try {
            const daoInstance = await App.daoContract.deployed();
            const admin = await daoInstance.admin();
            return App.account.toLowerCase() === admin.toLowerCase();
        } catch (error) {
            console.error("Error checking admin status:", error);
            return false;
        }
    },

    // 修改 saveAuditMaterials 函数
    saveAuditMaterials: async function (text, file, projectAddress) {
        try {
            // 创建 js/audit_files 目录（如果不存在）
            const dirPath = 'js/audit_files';

            // 创建唯一的文件名
            const timestamp = Date.now();
            const fileName = `audit_${timestamp}_${file.name}`;
            const filePath = `${dirPath}/${fileName}`;

            // 将文件转换为 Base64 格式
            const reader = new FileReader();
            const fileData = await new Promise((resolve, reject) => {
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(e);
                reader.readAsDataURL(file);
            });

            // 存储审核资料信息
            const auditData = {
                projectAddress: projectAddress.toLowerCase(),
                text: text,
                fileName: fileName,
                filePath: filePath,
                fileData: fileData,
                originalName: file.name,
                timestamp: timestamp,
                submitter: App.account
            };

            // 使用项目地址作为 key 存储
            localStorage.setItem(`audit_${projectAddress.toLowerCase()}`, JSON.stringify(auditData));

            return filePath;
        } catch (error) {
            console.error("Error saving audit materials:", error);
            throw error;
        }
    },

    // 修改 getProjectAuditMaterials 函数
    getProjectAuditMaterials: function (projectAddress) {
        if (!projectAddress) return null;

        // 直接使用项目地址获取审核资料
        const key = `audit_${projectAddress.toLowerCase()}`;
        const auditData = localStorage.getItem(key);

        return auditData ? JSON.parse(auditData) : null;
    },

    // Initialize navigation
    initNavigation: function () {
        // Get all navigation links
        const navLinks = document.querySelectorAll('.nav-link');

        // Add click event listeners to each navigation link
        navLinks.forEach(link => {
            link.addEventListener('click', function (e) {
                e.preventDefault();

                // Remove all active states
                navLinks.forEach(l => l.classList.remove('active'));

                // Add current active state
                this.classList.add('active');

                // Hide all sections
                document.querySelectorAll('main > section').forEach(section => {
                    section.classList.add('hidden');
                });

                // Show target section
                const targetSection = this.getAttribute('data-section');
                document.getElementById(targetSection).classList.remove('hidden');
            });
        });

        // Add scroll event listener to handle navigation bar appearance
        const nav = document.querySelector('.main-nav');
        let scrollThreshold = 50; // Show background after scrolling this many pixels

        // Function to check scroll position and update nav
        function checkScroll() {
            if (window.scrollY > scrollThreshold) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }

        // Initial check in case page is already scrolled on load
        checkScroll();

        // Add scroll event listener
        window.addEventListener('scroll', checkScroll);
    },

    // 添加这个辅助函数来更新按钮文本
    updateConnectButtonText: async function (isAdmin, isMember) {
        const connectBtn = document.querySelector('.connect-btn');
        const walletDropdown = document.querySelector('.wallet-dropdown');
        if (!connectBtn || !walletDropdown) return;

        // 更新按钮文本和样式
        if (isAdmin) {
            connectBtn.textContent = 'Admin';
            connectBtn.classList.add('admin-role');
        } else if (isMember) {
            connectBtn.textContent = 'DAO Member';
            connectBtn.classList.add('member-role');
        } else {
            connectBtn.textContent = 'Ordinary User';
            connectBtn.classList.add('user-role');
        }

        // 设置点击事件来显示/隐藏下拉框
        connectBtn.onclick = function (e) {
            e.stopPropagation();
            walletDropdown.classList.toggle('hidden');
        };

        // 更新下拉框内容
        const accountAddress = App.account;
        const balance = await App.web3.eth.getBalance(App.account);
        const balanceInEth = App.web3.utils.fromWei(balance, 'ether');

        // 获取 MetaMask 账户信息
        const accounts = await ethereum.request({
            method: 'eth_requestAccounts'
        });

        // 更新下拉框内容
        document.querySelector('.account-name').textContent = `Account ${accounts[0].substring(0, 6)}`;
        document.querySelector('.account-address').textContent =
            `${accountAddress.substring(0, 6)}...${accountAddress.substring(accountAddress.length - 4)}`;
        document.querySelector('.account-balance').textContent = `${parseFloat(balanceInEth).toFixed(4)} ETH`;

        // 获取存储的头像
        const storedAvatar = localStorage.getItem(`avatar_${App.account.toLowerCase()}`);
        const avatar = document.querySelector('.account-avatar img');

        if (storedAvatar) {
            avatar.src = storedAvatar;
        } else {
            avatar.src = `https://avatars.dicebear.com/api/jdenticon/${App.account}.svg`;
        }

        // 添加头像上传功能
        const avatarInput = document.getElementById('avatar-input');
        avatarInput.onchange = async function (e) {
            const file = e.target.files[0];
            if (file) {
                try {
                    // 验证文件类型
                    if (!file.type.startsWith('image/')) {
                        throw new Error('Please upload an image file');
                    }

                    // 验证文件大小 (最大 2MB)
                    if (file.size > 2 * 1024 * 1024) {
                        throw new Error('Image size should be less than 2MB');
                    }

                    // 读取并压缩图片
                    const compressedImage = await App.compressImage(file);

                    // 将压缩后的图片转换为 Base64
                    const reader = new FileReader();
                    reader.onload = function (e) {
                        const base64Image = e.target.result;

                        // 更新头像显示
                        avatar.src = base64Image;

                        // 保存到 localStorage
                        localStorage.setItem(`avatar_${App.account.toLowerCase()}`, base64Image);
                    };
                    reader.readAsDataURL(compressedImage);

                } catch (error) {
                    console.error('Error uploading avatar:', error);
                    alert(error.message || 'Failed to upload avatar');
                }
            }
        };

        // 添加点击其他地方关闭下拉框的功能
        document.addEventListener('click', function (e) {
            if (!walletDropdown.contains(e.target) && !connectBtn.contains(e.target)) {
                walletDropdown.classList.add('hidden');
            }
        });

        // 添加断开连接按钮的功能
        document.querySelector('.disconnect-btn').onclick = function () {
            // 重置状态
            App.account = null;
            connectBtn.textContent = 'Connect Wallet';
            connectBtn.classList.remove('admin-role', 'member-role', 'user-role');
            walletDropdown.classList.add('hidden');

            // 重置其他 UI 元素
            document.getElementById('account-address').textContent = 'Not connected';
            document.getElementById('account-balance').textContent = '0';
            document.getElementById('member-status').textContent = 'Unknown';
            document.getElementById('admin-status').textContent = 'No';
            document.getElementById('dao-management').classList.add('hidden');
            document.getElementById('project-creation').classList.add('hidden');
            document.getElementById('add-member-section').classList.add('hidden');

            // 重新初始化连接按钮的点击事件
            connectBtn.onclick = App.connectWallet;
        };
    },

    // 添加图片压缩功能
    compressImage: async function (file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // 如果图片大于 200x200，等比例缩小
                    if (width > 200 || height > 200) {
                        const ratio = Math.min(200 / width, 200 / height);
                        width *= ratio;
                        height *= ratio;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // 转换为 Blob
                    canvas.toBlob(
                        (blob) => {
                            resolve(new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            }));
                        },
                        'image/jpeg',
                        0.8 // 压缩质量
                    );
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    // 新增方法: 代币分发
    distributeTokens: async function () {
        if (!App.tokenContract || !App.daoContract || !App.account) {
            alert('Please connect your wallet first');
            return;
        }

        try {
            // 检查是否是管理员
            const isAdmin = await App.isAdmin();
            if (!isAdmin) {
                alert('Only admin can distribute tokens');
                return;
            }

            const memberAddress = document.getElementById('token-recipient-address').value;
            const tokenAmount = document.getElementById('token-amount').value;

            // 验证输入
            if (!memberAddress || !App.web3.utils.isAddress(memberAddress)) {
                alert('Please enter a valid Ethereum address');
                return;
            }

            if (!tokenAmount || isNaN(tokenAmount) || parseFloat(tokenAmount) <= 0) {
                alert('Please enter a valid token amount');
                return;
            }

            // 检查该地址是否是 DAO 成员
            const daoInstance = await App.daoContract.deployed();
            const isMember = await daoInstance.members(memberAddress);

            if (!isMember) {
                alert('The address is not a DAO member');
                return;
            }

            // 铸造代币给成员
            const tokenInstance = await App.tokenContract.deployed();
            const tokenAmountWei = App.web3.utils.toWei(tokenAmount, 'ether');
            await tokenInstance.mint(memberAddress, tokenAmountWei, { from: App.account });

            alert(`Successfully distributed ${tokenAmount} tokens to the member`);

            // 刷新 DAO 信息
            await App.loadDaoInfo();

            // 清空输入字段
            document.getElementById('token-recipient-address').value = '';
            document.getElementById('token-amount').value = '';

        } catch (error) {
            console.error("Error distributing tokens:", error);
            alert('Failed to distribute tokens: ' + error.message);
        }
    },

    // Helper function to ensure token contract permissions are set up correctly
    ensureTokenPermissions: async function (projectAddress) {
        try {
            // Check if required contracts are loaded
            if (!App.tokenContract || !App.account) return false;

            const tokenInstance = await App.tokenContract.deployed();
            const daoInstance = await App.daoContract.deployed();

            // Only admin can grant minter role
            const isAdmin = await App.isAdmin();
            if (!isAdmin) return false;

            // Get minter role constant
            const MINTER_ROLE = await tokenInstance.MINTER_ROLE();

            // Check if project has minter role
            const hasRole = await tokenInstance.hasRole(MINTER_ROLE, projectAddress);

            if (!hasRole) {
                console.log(`Granting minter role to project at ${projectAddress}`);
                await tokenInstance.grantRole(MINTER_ROLE, projectAddress, { from: App.account });
                return true;
            }

            return hasRole;
        } catch (error) {
            console.error("Error ensuring token permissions:", error);
            return false;
        }
    }
};

// Initialize the app when the window loads
window.addEventListener('load', function () {
    console.log("Window loaded, initializing app");
    App.init();
}); 