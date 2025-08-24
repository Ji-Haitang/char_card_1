/**
 * game-ui.js - UI更新和显示函数
 * 
 * 文件概述：
 * 负责所有用户界面的更新和显示逻辑，包括状态栏、属性面板、关系界面等。
 * 处理弹窗显示、文本渲染和动态内容更新。
 * 
 * 主要功能：
 * 1. 更新各种显示元素（日期、体力、行动点、属性等）
 * 2. 管理弹窗和提示框
 * 3. 处理Markdown文本渲染
 * 4. 管理悬浮提示框
 * 
 * 对外暴露的主要函数：
 * - updateDateDisplay(): 更新日期显示（年/月/周）
 * - updateMoodDisplay(): 更新体力值显示
 * - updateActionPointsDisplay(): 更新行动点显示并控制按钮状态
 * - updateAllDisplays(): 一次性更新所有显示内容
 * - updateStatsDisplay(): 更新角色属性面板（天赋、数值、战斗属性等）
 * - updateRelationshipsDisplay(): 更新人际关系界面
 * - updateStoryText(text): 使用Markdown渲染并更新故事文本
 * - showModal(text): 显示普通弹窗
 * - showConfirmModal(title, message, onConfirm): 显示确认弹窗
 * - showTooltip(event, text): 显示悬浮提示框
 * - hideTooltip(): 隐藏悬浮提示框
 * 
 * 依赖关系：
 * - 依赖 game-state.js 中的状态变量
 * - 依赖 game-config.js 中的配置数据
 * - 依赖 game-utils.js 中的计算函数
 * - 依赖外部库 markdown-it 进行文本渲染
 */

// 在文件开头添加翻页相关的状态变量
let storyPages = [];  // 存储分页后的文本
let currentPage = 0;  // 当前页码
let isStoryExpanded = false;  // 是否展开显示全文
let slgModeData = [];  // 新增：存储SLG模式的数据

// 更新日期显示
function updateDateDisplay() {
    const year = Math.floor((currentWeek - 1) / 48) + 1;
    const remainingWeeks = (currentWeek - 1) % 48;
    const month = Math.floor(remainingWeeks / 4) + 1;
    const week = remainingWeeks % 4 + 1;
    
    document.getElementById('date-display').textContent = `第${year}年第${month}月第${week}周`;
}

// 更新体力显示
function updateMoodDisplay() {
    const moodText = `体力: ${playerMood}`;
    if (playerMood > 100) {
        document.getElementById('mood-display').innerHTML = `<span style="color: #4ecdc4;">${moodText}</span>`;
    } else {
        document.getElementById('mood-display').textContent = moodText;
    }
}

// 更新行动点显示
function updateActionPointsDisplay() {
    document.getElementById('action-points-display').textContent = `行动点: ${actionPoints}`;
    
    const allSceneBtns = document.querySelectorAll('.scene-btn');
    allSceneBtns.forEach(btn => {
        btn.disabled = actionPoints < 1;
    });
}

// 更新所有显示
function updateAllDisplays() {
    updateDateDisplay();
    updateMoodDisplay();
    updateActionPointsDisplay();
    updateStatsDisplay();
    updateSLGReturnButton();  // 确保这个函数被调用
    
    // 删除或注释掉这部分
    // if (GameMode === 0) {
    //     const backBtns = document.querySelectorAll('.back-btn.slg-mode-offset');
    //     backBtns.forEach(btn => btn.classList.remove('slg-mode-offset'));
    // }
}

