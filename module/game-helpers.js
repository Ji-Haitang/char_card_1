/**
 * game-helpers.js - 辅助函数库
 * 
 * 文件概述：
 * 提供游戏逻辑的辅助功能，包括消息处理、游戏界面显示、NPC管理、场景切换等。
 * 这些函数连接了游戏的各个系统，提供中间层的功能支持。
 * 
 * 主要功能：
 * 1. 处理消息输出（支持SillyTavern环境和普通弹窗）
 * 2. 管理小游戏iframe（21点、战斗）
 * 3. NPC相关功能（位置、显示、交互）
 * 4. 场景切换和地点管理
 * 
 * 对外暴露的主要函数：
 * - handleMessageOutput(message): 智能处理消息输出（自动判断环境）
 * - showBlackjackGame(): 显示21点赌场游戏
 * - showBattleGame(battleData): 显示回合制战斗游戏
 * - showInteractionInput(npcId, location): 显示NPC互动输入框
 * - getNpcsAtLocation(location): 获取指定地点的NPC列表
 * - getRandomLocation(npcId): 根据概率获取NPC的随机位置
 * - displayNpcs(location): 在指定地点显示NPC立绘
 * - showNpcInfo(npcId, location, event): 显示NPC信息弹窗
 * - switchScene(sceneName): 切换到指定场景
 * - showLocationInfo(locationId, event): 显示地点信息弹窗
 * - setupLocationEvents(): 初始化地点的鼠标/触摸事件
 * 
 * 内部函数：
 * - closeNpcInfo(): 关闭NPC信息弹窗
 * - closeLocationInfo(): 关闭地点信息弹窗
 * 
 * 依赖关系：
 * - 依赖 game-state.js 中的状态变量和保存函数
 * - 依赖 game-config.js 中的配置数据
 * - 依赖 game-utils.js 中的环境检测函数
 * - 依赖 game-ui.js 中的显示函数
 */

// 处理消息输出
async function handleMessageOutput(message) {
    // 保存构造的消息到gameData
    lastUserMessage = message;
    
    // 如果有待添加的总结内容，添加到世界书
    if (currentSummary && currentSummary.trim()) {
        await updateWorldBookSummary(currentSummary);
        currentSummary = ""; // 清空已添加的内容
    }
    
    await saveGameData();
    
    if (isInRenderEnvironment()) {
        const renderFunc = getRenderFunction();
        try {
            // 使用inject命令隐式注入user输入
            await renderFunc(`/inject id=10 position=chat depth=0 scan=true role=user ephemeral=true ${message}`);
            await renderFunc('/trigger');
            console.log('Message injected:', message);
        } catch (error) {
            console.error('Error injecting message:', error);
            const message_error = `发生失败降级为弹窗<br>` + message;
            showModal(message_error);
        }
    } else {
        const message_notST = `非酒馆环境以弹窗显示<br>` + message;
        showModal(message_notST);
    }
}

// 显示21点游戏
function showBlackjackGame() {
    const modal = document.getElementById('blackjack-modal');
    const iframe = document.getElementById('blackjack-iframe');
    
    const gameUrl = `https://Ji-Haitang.github.io/char_card_1/blackjack.html?money=${playerStats.金钱}`;
    iframe.src = gameUrl;
    
    modal.style.display = 'block';
}

