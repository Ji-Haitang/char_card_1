import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
    const context = vm.createContext({});
    const source = readFileSync(new URL('../module/speech/runtime.js', import.meta.url), 'utf8');
    vm.runInContext(source, context);
    return context.speechTurn;
}

test('关闭配音时不追加发声指导', () => {
    const speechTurn = boot();
    assert.equal(speechTurn.instruction(null), '');
});

test('开配音时只给明确参与性活动的发言NPC追加性爱中标注', () => {
    const speechTurn = boot();
    const instruction = speechTurn.instruction({ kind: 'round' });

    // 普通对白继续使用原有的短表现描述规则。
    assert.match(instruction, /用1至24字中文短句/);
    assert.match(instruction, /日常交谈平实/);

    // 只有明确发生性活动且正在参与并开口的NPC才使用固定前缀。
    assert.match(instruction, /明确正在发生性交或性刺激/);
    assert.match(instruction, /只给正在参与该行为并开口的NPC/);
    assert.match(instruction, /表现描述开头写“性爱中，”/);
    assert.match(instruction, /气息、停顿或克制程度/);

    // 暧昧场景与同场旁观者不能被误标，第五字段也不能作为TTS判定依据。
    assert.match(instruction, /暧昧、调情、裸露、单纯接吻或同场旁观不得这样标注/);
    assert.match(instruction, /不根据第五字段判定/);
});
