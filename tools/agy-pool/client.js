'use strict';

let state = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function badge(profile) {
  if (profile.authState === 'credential-present') {
    return '<span class="badge ok">Credential detected</span>';
  }
  return '<span class="badge warn">Login required</span>';
}

function render() {
  const root = document.getElementById('profiles');
  root.innerHTML = state.profiles
    .map(
      (profile) => `
      <article class="card">
        <div class="row"><h2>${escapeHtml(profile.label)}</h2>${badge(profile)}</div>
        <div class="meta">${escapeHtml(profile.id)}</div>
        <div class="path">${escapeHtml(profile.home)}</div>
        <div class="runtime">${
          profile.runtime
            ? `Opened ${escapeHtml(profile.runtime.mode)} · PID ${escapeHtml(profile.runtime.pid)}`
            : 'No terminal launched in this pool-manager run'
        }</div>
        <div class="actions">
          <button data-id="${profile.id}" data-action="login">Open login</button>
          <button class="secondary" data-id="${profile.id}" data-action="open">Open Agy</button>
        </div>
      </article>`
    )
    .join('');
}

async function refresh() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  state = await response.json();
  document.getElementById('workspace').textContent = state.workspace;
  render();
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || !state) return;
  button.disabled = true;
  const profileId = button.dataset.id;
  const action = button.dataset.action;
  try {
    const response = await fetch(`/api/profiles/${profileId}/${action}`, {
      method: 'POST',
      headers: { 'X-Shipde-Action-Token': state.actionToken },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Launch failed');
    await refresh();
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('refresh').addEventListener('click', refresh);
refresh();
