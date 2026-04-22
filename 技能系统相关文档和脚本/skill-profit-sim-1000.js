"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TOTAL_BATTLES = 1000;
const MAX_TURNS_PER_BATTLE = 500;
const LEVEL_INDEX = 4;
const ACTIONS = ["gather", "defend", "light-attack", "heavy-attack", "special", "taunt"];
const ACTION_LABELS = {
    gather: "集气",
    defend: "防御",
    "light-attack": "轻攻击",
    "heavy-attack": "重攻击",
    special: "绝招",
    taunt: "嘴炮"
};
const STYLES = ["风", "火", "林", "山"];

const STYLE_STRATEGIES = {
    "风": {
        0: { gather: 100 },
        1: { gather: 25, taunt: 30, "light-attack": 45 },
        "2-4": { gather: 10, taunt: 25, "light-attack": 45, "heavy-attack": 20 },
        "5+": { gather: 10, taunt: 5, "light-attack": 30, "heavy-attack": 20, special: 35 }
    },
    "火": {
        0: { gather: 100 },
        1: { gather: 50, taunt: 15, "light-attack": 35 },
        "2-4": { gather: 20, taunt: 5, "light-attack": 20, "heavy-attack": 55 },
        "5+": { gather: 10, taunt: 5, "light-attack": 10, "heavy-attack": 35, special: 40 }
    },
    "林": {
        0: { gather: 100 },
        1: { gather: 75, taunt: 10, "light-attack": 15 },
        "2-4": { gather: 60, taunt: 10, "light-attack": 15, "heavy-attack": 15 },
        "5+": { gather: 10, taunt: 5, "light-attack": 10, "heavy-attack": 15, special: 60 }
    },
    "山": {
        0: { gather: 100 },
        1: { gather: 50, taunt: 10, "light-attack": 40 },
        "2-4": { gather: 50, taunt: 5, "light-attack": 20, "heavy-attack": 25 },
        "5+": { gather: 10, taunt: 5, "light-attack": 15, "heavy-attack": 20, special: 50 }
    }
};

const FIELD_EFFECTS = {
    "killing-intent": { id: "killing-intent", name: "杀意", duration: 3 },
    miasma: { id: "miasma", name: "瘴疠", duration: 3 },
    fortify: { id: "fortify", name: "固守", duration: 3 },
    "energy-tide": { id: "energy-tide", name: "气海", duration: 3 },
    melee: { id: "melee", name: "缠斗", duration: 3 },
    rejuvenation: { id: "rejuvenation", name: "回春", duration: 3 }
};

function loadSkillList() {
    const filePath = path.join(__dirname, "..", "module", "skill-list.js");
    const source = fs.readFileSync(filePath, "utf8") + "\nmodule.exports = skillList;";
    const sandbox = {
        module: { exports: {} },
        exports: {},
        console
    };
    vm.runInNewContext(source, sandbox, { filename: filePath });
    return sandbox.module.exports;
}

function weightedRandom(options) {
    const entries = Object.entries(options);
    const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let remaining = Math.random() * totalWeight;
    for (const [key, weight] of entries) {
        remaining -= weight;
        if (remaining <= 0) {
            return key;
        }
    }
    return entries[entries.length - 1][0];
}

function getEnergyRangeKey(energy) {
    if (energy === 0) return 0;
    if (energy === 1) return 1;
    if (energy >= 2 && energy <= 4) return "2-4";
    return "5+";
}

function initEnergyState(actor) {
    if (typeof actor.energyPrecise !== "number") {
        actor.energyPrecise = typeof actor.energy === "number" ? actor.energy : 0;
    }
    if (typeof actor.energy !== "number") {
        actor.energy = Math.floor(actor.energyPrecise);
    }
}

function addEnergy(actor, amount) {
    initEnergyState(actor);
    const before = actor.energyPrecise;
    const maxEnergy = actor.maxEnergy || 10;
    actor.energyPrecise = Math.min(maxEnergy, actor.energyPrecise + amount);
    actor.energy = Math.min(maxEnergy, Math.floor(actor.energyPrecise));
    return actor.energyPrecise - before;
}

function consumeEnergy(actor, amount) {
    initEnergyState(actor);
    const before = actor.energyPrecise;
    actor.energyPrecise = Math.max(0, actor.energyPrecise - amount);
    actor.energy = Math.floor(actor.energyPrecise);
    return before - actor.energyPrecise;
}

function canGainEnergy(actor) {
    initEnergyState(actor);
    return actor.energyPrecise < (actor.maxEnergy || 10);
}

function isActionDisabledByField(action, activeFieldEffect) {
    return !!(activeFieldEffect && activeFieldEffect.id === "melee" && action === "taunt");
}

function getFieldDamageMultiplier(activeFieldEffect) {
    return activeFieldEffect && activeFieldEffect.id === "killing-intent" ? 1.5 : 1.0;
}