// 显示战斗游戏
function showBattleGame(battleData) {
    const modal = document.getElementById('battle-modal');
    const iframe = document.getElementById('battle-iframe');
    
    const activeScene = document.querySelector('.scene.active');
    let backgroundUrl = '';
    
    // 根据当前场景和昼夜状态构建正确的背景URL
    if (activeScene && activeScene.id !== 'map-scene') {
        const sceneName = activeScene.id.replace('-scene', '');
        const locationName = locationNames[sceneName];
        const dayNight = dayNightStatus === 'night' ? '夜' : '昼';
        
        if (locationName) {
            backgroundUrl = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/${locationName}_${dayNight}.webp`;
        } else {
            // 默认使用天山派地图背景
            const seasonMap = {
                'spring': '春',
                'summer': '夏',
                'autumn': '秋',
                'winter': '冬'
            };
            const season = seasonMap[seasonStatus] || '冬';
            backgroundUrl = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派_${season}_${dayNight}.webp`;
        }
    } else {
        // 如果在地图场景，使用地图背景
        const seasonMap = {
            'spring': '春',
            'summer': '夏',
            'autumn': '秋',
            'winter': '冬'
        };
        const dayNightMap = {
            'daytime': '昼',
            'night': '夜'
        };
        const season = seasonMap[seasonStatus] || '冬';
        const dayNight = dayNightMap[dayNightStatus] || '昼';
        backgroundUrl = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派_${season}_${dayNight}.webp`;
    }
    
    // 获取当前难度
    const currentDifficulty = difficulty || 'normal';

    const params = new URLSearchParams({
        playerName: battleData.player.name,
        playerAttack: battleData.player.attack,
        playerHealth: battleData.player.health,
        enemyName: battleData.enemy.name,
        enemyMaxHealth: battleData.enemy.maxHealth,
        enemyBasicDamage: battleData.enemy.basicDamage,
        backgroundUrl: backgroundUrl,
        difficulty: currentDifficulty
    });
    
    const gameUrl = `https://Ji-Haitang.github.io/char_card_1/turn-based-battle.html?${params.toString()}`;
    // const gameUrl = `turn-based-battle.html?${params.toString()}`;
    iframe.src = gameUrl;
    
    modal.style.display = 'block';
}

// 显示农场游戏
function showFarmGame() {
    const modal = document.getElementById('farm-modal');
    const iframe = document.getElementById('farm-iframe');
    
    // 准备种子数据 - 确保从inventory中正确读取
    const seedCounts = {
        wheat: inventory['小麦种子'] || 0,
        eggplant: inventory['茄子种子'] || 0,
        melon: inventory['甜瓜种子'] || 0,
        sugarcane: inventory['甘蔗种子'] || 0
    };
    
    // 构建URL参数
    const params = new URLSearchParams({
        money: playerStats.金钱,
        week: currentWeek,
        lastFarmWeek: gameData.lastFarmWeek || 1,  // 传递上次耕种周数
        farmGrid: JSON.stringify(gameData.farmGrid || []),  // 传递农场状态
        ...seedCounts
    });
    
    const gameUrl = `https://Ji-Haitang.github.io/char_card_1/farm.html?${params.toString()}`;
    // const gameUrl = `farm.html?${params.toString()}`;
    iframe.src = gameUrl;
    
    modal.style.display = 'block';
}

// 显示互动输入弹窗
function showInteractionInput(npcId, location) {
    currentInteractionNpc = npcId;
    currentInteractionLocation = location;
    
    const npc = npcs[npcId];
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalButtons = document.getElementById('modal-buttons');
    
    modalText.innerHTML = `
        <div style="font-size: clamp(1.2rem, 3vw, 1.5rem); margin-bottom: clamp(15px, 3vw, 20px);">与 ${npc.name} 互动</div>
        <div class="input-area">
            <textarea class="input-field" id="interaction-input" placeholder="请输入你想对${npc.name}说的话或做的事..."></textarea>
        </div>
    `;
    
    modalButtons.innerHTML = `
        <button class="modal-btn" onclick="sendInteraction()">发送</button>
        <button class="modal-btn cancel" onclick="closeModal()">取消</button>
    `;
    
    modal.style.display = 'block';
    
    setTimeout(() => {
        document.getElementById('interaction-input').focus();
    }, 100);
}

// 获取某个地点的NPC列表
function getNpcsAtLocation(location) {
    const npcsAtLocation = [];
    
    Object.keys(currentNpcLocations).forEach(npcId => {
        if (currentNpcLocations[npcId] === location) {
            npcsAtLocation.push({ id: npcId, ...npcs[npcId] });
        }
    });

    return npcsAtLocation;
}

// 根据概率获取NPC的随机位置
function getRandomLocation(npcId) {
    const probabilities = npcLocationProbability[npcId];
    const random = Math.random();
    let cumulative = 0;

    for (const location in probabilities) {
        cumulative += probabilities[location];
        if (random <= cumulative) {
            return location;
        }
    }

    return 'none';
}

// 显示NPC立绘
function displayNpcs(location) {
    const container = document.getElementById(location + '-npcs');
    if (!container) return;

    let npcsAtLocation = getNpcsAtLocation(location);
    container.innerHTML = '';

    if (npcsAtLocation.length === 0) {
        return;
    }

    if (npcsAtLocation.length > 3) {
        npcsAtLocation = npcsAtLocation.sort(() => Math.random() - 0.5);
        npcsAtLocation = npcsAtLocation.slice(0, 3);
        console.log(`${location} 有超过3个NPC，随机显示其中3个`);
    }

    npcsAtLocation.forEach((npc, index) => {
        const portrait = document.createElement('div');
        portrait.className = 'npc-portrait';
        
        // 新增：如果是SLG模式，添加禁用样式
        if (GameMode === 1) {
            portrait.classList.add('slg-mode-disabled');
        }
        
        if (npcsAtLocation.length === 1) {
            portrait.classList.add('single');
        } else if (npcsAtLocation.length === 2) {
            portrait.classList.add(index === 0 ? 'double-left' : 'double-right');
        } else if (npcsAtLocation.length === 3) {
            portrait.style.position = 'absolute';
            portrait.style.bottom = '0';
            portrait.style.width = '60%';
            portrait.style.height = '60%';
            
            const positions = ['25%', '50%', '75%'];
            portrait.style.left = positions[index];
            portrait.style.transform = 'translateX(-50%)';
            portrait.style.zIndex = index + 1;
        }
        
        portrait.innerHTML = `<img src="${npcPortraits[npc.id]}" alt="${npc.name}">`;
        
        // 修改：只在非SLG模式下添加点击事件
        if (GameMode !== 1) {
            portrait.addEventListener('click', function(e) {
                e.stopPropagation();
                showNpcInfo(npc.id, location, e);
            });
        }
        
        container.appendChild(portrait);
    });
}

// 显示NPC信息弹窗
function showNpcInfo(npcId, location, event) {
    // 新增：如果是SLG模式，不显示NPC信息弹窗
    if (GameMode === 1) {
        return;
    }
    const npc = npcs[npcId];
    const popup = document.getElementById('npc-info-popup');
    
    // 检查是否已经切磋过
    const hasSparred = npcSparred[npcId];
    const sparBtnText = hasSparred ? '已切磋' : '切磋';
    const sparBtnDisabled = hasSparred ? 'disabled' : '';
    
    // 获取切磋奖励信息
    const reward = npcSparRewards[npcId];
    const rewardText = reward ? `(${reward.type}+${reward.value})` : '';
    
    popup.innerHTML = `
        <div class="npc-info-name">${npc.name}</div>
        <div class="npc-info-desc">${npc.description}</div>
        <div class="npc-info-actions">
            <button class="npc-info-btn ${hasSparred ? 'disabled' : ''}" 
                    onclick="npcAction('${npcId}', '切磋')" 
                    ${sparBtnDisabled}>${sparBtnText} ${rewardText}</button>
            <button class="npc-info-btn" onclick="npcAction('${npcId}', '互动')">互动</button>
        </div>
    `;
    
    popup.classList.add('show');
    
    const portrait = event.currentTarget;
    const portraitRect = portrait.getBoundingClientRect();
    
    const popupRect = popup.getBoundingClientRect();
    
    const portraitCenterX = portraitRect.left + portraitRect.width / 2;
    const portraitCenterY = portraitRect.top + portraitRect.height / 2;
    
    let left = portraitCenterX - popupRect.width / 2;
    let top = portraitCenterY - popupRect.height / 2;
    
    const margin = 10;
    if (left < margin) {
        left = margin;
    } else if (left + popupRect.width > window.innerWidth - margin) {
        left = window.innerWidth - popupRect.width - margin;
    }
    
    if (top < margin) {
        top = margin;
    } else if (top + popupRect.height > window.innerHeight - margin) {
        top = window.innerHeight - popupRect.height - margin;
    }
    
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.transform = 'none';
    
    setTimeout(() => {
        document.addEventListener('click', closeNpcInfo);
    }, 100);
}

function closeNpcInfo(e) {
    const popup = document.getElementById('npc-info-popup');
    if (!popup.contains(e.target)) {
        popup.classList.remove('show');
        document.removeEventListener('click', closeNpcInfo);
    }
}

// 切换场景
function switchScene(sceneName) {
    const scenes = document.querySelectorAll('.scene');
    scenes.forEach(scene => {
        scene.classList.remove('active');
        scene.classList.remove('slg-mode');
    });

    // 如果切换到角色属性或人际关系场景，清除SLG元素
    if (sceneName === 'player-stats' || sceneName === 'relationships') {
        const viewport = document.getElementById('main-viewport');
        const existingLayers = viewport.querySelectorAll('.slg-layer-container, .slg-layer');
        existingLayers.forEach(layer => layer.remove());
        const existingMask = viewport.querySelector('.slg-interaction-mask');
        if (existingMask) existingMask.remove();
        
        // 不要记录这两个特殊场景为userLocation
    } else {
        // 只在非特殊场景时更新userLocation
        if (sceneName !== 'map') {
            userLocation = sceneName;
        }
    }

    const targetScene = document.getElementById(sceneName + '-scene');
    if (targetScene) {
        targetScene.classList.add('active');
        
        // 只给需要遮罩的场景添加slg-mode类
        if (GameMode === 1 && sceneName !== 'player-stats' && sceneName !== 'relationships') {
            targetScene.classList.add('slg-mode');
        }
        
        if (sceneName !== 'player-stats' && sceneName !== 'relationships' && sceneName !== 'map') {
            displayNpcs(sceneName);
        }
    }
    
    updateSLGReturnButton();
}

// 显示地点信息弹窗
function showLocationInfo(locationId, event) {
    // 新增：如果是SLG模式，不显示地点信息弹窗
    if (GameMode === 1) {
        return;
    }
    const popup = document.getElementById('location-info-popup');
    const locationName = locationNames[locationId];
    const npcsAtLocation = getNpcsAtLocation(locationId);
    
    let npcsHtml = '';
    if (npcsAtLocation.length > 0) {
        npcsHtml = '<div class="location-info-npcs">在场NPC：';
        if (npcsAtLocation.length > 3) {
            npcsHtml += `<div style="font-size: 0.8em; color: #999; margin: 3px 0;">（共${npcsAtLocation.length}人，随机显示3人）</div>`;
        }
        npcsAtLocation.forEach(npc => {
            npcsHtml += `<div class="location-info-npc-item">• ${npc.name}</div>`;
        });
        npcsHtml += '</div>';
    } else {
        npcsHtml = '<div class="location-info-npcs">此处暂无人物</div>';
    }
    
    popup.innerHTML = `
        <div class="location-info-name">${locationName}</div>
        ${npcsHtml}
        <button class="location-go-btn" onclick="goToLocation('${locationId}')">前往</button>
    `;
    
    popup.classList.add('show');
    
    const locationElement = event.currentTarget;
    const locationRect = locationElement.getBoundingClientRect();
    const viewportRect = document.querySelector('.viewport').getBoundingClientRect();
    
    const popupRect = popup.getBoundingClientRect();
    
    const locationCenterX = locationRect.left + locationRect.width / 2;
    const locationCenterY = locationRect.top + locationRect.height / 2;
    
    let left = locationCenterX - popupRect.width / 2;
    let top = locationRect.top - popupRect.height - 10;
    
    const margin = 10;
    
    if (left < viewportRect.left + margin) {
        left = viewportRect.left + margin;
    } else if (left + popupRect.width > viewportRect.right - margin) {
        left = viewportRect.right - popupRect.width - margin;
    }
    
    if (top < viewportRect.top + margin) {
        top = locationRect.bottom + 10;
        
        if (top + popupRect.height > viewportRect.bottom - margin) {
            if (locationCenterY < viewportRect.top + viewportRect.height / 2) {
                top = Math.min(locationRect.bottom + 10, viewportRect.bottom - popupRect.height - margin);
            } else {
                top = Math.max(locationRect.top - popupRect.height - 10, viewportRect.top + margin);
            }
        }
    }
    
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    
    setTimeout(() => {
        document.addEventListener('click', closeLocationInfo);
    }, 100);
}

function closeLocationInfo(e) {
    const popup = document.getElementById('location-info-popup');
    if (!popup.contains(e.target)) {
        popup.classList.remove('show');
        document.removeEventListener('click', closeLocationInfo);
    }
}

// 设置地点事件
function setupLocationEvents() {
    const locations = document.querySelectorAll('.location');

    locations.forEach(location => {
        let touchTimer = null;
        
        location.addEventListener('mouseenter', function(e) {
            if (!('ontouchstart' in window)) {
                showLocationInfo(this.id, e);
            }
        });

        location.addEventListener('mouseleave', function() {
            if (!('ontouchstart' in window)) {
                // PC端不自动关闭
            }
        });

        location.addEventListener('touchstart', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if (touchTimer) {
                clearTimeout(touchTimer);
            }
            
            showLocationInfo(this.id, e);
        });

        location.addEventListener('click', function(e) {
            if (!('ontouchstart' in window)) {
                e.preventDefault();
                e.stopPropagation();
                showLocationInfo(this.id, e);
            }
        });
    });
}

