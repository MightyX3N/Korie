// The Korie page in Jellyfin's dashboard: installed add-ons, the Store and repositories.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function call(method, path, body) {
    return ApiClient.ajax({
        type: method,
        url: ApiClient.getUrl('Korie/' + path),
        data: body === undefined ? undefined : JSON.stringify(body),
        contentType: 'application/json',
        dataType: 'json'
    });
}

function toast(text) {
    if (window.Dashboard && Dashboard.alert) Dashboard.alert({ message: text });
    else alert(text);
}

function setting(a, s) {
    const key = esc(s.key);
    const value = a.values?.[s.key];
    const label = esc(s.label || s.key);
    const help = s.help ? `<div class="fieldDescription">${esc(s.help)}</div>` : '';
    if (s.type === 'list') {
        return `<div class="inputContainer"><label class="inputLabel">${label} (one per line)</label>
            <textarea data-key="${key}" data-list="1">${esc((value || []).join('\n'))}</textarea>${help}</div>`;
    }
    const type = s.type === 'password' ? 'password' : 'text';
    return `<div class="inputContainer"><label class="inputLabel">${label}</label>
        <input is="emby-input" type="${type}" data-key="${key}" value="${esc(value)}" placeholder="${type === 'password' && value ? 'Unchanged' : ''}"/>${help}</div>`;
}

function installedCard(a) {
    const notes = [];
    if (a.update) notes.push(`<div class="korie-note">Version ${esc(a.update)} is in the Store.</div>`);
    if (a.enabled && a.restartNeeded) notes.push('<div class="korie-note">Restart Jellyfin (Dashboard → Restart) to show this add-on as a channel.</div>');
    return `<div class="korie-card" data-id="${esc(a.id)}">
        <div class="korie-head">
            <h3>${esc(a.name)} <span class="korie-dim">${esc(a.version)}</span></h3>
            ${a.update ? '<button is="emby-button" type="button" class="raised emby-button" data-act="install">Update</button>' : ''}
            <button is="emby-button" type="button" class="raised emby-button" data-act="${a.enabled ? 'disable' : 'enable'}">${a.enabled ? 'Turn off' : 'Turn on'}</button>
            <button is="emby-button" type="button" class="raised emby-button" data-act="remove">Remove</button>
        </div>
        <p class="korie-dim">${esc(a.description)}</p>
        ${a.needsInternet ? `<p class="korie-dim">Fetches from: ${a.hosts.map(esc).join(', ') || 'the addresses in its settings'}</p>` : ''}
        ${notes.join('')}
        ${a.settings.length ? `<div style="margin-top: 1em">${a.settings.map((s) => setting(a, s)).join('')}
            <button is="emby-button" type="button" class="raised button-submit emby-button" data-act="save"><span>Save settings</span></button></div>` : ''}
        ${a.log.length ? `<details style="margin-top: 1em"><summary class="korie-dim">Log</summary><div class="korie-log">${a.log.map(esc).join('\n')}</div></details>` : ''}
    </div>`;
}

function storeCard(e) {
    const state = e.installed ? (e.installed === e.version ? 'Installed' : `Installed ${esc(e.installed)}`) : '';
    return `<div class="korie-card" data-id="${esc(e.id)}">
        <div class="korie-head">
            <h3>${esc(e.name || e.id)} <span class="korie-dim">${esc(e.version)}</span></h3>
            ${state ? `<span class="korie-dim">${state}</span>` : ''}
            ${!e.installed || e.installed !== e.version ? `<button is="emby-button" type="button" class="raised button-submit emby-button" data-act="install">${e.installed ? 'Update' : 'Install'}</button>` : ''}
        </div>
        <p class="korie-dim">${esc(e.description)}</p>
        <p class="korie-dim">By ${esc(e.author || 'unknown')} · from ${esc(e.repository)}</p>
    </div>`;
}

export default function (view) {
    const panel = (name) => view.querySelector(`[data-panel="${name}"]`);

    async function showInstalled() {
        const r = await call('GET', 'Addons');
        panel('installed').innerHTML = r.addons.length
            ? r.addons.map(installedCard).join('')
            : '<div class="korie-card"><p>No add-ons yet. Get some in the Store.</p></div>';
    }

    async function showStore(refresh) {
        panel('store').innerHTML = '<div class="korie-card"><p class="korie-dim">Loading the Store…</p></div>';
        const r = await call('GET', 'Store' + (refresh ? '?refresh=true' : ''));
        panel('store').innerHTML = r.errors.map((x) => `<div class="korie-error">${esc(x)}</div>`).join('')
            + (r.addons.length ? r.addons.map(storeCard).join('') : '<div class="korie-card"><p>The repositories have no add-ons.</p></div>');
        view.querySelector('#korieRepos').value = r.repositories.join('\n');
    }

    async function act(card, what) {
        const id = card.dataset.id;
        Dashboard.showLoadingMsg();
        try {
            let r;
            if (what === 'install') r = await call('POST', `Store/${encodeURIComponent(id)}/Install`);
            else if (what === 'remove') {
                if (!confirm('Remove this add-on?')) return;
                r = await call('POST', `Addons/${encodeURIComponent(id)}/Remove`);
            } else if (what === 'disable') r = await call('POST', `Addons/${encodeURIComponent(id)}/Disable`);
            else if (what === 'enable') {
                r = await call('POST', `Addons/${encodeURIComponent(id)}/Enable`);
                if (r.error === 'needs_internet') {
                    const hosts = card.querySelector('.korie-dim + .korie-dim')?.textContent || '';
                    if (!confirm(`This add-on fetches things from the internet. ${hosts}\n\nAllow it?`)) return;
                    r = await call('POST', `Addons/${encodeURIComponent(id)}/Enable?internet=true`);
                }
            } else if (what === 'save') {
                for (const el of card.querySelectorAll('[data-key]')) {
                    const isPassword = el.type === 'password';
                    if (isPassword && el.value === '••••••••') continue;
                    const value = el.dataset.list ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : el.value;
                    const s = await call('POST', `Addons/${encodeURIComponent(id)}/Settings`, { key: el.dataset.key, value });
                    if (!s.ok) throw new Error(s.error);
                }
                r = { ok: true };
                toast('Saved.');
            }
            if (r && r.ok === false && r.error) toast(r.error);
            else if (what === 'install' && r.restartNeeded) toast('Installed. Turn it on under Installed, then restart Jellyfin to show it as a channel.');
            await showInstalled();
            if (what === 'install') await showStore(false);
        } catch (e) {
            toast(e?.message || 'That didn\'t work.');
        } finally {
            Dashboard.hideLoadingMsg();
        }
    }

    view.addEventListener('click', (ev) => {
        const tab = ev.target.closest('[data-tab]');
        if (tab) {
            view.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === tab));
            view.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hide', p.dataset.panel !== tab.dataset.tab));
            if (tab.dataset.tab === 'store') showStore(false);
            return;
        }
        const btn = ev.target.closest('[data-act]');
        if (btn) act(btn.closest('[data-id]'), btn.dataset.act);
    });

    view.querySelector('#korieSaveRepos').addEventListener('click', async () => {
        const repositories = view.querySelector('#korieRepos').value.split('\n').map((x) => x.trim()).filter(Boolean);
        await call('POST', 'Repositories', { repositories });
        toast('Saved.');
        await showStore(true);
    });

    view.addEventListener('viewshow', () => {
        showInstalled();
        showStore(false);
    });
}