// 更新属性显示
function updateStatsDisplay() {
    // 更新天赋
    document.getElementById('talent-gengu').style.width = playerTalents.根骨 + '%';
    document.getElementById('talent-gengu-value').textContent = playerTalents.根骨;
    
    document.getElementById('talent-wuxing').style.width = playerTalents.悟性 + '%';
    document.getElementById('talent-wuxing-value').textContent = playerTalents.悟性;
    
    document.getElementById('talent-xinxing').style.width = playerTalents.心性 + '%';
    document.getElementById('talent-xinxing-value').textContent = playerTalents.心性;
    
    document.getElementById('talent-meili').style.width = playerTalents.魅力 + '%';
    document.getElementById('talent-meili-value').textContent = playerTalents.魅力;
    
    // 更新人物数值
    document.getElementById('stat-wuxue-value').textContent = playerStats.武学;
    document.getElementById('stat-xueshi-value').textContent = playerStats.学识;
    document.getElementById('stat-shengwang-value').textContent = playerStats.声望;
    document.getElementById('stat-jinqian-value').textContent = playerStats.金钱;
    
    // 更新战斗数值
    document.getElementById('combat-attack-value').textContent = combatStats.攻击力;
    document.getElementById('combat-hp-value').textContent = combatStats.生命值;
    
    // 更新剩余点数
    const remainingPoints = calculateRemainingPoints();
    document.getElementById('remaining-points-value').textContent = remainingPoints;
    
    // 更新加点按钮状态
    document.getElementById('add-attack-btn').disabled = remainingPoints <= 0;
    document.getElementById('add-hp-btn').disabled = remainingPoints <= 0;
    
    // 更新已学武功列表
    const skillsContainer = document.getElementById('learned-skills');
    skillsContainer.innerHTML = '';
    Object.keys(martialArts).forEach(skill => {
        if (martialArts[skill] === 1) {
            const skillDiv = document.createElement('div');
            skillDiv.className = 'skill-item';
            skillDiv.textContent = '• ' + skill;
            skillsContainer.appendChild(skillDiv);
        }
    });
}

// 更新关系显示
function updateRelationshipsDisplay() {
    const grid = document.getElementById('relationship-grid');
    grid.innerHTML = '';
    
    Object.keys(npcs).forEach(npcId => {
        const npc = npcs[npcId];
        const favorability = npcFavorability[npcId];
        const isVisible = npcVisibility[npcId];
        const hasGifted = npcGiftGiven[npcId];
        
        const card = document.createElement('div');
        card.className = 'relationship-card';
        
        // 判断是否可以送礼
        const canGift = !hasGifted && favorability <= 40 && playerStats.金钱 >= 500;
        
        card.innerHTML = `
            <div class="relationship-portrait">
                <img src="${npcPortraits[npcId]}" alt="${npc.name}">
            </div>
            <div class="relationship-info">
                <div class="relationship-name">${npc.name}</div>
                <div class="relationship-bar">
                    <div class="relationship-fill" style="width: ${favorability}%"></div>
                </div>
                <div class="relationship-value">好感度: ${favorability}</div>
                <div class="relationship-controls">
                    <label class="visibility-checkbox">
                        <input type="checkbox" id="visibility-${npcId}" ${isVisible ? 'checked' : ''} 
                               onchange="toggleNpcVisibility('${npcId}')">
                        <span class="checkbox-label">出场</span>
                    </label>
                    <button class="gift-btn ${!canGift ? 'disabled' : ''}" 
                            onclick="giveGift('${npcId}')" 
                            ${!canGift ? 'disabled' : ''}>
                        送礼 (500金)
                    </button>
                </div>
            </div>
        `;
        
        card.addEventListener('mouseenter', function(e) {
            showTooltip(e, npc.description);
        });
        
        card.addEventListener('mouseleave', function() {
            hideTooltip();
        });
        
        grid.appendChild(card);
    });
}


// 显示悬停提示
function showTooltip(event, text) {
    const tooltip = document.getElementById('tooltip');
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const viewportRect = document.querySelector('.viewport').getBoundingClientRect();
    
    tooltip.innerHTML = `<div class="tooltip-item">${text}</div>`;
    tooltip.classList.add('show');
    
    let left = rect.left - viewportRect.left + rect.width / 2;
    let top = rect.top - viewportRect.top - 10;
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.transform = 'translateX(-50%) translateY(-100%)';
    
    const tooltipRect = tooltip.getBoundingClientRect();
    
    if (tooltipRect.left < viewportRect.left) {
        tooltip.style.transform = 'translateX(0) translateY(-100%)';
        tooltip.style.left = '10px';
    } else if (tooltipRect.right > viewportRect.right) {
        tooltip.style.transform = 'translateX(-100%) translateY(-100%)';
        tooltip.style.left = (viewportRect.width - 10) + 'px';
    }
    
    if (tooltipRect.top < viewportRect.top) {
        tooltip.style.transform = 'translateX(-50%)';
        tooltip.style.top = (rect.bottom - viewportRect.top + 10) + 'px';
    }
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    tooltip.classList.remove('show');
}