function getFieldSelfDamageRatio(activeFieldEffect) {
    return activeFieldEffect && activeFieldEffect.id === "killing-intent" ? 0.25 : 0;
}

function isFieldFullDefense(activeFieldEffect) {
    return !!(activeFieldEffect && activeFieldEffect.id === "fortify");
}

function createFighter(name, style) {
    return {
        name,
        style,
        maxHealth: 250,
        currentHealth: 250,
        basicDamage: 100,
        critRate: 50,
        critDamage: 200,
        block: 0,
        armorPen: 0,
        turnover: 0,
        lifesteal: 0,
        thorns: 0,
        energy: 0,
        energyPrecise: 0,
        maxEnergy: 10,
        tauntedTurns: 0,
        lastAction: null,
        previousAction: null,
        selectedAction: null,
        swordIntent: 0,
        yuanBiQuanBonus: 0
    };
}

function chooseAction(actor, opponent, activeFieldEffect) {
    const style = actor.style || "风";
    const canDefend = actor.tauntedTurns <= 0;
    const canTaunt = !isActionDisabledByField("taunt", activeFieldEffect);
    const opponentEnergy = opponent.energy;

    if (opponentEnergy >= 5 && canTaunt) {
        if (style === "山" && Math.random() < 0.6) return "taunt";
        if (style === "林" && Math.random() < 0.5) return "taunt";
        if (style === "火" && Math.random() < 0.5) return "taunt";
        if (style === "风" && Math.random() < 0.4) return "taunt";
    }

    if (opponentEnergy >= 1 && canDefend) {
        if (style === "山" && Math.random() < 0.5) return "defend";
        if (style === "林" && Math.random() < 0.3) return "defend";
        if (style === "火" && Math.random() < 0.25) return "defend";
        if (style === "风" && Math.random() < 0.25) return "defend";
    }

    const styleStrategy = STYLE_STRATEGIES[style];
    const energyKey = getEnergyRangeKey(actor.energy);
    const options = { ...styleStrategy[energyKey] };

    if (actor.energy < 1) delete options["light-attack"];
    if (actor.energy < 2) delete options["heavy-attack"];
    if (actor.energy < 5) delete options.special;
    if (opponent.tauntedTurns > 0 && opponentEnergy < 5) delete options.taunt;
    if (!canTaunt) delete options.taunt;

    if (Object.keys(options).length === 0) return "gather";
    return weightedRandom(options);
}

function getEquippedSkillEntriesByTiming(state, timing) {
    const skill = state.equippedSkill;
    if (!skill || skill.triggerTiming !== timing) return [];
    return [skill];
}

