/* Same viewport host and skins as the skill library and trading panel. Opening
   a folio never changes location, advances a page, or tears down scene layers. */
function openProfileFolio(id) {
    const panel = document.getElementById(id);
    const opener = document.activeElement;
    if (document.body.classList.contains('layout-landscape')) toggleViewportDock(false);
    const api = DialogPanel.mount(panel);
    if (!panel.dataset.bound) {
        panel.dataset.bound = '1';
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape' && panel.querySelector('#folio-bio:not([hidden])')) {
                event.preventDefault(); event.stopImmediatePropagation();
                panel.querySelector('#folio-list-back').click();
            }
        }, true);
        panel.addEventListener('click', e => {
            const page = e.target.closest('[data-page]');
            if (page) selectProfilePage(panel, page.dataset.page);
            const tier = e.target.closest('[data-tier]');
            if (tier) {
                const key = tier.dataset.tier;
                const hint = panel.querySelector('#folio-tier');
                hint.textContent = key + ' · ' + getAttributeTierText(key, playerTalents[key] ?? playerStats[key]);
                hint.hidden = false;
                hint.scrollIntoView({block:'nearest'});
            }
        });
    }
    if (id === 'player-stats-scene') {
        updateStatsDisplay();
        selectProfilePage(panel, 'person');
    } else {
        panel.querySelector('#folio-bio').hidden = true;
        const grid = panel.querySelector('#relationship-grid');
        grid.hidden = false;
        updateRelationshipsDisplay();
        grid.scrollTop = 0;
    }
    api.open(opener);
    panel.querySelector('[data-dialog-close]').focus({preventScroll:true});
}

function selectProfilePage(panel, page) {
    const combat = page === 'combat';
    panel.querySelector('#folio-person').hidden = combat;
    panel.querySelector('#folio-combat').hidden = !combat;
    panel.querySelector('#folio-points').hidden = !combat;
    panel.querySelector('#folio-tier').hidden = true;
    panel.querySelectorAll('[data-page]').forEach(b => b.setAttribute('aria-pressed', b.dataset.page === page));
    panel.querySelector('.folio-scroll').scrollTop = 0;
}

function updateRelationshipsDisplay() {
    const grid = document.getElementById('relationship-grid');
    const fragment = document.createDocumentFragment();
    for (const [id, npc] of Object.entries(npcs)) {
        const card = document.createElement('article');
        card.className = 'folio-card';
        card.innerHTML = `<button type="button" class="folio-npc"><img alt=""><span><strong></strong><i class="folio-track"><i></i></i><small></small></span></button><label><input type="checkbox">出场</label>`;
        const button = card.querySelector('button'), check = card.querySelector('input');
        button.querySelector('img').src = npcPortraits[id];
        button.querySelector('strong').textContent = npc.name;
        button.querySelector('small').textContent = '好感度：' + npcFavorability[id];
        button.querySelector('.folio-track i').style.width = Math.max(0, Math.min(100, npcFavorability[id])) + '%';
        check.id = 'visibility-' + id;
        check.checked = !!npcVisibility[id];
        check.onchange = () => toggleNpcVisibility(id);
        button.onclick = () => {
            const bio = document.getElementById('folio-bio'), back = document.getElementById('folio-list-back');
            const offset = grid.scrollTop;
            bio.querySelector('h3').textContent = npc.name;
            bio.querySelector('p').textContent = npc.description;
            grid.hidden = true; bio.hidden = false;
            bio.querySelector('.dialog-detail-body').scrollTop = 0;
            back.focus({preventScroll:true});
            back.onclick = () => { bio.hidden = true; grid.hidden = false; grid.scrollTop = offset; button.focus({preventScroll:true}); };
        };
        fragment.append(card);
    }
    grid.replaceChildren(fragment);
}
