/**
 * game-events.js - 事件处理函数
 * 
 * 文件概述：
 * 处理游戏中的各种事件，包括随机事件、战斗事件、LLM响应解析等。
 * 管理事件的显示、选择和结果处理，以及iframe游戏的消息通信。
 * 
 * 主要功能：
 * 1. 随机事件系统（选项事件的显示和处理）
 * 2. 战斗事件系统（战斗准备和结果处理）
 * 3. LLM响应解析（处理AI返回的游戏数据）
 * 4. iframe消息监听（处理小游戏的结果）
 * 
 * 对外暴露的主要函数：
 * - displayRandomEvent(event): 显示随机事件界面
 * - hideRandomEvent(): 隐藏随机事件界面
 * - displayBattleEvent(event): 显示战斗事件界面
 * - hideBattleEvent(): 隐藏战斗事件界面
 * - parseLLMResponse(response, mainTextContent): 解析LLM返回的JSON响应
 * - setupMessageListeners(): 设置iframe消息监听器
 * - applyBattleReward(reward): 应用战斗胜利奖励
 * 
 * 内部函数：
 * - handleEventOption(optionIndex, option): 处理事件选项选择
 * - applyEventReward(reward): 应用事件奖励
 * 
 * 依赖关系：
 * - 依赖 game-state.js 中的状态变量和更新
 * - 依赖 game-config.js 中的NPC配置
 * - 依赖 game-utils.js 中的数值检查函数
 * - 依赖 game-ui.js 中的显示更新函数
 * - 依赖 game-helpers.js 中的消息处理和游戏显示函数
 * 
 * 特殊说明：
 * - parseLLMResponse 是与AI系统对接的核心函数
 * - 支持处理NPC好感度变化（含魅力判定）
 * - 支持处理NPC位置变动
 * - 支持两种类型的随机事件：选项事件和战斗事件
 */

// 显示随机事件
function displayRandomEvent(event) {
    const container = document.getElementById('random-event-container');
    const description = document.getElementById('event-description');
    const options = document.getElementById('event-options');
    
    description.textContent = event.事件描述;
    options.innerHTML = '';
    
    const optionKeys = ['选项一', '选项二', '选项三'];
    optionKeys.forEach((key, index) => {
        if (event[key]) {
            const option = event[key];
            const btn = document.createElement('button');
            btn.className = 'event-option-btn';
            btn.innerHTML = `
                <div class="option-desc">${option.描述}</div>
                <div class="option-reward">奖励: ${option.奖励}</div>
                <div class="option-success-rate">成功率: ${option.成功率}</div>
            `;
            btn.onclick = () => handleEventOption(index + 1, option);
            options.appendChild(btn);
        }
    });
    
    container.classList.add('show');
}

function hideRandomEvent() {
    const container = document.getElementById('random-event-container');
    container.classList.remove('show');
    currentRandomEvent = null;
}

// 处理事件选项
async function handleEventOption(optionIndex, option) {
    if (!currentRandomEvent) return;
    
    const successRate = parseInt(option.成功率) / 100;
    const isSuccess = Math.random() < successRate;
    
    if (isSuccess && option.奖励) {
        applyEventReward(option.奖励);
    }
    
    const resultMessage = `事件描述: ${currentRandomEvent.事件描述}<br>` +
        `{{user}}行动选择: ${option.描述}<br>` +
        `选择结果: ${isSuccess ? '成功' : '失败'}`;
    
    hideRandomEvent();
    
    await handleMessageOutput(resultMessage);
}

// 应用事件奖励
function applyEventReward(reward) {
    const rewardMatch = reward.match(/(.+?)([+-])(\d+)/);
    if (rewardMatch) {
        const attribute = rewardMatch[1];
        const operation = rewardMatch[2];
        const value = parseInt(rewardMatch[3]);
        
        if (playerTalents.hasOwnProperty(attribute)) {
            if (operation === '+') {
                playerTalents[attribute] = Math.min(100, playerTalents[attribute] + value);
            } else {
                playerTalents[attribute] = Math.max(0, playerTalents[attribute] - value);
            }
            checkAllValueRanges();
            updateStatsDisplay();
        }
        else if (playerStats.hasOwnProperty(attribute)) {
            if (operation === '+') {
                playerStats[attribute] = playerStats[attribute] + value;
            } else {
                playerStats[attribute] = Math.max(0, playerStats[attribute] - value);
            }
            checkAllValueRanges();
            updateStatsDisplay();
        }
    }
}