// 更新故事文本（支持分页）
function updateStoryText(text) {
    const storyElement = document.getElementById('story-text');
    currentStoryText = text;

    // 保存当前页码和展开状态
    const previousPage = currentPage;
    const previousExpanded = isStoryExpanded;
    
    // 检查是否为SLG模式
    if (GameMode === 1 && slgModeData && slgModeData.length > 0) {
        // SLG模式：使用slgModeData中的文本
        storyPages = slgModeData.map(data => {
            // 提取文本内容（第一个|之前的部分）
            const textContent = data.text || '';
            const md = window.markdownit({
                html: true,
                breaks: true,
                linkify: true,
                typographer: true
            }).disable('strikethrough');
            
            return md.render(textContent);
        });
    } else {
        // 普通模式：原有的分段逻辑
        let processedText = text.replace(/\n+/g, '\n');
        processedText = processedText.replace(/(\r\n)+/g, '\n');
        processedText = processedText.replace(/\r+/g, '\n');
        
        const md = window.markdownit({
            html: true,
            breaks: true,
            linkify: true,
            typographer: true
        }).disable('strikethrough');
        
        const htmlContent = md.render(processedText);
        
        let paragraphs = [];
        const textParts = processedText.split('\n');
        
        if (textParts.length > 1) {
            paragraphs = textParts
                .filter(part => part.trim())
                .map(part => {
                    const renderedPart = md.render(part);
                    return `<div class="story-paragraph">${renderedPart}</div>`;
                });
        } else {
            const htmlParts = htmlContent.split(/<br\s*\/?>/);
            if (htmlParts.length > 1) {
                paragraphs = htmlParts
                    .filter(part => part.trim())
                    .map(part => `<div class="story-paragraph">${part}</div>`);
            } else {
                paragraphs = [htmlContent];
            }
        }
        
        if (paragraphs.length === 0) {
            paragraphs = [htmlContent];
        }
        
        storyPages = paragraphs;
    }
    
    // 智能恢复页码：
    // 1. 如果之前是展开状态，保持展开
    if (previousExpanded) {
        isStoryExpanded = true;
        currentPage = 0;  // 展开模式不需要页码
    } 
    // 2. 如果新的页数能容纳之前的页码，保持原页码
    else if (previousPage < storyPages.length) {
        currentPage = previousPage;
        isStoryExpanded = false;
    } 
    // 3. 默认情况
    else {
        currentPage = 0;
        isStoryExpanded = false;
    }
    
    // 更新显示
    updateStoryDisplay();
}

 // emotionImg.src = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/${pageData.npc}_${pageData.emotion}.webp`;
