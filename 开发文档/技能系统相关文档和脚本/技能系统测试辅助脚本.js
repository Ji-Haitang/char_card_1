(function installSkillTestHelper() {
    const HELPER_VERSION = '2026-04-17-batch-bridge-1';
    const isMainPage = !!document.getElementById('battle-iframe');
    const isBattlePage = !!document.getElementById('battle-log') && typeof selectAction === 'function';

    function safeClone(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function actionLabel(action) {
        const labelMap = {
            'gather': '集气',
            'defend': '防御',
            'light-attack': '轻攻击',
            'heavy-attack': '重攻击',
            'special': '绝招',
            'taunt': '嘴炮'
        };
        return labelMap[action] || action;
    }

    function installBattleHelperInCurrentWindow(targetWindow) {
        if (targetWindow && targetWindow.skillTestBattleHelper && targetWindow.skillTestBattleHelper.__version === HELPER_VERSION) {
            return targetWindow.skillTestBattleHelper;
        }

        const evalCode = `
            (function createBattleSkillTestHelper() {
                const HELPER_VERSION = ${JSON.stringify(HELPER_VERSION)};

                if (window.skillTestBattleHelper && window.skillTestBattleHelper.__version === HELPER_VERSION) {
                    return;
                }

                function safeClone(value) {
                    try {
                        return JSON.parse(JSON.stringify(value));
                    } catch (error) {
                        return value;
                    }
                }

                function actionLabel(action) {
                    const labelMap = {
                        'gather': '集气',
                        'defend': '防御',
                        'light-attack': '轻攻击',
                        'heavy-attack': '重攻击',
                        'special': '绝招',
                        'taunt': '嘴炮'
                    };
                    return labelMap[action] || action;
                }

                function installDebugLogCapture() {
                    if (!window.__skillTestCapturedLogs) {
                        window.__skillTestCapturedLogs = [];
                    }
                    if (window.__skillTestConsolePatched) {
                        return;
                    }

                    function formatDebugArg(arg) {
                        if (typeof arg === 'string') {
                            return arg;
                        }
                        try {
                            return JSON.stringify(arg);
                        } catch (error) {
                            return String(arg);
                        }
                    }

                    function captureDebugLog(args) {
                        if (!args || args.length === 0) {
                            return;
                        }

                        const first = typeof args[0] === 'string' ? args[0] : '';
                        if (!first.startsWith('[SkillTest]') && !first.startsWith('[SkillTestHelper]')) {
                            return;
                        }

                        window.__skillTestCapturedLogs.push(args.map(formatDebugArg).join(' '));
                        if (window.__skillTestCapturedLogs.length > 400) {
                            window.__skillTestCapturedLogs = window.__skillTestCapturedLogs.slice(-400);
                        }
                    }

                    const originalLog = console.log.bind(console);
                    const originalWarn = console.warn.bind(console);

                    console.log = function patchedSkillTestLog(...args) {
                        captureDebugLog(args);
                        return originalLog(...args);
                    };

                    console.warn = function patchedSkillTestWarn(...args) {
                        captureDebugLog(args);
                        return originalWarn(...args);
                    };

                    window.__skillTestConsolePatched = true;
                }

                installDebugLogCapture();

                function snapshot() {
                    return {
                        currentTurn: gameState.currentTurn,
                        turnNumber: gameState.turnNumber,
                        waitingForConfirmation: gameState.waitingForConfirmation,
                        player: {
                            name: gameState.player.name,
                            currentHealth: gameState.player.currentHealth,
                            maxHealth: gameState.player.maxHealth,
                            energy: gameState.player.energy,
                            energyPrecise: gameState.player.energyPrecise,
                            selectedAction: gameState.player.selectedAction,
                            lastAction: gameState.player.lastAction,
                            previousAction: gameState.player.previousAction,
                            tauntedTurns: gameState.player.tauntedTurns,
                            swordIntent: gameState.player.swordIntent || 0,
                            yuanBiQuanBonus: gameState.player.yuanBiQuanBonus || 0
                        },
                        enemy: {
                            name: gameState.enemy.name,
                            currentHealth: gameState.enemy.currentHealth,
                            maxHealth: gameState.enemy.maxHealth,
                            energy: gameState.enemy.energy,
                            energyPrecise: gameState.enemy.energyPrecise,
                            selectedAction: gameState.enemy.selectedAction,
                            tauntedTurns: gameState.enemy.tauntedTurns,
                            style: gameState.enemy.style
                        },
                        playerEquippedSkills: safeClone(playerEquippedSkills || {})
                    };
                }

                function logSnapshot() {
                    const data = snapshot();
                    console.group('[SkillTestHelper] battle snapshot');
                    console.log(data);
                    console.groupEnd();
                    return data;
                }

                function recentLogs(count = 12) {
                    const lines = Array.from(document.querySelectorAll('#battle-log *'))
                        .map(node => (node.textContent || '').trim())
                        .filter(Boolean);
                    return lines.slice(-count);
                }

                function allLogs() {
                    return Array.from(document.querySelectorAll('#battle-log *'))
                        .map(node => (node.textContent || '').trim())
                        .filter(Boolean);
                }

                function recentDebugLogs(count = 20) {
                    return (window.__skillTestCapturedLogs || []).slice(-count);
                }

                function allDebugLogs() {
                    return (window.__skillTestCapturedLogs || []).slice();
                }

                function logSkillsByTiming() {
                    const grouped = {};
                    Object.values(playerEquippedSkills || {}).forEach(skill => {
                        if (!skill || !skill.triggerTiming) return;
                        if (!grouped[skill.triggerTiming]) {
                            grouped[skill.triggerTiming] = [];
                        }
                        grouped[skill.triggerTiming].push(skill.name + ' Lv' + skill.level);
                    });
                    console.group('[SkillTestHelper] 技能分组');
                    console.log(grouped);
                    console.groupEnd();
                    return grouped;
                }

                if (!window.__skillTestOriginalSelectEnemyAction) {
                    window.__skillTestOriginalSelectEnemyAction = selectEnemyAction;
                    selectEnemyAction = function patchedSelectEnemyAction() {
                        if (window.__skillTestForcedEnemyAction) {
                            const forcedAction = window.__skillTestForcedEnemyAction;
                            window.__skillTestForcedEnemyAction = null;
                            gameState.enemy.selectedAction = forcedAction;
                            addLog('【SkillTest】敌方动作已强制为' + actionLabel(forcedAction));
                            console.log('[SkillTestHelper] force enemy action:', forcedAction);
                            return;
                        }
                        return window.__skillTestOriginalSelectEnemyAction.apply(this, arguments);
                    };
                }

                function forceNextEnemyAction(action) {
                    const validActions = ['gather', 'defend', 'light-attack', 'heavy-attack', 'special', 'taunt'];
                    if (!validActions.includes(action)) {
                        throw new Error('无效敌方动作: ' + action);
                    }
                    window.__skillTestForcedEnemyAction = action;
                    console.log('[SkillTestHelper] 下一回合敌方动作将强制为:', action);
                    return action;
                }

                function setPlayerState(patch) {
                    Object.assign(gameState.player, patch || {});
                    updateDisplay();
                    return snapshot();
                }

                function setEnemyState(patch) {
                    Object.assign(gameState.enemy, patch || {});
                    updateDisplay();
                    return snapshot();
                }

                function setPlayerHealthRatio(ratio) {
                    const boundedRatio = Math.max(0.01, Math.min(1, Number(ratio) || 1));
                    gameState.player.currentHealth = Math.max(1, Math.round(gameState.player.maxHealth * boundedRatio));
                    updateDisplay();
                    console.log('[SkillTestHelper] 玩家血量已设置为比例:', boundedRatio, gameState.player.currentHealth + '/' + gameState.player.maxHealth);
                    return snapshot();
                }

                function setPlayerEnergy(value) {
                    const next = Math.max(0, Math.min(gameState.player.maxEnergy || 10, Number(value) || 0));
                    gameState.player.energy = next;
                    gameState.player.energyPrecise = next;
                    updateDisplay();
                    console.log('[SkillTestHelper] 玩家能量已设置为:', next);
                    return snapshot();
                }

                function setEnemyEnergy(value) {
                    const next = Math.max(0, Math.min(gameState.enemy.maxEnergy || 10, Number(value) || 0));
                    gameState.enemy.energy = next;
                    gameState.enemy.energyPrecise = next;
                    updateDisplay();
                    console.log('[SkillTestHelper] 敌方能量已设置为:', next);
                    return snapshot();
                }

                function normalizeBattleState(options = {}) {
                    const playerHealthRatio = options.playerHealthRatio == null ? 1 : Number(options.playerHealthRatio);
                    const enemyHealthRatio = options.enemyHealthRatio == null ? 1 : Number(options.enemyHealthRatio);
                    const playerEnergy = options.playerEnergy == null ? 0 : Number(options.playerEnergy);
                    const enemyEnergy = options.enemyEnergy == null ? 0 : Number(options.enemyEnergy);
                    const disableFieldEffect = options.disableFieldEffect == null ? true : Boolean(options.disableFieldEffect);

                    gameState.currentTurn = 'player';
                    gameState.waitingForConfirmation = false;
                    gameState.player.selectedAction = null;
                    gameState.player.lastAction = options.playerLastAction == null ? null : options.playerLastAction;
                    gameState.player.previousAction = options.playerPreviousAction == null ? null : options.playerPreviousAction;
                    gameState.player.swordIntent = options.swordIntent == null ? 0 : Number(options.swordIntent);
                    gameState.player.yuanBiQuanBonus = options.yuanBiQuanBonus == null ? 0 : Number(options.yuanBiQuanBonus);
                    gameState.enemy.selectedAction = null;
                    gameState.player.tauntedTurns = 0;
                    gameState.enemy.tauntedTurns = 0;

                    // 清除当前场地效果
                    if (typeof activeFieldEffect !== 'undefined') {
                        activeFieldEffect = null;
                    }
                    if (typeof fieldEffectRemaining !== 'undefined') {
                        fieldEffectRemaining = 0;
                    }
                    if (typeof updateFieldEffectUI === 'function') {
                        updateFieldEffectUI();
                    }

                    // 禁用/恢复场地效果触发
                    if (disableFieldEffect) {
                        if (!window.__skillTestOriginalCheckFieldEffect && typeof checkFieldEffectTrigger === 'function') {
                            window.__skillTestOriginalCheckFieldEffect = checkFieldEffectTrigger;
                        }
                        if (window.__skillTestOriginalCheckFieldEffect) {
                            checkFieldEffectTrigger = function skillTestNoFieldEffect() {
                                console.log('[SkillTestHelper] 场地效果已禁用（测试模式）');
                            };
                        }
                    } else if (window.__skillTestOriginalCheckFieldEffect) {
                        checkFieldEffectTrigger = window.__skillTestOriginalCheckFieldEffect;
                    }

                    gameState.player.currentHealth = Math.max(1, Math.round(gameState.player.maxHealth * Math.max(0.01, Math.min(1, playerHealthRatio || 1))));
                    gameState.enemy.currentHealth = Math.max(1, Math.round(gameState.enemy.maxHealth * Math.max(0.01, Math.min(1, enemyHealthRatio || 1))));
                    gameState.player.energy = Math.max(0, Math.min(gameState.player.maxEnergy || 10, playerEnergy || 0));
                    gameState.player.energyPrecise = gameState.player.energy;
                    gameState.enemy.energy = Math.max(0, Math.min(gameState.enemy.maxEnergy || 10, enemyEnergy || 0));
                    gameState.enemy.energyPrecise = gameState.enemy.energy;

                    if (typeof selectedActionText !== 'undefined' && selectedActionText) {
                        selectedActionText.textContent = '无';
                    }
                    if (typeof confirmModal !== 'undefined' && confirmModal) {
                        confirmModal.style.display = 'none';
                    }
                    if (typeof gameOverModal !== 'undefined' && gameOverModal) {
                        gameOverModal.style.display = 'none';
                    }
                    if (typeof commandButtons !== 'undefined' && commandButtons) {
                        commandButtons.forEach(btn => {
                            btn.classList.remove('disabled');
                            btn.classList.remove('selected');
                        });
                    }
                    if (typeof updateDisplay === 'function') {
                        updateDisplay();
                    }
                    if (typeof checkButtonAvailability === 'function') {
                        checkButtonAvailability();
                    }

                    console.log('[SkillTestHelper] 已标准化战斗状态:', {
                        playerHealthRatio,
                        enemyHealthRatio,
                        playerEnergy,
                        enemyEnergy
                    });
                    return snapshot();
                }

                function runTurn(playerAction, enemyAction) {
                    if (enemyAction) {
                        forceNextEnemyAction(enemyAction);
                    }
                    selectAction(playerAction);
                    confirmAction();
                    return {
                        playerAction: playerAction,
                        enemyAction: enemyAction || 'AI'
                    };
                }

                function wait(ms = 800) {
                    return new Promise(resolve => setTimeout(resolve, ms));
                }

                async function waitForTurnAdvance(startTurn, timeoutMs = 6000) {
                    const start = Date.now();
                    while (Date.now() - start < timeoutMs) {
                        const gameEnded = document.getElementById('game-over-modal')?.style.display === 'flex';
                        if (gameState.turnNumber > startTurn || gameEnded) {
                            await wait(250);
                            return true;
                        }
                        await wait(100);
                    }
                    return false;
                }

                function pickRecentSkillLogs(logs) {
                    return logs.filter(line => line.includes('【SkillTest】') || line.includes('【以牙还牙】') || line.includes('【猿臂拳】') || line.includes('【无剑真意】') || line.includes('【小梨飞刀】') || line.includes('【开山九式】') || line.includes('【冰川点穴手】') || line.includes('【归义剑诀】') || line.includes('【'));
                }

                function summarizeExpectation(expectation, logs, debugLogs = []) {
                    const combined = logs.concat(debugLogs).join('\n');
                    return expectation.map(item => ({
                        text: item,
                        matched: combined.includes(item)
                    }));
                }

                function extractBoostPercent(logs, debugLogs = []) {
                    const combined = logs.concat(debugLogs).join('\n');
                    const match = combined.match(/绝招伤害提高\s*(\d+)%/);
                    if (match) {
                        return Number(match[1]);
                    }

                    const multiplierMatch = combined.match(/skillDamageMultiplier["']?\s*[:=]\s*(\d+(?:\.\d+)?)/);
                    if (multiplierMatch) {
                        const multiplier = Number(multiplierMatch[1]);
                        if (Number.isFinite(multiplier)) {
                            return Math.max(0, Math.round((multiplier - 1) * 100));
                        }
                    }

                    return null;
                }

                async function runCase(caseName, setupFn, playerAction, enemyAction, expectation = []) {
                    const before = snapshot();
                    const beforeLogs = allLogs();
                    const beforeDebugLogs = allDebugLogs();
                    const startTurn = gameState.turnNumber;

                    if (typeof setupFn === 'function') {
                        setupFn();
                    }

                    runTurn(playerAction, enemyAction);
                    const advanced = await waitForTurnAdvance(startTurn);
                    const after = snapshot();
                    const afterLogs = allLogs();
                    const afterDebugLogs = allDebugLogs();
                    const newLogs = afterLogs.slice(beforeLogs.length);
                    const debugLogs = afterDebugLogs.slice(beforeDebugLogs.length);
                    const skillLogs = pickRecentSkillLogs(newLogs);
                    const expectationResult = summarizeExpectation(expectation, newLogs, debugLogs);

                    const result = {
                        caseName,
                        advanced,
                        playerAction,
                        enemyAction,
                        before,
                        after,
                        newLogs,
                        debugLogs,
                        skillLogs,
                        expectation,
                        expectationResult,
                        passed: advanced && expectationResult.every(item => item.matched)
                    };

                    console.group('[SkillTestHelper] oneClick result: ' + caseName);
                    console.log(result);
                    console.groupEnd();
                    return result;
                }

                const cases = {
                    tauntVsDefend() {
                        return runTurn('taunt', 'defend');
                    },
                    gather() {
                        return runTurn('gather', 'gather');
                    },
                    defendVsLightAttack() {
                        return runTurn('defend', 'light-attack');
                    },
                    specialAtHealthRatio(ratio, enemyAction = 'gather') {
                        setPlayerHealthRatio(ratio);
                        setPlayerEnergy(5);
                        return runTurn('special', enemyAction);
                    },
                    lightAttackVsGather() {
                        normalizeBattleState({ playerEnergy: 1, enemyEnergy: 0 });
                        return runTurn('light-attack', 'gather');
                    },
                    heavyAttackVsDefend() {
                        normalizeBattleState({ playerEnergy: 2, enemyEnergy: 0 });
                        return runTurn('heavy-attack', 'defend');
                    },
                    heavyAttackVsLightAttack() {
                        normalizeBattleState({ playerEnergy: 2, enemyEnergy: 1 });
                        return runTurn('heavy-attack', 'light-attack');
                    }
                };

                const oneClick = {
                    async tauntVsDefend() {
                        return runCase(
                            '绷急孝典乐_嘴炮对防御',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'taunt',
                            'defend',
                            ['嘴炮', '追加', 'onTauntHitDefend']
                        );
                    },
                    async gather() {
                        return runCase(
                            '冰心诀_连续集气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 0 });
                                setPlayerState({ lastAction: 'gather' });
                            },
                            'gather',
                            'gather',
                            ['额外获得', '能量', 'onGather']
                        );
                    },
                    async defendVsLightAttack() {
                        return runCase(
                            '不动明王诀_防御回血',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 0.6, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'defend',
                            'light-attack',
                            ['恢复', '生命', 'onDefend']
                        );
                    },
                    async specialAtHealthRatio(ratio, enemyAction = 'gather') {
                        return runCase(
                            '肉斩骨断_绝招增伤_' + ratio,
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: ratio, enemyHealthRatio: 1, playerEnergy: 5, enemyEnergy: 0 });
                                setPlayerHealthRatio(ratio);
                                setPlayerEnergy(5);
                            },
                            'special',
                            enemyAction,
                            ['绝招伤害提高', 'onSpecialUse']
                        );
                    },
                    async xiaoLiFeiDao() {
                        return runCase(
                            '小梨飞刀_轻击命中集气目标',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'gather',
                            ['小梨飞刀', '暗器追加', 'onAttackHit']
                        );
                    },
                    async xiaoLiFeiDaoLowHp() {
                        return runCase(
                            '小梨飞刀_残血加成',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 0.3, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'gather',
                            ['小梨飞刀', '暗器追加', '残血加成']
                        );
                    },
                    async xiaoLiFeiDaoVsTaunt() {
                        return runCase(
                            '小梨飞刀_轻击命中嘲讽目标',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'taunt',
                            ['小梨飞刀', '暗器追加', 'onAttackHit']
                        );
                    },
                    async xiaoLiFeiDaoNoTrigger() {
                        return runCase(
                            '小梨飞刀_轻击命中防御不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'defend',
                            ['轻攻击']
                        );
                    },
                    async kaiShanJiuShi() {
                        return runCase(
                            '开山九式_重击命中防御',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 2, enemyEnergy: 0 });
                            },
                            'heavy-attack',
                            'defend',
                            ['开山九式', '追加', '破防加成', 'onAttackHit']
                        );
                    },
                    async kaiShanJiuShiCounter() {
                        return runCase(
                            '开山九式_重击克制轻击',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 2, enemyEnergy: 1 });
                            },
                            'heavy-attack',
                            'light-attack',
                            ['开山九式', '追加', '重克轻', 'onAttackHit']
                        );
                    },
                    async kaiShanJiuShiNoTrigger() {
                        return runCase(
                            '开山九式_重击命中集气不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 2, enemyEnergy: 0 });
                            },
                            'heavy-attack',
                            'gather',
                            ['重攻击']
                        );
                    },
                    async bingChuanDianXueShou() {
                        return runCase(
                            '冰川点穴手_攻击命中集气目标',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 3 });
                            },
                            'light-attack',
                            'gather',
                            ['冰川点穴手', '削减', '能量', 'onAttackHit']
                        );
                    },
                    async bingChuanDianXueShouHighEnergy() {
                        return runCase(
                            '冰川点穴手_高能量追加削气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 6 });
                            },
                            'light-attack',
                            'gather',
                            ['冰川点穴手', '削减', '高能量追加']
                        );
                    },
                    async bingChuanDianXueShouNoTrigger() {
                        return runCase(
                            '冰川点穴手_攻击命中防御不触发削气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 3 });
                            },
                            'light-attack',
                            'defend',
                            ['轻攻击']
                        );
                    },
                    async yuanBiQuan() {
                        return runCase(
                            '猿臂拳_受伤后蓄力',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'gather',
                            'light-attack',
                            ['猿臂拳', '以伤化力', 'onTakeDamage']
                        );
                    },
                    async yuanBiQuanConsume() {
                        return runCase(
                            '猿臂拳_蓄力后轻击消耗',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0, yuanBiQuanBonus: 0.45 });
                            },
                            'light-attack',
                            'gather',
                            ['猿臂拳', '反击追加']
                        );
                    },
                    async shuangXueZangHua() {
                        return runCase(
                            '霜雪葬花_轻击命中集气回气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'gather',
                            ['霜雪葬花', '回复', '能量', 'onAttackHit']
                        );
                    },
                    async shuangXueZangHuaVsTaunt() {
                        return runCase(
                            '霜雪葬花_轻击命中嘲讽回气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'taunt',
                            ['霜雪葬花', '回复', '能量']
                        );
                    },
                    async shuangXueZangHuaNoTrigger() {
                        return runCase(
                            '霜雪葬花_轻击命中防御不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0 });
                            },
                            'light-attack',
                            'defend',
                            ['轻攻击']
                        );
                    },
                    async wuJianZhenYiAccumulate() {
                        return runCase(
                            '无剑真意_切换行动积层',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 0, playerLastAction: 'light-attack', playerPreviousAction: 'light-attack' });
                            },
                            'gather',
                            'gather',
                            ['无剑真意', '剑意']
                        );
                    },
                    async wuJianZhenYiConsume() {
                        return runCase(
                            '无剑真意_剑意爆发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0, swordIntent: 2 });
                            },
                            'light-attack',
                            'gather',
                            ['无剑真意', '剑意爆发', '追加']
                        );
                    },
                    async wuJianZhenYiNoAccumulate() {
                        return runCase(
                            '无剑真意_相同行动不积层',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 0, playerLastAction: 'gather', playerPreviousAction: 'gather' });
                            },
                            'gather',
                            'gather',
                            ['集气成功']
                        );
                    },
                    // === 灵狐剑法 ===
                    async lingHuJianFa() {
                        return runCase(
                            '灵狐剑法_连续攻击追加',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0, playerLastAction: 'light-attack' });
                            },
                            'light-attack',
                            'gather',
                            ['灵狐剑法', '连斩追加', 'onAttackHit']
                        );
                    },
                    async lingHuJianFaNoTrigger() {
                        return runCase(
                            '灵狐剑法_非连续攻击不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 0, playerLastAction: 'gather' });
                            },
                            'light-attack',
                            'gather',
                            ['轻攻击']
                        );
                    },
                    // === 青鸟衔书 ===
                    async qingNiaoXianShu() {
                        return runCase(
                            '青鸟衔书_防御受击回气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'defend',
                            'light-attack',
                            ['青鸟衔书', '回复', '能量', 'onTakeDamage']
                        );
                    },
                    async qingNiaoXianShuNoTrigger() {
                        return runCase(
                            '青鸟衔书_集气受击不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'gather',
                            'light-attack',
                            ['集气']
                        );
                    },
                    // === 连羽缠丝 ===
                    async lianYuChanSi() {
                        return runCase(
                            '连羽缠丝_重击命中集气削气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 2, enemyEnergy: 3 });
                            },
                            'heavy-attack',
                            'gather',
                            ['连羽缠丝', '削减', '能量', 'onAttackHit']
                        );
                    },
                    async lianYuChanSiVsTaunt() {
                        return runCase(
                            '连羽缠丝_重击命中嘲讽削气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 2, enemyEnergy: 3 });
                            },
                            'heavy-attack',
                            'taunt',
                            ['连羽缠丝', '削减', '能量']
                        );
                    },
                    async lianYuChanSiNoTrigger() {
                        return runCase(
                            '连羽缠丝_重击命中防御不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 2, enemyEnergy: 3 });
                            },
                            'heavy-attack',
                            'defend',
                            ['重攻击']
                        );
                    },
                    // === 天象示警 ===
                    async tianXiangShiJing() {
                        return runCase(
                            '天象示警_集气受击减伤',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'gather',
                            'light-attack',
                            ['天象示警', '减免', 'onTakeDamage']
                        );
                    },
                    async tianXiangShiJingNoTrigger() {
                        return runCase(
                            '天象示警_防御受击不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 1 });
                            },
                            'defend',
                            'light-attack',
                            ['防御']
                        );
                    },
                    // === 造化度厄针 ===
                    async zaoHuaDuEZhen() {
                        return runCase(
                            '造化度厄针_绝招命中窃气',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 5, enemyEnergy: 5 });
                                // 确保敌人血量足够高不会被绝招秒杀
                                setEnemyState({ currentHealth: 9999, maxHealth: 9999 });
                            },
                            'special',
                            'gather',
                            ['造化度厄针', '窃取', '能量', 'onAttackHit']
                        );
                    },
                    async zaoHuaDuEZhenNoTrigger() {
                        return runCase(
                            '造化度厄针_轻击不触发',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 1, enemyHealthRatio: 1, playerEnergy: 1, enemyEnergy: 3 });
                            },
                            'light-attack',
                            'gather',
                            ['轻攻击']
                        );
                    },
                    // === 百草心经 ===
                    async baiCaoXinJing() {
                        return runCase(
                            '百草心经_非连续集气回血',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 0.6, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 0, playerLastAction: 'light-attack' });
                            },
                            'gather',
                            'gather',
                            ['百草心经', '恢复', '生命', 'onGather']
                        );
                    },
                    async baiCaoXinJingNoTrigger() {
                        return runCase(
                            '百草心经_连续集气不触发回血',
                            function setup() {
                                normalizeBattleState({ playerHealthRatio: 0.6, enemyHealthRatio: 1, playerEnergy: 0, enemyEnergy: 0, playerLastAction: 'gather' });
                            },
                            'gather',
                            'gather',
                            ['集气成功']
                        );
                    },
                    async compareSpecialDamage(lowRatio = 0.2) {
                        const full = await this.specialAtHealthRatio(1, 'gather');
                        const low = await this.specialAtHealthRatio(lowRatio, 'gather');
                        const fullBoost = extractBoostPercent(full.newLogs, full.debugLogs);
                        const lowBoost = extractBoostPercent(low.newLogs, low.debugLogs);
                        const result = {
                            caseName: '肉斩骨断_满血对比残血',
                            full,
                            low,
                            fullBoost,
                            lowBoost,
                            boostComparisonPassed: fullBoost != null && lowBoost != null ? lowBoost > fullBoost : null,
                            note: '对比两次 oneClick 返回结果中的 newLogs，残血倍率应更高。'
                        };
                        console.group('[SkillTestHelper] oneClick compareSpecialDamage');
                        console.log(result);
                        console.groupEnd();
                        return result;
                    },
                    // ===================================================================
                    // 分批测试方法（记忆点上限10，16个技能需分3批）
                    // ===================================================================
                    printBatchPlan() {
                        const plan = {
                            'A (10点)': '绷急孝典乐(1) + 小梨飞刀(2) + 开山九式(2) + 冰川点穴手(2) + 灵狐剑法(1) + 连羽缠丝(1) + 百草心经(1)',
                            'B (10点)': '冰心诀(3) + 肉斩骨断(1) + 不动明王诀(2) + 猿臂拳(2) + 青鸟衔书(2)',
                            'C (10点)': '霜雪葬花(3) + 无剑真意(3) + 天象示警(1) + 造化度厄针(3)'
                        };
                        console.group('[SkillTestHelper] 分批测试计划');
                        console.table(plan);
                        console.groupEnd();
                        return plan;
                    },
                    async runBatchA() {
                        const results = [];
                        const totalExpected = 18;
                        try {
                        results.push(await this.tauntVsDefend());
                        results.push(await this.xiaoLiFeiDao());
                        results.push(await this.xiaoLiFeiDaoLowHp());
                        results.push(await this.xiaoLiFeiDaoVsTaunt());
                        results.push(await this.xiaoLiFeiDaoNoTrigger());
                        results.push(await this.kaiShanJiuShi());
                        results.push(await this.kaiShanJiuShiCounter());
                        results.push(await this.kaiShanJiuShiNoTrigger());
                        results.push(await this.bingChuanDianXueShou());
                        results.push(await this.bingChuanDianXueShouHighEnergy());
                        results.push(await this.bingChuanDianXueShouNoTrigger());
                        results.push(await this.lingHuJianFa());
                        results.push(await this.lingHuJianFaNoTrigger());
                        results.push(await this.lianYuChanSi());
                        results.push(await this.lianYuChanSiVsTaunt());
                        results.push(await this.lianYuChanSiNoTrigger());
                        results.push(await this.baiCaoXinJing());
                        results.push(await this.baiCaoXinJingNoTrigger());
                        } catch (err) {
                            console.error('[SkillTestHelper] 批次A 执行中断于第 ' + (results.length + 1) + ' 个用例:', err);
                        }

                        // 补齐缺失的结果占位
                        while (results.length < totalExpected) {
                            results.push({ caseName: '❌ 未执行(前序用例出错)', advanced: false, passed: false, newLogs: [], debugLogs: [], skillLogs: [], expectation: [], expectationResult: [] });
                        }

                        try {
                        const summaryRows = [
                            { skill: '绷急孝典乐', caseName: results[0].caseName, advanced: results[0].advanced, passed: results[0].passed, keyObservation: results[0].skillLogs.join(' | ') || '无' },
                            { skill: '小梨飞刀', caseName: results[1].caseName + ' / ' + results[2].caseName + ' / ' + results[3].caseName, advanced: results[1].advanced && results[2].advanced && results[3].advanced, passed: results[1].passed && results[2].passed && results[3].passed, keyObservation: results[1].skillLogs.join(' | ') || '无' },
                            { skill: '小梨飞刀(不触发)', caseName: results[4].caseName, advanced: results[4].advanced, passed: results[4].passed && !results[4].newLogs.some(l => l.includes('小梨飞刀')), keyObservation: results[4].newLogs.some(l => l.includes('小梨飞刀')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '开山九式', caseName: results[5].caseName + ' / ' + results[6].caseName, advanced: results[5].advanced && results[6].advanced, passed: results[5].passed && results[6].passed, keyObservation: results[5].skillLogs.join(' | ') || '无' },
                            { skill: '开山九式(不触发)', caseName: results[7].caseName, advanced: results[7].advanced, passed: results[7].passed && !results[7].newLogs.some(l => l.includes('开山九式')), keyObservation: results[7].newLogs.some(l => l.includes('开山九式')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '冰川点穴手', caseName: results[8].caseName + ' / ' + results[9].caseName, advanced: results[8].advanced && results[9].advanced, passed: results[8].passed && results[9].passed, keyObservation: results[8].skillLogs.join(' | ') || '无' },
                            { skill: '冰川点穴手(不触发)', caseName: results[10].caseName, advanced: results[10].advanced, passed: results[10].passed && !results[10].newLogs.some(l => l.includes('冰川点穴手')), keyObservation: results[10].newLogs.some(l => l.includes('冰川点穴手')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '灵狐剑法', caseName: results[11].caseName, advanced: results[11].advanced, passed: results[11].passed, keyObservation: results[11].skillLogs.join(' | ') || '无' },
                            { skill: '灵狐剑法(不触发)', caseName: results[12].caseName, advanced: results[12].advanced, passed: results[12].passed && !results[12].newLogs.some(l => l.includes('灵狐剑法')), keyObservation: results[12].newLogs.some(l => l.includes('灵狐剑法')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '连羽缠丝', caseName: results[13].caseName + ' / ' + results[14].caseName, advanced: results[13].advanced && results[14].advanced, passed: results[13].passed && results[14].passed, keyObservation: results[13].skillLogs.join(' | ') || '无' },
                            { skill: '连羽缠丝(不触发)', caseName: results[15].caseName, advanced: results[15].advanced, passed: results[15].passed && !results[15].newLogs.some(l => l.includes('连羽缠丝')), keyObservation: results[15].newLogs.some(l => l.includes('连羽缠丝')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '百草心经', caseName: results[16].caseName, advanced: results[16].advanced, passed: results[16].passed, keyObservation: results[16].skillLogs.join(' | ') || '无' },
                            { skill: '百草心经(不触发)', caseName: results[17].caseName, advanced: results[17].advanced, passed: results[17].passed && !results[17].newLogs.some(l => l.includes('百草心经')), keyObservation: results[17].newLogs.some(l => l.includes('百草心经')) ? '错误：不该触发但触发了' : '正确：未触发' }
                        ];
                        return this._finishBatch('批次A', summaryRows, results);
                        } catch (summaryErr) {
                            console.error('[SkillTestHelper] 批次A 汇总构建出错:', summaryErr);
                            const b = '❌';
                            console.log('');
                            console.log(b + ' ═══════════════════════════════════════');
                            console.log(b + '  批次A 汇总构建出错: ' + (summaryErr.message || summaryErr));
                            console.log(b + '  已完成: ' + results.filter(r => r.caseName && !r.caseName.startsWith('❌')).length + '/' + totalExpected);
                            results.forEach((r, i) => console.log(b + '  #' + (i+1) + ' ' + (r.passed ? '✅' : '❌') + ' ' + r.caseName));
                            console.log(b + ' ═══════════════════════════════════════');
                            console.log('');
                            return { caseName: '批次A_汇总异常', passed: false, error: summaryErr.message || String(summaryErr), completedResults: results };
                        }
                    },
                    async runBatchB() {
                        const results = [];
                        const totalExpected = 6;
                        let specialCompare = null;
                        try {
                        results.push(await this.gather());
                        specialCompare = await this.compareSpecialDamage(0.2);
                        results.push(await this.defendVsLightAttack());
                        results.push(await this.yuanBiQuan());
                        results.push(await this.yuanBiQuanConsume());
                        results.push(await this.qingNiaoXianShu());
                        results.push(await this.qingNiaoXianShuNoTrigger());
                        } catch (err) {
                            console.error('[SkillTestHelper] 批次B 执行中断于第 ' + (results.length + 1) + ' 个用例:', err);
                        }

                        while (results.length < totalExpected) {
                            results.push({ caseName: '❌ 未执行(前序用例出错)', advanced: false, passed: false, newLogs: [], debugLogs: [], skillLogs: [], expectation: [], expectationResult: [] });
                        }
                        if (!specialCompare) {
                            specialCompare = { caseName: '❌ 未执行', fullBoost: null, lowBoost: null, full: null, low: null, boostComparisonPassed: false };
                        }

                        try {
                        const summaryRows = [
                            { skill: '冰心诀', caseName: results[0].caseName, advanced: results[0].advanced, passed: results[0].passed, keyObservation: results[0].skillLogs.join(' | ') || results[0].debugLogs.join(' | ') || '无' },
                            { skill: '肉斩骨断', caseName: specialCompare.caseName, advanced: Boolean(specialCompare.full?.advanced && specialCompare.low?.advanced), passed: Boolean(specialCompare.full?.passed && specialCompare.low?.passed && specialCompare.boostComparisonPassed), keyObservation: '满血+' + String(specialCompare.fullBoost) + '% / 残血+' + String(specialCompare.lowBoost) + '%' },
                            { skill: '不动明王诀', caseName: results[1].caseName, advanced: results[1].advanced, passed: results[1].passed, keyObservation: results[1].skillLogs.join(' | ') || results[1].debugLogs.join(' | ') || '无' },
                            { skill: '猿臂拳', caseName: results[2].caseName + ' / ' + results[3].caseName, advanced: results[2].advanced && results[3].advanced, passed: results[2].passed && results[3].passed, keyObservation: (results[2].skillLogs.join(' | ') || '无') + ' → ' + (results[3].skillLogs.join(' | ') || '无') },
                            { skill: '青鸟衔书', caseName: results[4].caseName, advanced: results[4].advanced, passed: results[4].passed, keyObservation: results[4].skillLogs.join(' | ') || results[4].debugLogs.join(' | ') || '无' },
                            { skill: '青鸟衔书(不触发)', caseName: results[5].caseName, advanced: results[5].advanced, passed: results[5].passed && !results[5].newLogs.some(l => l.includes('青鸟衔书')), keyObservation: results[5].newLogs.some(l => l.includes('青鸟衔书')) ? '错误：不该触发但触发了' : '正确：未触发' }
                        ];
                        return this._finishBatch('批次B', summaryRows, results, specialCompare);
                        } catch (summaryErr) {
                            console.error('[SkillTestHelper] 批次B 汇总构建出错:', summaryErr);
                            const b = '❌';
                            console.log('');
                            console.log(b + ' ═══════════════════════════════════════');
                            console.log(b + '  批次B 汇总构建出错: ' + (summaryErr.message || summaryErr));
                            results.forEach((r, i) => console.log(b + '  #' + (i+1) + ' ' + (r.passed ? '✅' : '❌') + ' ' + r.caseName));
                            console.log(b + ' ═══════════════════════════════════════');
                            console.log('');
                            return { caseName: '批次B_汇总异常', passed: false, error: summaryErr.message || String(summaryErr), completedResults: results };
                        }
                    },
                    async runBatchC() {
                        const results = [];
                        const totalExpected = 10;
                        try {
                        results.push(await this.shuangXueZangHua());
                        results.push(await this.shuangXueZangHuaVsTaunt());
                        results.push(await this.shuangXueZangHuaNoTrigger());
                        results.push(await this.wuJianZhenYiAccumulate());
                        results.push(await this.wuJianZhenYiConsume());
                        results.push(await this.wuJianZhenYiNoAccumulate());
                        results.push(await this.tianXiangShiJing());
                        results.push(await this.tianXiangShiJingNoTrigger());
                        results.push(await this.zaoHuaDuEZhen());
                        results.push(await this.zaoHuaDuEZhenNoTrigger());
                        } catch (err) {
                            console.error('[SkillTestHelper] 批次C 执行中断于第 ' + (results.length + 1) + ' 个用例:', err);
                        }

                        while (results.length < totalExpected) {
                            results.push({ caseName: '❌ 未执行(前序用例出错)', advanced: false, passed: false, newLogs: [], debugLogs: [], skillLogs: [], expectation: [], expectationResult: [] });
                        }

                        try {
                        const summaryRows = [
                            { skill: '霜雪葬花', caseName: results[0].caseName + ' / ' + results[1].caseName, advanced: results[0].advanced && results[1].advanced, passed: results[0].passed && results[1].passed, keyObservation: results[0].skillLogs.join(' | ') || results[0].debugLogs.join(' | ') || '无' },
                            { skill: '霜雪葬花(不触发)', caseName: results[2].caseName, advanced: results[2].advanced, passed: results[2].passed && !results[2].newLogs.some(l => l.includes('霜雪葬花')), keyObservation: results[2].newLogs.some(l => l.includes('霜雪葬花')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '无剑真意(积层)', caseName: results[3].caseName, advanced: results[3].advanced, passed: results[3].passed, keyObservation: results[3].skillLogs.join(' | ') || results[3].newLogs.join(' | ') || '无' },
                            { skill: '无剑真意(爆发)', caseName: results[4].caseName, advanced: results[4].advanced, passed: results[4].passed, keyObservation: results[4].skillLogs.join(' | ') || '无' },
                            { skill: '无剑真意(不积层)', caseName: results[5].caseName, advanced: results[5].advanced, passed: results[5].passed && !results[5].newLogs.some(l => l.includes('剑意 +1')), keyObservation: results[5].newLogs.some(l => l.includes('剑意 +1')) ? '错误：不该积层但积了' : '正确：未积层' },
                            { skill: '天象示警', caseName: results[6].caseName, advanced: results[6].advanced, passed: results[6].passed, keyObservation: results[6].skillLogs.join(' | ') || results[6].debugLogs.join(' | ') || '无' },
                            { skill: '天象示警(不触发)', caseName: results[7].caseName, advanced: results[7].advanced, passed: results[7].passed && !results[7].newLogs.some(l => l.includes('天象示警')), keyObservation: results[7].newLogs.some(l => l.includes('天象示警')) ? '错误：不该触发但触发了' : '正确：未触发' },
                            { skill: '造化度厄针', caseName: results[8].caseName, advanced: results[8].advanced, passed: results[8].passed, keyObservation: results[8].skillLogs.join(' | ') || results[8].debugLogs.join(' | ') || '无' },
                            { skill: '造化度厄针(不触发)', caseName: results[9].caseName, advanced: results[9].advanced, passed: results[9].passed && !results[9].newLogs.some(l => l.includes('造化度厄针')), keyObservation: results[9].newLogs.some(l => l.includes('造化度厄针')) ? '错误：不该触发但触发了' : '正确：未触发' }
                        ];
                        return this._finishBatch('批次C', summaryRows, results);
                        } catch (summaryErr) {
                            console.error('[SkillTestHelper] 批次C 汇总构建出错:', summaryErr);
                            const b = '❌';
                            console.log('');
                            console.log(b + ' ═══════════════════════════════════════');
                            console.log(b + '  批次C 汇总构建出错: ' + (summaryErr.message || summaryErr));
                            results.forEach((r, i) => console.log(b + '  #' + (i+1) + ' ' + (r.passed ? '✅' : '❌') + ' ' + r.caseName));
                            console.log(b + ' ═══════════════════════════════════════');
                            console.log('');
                            return { caseName: '批次C_汇总异常', passed: false, error: summaryErr.message || String(summaryErr), completedResults: results };
                        }
                    },
                    _finishBatch(batchName, summaryRows, results, extra) {
                        const passCount = summaryRows.filter(r => r.passed).length;
                        const failCount = summaryRows.length - passCount;
                        const allPassed = failCount === 0;
                        const suiteResult = {
                            caseName: batchName + '_批量执行',
                            rows: summaryRows,
                            detail: results,
                            extra: extra || null,
                            passed: allPassed,
                            passCount,
                            failCount,
                            total: summaryRows.length
                        };
                        console.group('[SkillTestHelper] ' + batchName + ' summary');
                        console.table(summaryRows);
                        console.log(suiteResult);
                        console.groupEnd();

                        // 醒目的最终总结
                        const banner = allPassed ? '✅' : '❌';
                        const statusText = allPassed ? 'ALL PASSED' : 'HAS FAILURES';
                        console.log('');
                        console.log(banner + ' ═══════════════════════════════════════');
                        console.log(banner + '  ' + batchName + ' 最终结果: ' + statusText);
                        console.log(banner + '  通过: ' + passCount + '/' + summaryRows.length);
                        if (failCount > 0) {
                            const failedNames = summaryRows.filter(r => !r.passed).map(r => r.skill);
                            console.log(banner + '  失败: ' + failedNames.join(', '));
                        }
                        console.log(banner + ' ═══════════════════════════════════════');
                        console.log('');

                        return suiteResult;
                    }
                };

                function help() {
                    console.log('skillTestBattleHelper 可用方法:');
                    console.log('=== 基础工具 ===');
                    console.log('1. skillTestBattleHelper.snapshot()');
                    console.log('2. skillTestBattleHelper.logSnapshot()');
                    console.log('3. skillTestBattleHelper.logSkillsByTiming()');
                    console.log('4. skillTestBattleHelper.forceNextEnemyAction("defend")');
                    console.log('5. skillTestBattleHelper.runTurn("taunt", "defend")');
                    console.log('6. skillTestBattleHelper.setPlayerHealthRatio(0.2)');
                    console.log('7. skillTestBattleHelper.setPlayerEnergy(5)');
                    console.log('8. skillTestBattleHelper.recentLogs(12)');
                    console.log('=== 分批测试 ===');
                    console.log('9.  skillTestBattleHelper.oneClick.printBatchPlan()  // 查看分批方案');
                    console.log('10. skillTestBattleHelper.oneClick.runBatchA()  // 绷急孝典乐+小梨飞刀+开山九式+冰川点穴手+灵狐剑法+连羽缠丝+百草心经');
                    console.log('11. skillTestBattleHelper.oneClick.runBatchB()  // 冰心诀+肉斩骨断+不动明王诀+猿臂拳+青鸟衔书');
                    console.log('12. skillTestBattleHelper.oneClick.runBatchC()  // 霜雪葬花+无剑真意+天象示警+造化度厄针');
                    console.log('=== 单项技能测试 ===');
                    console.log('13. skillTestBattleHelper.oneClick.tauntVsDefend()  // 绷急孝典乐');
                    console.log('14. skillTestBattleHelper.oneClick.gather()  // 冰心诀');
                    console.log('15. skillTestBattleHelper.oneClick.defendVsLightAttack()  // 不动明王诀');
                    console.log('16. skillTestBattleHelper.oneClick.specialAtHealthRatio(0.2)  // 肉斩骨断');
                    console.log('17. skillTestBattleHelper.oneClick.compareSpecialDamage(0.2)');
                    console.log('18. skillTestBattleHelper.oneClick.xiaoLiFeiDao()  // 小梨飞刀');
                    console.log('19. skillTestBattleHelper.oneClick.kaiShanJiuShi()  // 开山九式');
                    console.log('20. skillTestBattleHelper.oneClick.bingChuanDianXueShou()  // 冰川点穴手');
                    console.log('21. skillTestBattleHelper.oneClick.yuanBiQuan()  // 猿臂拳');
                    console.log('22. skillTestBattleHelper.oneClick.shuangXueZangHua()  // 霜雪葬花');
                    console.log('23. skillTestBattleHelper.oneClick.wuJianZhenYiAccumulate()  // 无剑真意');
                    console.log('24. skillTestBattleHelper.oneClick.lingHuJianFa()  // 灵狐剑法');
                    console.log('25. skillTestBattleHelper.oneClick.qingNiaoXianShu()  // 青鸟衔书');
                    console.log('26. skillTestBattleHelper.oneClick.lianYuChanSi()  // 连羽缠丝');
                    console.log('27. skillTestBattleHelper.oneClick.tianXiangShiJing()  // 天象示警');
                    console.log('28. skillTestBattleHelper.oneClick.zaoHuaDuEZhen()  // 造化度厄针');
                    console.log('29. skillTestBattleHelper.oneClick.baiCaoXinJing()  // 百草心经');
                }

                function resolveMethodTarget(root, methodPath) {
                    if (methodPath === '__bridgePing') {
                        return {
                            owner: null,
                            method: function bridgePing() {
                                return { ok: true, version: HELPER_VERSION };
                            }
                        };
                    }

                    const parts = String(methodPath || '').split('.').filter(Boolean);
                    let owner = null;
                    let current = root;

                    for (const part of parts) {
                        if (current == null || !(part in current)) {
                            return { owner: null, method: null };
                        }
                        owner = current;
                        current = current[part];
                    }

                    return { owner, method: current };
                }

                window.skillTestBattleHelper = {
                    __version: HELPER_VERSION,
                    snapshot,
                    logSnapshot,
                    logSkillsByTiming,
                    forceNextEnemyAction,
                    setPlayerState,
                    setEnemyState,
                    setPlayerHealthRatio,
                    setPlayerEnergy,
                    setEnemyEnergy,
                    normalizeBattleState,
                    runTurn,
                    recentLogs,
                    recentDebugLogs,
                    allLogs,
                    allDebugLogs,
                    wait,
                    waitForTurnAdvance,
                    runCase,
                    cases,
                    oneClick,
                    help
                };

                if (window.__skillTestRequestHandler) {
                    window.removeEventListener('message', window.__skillTestRequestHandler);
                }

                window.__skillTestRequestHandler = async function onSkillTestRequest(event) {
                    const data = event.data;
                    if (!data || data.type !== 'skill-test-request' || !data.requestId) {
                        return;
                    }

                    const reply = payload => {
                        if (event.source && typeof event.source.postMessage === 'function') {
                            event.source.postMessage(payload, '*');
                        }
                    };

                    try {
                        const target = resolveMethodTarget(window.skillTestBattleHelper, data.methodPath);
                        if (typeof target.method !== 'function') {
                            throw new Error('未找到战斗测试方法: ' + data.methodPath);
                        }

                        const result = await target.method.apply(target.owner, Array.isArray(data.args) ? data.args : []);
                        reply({
                            type: 'skill-test-response',
                            requestId: data.requestId,
                            success: true,
                            result
                        });
                    } catch (error) {
                        reply({
                            type: 'skill-test-response',
                            requestId: data.requestId,
                            success: false,
                            error: error && error.message ? error.message : String(error)
                        });
                    }
                };

                window.addEventListener('message', window.__skillTestRequestHandler);

                console.log('[SkillTestHelper] battle helper ready', HELPER_VERSION);
            })();
        `;

        if (!targetWindow) {
            return evalCode;
        }

        targetWindow.eval(evalCode);

        return targetWindow.skillTestBattleHelper;
    }

    function installMainHelper() {
        const bridgeState = {
            requestSeq: 0,
            pending: new Map(),
            listenerReady: false,
            proxy: null
        };

        function getBattleFrame() {
            const iframe = document.getElementById('battle-iframe');
            if (!iframe) {
                throw new Error('未找到 battle-iframe');
            }
            return iframe;
        }

        function canDirectAccessBattleWindow(frameWindow) {
            try {
                if (!frameWindow) {
                    return false;
                }
                void frameWindow.location.href;
                void frameWindow.document;
                return true;
            } catch (error) {
                return false;
            }
        }

        function getBattleWindow() {
            const frameWindow = getBattleFrame().contentWindow;
            if (!frameWindow) {
                throw new Error('战斗 iframe 尚未就绪');
            }
            return frameWindow;
        }

        function ensureBridgeListener() {
            if (bridgeState.listenerReady) {
                return;
            }

            window.addEventListener('message', event => {
                const data = event.data;
                if (!data || data.type !== 'skill-test-response' || !data.requestId) {
                    return;
                }

                const pending = bridgeState.pending.get(data.requestId);
                if (!pending) {
                    return;
                }

                clearTimeout(pending.timeoutId);
                bridgeState.pending.delete(data.requestId);

                if (data.success) {
                    pending.resolve(data.result);
                    return;
                }

                pending.reject(new Error(data.error || '战斗页辅助桥接调用失败'));
            });

            bridgeState.listenerReady = true;
        }

        function callBattleBridge(methodPath, args = []) {
            ensureBridgeListener();

            return new Promise((resolve, reject) => {
                let frameWindow;
                try {
                    frameWindow = getBattleWindow();
                } catch (error) {
                    reject(error);
                    return;
                }

                // 批量测试方法需要更长超时（18个用例约需30-60秒）
                const isBatchRun = /runBatch[ABC]|compareSpecialDamage/.test(methodPath);
                const timeoutMs = isBatchRun ? 120000 : 5000;

                const requestId = `skill-test-${Date.now()}-${++bridgeState.requestSeq}`;
                const timeoutId = window.setTimeout(() => {
                    bridgeState.pending.delete(requestId);
                    reject(new Error(`等待战斗页响应超时(${timeoutMs / 1000}s): ${methodPath}`));
                }, timeoutMs);

                bridgeState.pending.set(requestId, { resolve, reject, timeoutId });

                frameWindow.postMessage({
                    type: 'skill-test-request',
                    requestId,
                    methodPath,
                    args
                }, '*');
            });
        }

        function createBridgeProxy() {
            if (bridgeState.proxy) {
                return bridgeState.proxy;
            }

            const call = methodPath => (...args) => callBattleBridge(methodPath, args);

            bridgeState.proxy = {
                __mode: 'bridge',
                snapshot: call('snapshot'),
                logSnapshot: call('logSnapshot'),
                logSkillsByTiming: call('logSkillsByTiming'),
                forceNextEnemyAction: call('forceNextEnemyAction'),
                setPlayerState: call('setPlayerState'),
                setEnemyState: call('setEnemyState'),
                setPlayerHealthRatio: call('setPlayerHealthRatio'),
                setPlayerEnergy: call('setPlayerEnergy'),
                setEnemyEnergy: call('setEnemyEnergy'),
                normalizeBattleState: call('normalizeBattleState'),
                runTurn: call('runTurn'),
                recentLogs: call('recentLogs'),
                allLogs: call('allLogs'),
                wait: call('wait'),
                waitForTurnAdvance: call('waitForTurnAdvance'),
                runCase: call('runCase'),
                cases: {
                    tauntVsDefend: call('cases.tauntVsDefend'),
                    gather: call('cases.gather'),
                    defendVsLightAttack: call('cases.defendVsLightAttack'),
                    specialAtHealthRatio: call('cases.specialAtHealthRatio'),
                    lightAttackVsGather: call('cases.lightAttackVsGather'),
                    heavyAttackVsDefend: call('cases.heavyAttackVsDefend'),
                    heavyAttackVsLightAttack: call('cases.heavyAttackVsLightAttack')
                },
                oneClick: {
                    printBatchPlan: call('oneClick.printBatchPlan'),
                    runBatchA: call('oneClick.runBatchA'),
                    runBatchB: call('oneClick.runBatchB'),
                    runBatchC: call('oneClick.runBatchC'),
                    tauntVsDefend: call('oneClick.tauntVsDefend'),
                    gather: call('oneClick.gather'),
                    defendVsLightAttack: call('oneClick.defendVsLightAttack'),
                    specialAtHealthRatio: call('oneClick.specialAtHealthRatio'),
                    compareSpecialDamage: call('oneClick.compareSpecialDamage'),
                    xiaoLiFeiDao: call('oneClick.xiaoLiFeiDao'),
                    xiaoLiFeiDaoLowHp: call('oneClick.xiaoLiFeiDaoLowHp'),
                    xiaoLiFeiDaoVsTaunt: call('oneClick.xiaoLiFeiDaoVsTaunt'),
                    xiaoLiFeiDaoNoTrigger: call('oneClick.xiaoLiFeiDaoNoTrigger'),
                    kaiShanJiuShi: call('oneClick.kaiShanJiuShi'),
                    kaiShanJiuShiCounter: call('oneClick.kaiShanJiuShiCounter'),
                    kaiShanJiuShiNoTrigger: call('oneClick.kaiShanJiuShiNoTrigger'),
                    bingChuanDianXueShou: call('oneClick.bingChuanDianXueShou'),
                    bingChuanDianXueShouHighEnergy: call('oneClick.bingChuanDianXueShouHighEnergy'),
                    bingChuanDianXueShouNoTrigger: call('oneClick.bingChuanDianXueShouNoTrigger'),
                    yuanBiQuan: call('oneClick.yuanBiQuan'),
                    yuanBiQuanConsume: call('oneClick.yuanBiQuanConsume'),
                    shuangXueZangHua: call('oneClick.shuangXueZangHua'),
                    shuangXueZangHuaVsTaunt: call('oneClick.shuangXueZangHuaVsTaunt'),
                    shuangXueZangHuaNoTrigger: call('oneClick.shuangXueZangHuaNoTrigger'),
                    wuJianZhenYiAccumulate: call('oneClick.wuJianZhenYiAccumulate'),
                    wuJianZhenYiConsume: call('oneClick.wuJianZhenYiConsume'),
                    wuJianZhenYiNoAccumulate: call('oneClick.wuJianZhenYiNoAccumulate'),
                    lingHuJianFa: call('oneClick.lingHuJianFa'),
                    lingHuJianFaNoTrigger: call('oneClick.lingHuJianFaNoTrigger'),
                    qingNiaoXianShu: call('oneClick.qingNiaoXianShu'),
                    qingNiaoXianShuNoTrigger: call('oneClick.qingNiaoXianShuNoTrigger'),
                    lianYuChanSi: call('oneClick.lianYuChanSi'),
                    lianYuChanSiVsTaunt: call('oneClick.lianYuChanSiVsTaunt'),
                    lianYuChanSiNoTrigger: call('oneClick.lianYuChanSiNoTrigger'),
                    tianXiangShiJing: call('oneClick.tianXiangShiJing'),
                    tianXiangShiJingNoTrigger: call('oneClick.tianXiangShiJingNoTrigger'),
                    zaoHuaDuEZhen: call('oneClick.zaoHuaDuEZhen'),
                    zaoHuaDuEZhenNoTrigger: call('oneClick.zaoHuaDuEZhenNoTrigger'),
                    baiCaoXinJing: call('oneClick.baiCaoXinJing'),
                    baiCaoXinJingNoTrigger: call('oneClick.baiCaoXinJingNoTrigger')
                },
                help: call('help')
            };

            return bridgeState.proxy;
        }

        function getBattleHelper() {
            const frameWindow = getBattleWindow();

            if (canDirectAccessBattleWindow(frameWindow)) {
                const helper = frameWindow.skillTestBattleHelper || installBattleHelperInCurrentWindow(frameWindow);
                helper.__mode = 'direct';
                return helper;
            }

            return createBridgeProxy();
        }

        function parentSnapshot() {
            const iframe = document.getElementById('battle-iframe');
            return {
                learnedSkills: safeClone(window.learnedSkills || {}),
                equippedSkills: safeClone(window.equippedSkills || {}),
                battleIframeSrc: iframe ? iframe.src : '',
                battleModalVisible: document.getElementById('battle-modal')?.style.display === 'block'
            };
        }

        function logParentSnapshot() {
            const data = parentSnapshot();
            console.group('[SkillTestHelper] parent snapshot');
            console.log(data);
            console.groupEnd();
            return data;
        }

        async function injectBattleHelper() {
            const helper = getBattleHelper();

            if (helper.__mode === 'bridge') {
                await callBattleBridge('__bridgePing');
                console.log('[SkillTestHelper] 已连接战斗页辅助对象 skillTestBattleHelper（跨域桥接模式）');
                return helper;
            }

            console.log('[SkillTestHelper] 已连接战斗页辅助对象 skillTestBattleHelper（同源直连模式）');
            return helper;
        }

        function battleHelper() {
            return getBattleHelper();
        }

        function battleSnapshot() {
            return battleHelper().logSnapshot();
        }

        function runTurn(playerAction, enemyAction) {
            return battleHelper().runTurn(playerAction, enemyAction);
        }

        function cases() {
            return battleHelper().cases;
        }

        function oneClick() {
            return battleHelper().oneClick;
        }

        window.skillTestHelper = {
            parentSnapshot,
            logParentSnapshot,
            injectBattleHelper,
            battleHelper,
            battleSnapshot,
            runTurn,
            cases,
            oneClick,
            help() {
                console.log('skillTestHelper 可用方法:');
                console.log('1. skillTestHelper.logParentSnapshot()');
                console.log('2. await skillTestHelper.injectBattleHelper()');
                console.log('3. await skillTestHelper.battleSnapshot()');
                console.log('4. skillTestHelper.runTurn("taunt", "defend")');
                console.log('5. await skillTestHelper.battleHelper().recentLogs(12)');
                console.log('=== 分批测试（推荐） ===');
                console.log('6.  skillTestHelper.oneClick().printBatchPlan()  // 查看分批方案');
                console.log('7.  await skillTestHelper.oneClick().runBatchA()  // 批次A');
                console.log('8.  await skillTestHelper.oneClick().runBatchB()  // 批次B');
                console.log('9.  await skillTestHelper.oneClick().runBatchC()  // 批次C');
                console.log('=== 单项技能测试 ===');
                console.log('10. skillTestHelper.oneClick().tauntVsDefend()  // 绷急孝典乐');
                console.log('11. skillTestHelper.oneClick().gather()  // 冰心诀');
                console.log('12. skillTestHelper.oneClick().defendVsLightAttack()  // 不动明王诀');
                console.log('13. skillTestHelper.oneClick().specialAtHealthRatio(0.2)  // 肉斩骨断');
                console.log('14. skillTestHelper.oneClick().shuangXueZangHua()  // 霜雪葬花');
                console.log('15. skillTestHelper.oneClick().lingHuJianFa()  // 灵狐剑法');
                console.log('16. skillTestHelper.oneClick().qingNiaoXianShu()  // 青鸟衔书');
                console.log('17. skillTestHelper.oneClick().lianYuChanSi()  // 连羽缠丝');
                console.log('18. skillTestHelper.oneClick().tianXiangShiJing()  // 天象示警');
                console.log('19. skillTestHelper.oneClick().zaoHuaDuEZhen()  // 造化度厄针');
                console.log('20. skillTestHelper.oneClick().baiCaoXinJing()  // 百草心经');
            }
        };

        console.log('[SkillTestHelper] main helper ready. 先调用 skillTestHelper.help() 查看说明');
        return window.skillTestHelper;
    }

    function installBattleOnlyHelper() {
        const helper = installBattleHelperInCurrentWindow(window);
        console.log('[SkillTestHelper] 当前页面为战斗页，可直接使用 skillTestBattleHelper.help()');
        return helper;
    }

    if (isMainPage) {
        installMainHelper();
        return;
    }

    if (isBattlePage) {
        installBattleOnlyHelper();
        return;
    }

    console.warn('[SkillTestHelper] 当前页面既不是主页面也不是战斗页面，未安装辅助脚本');
})();