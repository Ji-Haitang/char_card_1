/**
 * game-ui.js - UI更新和显示函数
 * 
 * 文件概述：
 * 负责所有用户界面的更新和显示逻辑，包括状态栏、属性面板、关系界面等。
 * 处理弹窗显示、文本渲染和动态内容更新。
 * 
 * 主要功能：
 * 1. 更新各种显示元素（日期、心情、行动点、属性等）
 * 2. 管理弹窗和提示框
 * 3. 处理Markdown文本渲染
 * 4. 管理悬浮提示框
 * 
 * 对外暴露的主要函数：
 * - updateDateDisplay(): 更新日期显示（年/月/周）
 * - updateMoodDisplay(): 更新心情值显示
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

// 更新日期显示
function updateDateDisplay() {
    const year = Math.floor((currentWeek - 1) / 48) + 1;
    const remainingWeeks = (currentWeek - 1) % 48;
    const month = Math.floor(remainingWeeks / 4) + 1;
    const week = remainingWeeks % 4 + 1;
    
    document.getElementById('date-display').textContent = `第${year}年第${month}月第${week}周`;
}

// 更新心情显示
function updateMoodDisplay() {
    document.getElementById('mood-display').textContent = `心情: ${playerMood}`;
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
        
        const card = document.createElement('div');
        card.className = 'relationship-card';
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
    
    // 预处理文本：将连续的换行符统一替换为单个换行符
    let processedText = text.replace(/\n+/g, '\n');  // 将多个连续的\n替换为单个\n
    processedText = processedText.replace(/(\r\n)+/g, '\n');  // 处理Windows换行符
    processedText = processedText.replace(/\r+/g, '\n');  // 处理Mac换行符
    
    // 使用markdown渲染
    const md = window.markdownit({
        html: true,
        breaks: true,
        linkify: true,
        typographer: true
    }).disable('strikethrough');
    
    const htmlContent = md.render(processedText);
    
    // 分段处理 - 简化版本，直接按处理后的换行符分段
    let paragraphs = [];
    
    // 先尝试按原始文本的换行符分段（已经统一为单个换行符）
    const textParts = processedText.split('\n');
    
    if (textParts.length > 1) {
        // 过滤掉空段落，并为每段渲染Markdown
        paragraphs = textParts
            .filter(part => part.trim())  // 过滤空段落
            .map(part => {
                const renderedPart = md.render(part);
                return `<div class="story-paragraph">${renderedPart}</div>`;
            });
    } else {
        // 如果没有换行符，尝试按渲染后的<br>标签分段
        const htmlParts = htmlContent.split(/<br\s*\/?>/);
        if (htmlParts.length > 1) {
            paragraphs = htmlParts
                .filter(part => part.trim())
                .map(part => `<div class="story-paragraph">${part}</div>`);
        } else {
            // 如果还是没有分段，将整个文本作为一段
            paragraphs = [htmlContent];
        }
    }
    
    // 确保至少有一段
    if (paragraphs.length === 0) {
        paragraphs = [htmlContent];
    }
    
    storyPages = paragraphs;
    currentPage = 0;
    isStoryExpanded = false;
    
    // 更新显示
    updateStoryDisplay();
}

// 更新故事显示
function updateStoryDisplay() {
    const storyElement = document.getElementById('story-text');
    const pageIndicator = document.getElementById('page-indicator');
    const prevBtn = document.getElementById('story-prev-btn');
    const nextBtn = document.getElementById('story-next-btn');
    const expandBtn = document.getElementById('story-expand-btn');
    
    if (isStoryExpanded) {
        // 展开模式：显示全部内容
        storyElement.innerHTML = storyPages.join('');
        storyElement.classList.add('expanded');
        if (expandBtn) expandBtn.innerHTML = '▲ 收起';
        
        // 隐藏翻页控件
        if (pageIndicator) pageIndicator.style.display = 'none';
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    } else {
        // 分页模式
        storyElement.innerHTML = storyPages[currentPage] || '';
        storyElement.classList.remove('expanded');
        if (expandBtn) expandBtn.innerHTML = '▼ 展开全文';
        
        // 显示翻页控件（如果有多页）
        if (storyPages.length > 1) {
            // 更新页面指示器
            if (pageIndicator) {
                pageIndicator.style.display = 'flex';
                pageIndicator.innerHTML = '';
                for (let i = 0; i < storyPages.length; i++) {
                    const dot = document.createElement('span');
                    dot.className = 'page-dot' + (i === currentPage ? ' active' : '');
                    dot.onclick = () => doGoToPage(i);
                    pageIndicator.appendChild(dot);
                }
            }
            
            // 更新翻页按钮状态
            if (prevBtn) {
                prevBtn.style.display = 'block';
                prevBtn.disabled = currentPage === 0;
            }
            if (nextBtn) {
                nextBtn.style.display = 'block';
                nextBtn.disabled = currentPage === storyPages.length - 1;
            }
        } else {
            // 只有一页时隐藏翻页控件
            if (pageIndicator) pageIndicator.style.display = 'none';
            if (prevBtn) prevBtn.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        }
    }
    
    // 添加淡入效果
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