// 使用道具
async function useItem(itemName) {
    const item = item_list[itemName];
    if (!item || !item.可使用 || inventory[itemName] <= 0) return;
    
    if (item.影响属性 === 'playerMood') {
        playerMood = Math.min(120, playerMood + item.影响数值);  // 从100改为120
    }
    
    inventory[itemName]--;
    if (inventory[itemName] <= 0) {
        delete inventory[itemName];
    }
    
    checkAllValueRanges();
    updateAllDisplays();
    await saveGameData();
    
    // showModal(`使用了${itemName}！<br>体力 +${item.影响数值}`);
    
    closeItemDetailModal();
    showInventory();
}

// 装备道具（简化逻辑：直接修改属性值）
async function equipItem(itemName) {
    const item = item_list[itemName];
    if (!item || !item.可装备 || inventory[itemName] <= 0) return;
    
    let targetSlot = null;
    
    if (item.装备类型 === '武器') {
        targetSlot = '武器';
    } else if (item.装备类型 === '防具') {
        targetSlot = '防具';
    } else if (item.装备类型 === '饰品') {
        if (!equipment.饰品1) {
            targetSlot = '饰品1';
        } else if (!equipment.饰品2) {
            targetSlot = '饰品2';
        } else {
            targetSlot = '饰品1';
        }
    }
    
    if (!targetSlot) return;
    
    // 如果槽位已有装备，先卸下旧装备
    const oldEquipment = equipment[targetSlot];
    if (oldEquipment) {
        const oldItem = item_list[oldEquipment];
        if (oldItem) {
            // 减去旧装备的属性
            if (oldItem.装备属性 === '攻击力') {
                combatStats.攻击力 -= oldItem.装备数值;
            } else if (oldItem.装备属性 === '生命值') {
                combatStats.生命值 -= oldItem.装备数值;
            }
        }
        inventory[oldEquipment] = (inventory[oldEquipment] || 0) + 1;
    }
    
    // 装备新道具，直接加上属性
    equipment[targetSlot] = itemName;
    if (item.装备属性 === '攻击力') {
        combatStats.攻击力 += item.装备数值;
    } else if (item.装备属性 === '生命值') {
        combatStats.生命值 += item.装备数值;
    }
    
    inventory[itemName]--;
    if (inventory[itemName] <= 0) {
        delete inventory[itemName];
    }
    
    checkAllValueRanges();
    updateAllDisplays();
    await saveGameData();
    
    // showModal(`装备了${itemName}！<br>${item.装备属性} +${item.装备数值}`);
    
    closeItemDetailModal();
    showEquipment();
}