function applyPlayerSkillEffects(state, timing, context = {}) {
    const result = {
        damageMultiplier: 1,
        extraDamage: 0,
        extraEnergy: 0,
        extraHeal: 0,
        damageReduction: 0,
        extraReflect: 0,
        energyDrain: 0,
        energySteal: 0,
        grantNextAttackBonus: 0
    };

    const entries = getEquippedSkillEntriesByTiming(state, timing);
    for (const skill of entries) {
        const params = skill.params || {};
        switch (timing) {
            case "onTauntHitDefend": {
                const extraDamageRatio = Number(params.extraDamageRatio) || 0;
                const extraDamage = Math.round((context.basicDamage || 0) * extraDamageRatio);
                if (extraDamage > 0) result.extraDamage += extraDamage;
                break;
            }
            case "onGather": {
                const extraEnergy = Number(params.extraEnergy) || 0;
                const healRatio = Number(params.healRatio) || 0;
                const previousAction = context.previousAction || null;
                const consecutiveGather = previousAction === "gather";
                const nonConsecutiveGather = previousAction !== "gather";
                if (consecutiveGather && extraEnergy > 0) {
                    result.extraEnergy += extraEnergy;
                }
                if (params.requireNonConsecutiveGather && nonConsecutiveGather && healRatio > 0) {
                    const extraHeal = Math.round((context.actor?.maxHealth || 0) * healRatio);
                    if (extraHeal > 0) result.extraHeal += extraHeal;
                }
                break;
            }
            case "onDefend": {
                const healRatio = Number(params.healRatio) || 0;
                const extraHeal = Math.round((context.actor?.maxHealth || 0) * healRatio);
                if (extraHeal > 0) result.extraHeal += extraHeal;
                break;
            }
            case "onSpecialUse": {
                const actor = context.actor;
                if (!actor || !(actor.maxHealth > 0)) break;
                const missingRatio = 1 - (actor.currentHealth / actor.maxHealth);
                const totalBonus = (Number(params.baseBonusRatio) || 0) + (Number(params.maxBonusRatio) || 0) * missingRatio;
                if (totalBonus > 0) result.damageMultiplier += totalBonus;
                break;
            }
            case "onTakeDamage": {
                result.damageReduction += Number(params.damageReduction) || 0;
                result.extraReflect += Number(params.reflectRatio) || 0;
                const energyRecovery = Number(params.energyRecovery) || 0;
                const gatherDamageReduction = Number(params.gatherDamageReduction) || 0;
                const defenderAction = context.defender?.selectedAction || "";
                const nextAttackBonusRatio = Number(params.nextAttackBonusRatio) || 0;
                if (nextAttackBonusRatio > 0) {
                    result.grantNextAttackBonus = Math.max(result.grantNextAttackBonus, nextAttackBonusRatio);
                }
                if (params.requirePlayerDefending && defenderAction === "defend" && energyRecovery > 0) {
                    result.extraEnergy += energyRecovery;
                }
                if (params.requirePlayerGathering && defenderAction === "gather" && gatherDamageReduction > 0) {
                    result.damageReduction += gatherDamageReduction;
                }
                break;
            }
            case "onAttackHit": {
                const playerAction = context.playerAction || "";
                const enemyAction = context.enemyAction || "";
                const basicDamage = context.basicDamage || 0;
                const targetCurrentHealth = context.targetCurrentHealth || 0;
                const targetMaxHealth = context.targetMaxHealth || 1;
                const previousAction = context.previousAction || null;

                if (params.requireConsecutiveAttack) {
                    const isCurrentAttack = playerAction === "light-attack" || playerAction === "heavy-attack" || playerAction === "special";
                    const wasPreviousAttack = previousAction === "light-attack" || previousAction === "heavy-attack" || previousAction === "special";
                    if (isCurrentAttack && wasPreviousAttack) {
                        const extraDamageRatio = Number(params.extraDamageRatio) || 0;
                        const extraDamage = Math.round(basicDamage * extraDamageRatio);
                        if (extraDamage > 0) result.extraDamage += extraDamage;
                    }
                    break;
                }

                if (params.requireLightAttack && params.requireTargetGatherOrTaunt) {
                    if (playerAction === "light-attack" && (enemyAction === "gather" || enemyAction === "taunt")) {
                        const energyRecoveryRatio = Number(params.energyRecoveryRatio) || 0;
                        if (energyRecoveryRatio > 0) {
                            result.extraEnergy += energyRecoveryRatio;
                            break;
                        }
                        const extraDamageRatio = Number(params.extraDamageRatio) || 0;
                        let extraDamage = Math.round(basicDamage * extraDamageRatio);
                        const lowHealthBonusMultiplier = Number(params.lowHealthBonusMultiplier) || 1;
                        if (targetCurrentHealth / targetMaxHealth < 0.5 && lowHealthBonusMultiplier > 1) {
                            extraDamage = Math.round(extraDamage * lowHealthBonusMultiplier);
                        }
                        if (extraDamage > 0) result.extraDamage += extraDamage;
                    }
                    break;
                }

                if (params.requireHeavyAttack && params.requireTargetNonDefendOrSpecial) {
                    if (playerAction === "heavy-attack" && enemyAction !== "defend" && enemyAction !== "special") {
                        const energyDrain = Number(params.energyDrain) || 0;
                        if (energyDrain > 0) result.energyDrain += energyDrain;
                    }
                    break;
                }

                if (params.requireHeavyAttack && params.requireTargetDefendOrCountered) {
                    if (playerAction === "heavy-attack" && (enemyAction === "defend" || enemyAction === "light-attack")) {
                        const extraDamageRatio = Number(params.extraDamageRatio) || 0;
                        let extraDamage = Math.round(basicDamage * extraDamageRatio);
                        const defendBonusMultiplier = Number(params.defendBonusMultiplier) || 1;
                        if (enemyAction === "defend" && defendBonusMultiplier > 1) {
                            extraDamage = Math.round(extraDamage * defendBonusMultiplier);
                        }
                        if (extraDamage > 0) result.extraDamage += extraDamage;
                    }
                    break;
                }

                if (params.requireTargetGather) {
                    if (enemyAction === "gather") {
                        const fixedEnergyLoss = Number(params.fixedEnergyLoss) || 0;
                        const extraEnergyLoss = Number(params.extraEnergyLoss) || 0;
                        const highEnergyThreshold = Number(params.highEnergyThreshold) || 5;
                        const targetEnergy = context.targetEnergy || 0;
                        let totalDrain = fixedEnergyLoss;
                        if (targetEnergy >= highEnergyThreshold) totalDrain += extraEnergyLoss;
                        if (totalDrain > 0) result.energyDrain += totalDrain;
                    }
                    break;
                }

                if (params.requireSpecialAttack) {
                    if (playerAction === "special") {
                        const energySteal = Number(params.energySteal) || 0;
                        if (energySteal > 0) result.energySteal += energySteal;
                    }
                    break;
                }
                break;
            }
            default:
                break;
        }
    }

    return result;
}