// 显示战斗事件
function displayBattleEvent(event) {
    const container = document.getElementById('battle-event-container');
    const description = document.getElementById('battle-event-description');
    const enemyName = document.getElementById('enemy-name-display');
    const enemyAttack = document.getElementById('enemy-attack-display');
    const enemyHealth = document.getElementById('enemy-health-display');
    const rewardText = document.getElementById('battle-reward-text');
    
    currentBattleEvent = event;
    
    description.textContent = event.事件描述;
    
    if (event.敌方信息) {
        enemyName.textContent = event.敌方信息.名称 || '未知敌人';
        enemyAttack.textContent = event.敌方信息.属性?.攻击力 || '中';
        enemyHealth.textContent = event.敌方信息.属性?.生命力 || '中';
        
        if (event.敌方信息.战斗报酬) {
            const reward = event.敌方信息.战斗报酬;
            rewardText.textContent = `战斗胜利奖励：${reward.类型}+${reward.数值}`;
            currentBattleReward = reward;
        }
    }
    
    container.classList.add('show');
}

function hideBattleEvent() {
    const container = document.getElementById('battle-event-container');
    container.classList.remove('show');
    currentBattleEvent = null;
}

// 应用战斗奖励
function applyBattleReward(reward) {
    if (!reward) return;
    
    switch (reward.类型) {
        case '金钱':
            playerStats.金钱 += reward.数值;
            break;
        case '声望':
            playerStats.声望 += reward.数值;
            break;
        case '武学':
            playerStats.武学 += reward.数值;
            break;
        case '学识':
            playerStats.学识 += reward.数值;
            break;
    }
    checkAllValueRanges();
    updateStatsDisplay();
}

