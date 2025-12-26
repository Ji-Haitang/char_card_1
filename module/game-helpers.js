/**
 * game-helpers.js - 辅助函数库
 * 
 * 文件概述：
 * 提供游戏逻辑的辅助功能，包括消息处理、游戏界面显示、NPC管理、场景切换等。
 * 这些函数连接了游戏的各个系统，提供中间层的功能支持。
 * 
 * 主要功能：
 * 1. 处理消息输出（支持SillyTavern环境和普通弹窗）
 * 2. 管理小游戏iframe（21点、战斗、农场）
 * 3. NPC相关功能（位置、显示、交互）
 * 4. 场景切换和地点管理
 * 
 * 对外暴露的主要函数：
 * - handleMessageOutput(message): 智能处理消息输出（自动判断环境）
 * - showBlackjackGame(): 显示21点赌场游戏
 * - showBattleGame(battleData): 显示回合制战斗游戏
 * - showFarmGame(): 显示农场游戏
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

    if (isInRenderEnvironment()) {
        const renderFunc = getRenderFunction();
        
        // 保存构造的消息到gameData
        lastUserMessage = message;
        console.log('user消息存入变量lastMessage_jxz');
        await renderFunc(`/setvar key=lastMessage_jxz ${message}`);

    // 新增：检查是否是新的一周的消息（新版：年/月/周）
    const newWeekPattern = /^行动选择:新的一周开始了<br>当前第(\d+)年第(\d+)月第(\d+)周$/;
        const match = message.match(newWeekPattern);

        if (match) {
            newWeek = 1;
            console.log('检测到新的一周开始，newWeek设置为1');
        } else {
            newWeek = 0;
            console.log('非新周消息，newWeek设置为0');
        }
        
        try {
            // 显示用户输入信息（仅展示，不等待确认）
            const modalHTML = `
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 15px;">
                    正在发送以下内容
                </div>
                <div style="
                    background: #f5f5f5;
                    padding: 15px;
                    border-radius: 8px;
                    max-height: 400px;
                    overflow-y: auto;
                    text-align: left;
                    white-space: pre-wrap;
                    word-break: break-word;
                ">${message}</div>
                <div style="
                    margin-top: 15px;
                    color: #666;
                    font-size: 14px;
                    text-align: center;
                ">自动发送中...</div>
            `;
            
            // 使用普通的showModal显示信息
            showModal(modalHTML);
            await saveGameData();
            
            // 使用Promise方式延迟，保持在同一个async上下文中
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 确保变量完全同步到SillyTavern
            await saveGameData();
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 使用inject命令隐式注入user输入
            await renderFunc(`/inject id=10 position=chat depth=0 scan=true role=user ${message}`);
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
    
    // 优先使用 SLG 模式下最后验证有效的场景图作为背景
    let backgroundUrl = '';
    if (typeof window !== 'undefined' && window.__lastValidSceneUrl) {
        backgroundUrl = window.__lastValidSceneUrl;
    } else {
        const activeScene = document.querySelector('.scene.active');
        // 兜底为旧逻辑
        if (activeScene && activeScene.id !== 'map-scene') {
            const sceneName = activeScene.id.replace('-scene', '');
            const locationName = locationNames[sceneName];
            const dayNight = dayNightStatus === 'night' ? '夜' : '昼';
            
            if (locationName) {
                backgroundUrl = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/${locationName}_${dayNight}.webp`;
            } else {
                const seasonMap = { 'spring': '春', 'summer': '夏', 'autumn': '秋', 'winter': '冬' };
                const season = seasonMap[seasonStatus] || '冬';
                backgroundUrl = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派_${season}_${dayNight}.webp`;
            }
        } else {
            const seasonMap = { 'spring': '春', 'summer': '夏', 'autumn': '秋', 'winter': '冬' };
            const dayNightMap = { 'daytime': '昼', 'night': '夜' };
            const season = seasonMap[seasonStatus] || '冬';
            const dayNight = dayNightMap[dayNightStatus] || '昼';
            backgroundUrl = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派_${season}_${dayNight}.webp`;
        }
    }
    
    // 获取当前难度
    const currentDifficulty = difficulty || 'normal';
    
    // 准备道具数据 - 从inventory中读取
    const itemCounts = {
        daliwan: inventory['大力丸'] || 0,
        jingutie: inventory['筋骨贴'] || 0,
        jinchuangyao: inventory['金疮药'] || 0,
        piliwan: inventory['霹雳丸'] || 0
    };

    const params = new URLSearchParams({
        playerName: battleData.player.name,
        playerAttack: battleData.player.attack,
        playerHealth: battleData.player.health,
        enemyName: battleData.enemy.name,
        enemyMaxHealth: battleData.enemy.maxHealth,
        enemyBasicDamage: battleData.enemy.basicDamage,
        backgroundUrl: backgroundUrl,
        difficulty: currentDifficulty,
        // 道具数量
        ...itemCounts
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
        lastFarmWeek: lastFarmWeek || 1,  // 传递上次耕种周数
        farmGrid: JSON.stringify(farmGrid || []),  // 传递农场状态
        ...seedCounts
    });
    
    const gameUrl = `https://Ji-Haitang.github.io/char_card_1/farm.html?${params.toString()}`;
    // const gameUrl = `farm.html?${params.toString()}`;
    iframe.src = gameUrl;
    
    modal.style.display = 'block';
}

// 显示炼丹游戏
function showAlchemyGame() {
    // 检查是否已经炼丹过
    if (alchemyDone) {
        showModal('本周已经进行过炼丹，请等待下周！');
        return;
    }
    
    const modal = document.getElementById('alchemy-modal');
    const iframe = document.getElementById('alchemy-iframe');
    
    // 准备药材数据 - 从inventory中读取
    const herbCounts = {
        danshen: inventory['丹参'] || 0,
        danggui: inventory['当归'] || 0,
        moyao: inventory['没药'] || 0,
        chenxiang: inventory['沉香'] || 0
    };
    
    // 准备丹药数据 - 从inventory中读取
    const pillCounts = {
        daliwan: inventory['大力丸'] || 0,
        jingutie: inventory['筋骨贴'] || 0,
        jinchuangyao: inventory['金疮药'] || 0,
        piliwan: inventory['霹雳丸'] || 0
    };
    
    // 调试日志：输出传递的数据
    console.log('[炼丹] 准备传递数据到alchemy.html:');
    console.log('[炼丹] 金钱:', playerStats.金钱);
    console.log('[炼丹] 天赋属性:', playerTalents);
    console.log('[炼丹] 药材数量:', herbCounts);
    console.log('[炼丹] 丹药数量:', pillCounts);
    
    // 构建URL参数
    const params = new URLSearchParams({
        money: playerStats.金钱,
        // 天赋属性（用于属性提升计算）
        rootBone: playerTalents.根骨,
        comprehension: playerTalents.悟性,
        nature: playerTalents.心性,
        charm: playerTalents.魅力,
        // 药材数量
        ...herbCounts,
        // 丹药数量
        ...pillCounts
    });
    
    // 使用本地URL进行调试
    const gameUrl = `https://Ji-Haitang.github.io/char_card_1/alchemy.html?${params.toString()}`;
    //const gameUrl = `alchemy.html?${params.toString()}`;
    
    console.log('[炼丹] 完整URL:', gameUrl);
    
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
        // 关闭弹窗时，取消地图建筑的高亮状态
        try {
            const svg = document.getElementById('map-hit-areas');
            if (svg) {
                const actives = svg.querySelectorAll('polygon.active');
                actives.forEach(n => n.classList.remove('active'));
            }
        } catch (err) {}
    }
}

// 设置地点事件
function setupLocationEvents() {
    const locations = document.querySelectorAll('.location');

    // 渲染“地名 + 分隔线 + 人数光点”结构；不绑定点击/悬停事件
    try {
        locations.forEach(el => {
            const id = el.id;
            const label = (id && typeof locationNames === 'object') ? (locationNames[id] || id) : (id || '');

            // 清空并重建两行结构
            el.innerHTML = '';

            const nameEl = document.createElement('span');
            nameEl.className = 'location-label-text';
            nameEl.textContent = label;

            const dividerEl = document.createElement('span');
            dividerEl.className = 'location-label-divider';

            const peopleEl = document.createElement('span');
            peopleEl.className = 'location-people';
            peopleEl.textContent = '';

            el.appendChild(nameEl);
            el.appendChild(dividerEl);
            el.appendChild(peopleEl);
        });
    } catch (e) {}

    // 初始化一次人数显示
    if (typeof updateLocationHeadcountLabels === 'function') {
        updateLocationHeadcountLabels();
    }
}

// 更新地图地点标签上的人数显示（统一使用白色光点）
function updateLocationHeadcountLabels() {
    try {
        const countByLocation = {
            yanwuchang: 0,
            cangjingge: 0,
            huofang: 0,
            houshan: 0,
            yishiting: 0,
            tiejiangpu: 0,
            nandizi: 0,
            nvdizi: 0,
            shanmen: 0,
            gongtian: 0,
            danfang: 0
        };

        if (currentNpcLocations && typeof currentNpcLocations === 'object') {
            Object.keys(currentNpcLocations).forEach(npcId => {
                const loc = currentNpcLocations[npcId];
                if (loc && countByLocation.hasOwnProperty(loc)) {
                    countByLocation[loc] += 1;
                }
            });
        }

		Object.keys(countByLocation).forEach(locId => {
            const el = document.getElementById(locId);
            if (!el) return;
            const peopleEl = el.querySelector('.location-people');
            const dividerEl = el.querySelector('.location-label-divider');
            if (peopleEl) {
				const n = countByLocation[locId];
				// 清空现有内容
				peopleEl.textContent = '';
				peopleEl.innerHTML = '';
				if (n > 0) {
					for (let i = 0; i < n; i++) {
						const dot = document.createElement('span');
						dot.className = 'people-dot';
						peopleEl.appendChild(dot);
					}
				}
            }
            if (dividerEl) {
                // 当没有人时可淡化分隔线（可选）
                dividerEl.style.opacity = countByLocation[locId] > 0 ? '1' : '0.35';
            }
        });
    } catch (e) {}
}

// 暴露到全局（供页面中其他脚本调用）
window.updateLocationHeadcountLabels = updateLocationHeadcountLabels;

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
    // await saveGameData();
    
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
    // await saveGameData();
    
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
    // await saveGameData();
    
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
    const sceneNames = ['yanwuchang', 'cangjingge', 'huofang', 'houshan', 'yishiting', 'tiejiangpu', 'nandizi', 'nvdizi', 'shanmen', 'gongtian', 'danfang'];
    const dayNight = dayNightStatus === 'night' ? '夜' : '昼';
    
    sceneNames.forEach(sceneName => {
        const scene = document.getElementById(`${sceneName}-scene`);
        if (scene) {
            const locationName = locationNames[sceneName];
            scene.style.backgroundImage = `url('https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/${locationName}_${dayNight}.webp')`;
        }
    });
}