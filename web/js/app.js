let projectToDelete = null;
let currentTagFilter = null;
let draggedRow = null;
let availableTags = [];
let cachedProjects = []; // Projeleri anlık düzenleme için bellekte tutuyoruz

document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    setInterval(updateStatuses, 2000);
    connectWebSocket();
    initTagAutocomplete('projTag', 'tagDropdown'); // Add modal için
    initTagAutocomplete('editProjTag', 'editTagDropdown'); // Edit modal için
});

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("API error");
        
        const projects = await response.json();
        cachedProjects = projects; // Belleğe al
        
        renderSidebarTags(projects);

        const tbody = document.getElementById('project-list');
        tbody.innerHTML = '';

        const filteredProjects = currentTagFilter 
            ? projects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase())
            : projects;

        if (filteredProjects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">No projects found.</td></tr>`;
            return;
        }

        filteredProjects.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-700/50 hover:bg-gray-750 transition-colors group bg-gray-800/20';
            tr.setAttribute('draggable', 'true');
            tr.dataset.id = p.id;
            
            tr.addEventListener('dragstart', handleDragStart);
            tr.addEventListener('dragover', handleDragOver);
            tr.addEventListener('dragenter', handleDragEnter);
            tr.addEventListener('dragleave', handleDragLeave);
            tr.addEventListener('drop', handleDrop);
            tr.addEventListener('dragend', handleDragEnd);
            
            const tagBadge = p.tag ? `<span class="ml-3 px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-[10px] uppercase tracking-wider rounded border border-indigo-500/30">${p.tag}</span>` : '';

            tr.innerHTML = `
                <td class="p-5 font-medium text-gray-200 flex items-center gap-3">
                    <div class="cursor-grab text-gray-600 hover:text-gray-400 mr-1" title="Drag to reorder">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
                    </div>
                    <div class="h-8 w-8 rounded bg-gray-700 flex items-center justify-center text-indigo-400 font-bold group-hover:bg-indigo-500/20 transition-colors">
                        ${p.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex flex-col">
                        <div class="flex items-center">${p.name} ${tagBadge}</div>
                    </div>
                </td>
                <td class="p-5 text-sm text-gray-400 font-mono text-xs truncate max-w-xs" title="${p.path}">
                    ${p.path}
                </td>
                <td class="p-5">
                    <span id="status-${p.id}" class="px-3 py-1 bg-gray-600/30 text-gray-400 text-xs rounded-full border border-gray-500/30 font-medium">Loading...</span>
                </td>
                <td class="p-5">
                    <div id="stats-${p.id}" class="text-xs text-gray-500 font-mono flex flex-col gap-1">
                        <span>CPU: --</span>
                        <span>RAM: --</span>
                    </div>
                </td>
                <td class="p-5 text-right space-x-2">
                    <button onclick="startProject('${p.id}')" class="btn-action bg-emerald-600/90 hover:bg-emerald-500 text-white px-3 py-1.5 rounded shadow-lg text-xs font-medium">Start</button>
                    <button onclick="stopProject('${p.id}')" class="btn-action bg-rose-600/90 hover:bg-rose-500 text-white px-3 py-1.5 rounded shadow-lg text-xs font-medium">Stop</button>
                    
                    <button onclick="openEditModal('${p.id}')" class="btn-action bg-gray-700 hover:bg-indigo-600 text-gray-300 hover:text-white p-1.5 rounded transition-colors" title="Edit Project">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </button>

                    <button onclick="openDeleteModal('${p.id}')" class="btn-action bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white p-1.5 rounded transition-colors" title="Delete Project">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        updateStatuses();
    } catch (error) {
        console.error("Load error:", error);
    }
}

/* =========================================
   DRAG & DROP LOGIC
========================================= */

function handleDragStart(e) {
    draggedRow = this;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.classList.add('opacity-50'), 0);
}

function handleDragOver(e) {
    e.preventDefault();
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedRow) this.classList.add('border-t-2', 'border-indigo-500');
}

function handleDragLeave() {
    this.classList.remove('border-t-2', 'border-indigo-500');
}

function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('border-t-2', 'border-indigo-500');
    if (draggedRow !== this) {
        const tbody = document.getElementById('project-list');
        const rows = Array.from(tbody.children);
        const draggedIndex = rows.indexOf(draggedRow);
        const droppedIndex = rows.indexOf(this);
        if (draggedIndex < droppedIndex) this.parentNode.insertBefore(draggedRow, this.nextSibling);
        else this.parentNode.insertBefore(draggedRow, this);
        saveNewOrder();
    }
    return false;
}

function handleDragEnd() {
    this.classList.remove('opacity-50');
    document.querySelectorAll('#project-list tr').forEach(r => r.classList.remove('border-t-2', 'border-indigo-500'));
}

async function saveNewOrder() {
    const tbody = document.getElementById('project-list');
    const newOrderIDs = Array.from(tbody.children).map(tr => tr.dataset.id);
    await fetch('/api/projects/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrderIDs)
    });
}

/* =========================================
   SIDEBAR & TAGS
========================================= */

function toggleBoard() {
    const list = document.getElementById('tag-list');
    const chevron = document.getElementById('board-chevron');
    list.classList.toggle('hidden');
    chevron.classList.toggle('rotate-180');
}

function setFilter(tag) {
    currentTagFilter = tag;
    loadProjects();
    document.querySelectorAll('.tag-filter-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30');
        btn.classList.add('text-gray-400', 'hover:bg-gray-700/30');
    });
    const activeId = tag === null ? 'btn-filter-all' : `btn-filter-${tag}`;
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) {
        activeBtn.classList.add('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30');
        activeBtn.classList.remove('text-gray-400', 'hover:bg-gray-700/30');
    }
}

function renderSidebarTags(projects) {
    projects.sort((a, b) => (a.order || 0) - (b.order || 0));
    availableTags = [...new Set(projects.map(p => p.tag).filter(t => t && t.trim() !== ''))];
    const tagList = document.getElementById('tag-list');
    if (!tagList) return;
    tagList.innerHTML = `<button id="btn-filter-all" onclick="setFilter(null)" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border ${currentTagFilter === null ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'border-transparent text-gray-400 hover:bg-gray-700/30'}">All Projects</button>`;
    availableTags.forEach(tag => {
        const isActive = currentTagFilter === tag;
        tagList.innerHTML += `<button id="btn-filter-${tag}" onclick="setFilter('${tag}')" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border ${isActive ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'border-transparent text-gray-400 hover:bg-gray-700/30'}"># ${tag}</button>`;
    });
}