// 修改 updateStoryDisplay 函数
function updateStoryDisplay() {
    const storyElement = document.getElementById('story-text');
    const pageIndicator = document.getElementById('page-indicator');
    const prevBtn = document.getElementById('story-prev-btn');
    const nextBtn = document.getElementById('story-next-btn');
    const expandBtn = document.getElementById('story-expand-btn');
    const viewport = document.getElementById('main-viewport');
    
    // 只在非展开模式或非SLG模式时清除图层
    if (!isStoryExpanded || GameMode !== 1) {
        // 清除之前的SLG图层
        const existingLayers = viewport.querySelectorAll('.slg-layer');
        existingLayers.forEach(layer => layer.remove());
        
        // 清除之前的SLG遮罩层
        const existingMask = viewport.querySelector('.slg-interaction-mask');
        if (existingMask) existingMask.remove();
    }
    
    storyElement.onclick = null;
    
    if (isStoryExpanded) {
        // 展开模式
        if (GameMode === 1 && slgModeData && slgModeData.length > 0) {
            storyElement.innerHTML = storyPages.join('');
            // 在SLG模式展开时，保持当前页的图片显示
        } else {
            storyElement.innerHTML = storyPages.join('');
        }
        storyElement.classList.add('expanded');
        if (expandBtn) expandBtn.innerHTML = '▲ 收起';
        if (pageIndicator) pageIndicator.style.display = 'none';
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    } else {
        // 分页模式
        storyElement.innerHTML = storyPages[currentPage] || '';
        storyElement.classList.remove('expanded');
        if (expandBtn) expandBtn.innerHTML = '▼ 展开全文';
        
        // 如果是SLG模式，显示对应的图片
        if (GameMode === 1 && slgModeData && slgModeData[currentPage]) {
            // 检查当前场景，只在需要遮罩的场景添加遮罩
            const activeScene = document.querySelector('.scene.active');
            const needsMask = activeScene && 
                            activeScene.id !== 'player-stats-scene' && 
                            activeScene.id !== 'relationships-scene';
            
            if (needsMask) {
                // 添加遮罩层，阻止场景互动
                const interactionMask = document.createElement('div');
                interactionMask.className = 'slg-interaction-mask';
                viewport.appendChild(interactionMask);
            }
            
            const pageData = slgModeData[currentPage];
            
            // 创建图层容器
            const layerContainer = document.createElement('div');
            layerContainer.className = 'slg-layer-container';
            
            // 1. 场景图层（最底层）
            if (pageData.scene && pageData.scene !== '无') {
                const sceneLayer = document.createElement('div');
                sceneLayer.className = 'slg-layer slg-scene-layer';
                const sceneImg = document.createElement('img');
                sceneImg.src = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/${pageData.scene}.webp`;
                sceneImg.alt = pageData.scene;
                sceneLayer.appendChild(sceneImg);
                layerContainer.appendChild(sceneLayer);
            }
            
            // 2. NPC表情图层（中层）
            if (pageData.npc && pageData.emotion && pageData.emotion !== '无') {
                const npcId = npcNameToId[pageData.npc];
                if (npcId) {
                    const emotionLayer = document.createElement('div');
                    emotionLayer.className = 'slg-layer slg-emotion-layer';
                    const emotionImg = document.createElement('img');
                    emotionImg.src = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/${pageData.npc}.webp`;
                    emotionImg.alt = `${pageData.npc} - ${pageData.emotion}`;
                    emotionLayer.appendChild(emotionImg);
                    layerContainer.appendChild(emotionLayer);
                }
            }
            
            // 3. 特殊CG图层（最顶层）
            if (pageData.cg && pageData.cg !== '无') {
                const cgLayer = document.createElement('div');
                cgLayer.className = 'slg-layer slg-cg-layer';
                const cgImg = document.createElement('img');
                cgImg.src = `https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/CG/${pageData.cg}.webp`;
                cgImg.alt = pageData.cg;
                cgLayer.appendChild(cgImg);
                layerContainer.appendChild(cgLayer);
            }
            
            // 将图层容器添加到viewport
            viewport.appendChild(layerContainer);
        }
        
        // 翻页控件逻辑
        if (storyPages.length > 1) {
            storyElement.style.cursor = 'pointer';
            storyElement.onclick = function(e) {
                const rect = storyElement.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                
                if (clickX < width / 3) {
                    doPrevPage();
                } else if (clickX > width * 2 / 3) {
                    doNextPage();
                }
            };
            
            if (pageIndicator) {
                pageIndicator.style.display = 'flex';
                pageIndicator.innerHTML = '';
                for (let i = 0; i < storyPages.length; i++) {
                    const dot = document.createElement('span');
                    dot.className = 'page-dot' + (i === currentPage ? ' active' : '');
                    dot.onclick = (e) => {
                        e.stopPropagation();
                        doGoToPage(i);
                    };
                    pageIndicator.appendChild(dot);
                }
            }
            
            if (prevBtn) {
                prevBtn.style.display = 'block';
                prevBtn.disabled = currentPage === 0;
            }
            if (nextBtn) {
                nextBtn.style.display = 'block';
                nextBtn.disabled = currentPage === storyPages.length - 1;
            }
        } else {
            storyElement.style.cursor = 'default';
            storyElement.onclick = null;
            
            if (pageIndicator) pageIndicator.style.display = 'none';
            if (prevBtn) prevBtn.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        }
    }
    
    storyElement.style.opacity = '0';
    setTimeout(() => {
        storyElement.style.transition = 'opacity 0.5s ease';
        storyElement.style.opacity = '1';
    }, 100);
}

// 翻页函数（注意函数名改为doXXX避免冲突）
function doGoToPage(pageNum) {
    if (pageNum >= 0 && pageNum < storyPages.length) {
        currentPage = pageNum;
        updateStoryDisplay();
    }
}