function computeDamage(attacker, defender, baseDamage, defenseFactor, forcedCrit = null) {
    if (!baseDamage || baseDamage <= 0) {
        return { damage: 0, crit: false, lifesteal: 0, thorns: 0 };
    }

    const factor = typeof defenseFactor === "number" ? defenseFactor : 1;
    const defenseDamage = factor <= 0 ? 0 : (baseDamage * factor);
    const blockValue = Math.max(0, defender.block || 0);
    const armorPenValue = Math.max(0, attacker.armorPen || 0);
    let damage = defenseDamage - blockValue + armorPenValue;
    damage = Math.max(0, Math.min(baseDamage, damage));
    damage = Math.round(damage);

    let crit = false;
    if (damage > 0 && (attacker.critRate || 0) > 0) {
        crit = forcedCrit != null ? !!forcedCrit : (Math.random() * 100 < attacker.critRate);
        if (crit) {
            const critMultiplier = Math.max(0, (attacker.critDamage || 0) / 100);
            damage = Math.round(damage * critMultiplier);
        }
    }

    return {
        damage,
        crit,
        lifesteal: damage > 0 && (attacker.lifesteal || 0) > 0 ? Math.round(damage * attacker.lifesteal / 100) : 0,
        thorns: damage > 0 && (defender.thorns || 0) > 0 ? Math.round(damage * defender.thorns / 100) : 0
    };
}

function resolveDamage(state, attacker, defender, baseDamage, defenseFactor, forcedCrit = null) {
    const result = computeDamage(attacker, defender, baseDamage, defenseFactor, forcedCrit);
    if (defender === state.player && result.damage > 0) {
        const skillEffect = applyPlayerSkillEffects(state, "onTakeDamage", { attacker, defender, damage: result.damage });
        if (skillEffect.damageReduction > 0) {
            const previousDamage = result.damage;
            result.damage = Math.max(0, Math.round(result.damage * (1 - skillEffect.damageReduction)));
            const reduced = previousDamage - result.damage;
            if (reduced > 0) {
                state.skillValue.preventedDamage += reduced;
            }
        }
        if (skillEffect.extraReflect > 0 && result.damage > 0) {
            const reflectedDamage = Math.round(result.damage * skillEffect.extraReflect);
            if (reflectedDamage > 0) {
                result.thorns += reflectedDamage;
                state.skillValue.reflectDamage += reflectedDamage;
            }
        }
        if (skillEffect.grantNextAttackBonus > 0 && result.damage > 0) {
            state.player.yuanBiQuanBonus = skillEffect.grantNextAttackBonus;
        }
        if (skillEffect.extraEnergy > 0 && result.damage > 0) {
            const actualGain = addEnergy(defender, skillEffect.extraEnergy);
            state.skillValue.energyGain += actualGain;
        }
    }

    if (result.damage > 0) {
        defender.currentHealth = Math.max(0, defender.currentHealth - result.damage);
    }
    if (result.lifesteal > 0) {
        attacker.currentHealth = Math.min(attacker.maxHealth, attacker.currentHealth + result.lifesteal);
    }
    if (result.thorns > 0) {
        attacker.currentHealth = Math.max(0, attacker.currentHealth - result.thorns);
    }
    return result;
}

function processPlayerHitSkills(state, playerAction, enemyAction) {
    const player = state.player;
    const enemy = state.enemy;
    let totalExtraDamage = 0;

    const hitEffect = applyPlayerSkillEffects(state, "onAttackHit", {
        playerAction,
        enemyAction,
        basicDamage: player.basicDamage || 0,
        targetCurrentHealth: enemy.currentHealth,
        targetMaxHealth: enemy.maxHealth,
        targetEnergy: enemy.energy || 0,
        previousAction: player.lastAction
    });

    if (hitEffect.extraDamage > 0) {
        totalExtraDamage += hitEffect.extraDamage;
        state.skillValue.extraDamage += hitEffect.extraDamage;
    }
    if (hitEffect.energyDrain > 0) {
        const actualDrain = consumeEnergy(enemy, hitEffect.energyDrain);
        state.skillValue.energyDrain += actualDrain;
    }
    if (hitEffect.extraEnergy > 0) {
        const actualGain = addEnergy(player, hitEffect.extraEnergy);
        state.skillValue.energyGain += actualGain;
    }
    if (hitEffect.energySteal > 0) {
        const actualDrain = consumeEnergy(enemy, hitEffect.energySteal);
        if (actualDrain > 0) {
            const actualGain = addEnergy(player, actualDrain);
            state.skillValue.energyDrain += actualDrain;
            state.skillValue.energyGain += actualGain;
        }
    }

    if (player.yuanBiQuanBonus > 0 && (playerAction === "light-attack" || playerAction === "heavy-attack")) {
        const bonusDamage = Math.round((player.basicDamage || 0) * player.yuanBiQuanBonus);
        if (bonusDamage > 0) {
            totalExtraDamage += bonusDamage;
            state.skillValue.extraDamage += bonusDamage;
        }
        player.yuanBiQuanBonus = 0;
    }

    if (player.swordIntent > 0) {
        const skill = state.equippedSkill;
        if (skill && skill.triggerTiming === "passive") {
            const perStackDamageRatio = Number(skill.params.perStackDamageRatio) || 0;
            if (perStackDamageRatio > 0) {
                const stacks = player.swordIntent;
                const bonusDamage = Math.round((player.basicDamage || 0) * perStackDamageRatio * stacks);
                if (bonusDamage > 0) {
                    totalExtraDamage += bonusDamage;
                    state.skillValue.extraDamage += bonusDamage;
                }
                player.swordIntent = 0;
            }
        }
    }

    if (totalExtraDamage > 0) {
        enemy.currentHealth = Math.max(0, enemy.currentHealth - totalExtraDamage);
    }
}