// 卸下装备（简化逻辑：直接修改属性值）
async function unequipItem(itemName) {
    let slot = null;
    for (const [key, value] of Object.entries(equipment)) {
        if (value === itemName) {
            slot = key;
            break;
        }
    }
    
    if (!slot) return;
    
    const item = item_list[itemName];
    if (item) {
        // 减去装备的属性
        if (item.装备属性 === '攻击力') {
            combatStats.攻击力 -= item.装备数值;
        } else if (item.装备属性 === '生命值') {
            combatStats.生命值 -= item.装备数值;
        }
    }
    
    equipment[slot] = null;
    inventory[itemName] = (inventory[itemName] || 0) + 1;
    
    checkAllValueRanges();
    updateAllDisplays();
    await saveGameData();
    
    // showModal(`卸下了${itemName}！`);
    
    closeItemDetailModal();
    showEquipment();
}

// 根据周数计算季节
function calculateSeason(week) {
    const year = Math.floor((week - 1) / 48) + 1;
    const remainingWeeks = (week - 1) % 48;
    const month = Math.floor(remainingWeeks / 4) + 1;
    
    if (month === 12 || month === 1 || month === 2) {
        return 'winter';
    } else if (month >= 3 && month <= 5) {
        return 'spring';
    } else if (month >= 6 && month <= 8) {
        return 'summer';
    } else {  // 9, 10, 11月
        return 'autumn';
    }
}