// 解析LLM响应
function parseLLMResponse(response, mainTextContent) {
    // 在函数开头添加时间解析
    if (response && response.时间) {
        const timeStr = response.时间;
        console.log(`当前时间：${timeStr}`);
        
        // 解析时间格式 "HH:MM"
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            const hour = parseInt(timeMatch[1]);
            const minute = parseInt(timeMatch[2]);
            
            // 判断昼夜
            if (hour >= 6 && hour < 18) {
                dayNightStatus = 'daytime';
            } else {
                dayNightStatus = 'night';
            }
            
            console.log(`昼夜状态更新为：${dayNightStatus}`);
            
            // 更新场景背景
            updateSceneBackgrounds();
        } else {
            console.warn(`无法解析时间格式：${timeStr}`);
        }
    }

    // 解析用户位置变动
    if (response && response.用户 && response.用户.位置变动 && response.用户.位置变动 !== 'none') {
        const userNewLocation = response.用户.位置变动;
        console.log(`用户位置变动：${userNewLocation}`);
        
        // 查找对应的地点ID
        let userLocationId = null;
        for (const [locId, locName] of Object.entries(locationNames)) {
            if (locName === userNewLocation.trim()) {
                userLocationId = locId;
                break;
            }
        }
        
        if (userLocationId) {
            // 更新用户位置
            userLocation = userLocationId;
            userLocation_old = userLocation;
            // gameData.userLocation = userLocationId;
            
            console.log(`用户移动到：${userNewLocation} (${userLocationId})`);
            
            // 切换到新场景（如果不在特殊界面）
            const activeScene = document.querySelector('.scene.active');
            if (activeScene && 
                activeScene.id !== 'player-stats-scene' && 
                activeScene.id !== 'relationships-scene' ) {
                
                // 如果用户位置改变，切换场景
                const currentSceneId = activeScene.id.replace('-scene', '');
                if (currentSceneId !== userLocationId) {
                    switchScene(userLocationId);
                    // 在新场景显示NPC
                    displayNpcs(userLocationId);
                }
            }
        } else {
            console.warn(`未找到位置 "${userNewLocation}" 的ID映射`);
        }
    }

    // 检查是否为SLG模式
    if (GameMode === 1 && mainTextContent) {
        // SLG模式：解析特殊格式的输出
        const lines = mainTextContent.trim().split('\n');
        slgModeData = [];
        
        // 解析每一行
        lines.forEach(line => {
            if (line.trim()) {
                const parts = line.split('|').map(part => part.trim());
                slgModeData.push({
                    text: parts[0] || '',
                    npc: parts[1] || '',
                    scene: parts[2] || '',
                    emotion: parts[3] || '',
                    cg: parts[4] || '无'
                });
            }
        });
        
        // 使用slgModeData中的文本更新显示
        if (slgModeData.length > 0) {
            const allText = slgModeData.map(data => data.text).join('\n');
            currentStoryText = allText;
            updateStoryText(allText);
        }
        
        // 处理response中的NPC数据（如果有）
        if (response && response.主要NPC && typeof response.主要NPC === 'object') {
            for (const npcName in response.主要NPC) {
                const npcData = response.主要NPC[npcName];
                let npcId = npcNameToId[npcName];
                
                if (!npcId) {
                    console.warn(`未找到NPC "${npcName}" 的ID映射`);
                    continue;
                }
                
                // 处理好感变化
                if (npcData.好感变化 && npcFavorability.hasOwnProperty(npcId)) {
                    let changeValue = 0;
    
                    // 根据难度调整好感度变化值
                    const currentDifficulty = difficulty || 'normal';
                    
                    switch (npcData.好感变化) {
                        case '大幅下降':
                            if (currentDifficulty === 'easy') {
                                changeValue = -2;  // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = -2;  // 普通：大幅下降变为-2
                            } else if (currentDifficulty === 'hard') {
                                changeValue = -4;  // 困难：大幅下降-4
                            }
                            break;
                            
                        case '下降':
                            if (currentDifficulty === 'easy') {
                                changeValue = -1;  // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = -1;  // 普通：下降变为-1
                            } else if (currentDifficulty === 'hard') {
                                changeValue = -2;  // 困难：下降-2
                            }
                            break;
                            
                        case '不变':
                            changeValue = 0;  // 所有难度都是0
                            break;
                            
                        case '上升':
                            if (currentDifficulty === 'easy') {
                                changeValue = 2;   // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = 1;   // 普通：上升变为+1
                            } else if (currentDifficulty === 'hard') {
                                changeValue = 1;   // 困难：上升+1
                            }
                            break;
                            
                        case '大幅上升':
                            if (currentDifficulty === 'easy') {
                                changeValue = 4;   // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = 2;   // 普通：大幅上升变为+2
                            } else if (currentDifficulty === 'hard') {
                                changeValue = 2;   // 困难：大幅上升+2
                            }
                            break;
                    }
                    
                    let finalChangeValue = changeValue;
                    let charmMessageShown = false;
                    if (changeValue > 0) {
                        const charmChance = playerTalents.魅力 / 2;
                        if (Math.random() * 100 < charmChance) {
                            finalChangeValue = changeValue * 2;
                            charmMessageShown = true;
                        }
                    }
                    
                    npcFavorability[npcId] = npcFavorability[npcId] + finalChangeValue;
                    checkAllValueRanges();
                    
                    if (charmMessageShown) {
                        setTimeout(() => {
                            showModal(`对${npcName}的魅力属性判定成功，好感度变化加倍`);
                        }, 100);
                    }
                }
                
                // 处理位置变动
                if (npcData.位置变动) {
                    // 支持多种格式："演武场|议事厅|后山" 或 "伙房"
                    const locations = npcData.位置变动.split('|').map(loc => loc.trim());
                    const toLocation = locations[locations.length - 1]; // 取最后一个位置
                    
                    let toLocationId = null;
                    for (const [locId, locName] of Object.entries(locationNames)) {
                        if (locName === toLocation.trim()) {
                            toLocationId = locId;
                            break;
                        }
                    }
                    
                    if (toLocationId) {
                        currentNpcLocations[npcId] = toLocationId;
                        
                        switch(npcId) {
                            case 'A': npcLocationA = toLocationId; break;
                            case 'B': npcLocationB = toLocationId; break;
                            case 'C': npcLocationC = toLocationId; break;
                            case 'D': npcLocationD = toLocationId; break;
                            case 'E': npcLocationE = toLocationId; break;
                            case 'F': npcLocationF = toLocationId; break;
                            case 'G': npcLocationG = toLocationId; break;
                            case 'H': npcLocationH = toLocationId; break;
                            case 'I': npcLocationI = toLocationId; break;
                            case 'J': npcLocationJ = toLocationId; break;
                            case 'K': npcLocationK = toLocationId; break;
                            case 'L': npcLocationL = toLocationId; break;
                        }
                    }
                }
            }
        }
        
    } else {
        // 原有的解析逻辑（普通模式）
        slgModeData = [];  // 清空SLG模式数据
        
        if (mainTextContent) {
            currentStoryText = mainTextContent;
            updateStoryText(currentStoryText);
        }
        
        // 处理主要NPC
        if (response.主要NPC && typeof response.主要NPC === 'object') {
            for (const npcName in response.主要NPC) {
                const npcData = response.主要NPC[npcName];
                
                let npcId = npcNameToId[npcName];
                
                if (!npcId) {
                    console.warn(`未找到NPC "${npcName}" 的ID映射`);
                    continue;
                }
                
                if (npcData.好感变化 && npcFavorability.hasOwnProperty(npcId)) {
                    let changeValue = 0;
    
                    // 根据难度调整好感度变化值
                    const currentDifficulty = difficulty || 'normal';
                    
                    switch (npcData.好感变化) {
                        case '大幅下降':
                            if (currentDifficulty === 'easy') {
                                changeValue = -2;  // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = -2;  // 普通：大幅下降变为-2
                            } else if (currentDifficulty === 'hard') {
                                changeValue = -4;  // 困难：大幅下降-4
                            }
                            break;
                            
                        case '下降':
                            if (currentDifficulty === 'easy') {
                                changeValue = -1;  // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = -1;  // 普通：下降变为-1
                            } else if (currentDifficulty === 'hard') {
                                changeValue = -2;  // 困难：下降-2
                            }
                            break;
                            
                        case '不变':
                            changeValue = 0;  // 所有难度都是0
                            break;
                            
                        case '上升':
                            if (currentDifficulty === 'easy') {
                                changeValue = 2;   // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = 1;   // 普通：上升变为+1
                            } else if (currentDifficulty === 'hard') {
                                changeValue = 1;   // 困难：上升+1
                            }
                            break;
                            
                        case '大幅上升':
                            if (currentDifficulty === 'easy') {
                                changeValue = 4;   // 简单：保持原状
                            } else if (currentDifficulty === 'normal') {
                                changeValue = 2;   // 普通：大幅上升变为+2
                            } else if (currentDifficulty === 'hard') {
                                changeValue = 2;   // 困难：大幅上升+2
                            }
                            break;
                    }
                    
                    let finalChangeValue = changeValue;
                    let charmMessageShown = false;
                    if (changeValue > 0) {
                        const charmChance = playerTalents.魅力 / 2;
                        if (Math.random() * 100 < charmChance) {
                            finalChangeValue = changeValue * 2;
                            charmMessageShown = true;
                        }
                    }
                    
                    npcFavorability[npcId] = npcFavorability[npcId] + finalChangeValue;
                    checkAllValueRanges();
                    
                    if (charmMessageShown) {
                        setTimeout(() => {
                            showModal(`对${npcName}的魅力属性判定成功，好感度变化加倍`);
                        }, 100);
                    }
                }
                
                if (npcData.位置变动) {
                    // 支持多种格式："演武场|议事厅|后山" 或 "伙房"
                    const locations = npcData.位置变动.split('|').map(loc => loc.trim());
                    const toLocation = locations[locations.length - 1]; // 取最后一个位置
                    
                    let toLocationId = null;
                    for (const [locId, locName] of Object.entries(locationNames)) {
                        if (locName === toLocation.trim()) {
                            toLocationId = locId;
                            break;
                        }
                    }
                    
                    if (toLocationId) {
                        currentNpcLocations[npcId] = toLocationId;
                        
                        switch(npcId) {
                            case 'A': npcLocationA = toLocationId; break;
                            case 'B': npcLocationB = toLocationId; break;
                            case 'C': npcLocationC = toLocationId; break;
                            case 'D': npcLocationD = toLocationId; break;
                            case 'E': npcLocationE = toLocationId; break;
                            case 'F': npcLocationF = toLocationId; break;
                            case 'G': npcLocationG = toLocationId; break;
                            case 'H': npcLocationH = toLocationId; break;
                            case 'I': npcLocationI = toLocationId; break;
                            case 'J': npcLocationJ = toLocationId; break;
                            case 'K': npcLocationK = toLocationId; break;
                            case 'L': npcLocationL = toLocationId; break;
                        }
                        
                        console.log(`${npcName} 移动到 ${toLocation}`);
                    } else {
                        console.warn(`未找到位置 "${toLocation}" 的ID映射`);
                    }
                }
            }
        }
    }

    // 处理随机事件
    if (response.随机事件) {
        currentRandomEvent = response.随机事件;
        
        if (currentRandomEvent.事件类型 === '战斗事件') {
            displayBattleEvent(currentRandomEvent);
            hideRandomEvent();
        } else {
            displayRandomEvent(currentRandomEvent);
            hideBattleEvent();
        }
    } else {
        hideRandomEvent();
        hideBattleEvent();
    }
    console.log(`NPC好感度 ${npcFavorability}`);
    // 更新关系显示（如果在关系界面）
    const activeScene = document.querySelector('.scene.active');
    if (activeScene && activeScene.id === 'relationships-scene') {
        updateRelationshipsDisplay();
    }
    console.log(`currentNpcLocations ${currentNpcLocations}`);
    console.log(`npcLocationA ${npcLocationA}`);
    console.log(`npcLocationB ${npcLocationB}`);
    console.log(`npcLocationC ${npcLocationC}`);
    console.log(`npcLocationD ${npcLocationD}`);
    console.log(`npcLocationE ${npcLocationE}`);
    console.log(`npcLocationF ${npcLocationF}`);
    console.log(`npcLocationG ${npcLocationG}`);
    console.log(`npcLocationH ${npcLocationH}`);
    console.log(`npcLocationI ${npcLocationI}`);
    console.log(`npcLocationJ ${npcLocationJ}`);
    console.log(`npcLocationK ${npcLocationK}`);
    console.log(`npcLocationL ${npcLocationL}`);
    // 更新当前场景的NPC显示
    if (activeScene && activeScene.id !== 'map-scene' && 
        activeScene.id !== 'player-stats-scene' && 
        activeScene.id !== 'relationships-scene') {
        const locationName = activeScene.id.replace('-scene', '');
        displayNpcs(locationName);
    }

    checkAllValueRanges();
    updateAllDisplays();
}