function checkFieldEffectTrigger(state) {
    if (state.turnNumber <= 5) return;
    if (state.activeFieldEffect !== null) return;

    let shouldTrigger = false;
    if (state.turnNumber === 6) {
        shouldTrigger = true;
    } else {
        shouldTrigger = Math.random() <= 0.33;
    }
    if (!shouldTrigger) return;

    const effectKeys = Object.keys(FIELD_EFFECTS);
    const randomKey = effectKeys[Math.floor(Math.random() * effectKeys.length)];
    state.activeFieldEffect = { ...FIELD_EFFECTS[randomKey] };
    state.fieldEffectRemaining = state.activeFieldEffect.duration;
}

function applyFieldEffectOnTurnStart(state) {
    if (!state.activeFieldEffect) return;

    const player = state.player;
    const enemy = state.enemy;
    switch (state.activeFieldEffect.id) {
        case "energy-tide":
            if (canGainEnergy(player)) addEnergy(player, 1);
            if (canGainEnergy(enemy)) addEnergy(enemy, 1);
            break;
        case "miasma":
            player.currentHealth = Math.max(1, player.currentHealth - Math.round(player.currentHealth * 0.1));
            enemy.currentHealth = Math.max(1, enemy.currentHealth - Math.round(enemy.currentHealth * 0.1));
            break;
        case "rejuvenation":
            player.currentHealth = Math.min(player.maxHealth, player.currentHealth + Math.round(player.maxHealth * 0.1));
            enemy.currentHealth = Math.min(enemy.maxHealth, enemy.currentHealth + Math.round(enemy.maxHealth * 0.1));
            break;
        default:
            break;
    }
}

function processFieldEffectTurnEnd(state) {
    if (!state.activeFieldEffect) return;
    state.fieldEffectRemaining -= 1;
    if (state.fieldEffectRemaining <= 0) {
        state.activeFieldEffect = null;
        state.fieldEffectRemaining = 0;
    }
}

function continueTurnState(state, playerResolvedAction) {
    const skill = state.equippedSkill;
    if (skill && skill.triggerTiming === "passive") {
        const maxStacks = Number(skill.params.maxStacks) || 3;
        const perStackDamageRatio = Number(skill.params.perStackDamageRatio) || 0;
        if (perStackDamageRatio > 0) {
            if (!state.player.previousAction) {
                // 第一回合不积层
            } else if (playerResolvedAction && playerResolvedAction !== state.player.previousAction) {
                state.player.swordIntent = Math.min((state.player.swordIntent || 0) + 1, maxStacks);
            }
        }
    }
    state.player.previousAction = playerResolvedAction || null;

    if (state.player.tauntedTurns > 0) state.player.tauntedTurns -= 1;
    if (state.enemy.tauntedTurns > 0) state.enemy.tauntedTurns -= 1;

    processFieldEffectTurnEnd(state);
    state.turnNumber += 1;
    checkFieldEffectTrigger(state);
    applyFieldEffectOnTurnStart(state);
}

