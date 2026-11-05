/**
 * layout-iteration.browser.mjs - 界面布局迭代验收（视窗 HUD / 文本区输入栏 / 横屏模式）
 *
 * 独立运行（不属于 run-browser 注册表）：
 *   node tests/scene3d/layout-iteration.browser.mjs <绝对路径的新证据目录>
 *
 * 只读取真实页面布局与点击真实控件，不注入样式、不改业务状态字段。
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, newGameContext, startGame, json, fixturesRoot } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../../scene3d/scripts/test-server.mjs';
import { waitForLatestApplied } from './p1.browser.mjs';

const gameRoot = process.cwd();
const directory = process.argv[2];
assert.ok(directory && path.isAbsolute(directory), 'Supply a NEW absolute evidence directory');
await mkdir(directory, { recursive: false });
const save = (name, value) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const results = [];
const server = await startTestServer({ gameRoot });
const browser = await launchBrowser();
try {
  for (const testCase of [
    { label: 'portrait-ancient-1280', viewport: { width: 1280, height: 900, deviceScaleFactor: 1 }, style: 0 },
    { label: 'portrait-flat-390', viewport: { width: 390, height: 844, deviceScaleFactor: 1 }, style: 1 },
    { label: 'portrait-flat-1280', viewport: { width: 1280, height: 900, deviceScaleFactor: 1 }, style: 1 },
    { label: 'landscape-ancient-1280', viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, style: 0, landscape: true },
    { label: 'landscape-flat-844', viewport: { width: 844, height: 390, deviceScaleFactor: 1 }, style: 1, landscape: true },
    { label: 'landscape-ancient-1920', viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }, style: 0, landscape: true }
  ]) {
    const { label, viewport, style, landscape = false } = testCase;
    const payload = await json(path.join(fixturesRoot, 'saves/map.json'));
    const session = await newGameContext(browser, server, {
      payload, channel: label, style, viewport,
      scene3dPreferences: { schema: 1, enabled: false, quality: 'low' }
    });
    const page = session.page;
    const record = { label, style, landscape, viewport };
    try {
      await startGame(session, server);
      await page.evaluate(() => closeModal());
      if (landscape) {
        await page.evaluate(() => {
          const toggle = document.getElementById('gs-layout-toggle');
          toggle.checked = true;
          gsOnLayoutMode(toggle);
        });
        await page.waitForFunction(() => document.body.classList.contains('layout-landscape'));
      } else {
        assert.equal(await page.evaluate(() => document.body.classList.contains('layout-landscape')), false, '竖屏为默认');
      }
      await sleep(150);

      /* ---------- 1. 结构：中间按钮/输入区已取消，元素已拆分到位 ---------- */
      record.structure = await page.evaluate(() => {
        const viewport = document.getElementById('main-viewport');
        const input = document.getElementById('free-action-input');
        const expand = document.getElementById('story-expand-btn');
        const dock = document.getElementById('viewport-dock');
        const ids = ['attribute-dropdown', 'system-dropdown', 'history-dropdown', 'skip-week-btn', 'slg-return-btn',
          'free-action-input', 'free-action-send-btn', 'regenerate-btn'];
        const parents = {};
        ids.forEach(id => {
          const node = document.getElementById(id);
          parents[id] = { inViewport: !!node.closest('#main-viewport'), inStoryArea: !!node.closest('.story-area'),
            hidden: getComputedStyle(node).display === 'none' };
        });
        return {
          bottomPanelPresent: !!document.querySelector('.bottom-panel, .control-buttons'),
          dockInViewport: !!dock && dock.parentElement.parentElement === viewport,
          inputInStoryArea: !!input.closest('.story-area'),
          expandBelowInput: expand.getBoundingClientRect().top >= input.getBoundingClientRect().bottom - 1,
          parents
        };
      });
      assert.equal(record.structure.bottomPanelPresent, false, '中间的按钮和输入框区必须已取消');
      assert.equal(record.structure.dockInViewport, true, '控制面板必须位于 viewport 内');
      assert.equal(record.structure.inputInStoryArea, true, '输入框必须在文本区内');
      assert.equal(record.structure.expandBelowInput, true, '展开全文/收起按钮必须位于输入框下方');
      for (const id of ['attribute-dropdown', 'system-dropdown', 'history-dropdown', 'skip-week-btn']) {
        assert.equal(record.structure.parents[id].inViewport, true, `#${id} 应在视窗内`);
      }
      for (const id of ['free-action-input', 'free-action-send-btn', 'regenerate-btn']) {
        assert.equal(record.structure.parents[id].inStoryArea, true, `#${id} 应在文本区内`);
      }

      /* ---------- 2. 齿轮按钮：收起态位置/尺寸/层级 ---------- */
      const closed = await page.evaluate(() => {
        const viewport = document.getElementById('main-viewport');
        const dock = document.getElementById('viewport-dock');
        const gear = document.getElementById('viewport-dock-gear');
        const menu = document.getElementById('viewport-dock-menu');
        const vp = viewport.getBoundingClientRect(), g = gear.getBoundingClientRect();
        const contentRight = vp.left + viewport.clientLeft + viewport.clientWidth;
        const contentBottom = vp.top + viewport.clientTop + viewport.clientHeight;
        const gearStyle = getComputedStyle(gear);
        const controlBtn = viewport.querySelector('#viewport-dock-menu .control-btn');
        return {
          open: dock.classList.contains('open'),
          gearRightGap: contentRight - g.right, gearBottomGap: contentBottom - g.bottom,
          gearWidth: g.width, gearHeight: g.height,
          gearRadius: gearStyle.borderRadius, gearBackground: gearStyle.backgroundColor,
          layerZIndex: getComputedStyle(document.getElementById('viewport-dock-layer')).zIndex,
          menuVisibility: getComputedStyle(menu).visibility,
          controlBtnHeight: controlBtn ? controlBtn.getBoundingClientRect().height : 0
        };
      });
      record.gearClosed = closed;
      assert.equal(closed.open, false, '默认收起');
      assert.equal(closed.menuVisibility, 'hidden', '收起时四枚按钮不可见');
      assert.ok(Math.abs(closed.gearRightGap - 12) < 1.5, `齿轮右间距 ${closed.gearRightGap} 应≈12px`);
      assert.ok(Math.abs(closed.gearBottomGap - 12) < 1.5, `齿轮下间距 ${closed.gearBottomGap} 应≈12px`);
      const expectedGear = Math.max(12, Math.min(64, 0.8 * closed.controlBtnHeight));
      assert.ok(Math.abs(closed.gearWidth - expectedGear) < 0.75, `齿轮尺寸 ${closed.gearWidth} 应≈80%×按钮高(${closed.controlBtnHeight.toFixed(2)})≈${expectedGear.toFixed(2)}`);
      assert.equal(closed.gearRadius, '50%');
      assert.ok(Number(closed.layerZIndex) >= 950, '层级必须高于 CG/SLG 图层与流式遮罩');
      await page.screenshot({ path: path.join(directory, `${label}-closed.png`) });

      /* ---------- 3. 展开：四枚按钮可见、等宽、位于齿轮左侧、不越出视窗 ---------- */
      await page.click('#viewport-dock-gear');
      await page.waitForFunction(() => document.getElementById('viewport-dock').classList.contains('open'));
      await sleep(280);
      record.gearOpen = await page.evaluate(() => {
        const viewport = document.getElementById('main-viewport');
        const gear = document.getElementById('viewport-dock-gear');
        const buttons = ['attribute-dropdown', 'system-dropdown', 'history-dropdown', 'skip-week-btn'].map(id => {
          const node = document.getElementById(id);
          const button = node.classList.contains('dropdown-menu') ? node.previousElementSibling : node;
          const r = button.getBoundingClientRect();
          return { id, visible: getComputedStyle(button).visibility !== 'hidden' && r.width > 0, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        });
        const vp = viewport.getBoundingClientRect(), g = gear.getBoundingClientRect();
        return { vp: { left: vp.left, right: vp.right, bottom: vp.bottom }, gear: { left: g.left }, buttons };
      });
      for (const button of record.gearOpen.buttons) {
        assert.equal(button.visible, true, `${button.id} 展开后必须可见`);
        assert.ok(button.right <= record.gearOpen.gear.left + 1, `${button.id} 必须展开在齿轮左侧`);
        assert.ok(button.left >= record.gearOpen.vp.left - 1, `${button.id} 不可越出视窗左缘`);
        assert.ok(button.bottom <= record.gearOpen.vp.bottom - 10, `${button.id} 不可越出视窗下缘`);
      }
      const widths = record.gearOpen.buttons.map(b => b.width);
      assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, `四枚按钮必须等宽（${widths.join('/')}）`);
      // 3.5:1 宽高比 + 永远单排
      for (const button of record.gearOpen.buttons) {
        const ratio = button.width / button.height;
        assert.ok(Math.abs(ratio - 3.5) < 0.5, `${button.id} 宽高比应≈3.5:1（实际 ${ratio.toFixed(2)}）`);
      }
      const tops = record.gearOpen.buttons.map(b => b.top);
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, `四枚按钮必须同一行（top=${tops.join('/')}）`);
      // 整行约占视窗宽度 90%（窄屏让开齿轮可略低）
      const menuLeft = Math.min(...record.gearOpen.buttons.map(b => b.left));
      const menuRight = Math.max(...record.gearOpen.buttons.map(b => b.right));
      const vpWidth = record.gearOpen.vp.right - record.gearOpen.vp.left;
      const menuShare = (menuRight - menuLeft) / vpWidth;
      assert.ok(menuShare > 0.75 && menuShare < 0.97, `按钮行应约占视窗 90% 宽（实际 ${(menuShare * 100).toFixed(1)}%）`);
      await page.screenshot({ path: path.join(directory, `${label}-open.png`) });

      /* ---------- 4. 下拉菜单真实展开且不越出视窗 ---------- */
      await page.evaluate(() => toggleDropdown('attribute-dropdown'));
      await page.waitForFunction(() => document.getElementById('attribute-dropdown').classList.contains('show'));
      await sleep(240);
      record.dropdown = await page.evaluate(() => {
        const menu = document.getElementById('attribute-dropdown');
        const trigger = menu.previousElementSibling;
        const vp = document.getElementById('main-viewport').getBoundingClientRect();
        const r = menu.getBoundingClientRect();
        const t = trigger.getBoundingClientRect();
        const item = menu.querySelector('.dropdown-item');
        const ir = item.getBoundingClientRect();
        const truncatedItems = [...menu.querySelectorAll('.dropdown-item')]
          .filter(node => node.offsetParent && node.scrollWidth > node.clientWidth + 1)
          .map(node => node.textContent.trim());
        return {
          display: getComputedStyle(menu).display, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          width: r.width, triggerWidth: t.width, itemWidth: ir.width, itemHeight: ir.height,
          truncated: truncatedItems.length > 0, truncatedItems,
          vp: { left: vp.left, right: vp.right, top: vp.top, bottom: vp.bottom }
        };
      });
      assert.equal(record.dropdown.display, 'block', '下拉菜单应可见');
      assert.ok(record.dropdown.left >= record.dropdown.vp.left - 1, `菜单不越出视窗左缘（left=${record.dropdown.left}）`);
      assert.ok(record.dropdown.right <= record.dropdown.vp.right + 1, `菜单不越出视窗右缘（right=${record.dropdown.right}）`);
      assert.ok(record.dropdown.top >= record.dropdown.vp.top - 1, `菜单不越出视窗上缘（top=${record.dropdown.top}）`);
      assert.ok(record.dropdown.bottom <= record.dropdown.vp.bottom + 1, `菜单不越出视窗下缘（bottom=${record.dropdown.bottom}）`);
      // 二级菜单默认与主按钮等宽；主按钮窄于文字所需宽度（小屏）时按内容撑开，保证标题不被截断
      assert.ok(record.dropdown.width >= record.dropdown.triggerWidth - 2, `二级菜单不得窄于主按钮（menu=${record.dropdown.width} vs btn=${record.dropdown.triggerWidth}）`);
      assert.equal(record.dropdown.truncated, false, `二级菜单标题不得被截断（截断项：${record.dropdown.truncatedItems.join('、')}）`);
      assert.ok(Math.abs(record.dropdown.itemWidth - record.dropdown.width) <= 16, `二级按钮应填满菜单内容区（item=${record.dropdown.itemWidth} vs menu=${record.dropdown.width}，含内边距差）`);
      await page.screenshot({ path: path.join(directory, `${label}-menu.png`) });
      await page.evaluate(() => { toggleDropdown('attribute-dropdown'); toggleViewportDock(false); });

      /* ---------- 5. 小游戏界面不出现 ---------- */
      record.minigame = {};
      for (const [id, label2] of [['battle-modal', '战斗'], ['alchemy-modal', '炼丹'], ['blackjack-modal', '21点'], ['farm-modal', '种植']]) {
        await page.evaluate(modalId => { document.getElementById(modalId).style.display = 'block'; }, id);
        const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('viewport-dock-layer')).display === 'none');
        record.minigame[id] = { hidden };
        assert.equal(hidden, true, `${label2}界面必须隐藏控制面板`);
        await page.evaluate(modalId => { document.getElementById(modalId).style.display = 'none'; }, id);
      }
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('viewport-dock-layer')).display !== 'none'), true, '关闭小游戏后恢复显示');

      /* ---------- 6. GameMode=1（CG 图）不被遮挡 ---------- */
      record.cg = await page.evaluate(() => {
        const viewport = document.getElementById('main-viewport');
        const container = document.createElement('div');
        container.className = 'slg-layer-container';
        container.dataset.layoutProbe = 'true';
        const scene = document.createElement('div');
        scene.className = 'slg-layer slg-scene-layer';
        const cg = document.createElement('div');
        cg.className = 'slg-layer slg-cg-layer';
        cg.style.background = '#123';
        container.appendChild(scene); container.appendChild(cg);
        document.body.classList.add('slg-global');
        viewport.appendChild(container);
        const gear = document.getElementById('viewport-dock-gear');
        const r = gear.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { hitIsDock: !!hit.closest('#viewport-dock'), hitTag: hit.tagName };
      });
      assert.equal(record.cg.hitIsDock, true, `GameMode=1 下层 CG 图不得遮住齿轮（命中 ${record.cg.hitTag}）`);
      await page.evaluate(() => {
        document.querySelector('[data-layout-probe="true"]')?.remove();
        document.body.classList.remove('slg-global');
      });

      /* ---------- 7. 横屏/竖屏几何 + 横屏文本列输入栏/箭头 ---------- */
      if (landscape) {
        // 强制多页故事，让翻页箭头渲染出来（fixture 单页时箭头 display:none），验证横屏下箭头收进文本区内
        await page.evaluate(() => { storyPages = ['第一页', '第二页']; currentPage = 0; updateStoryDisplay(); });
        await sleep(100);
      }
      record.geometry = await page.evaluate(() => {
        const box = element => { const r = element.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
        const viewport = document.getElementById('main-viewport');
        const storyArea = document.querySelector('.story-area');
        const inputRow = document.querySelector('.story-area > .free-action-container');
        const send = document.getElementById('free-action-send-btn');
        const prev = document.getElementById('story-prev-btn');
        const next = document.getElementById('story-next-btn');
        const doc = document.documentElement;
        return {
          landscape: document.body.classList.contains('layout-landscape'),
          viewport: box(viewport), storyArea: box(storyArea),
          window: { width: window.innerWidth, height: window.innerHeight },
          documentScrollWidth: doc.scrollWidth,
          inputRowOverflowsX: inputRow.scrollWidth > inputRow.clientWidth + 1,
          sendRight: send.getBoundingClientRect().right,
          prev: box(prev), next: box(next)
        };
      });
      if (landscape) {
        const { viewport: vp, storyArea: sa, window: win } = record.geometry;
        assert.ok(vp.left <= 12, `横屏视窗应贴左（left=${vp.left}）`);
        assert.ok(Math.abs(vp.width / vp.height - 1.46) < 0.03, `横屏视窗必须保持 1.46 宽高比（${(vp.width / vp.height).toFixed(3)}）`);
        assert.ok(Math.abs(vp.height - win.height) <= 2, `横屏视窗应上下填满页面（vp.height=${vp.height} vs win.height=${win.height}）`);
        assert.ok(Math.abs(sa.left - vp.right) <= 2, `文本区左缘与视窗右缘必须贴紧无空隙（sa.left=${sa.left} vs vp.right=${vp.right}）`);
        assert.ok(sa.right >= win.width - 2, `文本区应吃满右侧（right=${sa.right}/${win.width}）`);
        assert.ok(sa.width > 100, `文本区宽度需可用（${sa.width}）`);
        // 文本区 = 视窗上下填满后让出的右侧剩余宽度
        assert.ok(Math.abs(sa.width - (win.width - vp.width)) <= 2, `文本区应吃掉剩余宽度（sa=${sa.width} vs rest=${win.width - vp.width}）`);
        assert.ok(record.geometry.documentScrollWidth <= win.width + 1, '横屏不应出现横向滚动');
        // 输入栏不横向溢出，发送按钮不越出文本区右缘
        assert.equal(record.geometry.inputRowOverflowsX, false, '横屏输入栏不得横向溢出');
        assert.ok(record.geometry.sendRight <= sa.right + 1, `发送按钮不得越出文本区右缘（send.right=${record.geometry.sendRight} vs story.right=${sa.right}）`);
        // 翻页箭头：横屏下贴文本区左右边缘、可见（不被裁掉）
        assert.ok(record.geometry.prev.left >= sa.left - 1 && record.geometry.prev.width > 0, '横屏上一页箭头应在文本区内');
        assert.ok(record.geometry.next.right <= sa.right + 1 && record.geometry.next.width > 0, '横屏下一页箭头应在文本区内');
      } else {
        const { viewport: vp, storyArea: sa } = record.geometry;
        assert.ok(sa.top >= vp.bottom - 2, '竖屏文本区仍在视窗下方');
        assert.ok(Math.abs(vp.width / vp.height - 1.46) < 0.03, '竖屏视窗保持 1.46 宽高比');
      }

      /* ---------- 7b. 输入栏比例：输入框 60% + 发送/重生成各≈20%（3:1） ---------- */
      record.inputRow = await page.evaluate(() => {
        const box = element => { const r = element.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
        const row = document.querySelector('.free-action-row');
        const input = document.getElementById('free-action-input');
        const send = document.getElementById('free-action-send-btn');
        const regen = document.getElementById('regenerate-btn');
        const expand = document.getElementById('story-expand-btn');
        return { row: box(row), input: box(input), send: box(send), regen: box(regen), expand: box(expand) };
      });
      {
        const { row, input, send, regen, expand } = record.inputRow;
        const inputShare = input.width / row.width;
        assert.ok(Math.abs(inputShare - 0.6) < 0.05, `输入框应约占输入行 60%（实际 ${(inputShare * 100).toFixed(1)}%）`);
        assert.ok(Math.abs(input.height - send.height) <= 1 && Math.abs(input.height - regen.height) <= 1,
          `输入框应与发送/重生成按钮等高（input=${input.height} send=${send.height} regen=${regen.height}）`);
        const sendRatio = send.width / send.height;
        const regenRatio = regen.width / regen.height;
        // 按钮常态≈3:1；极窄栏下 3:1 高度不足输入框一行文字（行高+边框）时，按钮随输入框同高，宽高比变小
        const lineFloor = input.height <= 24;
        assert.ok(Math.abs(sendRatio - 3) < 0.6 || (lineFloor && sendRatio < 3), `发送按钮应≈3:1（实际 ${sendRatio.toFixed(2)}）`);
        assert.ok(Math.abs(regenRatio - 3) < 0.6 || (lineFloor && regenRatio < 3), `重生成按钮应≈3:1（实际 ${regenRatio.toFixed(2)}）`);
        assert.ok(expand.top >= row.bottom - 1, `展开/收起按钮必须在输入行下方（expand.top=${expand.top} vs row.bottom=${row.bottom}）`);
        assert.ok(expand.width < row.width * 0.7, `展开/收起按钮应为小按钮不拉伸（width=${expand.width} vs row=${row.width}）`);
      }

      /* ---------- 8. 历史记录弹窗：竖屏纵向突破 / 横屏横向突破 ---------- */
      await page.evaluate(async () => { await showHistorySummary(); });
      await page.waitForFunction(() => document.getElementById('history-summary-modal').style.display === 'block');
      await sleep(200);
      record.historyModal = await page.evaluate(() => {
        const modal = document.getElementById('history-summary-modal');
        const viewport = document.getElementById('main-viewport');
        const box = element => { const r = element.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
        const mc = document.querySelector('#history-summary-modal .modal-content');
        const h3 = document.querySelector('#history-summary-modal .modal-content h3');
        const hr = h3 ? h3.getBoundingClientRect() : null;
        const cs = h3 ? getComputedStyle(h3) : null;
        return {
          modal: box(modal), viewport: box(viewport), bodyParent: modal.parentElement === document.body,
          contentWidth: mc ? Math.round(mc.getBoundingClientRect().width) : 0,
          titleWidth: hr ? Math.round(hr.width) : 0,
          titleStroke: cs ? cs.webkitTextStroke : '',
          titleAlignSelf: cs ? cs.alignSelf : ''
        };
      });
      if (landscape) {
        assert.ok(record.historyModal.modal.right > record.historyModal.viewport.right + 40,
          `横屏下历史记录弹窗应横向突破视窗（modal.right=${record.historyModal.modal.right} vs viewport.right=${record.historyModal.viewport.right}）`);
        assert.ok(record.historyModal.modal.bottom <= record.historyModal.viewport.bottom + 2,
          `横屏下不应纵向突破（modal.bottom=${record.historyModal.modal.bottom} vs viewport.bottom=${record.historyModal.viewport.bottom}）`);
      } else {
        assert.ok(record.historyModal.modal.bottom > record.historyModal.viewport.bottom + 20,
          `竖屏下历史记录弹窗应纵向突破视窗（modal.bottom=${record.historyModal.modal.bottom} vs viewport.bottom=${record.historyModal.viewport.bottom}）`);
      }
      if (style === 0) {
        // 古风标题牌（水墨笔触2底）不应被拉伸到整行，且反白字带黑色描边
        assert.ok(record.historyModal.contentWidth > 0 && record.historyModal.titleWidth < record.historyModal.contentWidth * 0.6,
          `古风标题不应被拉伸到整行（title=${record.historyModal.titleWidth} vs content=${record.historyModal.contentWidth}）`);
        assert.equal(record.historyModal.titleAlignSelf, 'flex-start', `古风标题应 flex-start（align-self=${record.historyModal.titleAlignSelf}）`);
        assert.ok(record.historyModal.titleStroke && !record.historyModal.titleStroke.startsWith('0px'),
          `古风标题应有黑色描边（stroke=${record.historyModal.titleStroke}）`);
      }
      await page.screenshot({ path: path.join(directory, `${label}-history.png`) });
      await page.evaluate(() => closeHistorySummaryModal());

      /* ---------- 9. 3D 场景（仅竖屏古风用例）：镜头归位按钮在齿轮上方 ---------- */
      if (!landscape && style === 0) {
        await page.evaluate(() => GameSceneBridge.setPreference({ enabled: true }));
        await waitForLatestApplied(page, 'main', 120000);
        await sleep(400);
        await page.mouse.move(2, 2);
        record.scene3d = await page.evaluate(() => {
          const round = value => Math.round(value * 10) / 10;
          const reset = document.querySelector('.scene3d-reset');
          const gear = document.getElementById('viewport-dock-gear');
          const viewport = document.getElementById('main-viewport');
          const r = reset.getBoundingClientRect(), g = gear.getBoundingClientRect(), vp = viewport.getBoundingClientRect();
          const rs = getComputedStyle(reset), gs = getComputedStyle(gear);
          const hit = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2);
          return {
            reset: { rightGap: round(vp.right - r.right), bottomGap: round(vp.bottom - r.bottom), width: round(r.width), height: round(r.height) },
            gear: { rightGap: round(vp.right - g.right), bottomGap: round(vp.bottom - g.bottom), width: round(g.width), height: round(g.height) },
            resetBackground: rs.backgroundColor, gearBackground: gs.backgroundColor,
            resetRadius: rs.borderRadius, gearRadius: gs.borderRadius,
            gearHit: !!hit.closest('#viewport-dock')
          };
        });
        assert.ok(record.scene3d.reset.bottomGap > record.scene3d.gear.bottomGap + record.scene3d.gear.height,
          `镜头归位按钮必须在齿轮上方（reset.bottomGap=${record.scene3d.reset.bottomGap} gear.bottomGap=${record.scene3d.gear.bottomGap}）`);
        assert.ok(Math.abs(record.scene3d.reset.rightGap - record.scene3d.gear.rightGap) < 1.5, '两者右对齐');
        assert.equal(record.scene3d.gearBackground, record.scene3d.resetBackground, '齿轮与镜头归位按钮底色一致');
        assert.equal(record.scene3d.gearRadius, record.scene3d.resetRadius, '齿轮与镜头归位按钮圆角一致');
        assert.equal(record.scene3d.gearHit, true, '3D 场景下齿轮可点击（未被画布/悬浮层遮挡）');
        await page.screenshot({ path: path.join(directory, `${label}-3d.png`) });
      }

      assert.deepEqual(session.logs.filter(log => log.type === 'pageerror'), [], 'Uncaught host error');
      record.status = 'PASS';
    } catch (error) {
      record.status = 'FAIL';
      record.error = error.stack;
      try { await page.screenshot({ path: path.join(directory, `${label}-FAIL.png`) }); } catch { /* page may be gone */ }
    } finally {
      results.push(record);
      await save('results.json', results);
      await session.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(results.map(({ label, status, error }) => ({ label, status, error })), null, 2));
if (results.some(record => record.status === 'FAIL')) process.exitCode = 1;