// 更新场景背景（根据昼夜和季节）
function updateSceneBackgrounds() {
    // 更新地图场景背景
    const mapScene = document.getElementById('map-scene');
    if (mapScene) {
        const seasonMap = {
            'spring': '春',
            'summer': '夏',
            'autumn': '秋',
            'winter': '冬'
        };
        const dayNightMap = {
            'daytime': '昼',
            'night': '夜'
        };
        
        const season = seasonMap[seasonStatus] || '冬';
        const dayNight = dayNightMap[dayNightStatus] || '昼';
        
        mapScene.style.backgroundImage = `url('https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派_${season}_${dayNight}.webp')`;
    }
    
    // 更新其他场景背景
    const sceneNames = ['yanwuchang', 'cangjingge', 'huofang', 'houshan', 'yishiting', 'tiejiangpu', 'nandizi', 'nvdizi', 'shanmen', 'gongtian'];
    const dayNight = dayNightStatus === 'night' ? '夜' : '昼';
    
    sceneNames.forEach(sceneName => {
        const scene = document.getElementById(`${sceneName}-scene`);
        if (scene) {
            const locationName = locationNames[sceneName];
            scene.style.backgroundImage = `url('https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/${locationName}_${dayNight}.webp')`;
        }
    });
}

// 初始化世界书
async function initializeWorldBook() {
    console.log('进入初始化世界书函数');
    if (!isInRenderEnvironment()) {
        console.log('非SillyTavern环境，跳过世界书初始化');
        return;
    }
    console.log('SillyTavern环境，开始初始化世界书');
    const renderFunc = getRenderFunction();
    if (!renderFunc) return;
    console.log('获取渲染函数成功，准备开始获取或者创建世界书');
    try {
        // 获取或创建聊天绑定的世界书
        console.log('获取世界书名称');
        let bookName = await renderFunc('/getchatbook');
        if (bookName) {
            console.log('获取世界书名称成功：', bookName);
            // 如果bookName不同于已保存的，说明是新聊天或切换了聊天
            if (bookName !== worldBookName) {
                worldBookName = bookName;
                summaryEntryUID = ""; // 重置UID，需要重新查找或创建
                let nullid = await renderFunc(`/createentry file="${worldBookName}" key="占位" 纯占位`);
                console.log('世界书名称：', worldBookName);
            }
            console.log('检查是否已有"聊天小总结"条目');
            // 检查是否已有"聊天小总结"条目
            if (!summaryEntryUID) {
                // 先尝试查找已存在的条目
                let uid = await renderFunc(`/findentry file="${worldBookName}" field=key 聊天小总结`);
                
                if (!uid || uid === "") {
                    // 如果不存在，创建新条目
                    uid = await renderFunc(`/createentry file="${worldBookName}" key="聊天小总结" 本次聊天的重要事件总结`);
                    console.log('创建聊天小总结条目，UID：', uid);
                } else {
                    console.log('找到已存在的聊天小总结条目，UID：', uid);
                }
                
                if (uid) {
                    summaryEntryUID = uid;
                    console.log('设置条目的其他属性', uid);
                    // 设置条目的其他属性
                    await renderFunc(`/setentryfield file="${worldBookName}" uid=${summaryEntryUID} field=disable 1`);
                }
            }
            await renderFunc('/echo ✅世界书初始化完成')
            // 保存世界书信息到gameData
            console.log('保存世界书信息');
            await saveGameData();
        }
    } catch (error) {
        console.error('初始化世界书失败：', error);
        await renderFunc('/echo 🚫世界书初始化失败')
    }
}