function simulateTurn(state) {
    const player = state.player;
    const enemy = state.enemy;
    const playerAction = chooseAction(player, enemy, state.activeFieldEffect);
    const enemyAction = chooseAction(enemy, player, state.activeFieldEffect);
    player.selectedAction = playerAction;
    enemy.selectedAction = enemyAction;

    let turnEnded = false;
    const markTurnEndedIfDead = () => {
        if (player.currentHealth <= 0 || enemy.currentHealth <= 0) turnEnded = true;
    };

    let playerTotalDamageDealt = 0;
    let enemyTotalDamageDealt = 0;
    const fieldDamageMultiplier = getFieldDamageMultiplier(state.activeFieldEffect);
    const fieldFullDefense = isFieldFullDefense(state.activeFieldEffect);

    if (playerAction === "gather" && canGainEnergy(player)) {
        addEnergy(player, 1 + (player.turnover || 0));
        const gatherSkillEffect = applyPlayerSkillEffects(state, "onGather", { actor: player, previousAction: player.lastAction });
        if (gatherSkillEffect.extraEnergy > 0) {
            const actualGain = addEnergy(player, gatherSkillEffect.extraEnergy);
            state.skillValue.energyGain += actualGain;
        }
        if (gatherSkillEffect.extraHeal > 0) {
            const before = player.currentHealth;
            player.currentHealth = Math.min(player.maxHealth, player.currentHealth + gatherSkillEffect.extraHeal);
            state.skillValue.heal += player.currentHealth - before;
        }
    }
    if (enemyAction === "gather" && canGainEnergy(enemy)) {
        addEnergy(enemy, 1 + (enemy.turnover || 0));
    }

    const playerDefending = playerAction === "defend";
    const enemyDefending = enemyAction === "defend";

    if (playerDefending) {
        const defendSkillEffect = applyPlayerSkillEffects(state, "onDefend", { actor: player });
        if (defendSkillEffect.extraHeal > 0) {
            const before = player.currentHealth;
            player.currentHealth = Math.min(player.maxHealth, player.currentHealth + defendSkillEffect.extraHeal);
            state.skillValue.heal += player.currentHealth - before;
        }
    }

    let playerTauntSuccess = false;
    let enemyTauntSuccess = false;
    if (!(playerAction === "taunt" && enemyAction === "taunt")) {
        if (playerAction === "taunt" && enemyDefending) {
            if (enemy.energy > 0) consumeEnergy(enemy, 1);
            enemy.tauntedTurns = 3;
            const tauntSkillEffect = applyPlayerSkillEffects(state, "onTauntHitDefend", { basicDamage: player.basicDamage });
            if (tauntSkillEffect.extraDamage > 0) {
                enemy.currentHealth = Math.max(0, enemy.currentHealth - tauntSkillEffect.extraDamage);
                playerTotalDamageDealt += tauntSkillEffect.extraDamage;
                state.skillValue.extraDamage += tauntSkillEffect.extraDamage;
                markTurnEndedIfDead();
            }
        }

        if (enemyAction === "taunt" && playerDefending) {
            if (player.energy > 0) consumeEnergy(player, 1);
            player.tauntedTurns = 3;
        }

        if (playerAction === "taunt" && enemyAction === "special") playerTauntSuccess = true;
        if (enemyAction === "taunt" && playerAction === "special") enemyTauntSuccess = true;
    }

    if (playerAction === "special") {
        consumeEnergy(player, 5);
        if (!enemyTauntSuccess) {
            const skillEffect = applyPlayerSkillEffects(state, "onSpecialUse", { actor: player });
            const baseWithoutSkill = Math.round(player.basicDamage * 3 * fieldDamageMultiplier);
            const baseWithSkill = Math.round(baseWithoutSkill * skillEffect.damageMultiplier);
            const crit = Math.random() * 100 < player.critRate;
            const baseline = computeDamage(player, enemy, baseWithoutSkill, null, crit);
            const result = resolveDamage(state, player, enemy, baseWithSkill, null, crit);
            playerTotalDamageDealt += result.damage;
            const extraFromSkill = Math.max(0, result.damage - baseline.damage);
            state.skillValue.extraDamage += extraFromSkill;
            markTurnEndedIfDead();
            if (!turnEnded) {
                processPlayerHitSkills(state, playerAction, enemyAction);
                markTurnEndedIfDead();
            }
        }
        if (enemyAction === "light-attack") consumeEnergy(enemy, 1);
        if (enemyAction === "heavy-attack") consumeEnergy(enemy, 2);
    }

    if (!turnEnded && enemyAction === "special") {
        consumeEnergy(enemy, 5);
        if (!playerTauntSuccess) {
            const baseDamage = Math.round(enemy.basicDamage * 3 * fieldDamageMultiplier);
            const result = resolveDamage(state, enemy, player, baseDamage, null);
            enemyTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
        }
        if (playerAction === "light-attack") consumeEnergy(player, 1);
        if (playerAction === "heavy-attack") consumeEnergy(player, 2);
    }

    if (!turnEnded && playerAction === "heavy-attack" && enemyAction !== "special") {
        consumeEnergy(player, 2);
        if (enemyDefending) {
            const baseDamage = Math.round(player.basicDamage * 1.5 * fieldDamageMultiplier);
            const result = resolveDamage(state, player, enemy, baseDamage, fieldFullDefense ? 0 : 0.25);
            playerTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
            if (!turnEnded) processPlayerHitSkills(state, playerAction, enemyAction);
        } else if (enemyAction === "light-attack") {
            const baseDamage = Math.round(player.basicDamage * 1.5 * fieldDamageMultiplier);
            const result = resolveDamage(state, player, enemy, baseDamage, null);
            playerTotalDamageDealt += result.damage;
            consumeEnergy(enemy, 1);
            markTurnEndedIfDead();
            if (!turnEnded) processPlayerHitSkills(state, playerAction, enemyAction);
        } else {
            const baseDamage = Math.round(player.basicDamage * 1.5 * fieldDamageMultiplier);
            const result = resolveDamage(state, player, enemy, baseDamage, null);
            playerTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
            if (!turnEnded) processPlayerHitSkills(state, playerAction, enemyAction);
        }
    }

    if (!turnEnded && enemyAction === "heavy-attack" && playerAction !== "special") {
        consumeEnergy(enemy, 2);
        if (playerDefending) {
            const baseDamage = Math.round(enemy.basicDamage * 1.5 * fieldDamageMultiplier);
            const result = resolveDamage(state, enemy, player, baseDamage, fieldFullDefense ? 0 : 0.25);
            enemyTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
        } else if (playerAction === "light-attack") {
            const baseDamage = Math.round(enemy.basicDamage * 1.5 * fieldDamageMultiplier);
            const result = resolveDamage(state, enemy, player, baseDamage, null);
            enemyTotalDamageDealt += result.damage;
            consumeEnergy(player, 1);
            markTurnEndedIfDead();
        } else {
            const baseDamage = Math.round(enemy.basicDamage * 1.5 * fieldDamageMultiplier);
            const result = resolveDamage(state, enemy, player, baseDamage, null);
            enemyTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
        }
    }

    if (!turnEnded && playerAction === "light-attack" && enemyAction !== "heavy-attack" && enemyAction !== "special") {
        consumeEnergy(player, 1);
        if (enemyDefending) {
            const baseDamage = Math.round(player.basicDamage * fieldDamageMultiplier);
            const result = resolveDamage(state, player, enemy, baseDamage, fieldFullDefense ? 0 : 0.15);
            playerTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
            if (!turnEnded) processPlayerHitSkills(state, playerAction, enemyAction);
        } else {
            const baseDamage = Math.round(player.basicDamage * fieldDamageMultiplier);
            const result = resolveDamage(state, player, enemy, baseDamage, null);
            playerTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
            if (!turnEnded) processPlayerHitSkills(state, playerAction, enemyAction);
        }
    }

    if (!turnEnded && enemyAction === "light-attack" && playerAction !== "heavy-attack" && playerAction !== "special") {
        consumeEnergy(enemy, 1);
        if (playerDefending) {
            const baseDamage = Math.round(enemy.basicDamage * fieldDamageMultiplier);
            const result = resolveDamage(state, enemy, player, baseDamage, fieldFullDefense ? 0 : 0.15);
            enemyTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
        } else {
            const baseDamage = Math.round(enemy.basicDamage * fieldDamageMultiplier);
            const result = resolveDamage(state, enemy, player, baseDamage, null);
            enemyTotalDamageDealt += result.damage;
            markTurnEndedIfDead();
        }
    }

    const selfDamageRatio = getFieldSelfDamageRatio(state.activeFieldEffect);
    if (selfDamageRatio > 0) {
        if (playerTotalDamageDealt > 0) {
            player.currentHealth = Math.max(0, player.currentHealth - Math.round(playerTotalDamageDealt * selfDamageRatio));
        }
        if (enemyTotalDamageDealt > 0) {
            enemy.currentHealth = Math.max(0, enemy.currentHealth - Math.round(enemyTotalDamageDealt * selfDamageRatio));
        }
    }

    player.lastAction = playerAction;
    enemy.lastAction = enemyAction;
    continueTurnState(state, playerAction);
}