// 监听iframe消息
function setupMessageListeners() {
    window.addEventListener('message', async function(event) {
        if (event.data.type === 'blackjack-exit') {
            playerStats.金钱 = event.data.money;
            checkAllValueRanges();
            updateStatsDisplay();
            
            document.getElementById('blackjack-modal').style.display = 'none';
            document.getElementById('blackjack-iframe').src = '';
            
            let message = `赌场游戏结束<br>当前金钱：${playerStats.金钱}`;
            
            if (window.pendingMindMessage) {
                message = '【心性属性判定成功，本次行动不消耗行动点】<br><br>' + message;
                window.pendingMindMessage = false;
            }
            
            showModal(message);
        }
        else if (event.data.type === 'battle-exit') {
            document.getElementById('battle-modal').style.display = 'none';
            document.getElementById('battle-iframe').src = '';
            
            const result = event.data.result;
            
            if (currentBattleType === 'npc') {
                // 无论胜利还是失败，都标记本周已经切磋过
                npcSparred[currentBattleNpcId] = true;
                
                // 获取时间信息
                const year = Math.floor((currentWeek - 1) / 48) + 1;
                const remainingWeeks = (currentWeek - 1) % 48;
                const month = Math.floor(remainingWeeks / 4) + 1;
                const week = remainingWeeks % 4 + 1;
                
                // 获取当前地点
                const activeScene = document.querySelector('.scene.active');
                const locationId = activeScene.id.replace('-scene', '');
                const locationName = locationNames[locationId] || '未知地点';
                
                // 构建地点信息
                let locationInfo = '';
                if (userLocation === userLocation_old) {
                    locationInfo = `地点：${locationName}<br>`;
                } else {
                    const oldLocationName = locationNames[userLocation_old] || userLocation_old;
                    locationInfo = `地点：从${oldLocationName}来到${locationName}<br>`;
                }
                
                // 基础信息
                let resultMessage = `时间：第${year}年第${month}月第${week}周<br>` +
                                `季节：${seasonNameMap[seasonStatus] || '冬天'}<br>` +
                                locationInfo +  // 使用新的地点信息
                                `{{user}}行动选择：武艺切磋<br>` +
                                `切磋对手：${currentBattleNpcName}<br>`;
                
                if (result === 'victory') {
                    resultMessage += `比试结果：胜利<br><br>属性变化：`;
                    
                    // 获取对应的奖励配置
                    const reward = npcSparRewards[currentBattleNpcId];
                    
                    if (reward) {
                        // 应用奖励
                        if (playerTalents.hasOwnProperty(reward.type)) {
                            // 天赋属性
                            playerTalents[reward.type] = Math.min(100, playerTalents[reward.type] + reward.value);
                        } else if (playerStats.hasOwnProperty(reward.type)) {
                            // 人物数值
                            playerStats[reward.type] += reward.value;
                        }
                        resultMessage += `<br>${reward.type}: +${reward.value}`;
                        checkAllValueRanges();
                        updateStatsDisplay();
                    }
                    
                } else if (result === 'defeat' || result === 'quit') {
                    resultMessage += `比试结果：失败<br><br>属性变化：<br>无`;
                }
                
                await handleMessageOutput(resultMessage);
                
                currentBattleNpcName = null;
                currentBattleNpcId = null;
                
            } else if (currentBattleType === 'event') {
                if (result === 'victory') {
                    let rewardMessage = '';
                    if (currentBattleReward) {
                        applyBattleReward(currentBattleReward);
                        rewardMessage = `<br>获得奖励：${currentBattleReward.类型}+${currentBattleReward.数值}`;
                    }
                    await handleMessageOutput(currentBattleEvent.事件描述 + 
                        `<br><br>你迎战${currentBattleEvent.敌方信息.名称}并获得了胜利！` + 
                        rewardMessage);
                } else if (result === 'defeat' || result === 'quit') {
                    await handleMessageOutput(currentBattleEvent.事件描述 + 
                        `<br><br>你迎战${currentBattleEvent.敌方信息.名称}但是不幸败北。`);
                }
                
                hideBattleEvent();
            }
            
            currentBattleType = null;
            currentBattleReward = null;
        }
        else if (event.data.type === 'farm-exit') {
            // 更新金钱
            playerStats.金钱 = event.data.money;
            
            // 更新种子数量
            if (event.data.seeds) {
                inventory['小麦种子'] = event.data.seeds.wheat || 0;
                inventory['茄子种子'] = event.data.seeds.eggplant || 0;
                inventory['甜瓜种子'] = event.data.seeds.melon || 0;
                inventory['甘蔗种子'] = event.data.seeds.sugarcane || 0;
                
                // 清理数量为0的种子
                Object.keys(inventory).forEach(key => {
                    if (inventory[key] === 0) {
                        delete inventory[key];
                    }
                });
            }
            
            // 保存农场状态
            lastFarmWeek = currentWeek;
            farmGrid = event.data.farmGrid || [];
            
            checkAllValueRanges();
            updateAllDisplays();
            await saveGameData();  // 保存游戏数据
            
            document.getElementById('farm-modal').style.display = 'none';
            document.getElementById('farm-iframe').src = '';
        }
    });
}