function doPrevPage() {
    doGoToPage(currentPage - 1);
}

function doNextPage() {
    doGoToPage(currentPage + 1);
}

// 切换展开/收起
function doToggleStoryExpand() {
    isStoryExpanded = !isStoryExpanded;
    updateStoryDisplay();
}

// 显示弹窗
function showModal(text) {
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalButtons = document.getElementById('modal-buttons');
    
    modalText.innerHTML = text;
    modalButtons.innerHTML = '<button class="modal-btn" onclick="closeModal()">确定</button>';
    modal.style.display = 'block';
}

// 显示确认弹窗
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalButtons = document.getElementById('modal-buttons');
    
    modalText.innerHTML = `<div style="font-size: clamp(1.2rem, 3vw, 1.5rem); margin-bottom: 10px;">${title}</div>${message}`;
    modalButtons.innerHTML = `
        <button class="modal-btn" onclick="confirmAction()">确定</button>
        <button class="modal-btn cancel" onclick="closeModal()">取消</button>
    `;
    
    window.confirmAction = () => {
        closeModal();
        onConfirm();
    };
    
    modal.style.display = 'block';
}

// 更新SLG返回按钮的显示状态
function updateSLGReturnButton() {
    const slgReturnBtn = document.getElementById('slg-return-btn');
    const skipWeekBtn = document.getElementById('skip-week-btn');
    
    if (slgReturnBtn && skipWeekBtn) {
        if (GameMode === 1) {
            // SLG模式：显示返回按钮，隐藏跳过按钮
            slgReturnBtn.style.display = 'block';
            skipWeekBtn.style.display = 'none';
        } else {
            // 普通模式：隐藏返回按钮，显示跳过按钮
            slgReturnBtn.style.display = 'none';
            skipWeekBtn.style.display = 'block';
        }
    }
}

/* 工具：把指定 modal 精准套到 #main-viewport */
function fitModalToViewport(modal) {
    const vp = document.getElementById('main-viewport');
    const vpRect = vp.getBoundingClientRect();
    
    // 使用fixed定位时，直接使用getBoundingClientRect的值即可
    Object.assign(modal.style, {
        left: vpRect.left + 'px',
        top: vpRect.top + 'px',
        width: vpRect.width + 'px',
        height: vpRect.height + 'px',
        position: 'fixed',
        margin: '0',
        transform: 'none'
    });
    
    // 同时设置modal-content的大小
    const content = modal.querySelector('.modal-content');
    if (content) {
        Object.assign(content.style, {
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            maxHeight: 'none',
            left: '0',
            top: '0',
            transform: 'none'
        });
    }
}

/* 供窗口大小变化时实时刷新位置 */
function bindModalAutoFit(modal) {
    let rafId = null;
    
    const refresh = () => {
        // 使用requestAnimationFrame避免过度更新
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            fitModalToViewport(modal);
        });
    };
    
    // 监听窗口大小变化
    window.addEventListener('resize', refresh);
    
    // 监听滚动事件
    window.addEventListener('scroll', refresh, { passive: true });
    document.addEventListener('scroll', refresh, { passive: true });
    
    // 清理函数
    modal._unbindFit = () => {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', refresh);
        window.removeEventListener('scroll', refresh);
        document.removeEventListener('scroll', refresh);
    };
}

// 关闭所有特殊弹窗（背包、装备、难度、金手指）
function closeAllSpecialModals() {
    // 关闭背包
    const inventoryModal = document.getElementById('inventory-modal');
    if (inventoryModal.style.display === 'block') {
        closeInventoryModal();
    }
    
    // 关闭装备
    const equipmentModal = document.getElementById('equipment-modal');
    if (equipmentModal.style.display === 'block') {
        closeEquipmentModal();
    }
    
    // 关闭难度设置
    const difficultyModal = document.getElementById('difficulty-modal');
    if (difficultyModal.style.display === 'block') {
        closeDifficultyModal();
    }
    
    // 关闭金手指
    const cheatModal = document.getElementById('cheat-modal');
    if (cheatModal.style.display === 'block') {
        closeCheatModal();
    }
    
    // 关闭物品详情
    const itemDetailModal = document.getElementById('item-detail-modal');
    if (itemDetailModal.style.display === 'block') {
        closeItemDetailModal();
    }

    // 关闭交易
    const tradingModal = document.getElementById('trading-modal');
    if (tradingModal && tradingModal.style.display === 'block') {
        closeTrading();
    }

    // 关闭商品详情
    const shopDetailModal = document.getElementById('shop-detail-modal');
    if (shopDetailModal && shopDetailModal.style.display === 'block') {
        closeShopDetailModal();
    }
}