function simulateSkill(skill) {
    const totals = {
        extraDamage: 0,
        reflectDamage: 0,
        preventedDamage: 0,
        heal: 0,
        energyGain: 0,
        energyDrain: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        totalTurns: 0
    };

    for (let battleIndex = 0; battleIndex < TOTAL_BATTLES; battleIndex += 1) {
        const playerStyle = STYLES[Math.floor(Math.random() * STYLES.length)];
        const enemyStyle = STYLES[Math.floor(Math.random() * STYLES.length)];
        const state = {
            turnNumber: 1,
            activeFieldEffect: null,
            fieldEffectRemaining: 0,
            player: createFighter("用户", playerStyle),
            enemy: createFighter("敌方", enemyStyle),
            equippedSkill: skill,
            skillValue: {
                extraDamage: 0,
                reflectDamage: 0,
                preventedDamage: 0,
                heal: 0,
                energyGain: 0,
                energyDrain: 0
            }
        };

        let turnsPlayed = 0;
        while (state.player.currentHealth > 0 && state.enemy.currentHealth > 0 && turnsPlayed < MAX_TURNS_PER_BATTLE) {
            simulateTurn(state);
            turnsPlayed += 1;
        }

        totals.extraDamage += state.skillValue.extraDamage;
        totals.reflectDamage += state.skillValue.reflectDamage;
        totals.preventedDamage += state.skillValue.preventedDamage;
        totals.heal += state.skillValue.heal;
        totals.energyGain += state.skillValue.energyGain;
        totals.energyDrain += state.skillValue.energyDrain;
        totals.totalTurns += turnsPlayed;

        if (state.player.currentHealth <= 0 && state.enemy.currentHealth <= 0) totals.draws += 1;
        else if (state.enemy.currentHealth <= 0) totals.wins += 1;
        else if (state.player.currentHealth <= 0) totals.losses += 1;
        else totals.draws += 1;
    }

    return totals;
}