/* =========================================
   YENİ: EDIT PROJECT LOGIC
========================================= */

function openEditModal(id) {
    const project = cachedProjects.find(p => p.id === id);
    if (!project) return;

    document.getElementById('editProjId').value = project.id;
    document.getElementById('editProjName').value = project.name;
    document.getElementById('editProjPath').value = project.path;
    document.getElementById('editProjCmd').value = project.command || '';
    document.getElementById('editProjTag').value = project.tag || '';
    document.getElementById('editProjInteractive').checked = project.interactive;

    const modal = document.getElementById('editModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function submitEditProject(event) {
    event.preventDefault();
    const updatedProject = {
        id: document.getElementById('editProjId').value,
        name: document.getElementById('editProjName').value,
        path: document.getElementById('editProjPath').value,
        command: document.getElementById('editProjCmd').value,
        tag: document.getElementById('editProjTag').value,
        interactive: document.getElementById('editProjInteractive').checked
    };

    try {
        const response = await fetch('/api/projects/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedProject)
        });

        if (response.ok) {
            closeEditModal();
            loadProjects(); // Tabloyu ve Tagleri yenile
        } else {
            const err = await response.json();
            alert("Update failed: " + err.error);
        }
    } catch (e) {
        console.error("Update error:", e);
    }
}