// 更新装备槽显示
function updateEquipmentSlot(slotId, itemName) {
    const slot = document.getElementById(slotId);
    if (itemName) {
        slot.innerHTML = `<div class="equipped-item">${itemName}</div>`;
    } else {
        slot.innerHTML = '<div class="empty-slot">空</div>';
    }
}

// 显示道具详情
function showItemDetail(itemName) {
    const item = item_list[itemName];
    if (!item) return;
    
    // 先关闭可能已经打开的物品详情弹窗
    const existingDetailModal = document.getElementById('item-detail-modal');
    if (existingDetailModal.style.display === 'block') {
        closeItemDetailModal();
    }
    
    document.getElementById('item-name').textContent = itemName;
    document.getElementById('item-description').textContent = item.描述;
    
    let infoHTML = '';
    if (item.可交易) {
        infoHTML += `<div class="item-stat"><span class="item-stat-label">买入价格：</span>${item.买入价格} 金</div>`;
        infoHTML += `<div class="item-stat"><span class="item-stat-label">卖出价格：</span>${item.卖出价格} 金</div>`;
    }
    if (item.可装备) {
        infoHTML += `<div class="item-stat"><span class="item-stat-label">装备类型：</span>${item.装备类型}</div>`;
        infoHTML += `<div class="item-stat"><span class="item-stat-label">装备属性：</span>${item.装备属性} +${item.装备数值}</div>`;
    }
    if (item.可使用) {
        infoHTML += `<div class="item-stat"><span class="item-stat-label">使用效果：</span>${getItemEffectText(item)}</div>`;
    }
    document.getElementById('item-info').innerHTML = infoHTML;
    
    const actionsDiv = document.getElementById('item-actions');
    actionsDiv.innerHTML = '';
    
    if (item.可使用) {
        const useBtn = document.createElement('button');
        useBtn.className = 'modal-btn';
        useBtn.textContent = '使用';
        useBtn.onclick = () => useItem(itemName);
        actionsDiv.appendChild(useBtn);
    }
    
    if (item.可装备) {
        const isEquipped = Object.values(equipment).includes(itemName);
        
        if (isEquipped) {
            const unequipBtn = document.createElement('button');
            unequipBtn.className = 'modal-btn unequip-btn';
            unequipBtn.textContent = '卸下';
            unequipBtn.onclick = () => unequipItem(itemName);
            actionsDiv.appendChild(unequipBtn);
        } else {
            const equipBtn = document.createElement('button');
            equipBtn.className = 'modal-btn';
            equipBtn.textContent = '装备';
            equipBtn.onclick = () => equipItem(itemName);
            actionsDiv.appendChild(equipBtn);
        }
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn cancel';
    closeBtn.textContent = '关闭';
    closeBtn.onclick = () => closeItemDetailModal();
    actionsDiv.appendChild(closeBtn);
    
    const modal = document.getElementById('item-detail-modal');
    modal.style.display = 'block';
    
    // 将物品详情弹窗定位在背包弹窗的中心
    const inventoryModal = document.getElementById('inventory-modal');
    const inventoryRect = inventoryModal.getBoundingClientRect();
    const detailContent = modal.querySelector('.modal-content');
    
    // 设置物品详情弹窗的位置
    detailContent.style.position = 'fixed';
    detailContent.style.left = inventoryRect.left + inventoryRect.width / 2 + 'px';
    detailContent.style.top = inventoryRect.top + inventoryRect.height / 2 + 'px';
    detailContent.style.transform = 'translate(-50%, -50%)';
}

// 获取道具效果文本
function getItemEffectText(item) {
    if (item.影响属性 === 'playerMood') {
        return `体力 +${item.影响数值}`;
    }
    return `${item.影响属性} +${item.影响数值}`;
}

function closeItemDetailModal() {
    document.getElementById('item-detail-modal').style.display = 'none';
}