function toSkillEntry(definition) {
    const level = definition.levels[LEVEL_INDEX];
    return {
        id: definition.id,
        name: definition.name,
        category: definition.category,
        memorySlots: definition.memorySlots,
        triggerTiming: definition.triggerTiming,
        level: LEVEL_INDEX + 1,
        params: { ...(level.params || {}) }
    };
}

function escapeCsvValue(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function rowsToCsv(rows) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const lines = [headers.map(escapeCsvValue).join(",")];
    rows.forEach((row) => lines.push(headers.map((header) => escapeCsvValue(row[header])).join(",")));
    return lines.join("\n");
}

function main() {
    const skillList = loadSkillList();
    const skills = Object.values(skillList).map(toSkillEntry);
    const simulationSetup = {
        totalBattles: TOTAL_BATTLES,
        maxTurnsPerBattle: MAX_TURNS_PER_BATTLE,
        skillLevel: LEVEL_INDEX + 1,
        playerHasSingleSkill: true,
        enemyHasSkill: false,
        styleSelection: "每场为双方各自从 风/火/林/山 中等概率随机抽取 1 种风格",
        fighterStats: {
            maxHealth: 250,
            currentHealth: 250,
            basicDamage: 100,
            critRate: 50,
            critDamage: 200,
            block: 0,
            armorPen: 0,
            turnover: 0,
            lifesteal: 0,
            thorns: 0,
            energy: 0,
            maxEnergy: 10
        },
        profitRule: {
            damageOrHealPerPoint: 50,
            energyPerPoint: 1,
            preventedDamageCountsAsHeal: true
        },
        notes: [
            "双方基础属性完全对称，仅玩家装备待测技能。",
            "行动选择沿用战斗页的四风格权重表与能量门槛。",
            "场地效果按现有逻辑随机触发并参与结算。"
        ]
    };
    const rows = skills.map((skill) => {
        const total = simulateSkill(skill);
        const directDamage = total.extraDamage + total.reflectDamage;
        const effectiveHeal = total.heal + total.preventedDamage;
        const profitFromDamage = directDamage / 50;
        const profitFromHeal = effectiveHeal / 50;
        const profitFromEnergy = total.energyGain + total.energyDrain;
        const totalProfit = profitFromDamage + profitFromHeal + profitFromEnergy;

        return {
            技能: skill.name,
            分类: skill.category,
            记忆点: skill.memorySlots,
            等级: skill.level,
            触发: skill.triggerTiming,
            额外伤害: total.extraDamage,
            反弹伤害: total.reflectDamage,
            等效减伤: total.preventedDamage,
            实际回血: total.heal,
            额外回气: Number(total.energyGain.toFixed(2)),
            额外削气: Number(total.energyDrain.toFixed(2)),
            伤害收益点: Number(profitFromDamage.toFixed(2)),
            回复收益点: Number(profitFromHeal.toFixed(2)),
            气收益点: Number(profitFromEnergy.toFixed(2)),
            总收益点: Number(totalProfit.toFixed(2)),
            平均每场收益点: Number((totalProfit / TOTAL_BATTLES).toFixed(3)),
            胜场: total.wins,
            负场: total.losses,
            平局: total.draws,
            平均回合: Number((total.totalTurns / TOTAL_BATTLES).toFixed(2))
        };
    }).sort((a, b) => b.总收益点 - a.总收益点);

    const outputDir = path.join(__dirname, "simulation-output");
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, "skill-profit-report.json");
    const csvPath = path.join(outputDir, "skill-profit-report.csv");
    fs.writeFileSync(jsonPath, JSON.stringify({ simulationSetup, rows }, null, 2), "utf8");
    fs.writeFileSync(csvPath, rowsToCsv(rows), "utf8");

    console.log(`=== 技能收益统计 (${TOTAL_BATTLES} 场 / Lv${LEVEL_INDEX + 1}) ===`);
    console.log("对战设定:");
    console.table([
        { 项目: "总场次", 数值: TOTAL_BATTLES },
        { 项目: "最大回合", 数值: MAX_TURNS_PER_BATTLE },
        { 项目: "技能等级", 数值: `Lv${LEVEL_INDEX + 1}` },
        { 项目: "双方基础生命", 数值: 250 },
        { 项目: "双方基础攻击", 数值: 100 },
        { 项目: "双方暴击率", 数值: "50%" },
        { 项目: "双方暴击伤害", 数值: "200%" },
        { 项目: "双方风格", 数值: "每场各自从风/火/林/山等概率随机" },
        { 项目: "技能配置", 数值: "仅玩家装备单个待测技能，敌方无技能" },
        { 项目: "收益换算", 数值: "50伤害/治疗=1点，1点气收益=1点" }
    ]);
    console.table(rows);
    console.log("\n导出文件:");
    console.table([
        { 文件: "JSON", 路径: jsonPath },
        { 文件: "CSV", 路径: csvPath }
    ]);
}

main();