/* =========================================
   PREMIUM AUTOCOMPLETE
========================================= */

function initTagAutocomplete(inputId, dropdownId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    input.addEventListener('focus', () => update(input.value));
    input.addEventListener('input', (e) => update(e.target.value));
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));

    function update(text) {
        const filtered = availableTags.filter(t => t.toLowerCase().includes(text.toLowerCase()));
        if (filtered.length === 0) { dropdown.classList.add('hidden'); return; }
        dropdown.innerHTML = '';
        filtered.forEach(tag => {
            const div = document.createElement('div');
            div.className = 'px-4 py-2 text-sm text-gray-300 hover:bg-indigo-600 hover:text-white cursor-pointer';
            div.textContent = tag;
            div.onmousedown = (e) => { e.preventDefault(); input.value = tag; dropdown.classList.add('hidden'); };
            dropdown.appendChild(div);
        });
        dropdown.classList.remove('hidden');
    }
}

/* =========================================
   CORE API & STATUS
========================================= */

async function updateStatuses() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) return;
        const projects = await response.json();
        cachedProjects = projects; // Cache'i her saniye güncelle

        projects.forEach(p => {
            const badge = document.getElementById('status-' + p.id);
            const stats = document.getElementById('stats-' + p.id);
            if (!badge) return;

            if (p.status === 'running') {
                badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-medium shadow-[0_0_10px_rgba(16,185,129,0.2)]';
                badge.innerText = 'Running';
                if (stats && p.cpu !== undefined) {
                    stats.innerHTML = `<span class="text-indigo-400">CPU: ${p.cpu.toFixed(1)}%</span><span class="text-emerald-400">RAM: ${p.ram.toFixed(1)} MB</span>`;
                }
            } else {
                badge.className = 'px-3 py-1 bg-gray-600/30 text-gray-400 text-xs rounded-full border border-gray-500/30 font-medium';
                badge.innerText = 'Stopped';
                if (stats) stats.innerHTML = `<span class="text-gray-600">CPU: --</span><span class="text-gray-600">RAM: --</span>`;
            }
        });
    } catch (e) {}
}

async function startProject(id) { await fetch(`/api/projects/start?id=${id}`, { method: 'POST' }); updateStatuses(); }
async function stopProject(id) { await fetch(`/api/projects/stop?id=${id}`, { method: 'POST' }); updateStatuses(); }

function openModal() { document.getElementById('addModal').classList.replace('hidden', 'flex'); }
function closeModal() { document.getElementById('addModal').classList.replace('flex', 'hidden'); document.getElementById('addForm').reset(); }

async function submitNewProject(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('projName').value,
        path: document.getElementById('projPath').value,
        command: document.getElementById('projCmd').value,
        tag: document.getElementById('projTag').value,
        interactive: document.getElementById('projInteractive').checked
    };
    const res = await fetch('/api/projects/add', { method: 'POST', body: JSON.stringify(data) });
    if (res.ok) { closeModal(); loadProjects(); }
}

function openDeleteModal(id) { projectToDelete = id; document.getElementById('deleteModal').classList.replace('hidden', 'flex'); document.getElementById('confirmDeleteBtn').onclick = executeDelete; }
function closeDeleteModal() { document.getElementById('deleteModal').classList.replace('flex', 'hidden'); }
async function executeDelete() { await fetch(`/api/projects/delete?id=${projectToDelete}`, { method: 'DELETE' }); closeDeleteModal(); loadProjects(); }

const terminalOutput = document.getElementById('terminal-output');
function connectWebSocket() {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    socket.onmessage = (e) => appendLog(e.data);
    socket.onclose = () => setTimeout(connectWebSocket, 3000);
}
function appendLog(msg) {
    const lines = msg.split('\n');
    lines.forEach(l => {
        if (!l.trim()) return;
        const d = document.createElement('div'); d.className = 'text-green-400'; d.textContent = l;
        terminalOutput.appendChild(d);
    });
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}
function clearTerminal() { terminalOutput.innerHTML = ''; }