// 更新世界书总结内容
async function updateWorldBookSummary(summaryText) {
    if (!isInRenderEnvironment() || !worldBookName || !summaryEntryUID) {
        console.log('无法更新世界书总结：环境或条目不存在');
        return;
    }
    
    const renderFunc = getRenderFunction();
    if (!renderFunc) return;
    
    try {
        // 获取现有内容
        let existingContent = await renderFunc(`/getentryfield file="${worldBookName}" field=content ${summaryEntryUID}`);
        
        // 如果existingContent是字符串形式的"null"或undefined，将其转换为空字符串
        if (!existingContent || existingContent === "null" || existingContent === "undefined") {
            existingContent = "";
        }
        
        // 构建新内容（保留历史，添加时间戳）
        const year = Math.floor((currentWeek - 1) / 48) + 1;
        const remainingWeeks = (currentWeek - 1) % 48;
        const month = Math.floor(remainingWeeks / 4) + 1;
        const week = remainingWeeks % 4 + 1;
        
        const timestamp = `[第${year}年第${month}月第${week}周]`;
        const newContent = existingContent 
            ? `${existingContent}\n\n${timestamp}\n${summaryText}`
            : `${timestamp}\n${summaryText}`;
        
        // 更新条目内容
        await renderFunc(`/setentryfield file="${worldBookName}" uid=${summaryEntryUID} field=content ${newContent}`);
        console.log('世界书总结已更新');
        
    } catch (error) {
        console.error('更新世界书总结失败：', error);
    }
}

// 获取世界书总结内容
async function getWorldBookSummary() {
    if (!isInRenderEnvironment() || !worldBookName || !summaryEntryUID) {
        return "暂无聊天总结记录";
    }
    
    const renderFunc = getRenderFunction();
    if (!renderFunc) return "无法获取总结内容";
    
    try {
        const content = await renderFunc(`/getentryfield file="${worldBookName}" field=content ${summaryEntryUID}`);
        
        if (!content || content === "null" || content === "undefined") {
            return "暂无聊天总结记录";
        }
        
        return content;
    } catch (error) {
        console.error('获取世界书总结失败：', error);
        return "获取总结内容时出错";
    }
}