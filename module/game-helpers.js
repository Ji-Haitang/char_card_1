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
    await saveGameData();
    
    if (isInRenderEnvironment()) {
        const renderFunc = getRenderFunction();
        try {
            await renderFunc(`/send at={{lastMessageId}}+1 ${message}`);
            await renderFunc('/trigger');
            console.log('Message sent:', message);
        } catch (error) {
            console.error('Error sending message:', error);
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
    let backgroundUrl = locationBackgrounds.tianshanpai;
    
    if (activeScene && activeScene.id !== 'map-scene') {
        const sceneName = activeScene.id.replace('-scene', '');
        backgroundUrl = locationBackgrounds[sceneName] || locationBackgrounds.tianshanpai;
    }
    
    const params = new URLSearchParams({
        playerName: battleData.player.name,
        playerAttack: battleData.player.attack,
        playerHealth: battleData.player.health,
        enemyName: battleData.enemy.name,
        enemyMaxHealth: battleData.enemy.maxHealth,
        enemyBasicDamage: battleData.enemy.basicDamage,
        backgroundUrl: backgroundUrl
    });
    
    const gameUrl = `https://Ji-Haitang.github.io/char_card_1/turn-based-battle.html?${params.toString()}`;
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
        
        portrait.addEventListener('click', function(e) {
            e.stopPropagation();
            showNpcInfo(npc.id, location, e);
        });
        
        container.appendChild(portrait);
    });
}

// 显示NPC信息弹窗
function showNpcInfo(npcId, location, event) {
    const npc = npcs[npcId];
    const popup = document.getElementById('npc-info-popup');
    
    popup.innerHTML = `
        <div class="npc-info-name">${npc.name}</div>
        <div class="npc-info-desc">${npc.description}</div>
        <div class="npc-info-actions">
            <button class="npc-info-btn" onclick="npcAction('${npcId}', '切磋')">切磋</button>
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
    });

    const targetScene = document.getElementById(sceneName + '-scene');
    if (targetScene) {
        targetScene.classList.add('active');
        if (sceneName !== 'player-stats' && sceneName !== 'relationships') {
            userLocation = sceneName;
            displayNpcs(sceneName);
        }
    }
}

// 显示地点信息弹窗
function showLocationInfo(locationId, event) {
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
