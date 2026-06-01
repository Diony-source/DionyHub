let projectToDelete = null;
let currentTagFilter = null;
let draggedRow = null;
let availableTags = [];
let cachedProjects = [];

let globalWorkspace = "C:/DionyHub/apps";
const MAX_LOG_LINES = 1000;

let logBuffer = [];
let logFlushInterval = null;

document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    loadSettings();
    setInterval(updateStatuses, 2000);
    connectWebSocket();
    initTagAutocomplete('projTag', 'tagDropdown'); 
    initTagAutocomplete('editProjTag', 'editTagDropdown'); 
    switchView('dashboard');
    
    // YENİ: Havuzu her 30 milisaniyede (Saniyede ~33 kare - FPS) bir boşalt. 
    // Bu terminalin "takılması" hissini tamamen ortadan kaldırır.
    logFlushInterval = setInterval(flushLogBuffer, 30);
});

function formatWorkspacePath(path) {
    const maxLength = 22; 
    let cleanPath = path.replace(/\\/g, '/');
    if (!cleanPath.endsWith('/')) cleanPath += '/';
    if (cleanPath.length <= maxLength) return cleanPath;
    const startPart = cleanPath.substring(0, 3);
    const endPartLength = maxLength - startPart.length - 3; 
    const endPart = cleanPath.substring(cleanPath.length - endPartLength);
    return startPart + '...' + endPart;
}

function toggleButtonLoading(btn, isLoading, originalContent = '') {
    if (!btn) return originalContent;
    if (isLoading) {
        const currentContent = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = `<svg class="animate-spin h-4 w-4 mx-auto inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
        return currentContent;
    } else {
        btn.disabled = false;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        btn.innerHTML = originalContent;
        return '';
    }
}

function switchView(viewName) {
    const dashboardView = document.getElementById('dashboard-view');
    const settingsView = document.getElementById('settings-view');
    const viewTitle = document.getElementById('view-title');
    const addBtn = document.getElementById('header-add-btn');
    const navDashboard = document.getElementById('nav-dashboard');
    const navSettings = document.getElementById('nav-settings');

    if (viewName === 'dashboard') {
        if (!dashboardView.classList.contains('hidden')) toggleBoard();
        dashboardView.classList.remove('hidden');
        settingsView.classList.add('hidden');
        viewTitle.innerText = "Active Library";
        addBtn.classList.remove('hidden');

        navDashboard.className = "w-full flex items-center justify-between px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-md text-white font-medium shadow-inner transition-colors";
        navSettings.className = "w-full flex items-center gap-2 px-4 py-2 text-gray-400 hover:bg-gray-700/30 hover:text-white rounded-md transition-colors border border-transparent font-medium text-left";
    } else if (viewName === 'settings') {
        dashboardView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        viewTitle.innerText = "System Settings";
        addBtn.classList.add('hidden');

        navDashboard.className = "w-full flex items-center justify-between px-4 py-2 text-gray-400 hover:bg-gray-700/30 hover:text-white rounded-md transition-colors border border-transparent font-medium";
        navSettings.className = "w-full flex items-center gap-2 px-4 py-2 bg-gray-700/50 border border-gray-600 text-white rounded-md transition-colors font-medium text-left shadow-inner";
    }
}

// ... (Mevcut kodların aynen kalıyor) ...

function toggleWorkspaceMode() {
    const useWs = document.getElementById('useWorkspace').checked;
    const prefix = document.getElementById('workspacePrefix');
    const input = document.getElementById('projPath');

    if(useWs) {
        prefix.classList.remove('hidden');
        input.classList.remove('rounded-l-md');
        input.classList.add('border-l-0'); // prefix varken sol borderı sil
        const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/');
        prefix.title = formattedWs; 
        prefix.innerText = formatWorkspacePath(globalWorkspace);
        input.placeholder = "folder_name";
    } else {
        prefix.classList.add('hidden');
        input.classList.add('rounded-l-md');
        input.classList.remove('border-l-0');
        input.placeholder = "C:/Users/Diony/Desktop/bot";
    }
}

// YENİ: Yerel Bilgisayardan Klasör Seçme Fonksiyonu
async function browseFolder(inputId, handleWorkspace = true) {
    try {
        const res = await fetch('/api/system/browse');
        const data = await res.json();
        
        if (data.path && data.path !== "") {
            document.getElementById(inputId).value = data.path;
            
            // Eğer "Add Project" ekranındaysak ve tam yol seçilmişse, "Use Workspace" kilidini mantıken kapat
            if (handleWorkspace) {
                const wsCheckbox = document.getElementById('useWorkspace');
                if (wsCheckbox.checked) {
                    wsCheckbox.checked = false;
                    toggleWorkspaceMode();
                }
            }
        }
    } catch (e) {
        showToast("Failed to open native folder picker.", "error");
    }
}

function toggleSourceMode() {
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    const localWrapper = document.getElementById('localFlowWrapper');
    const githubWrapper = document.getElementById('githubFlowWrapper');
    
    const projName = document.getElementById('projName');
    const projPath = document.getElementById('projPath');
    const repoUrl = document.getElementById('repoUrl');

    if (mode === 'local') {
        localWrapper.classList.remove('hidden');
        githubWrapper.classList.add('hidden');
        projName.required = true;
        projPath.required = true;
        repoUrl.required = false;
    } else {
        localWrapper.classList.add('hidden');
        githubWrapper.classList.remove('hidden');
        projName.required = false;
        projPath.required = false;
        repoUrl.required = true;
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            globalWorkspace = settings.workspace || 'C:/DionyHub/apps';
            document.getElementById('setting-workspace').value = globalWorkspace;
            
            if (settings.global_env) {
                document.getElementById('setting-global-env').value = settings.global_env;
            }
            
            toggleWorkspaceMode(); 
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

async function saveSettings() {
    const btn = document.getElementById('save-settings-btn');
    const originalHTML = toggleButtonLoading(btn, true);

    globalWorkspace = document.getElementById('setting-workspace').value;
    const globalEnv = document.getElementById('setting-global-env').value;
    
    const newSettings = {
        workspace: globalWorkspace,
        log_buffer: true,
        global_env: globalEnv
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSettings)
        });

        if (response.ok) {
            showToast("System settings and Global ENV applied successfully.", "success");
            toggleWorkspaceMode(); 
        } else {
            const err = await response.json();
            showToast(err.error, "error");
        }
    } catch (e) {
        showToast("Server error during save.", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-500/10 border-red-500/50 text-red-400' : 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400';
    const icon = type === 'error'
        ? `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
        : `<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;

    toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-md shadow-2xl transform transition-all duration-300 translate-x-full opacity-0 pointer-events-auto ${bgColor}`;
    toast.innerHTML = `${icon} <span class="text-sm font-medium drop-shadow-md">${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => toast.classList.remove('translate-x-full', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function executeBulkAction(action) {
    if (!currentTagFilter) return; 
    
    const filteredProjects = cachedProjects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase());
    const idsToProcess = filteredProjects.map(p => p.id);
    
    if (idsToProcess.length === 0) {
        showToast("No projects found in this tag.", "error");
        return;
    }

    const endpoint = action === 'start' ? '/api/projects/start-bulk' : '/api/projects/stop-bulk';
    showToast(`${action === 'start' ? 'Starting' : 'Stopping'} ${idsToProcess.length} projects...`, "success");

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(idsToProcess)
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, "success");
            updateStatuses();
        } else {
            showToast(data.error || `Bulk ${action} failed`, "error");
        }
    } catch (e) {
        showToast("Network error during bulk action", "error");
    }
}

async function backupProject(id, btn) {
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/backup?id=${id}`, { method: 'POST' });
        const data = await res.json();
        
        if (res.ok) {
            showToast(data.message, "success");
        } else {
            showToast(data.error || "Backup failed", "error");
        }
    } catch (e) {
        showToast("Network error during backup", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

async function openEnvModal(id) {
    const project = cachedProjects.find(p => p.id === id);
    if (!project) return;
    
    document.getElementById('envProjId').value = project.id;
    const textArea = document.getElementById('envContent');
    textArea.value = "Loading...";

    const modal = document.getElementById('envModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const res = await fetch(`/api/projects/env?id=${id}`);
        if (res.ok) {
            const data = await res.json();
            textArea.value = data.content;
        } else {
            textArea.value = "";
            showToast("Failed to load .env. You can create a new one.", "error");
        }
    } catch (err) {
        textArea.value = "";
        showToast("Network error while loading .env", "error");
    }
}

function closeEnvModal() { 
    document.getElementById('envModal').classList.add('hidden'); 
    document.getElementById('envForm').reset();
}

async function submitEnv(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalHTML = toggleButtonLoading(btn, true);

    const id = document.getElementById('envProjId').value;
    const content = document.getElementById('envContent').value;

    try {
        const res = await fetch(`/api/projects/env?id=${id}`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        });
        
        if (res.ok) { 
            closeEnvModal(); 
            showToast(".env saved securely to disk!", "success");
        } else {
            const err = await res.json();
            showToast(err.error, "error");
        }
    } catch (err) {
        showToast("Server connection failed.", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("API error");
        
        const projects = await response.json();
        cachedProjects = projects;
        
        renderSidebarTags(projects);

        const tbody = document.getElementById('project-list');
        if (!tbody) return;
        tbody.innerHTML = '';

        const filteredProjects = currentTagFilter 
            ? projects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase())
            : projects;

        const bulkContainer = document.getElementById('bulk-actions-container');
        if (bulkContainer) {
            if (currentTagFilter !== null) {
                document.getElementById('bulk-tag-name').innerHTML = `<span class="text-indigo-500 font-bold opacity-75">#</span> ${currentTagFilter}`;
                document.getElementById('bulk-project-count').innerText = `${filteredProjects.length} project(s)`;
                bulkContainer.classList.remove('hidden');
                bulkContainer.classList.add('flex');
            } else {
                bulkContainer.classList.add('hidden');
                bulkContainer.classList.remove('flex');
            }
        }

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
            
            const tagBadge = p.tag ? `<span class="ml-3 inline-flex items-center gap-1 px-2.5 py-0.5 bg-gray-800 text-indigo-300 text-xs font-medium rounded-full border border-indigo-500/30 shadow-sm whitespace-nowrap"><span class="text-indigo-500 opacity-80 font-bold">#</span>${p.tag}</span>` : '';
            
            const autoBadge = p.auto_start ? `<span class="ml-2 text-emerald-400 drop-shadow-md" title="Auto-Start Enabled">⚡</span>` : '';
            const watchdogBadge = p.auto_restart ? `<span class="ml-1 text-amber-400 drop-shadow-md" title="Auto-Restart Enabled">🛡️</span>` : '';

            tr.innerHTML = `
                <td class="p-5 font-medium text-gray-200 flex items-center gap-3">
                    <div class="cursor-grab text-gray-600 hover:text-gray-400 mr-1" title="Drag to reorder">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
                    </div>
                    <div class="h-8 w-8 rounded bg-gray-700 flex items-center justify-center text-indigo-400 font-bold group-hover:bg-indigo-500/20 transition-colors shrink-0">
                        ${p.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex flex-col">
                        <div class="flex items-center">${p.name} ${tagBadge} ${autoBadge} ${watchdogBadge}</div>
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
                <td class="p-5">
                    <div class="flex items-center justify-end gap-3 whitespace-nowrap">
                        <div class="flex items-center gap-2 border-r border-gray-700 pr-3">
                            <button onclick="startProject('${p.id}', this)" class="btn-action w-16 bg-emerald-600/90 hover:bg-emerald-500 text-white py-1.5 rounded shadow-lg text-xs font-medium text-center">Start</button>
                            <button onclick="stopProject('${p.id}', this)" class="btn-action w-16 bg-rose-600/90 hover:bg-rose-500 text-white py-1.5 rounded shadow-lg text-xs font-medium text-center">Stop</button>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button onclick="backupProject('${p.id}', this)" class="btn-action bg-gray-700 hover:bg-amber-600 text-gray-300 hover:text-white p-1.5 rounded transition-colors" title="Export as .zip Archive">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            </button>
                            <button onclick="openEnvModal('${p.id}')" class="btn-action bg-gray-700 hover:bg-teal-500 text-gray-300 hover:text-white p-1.5 rounded transition-colors" title="Edit .env Variables">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
                            </button>
                            <button onclick="openEditModal('${p.id}')" class="btn-action bg-gray-700 hover:bg-indigo-600 text-gray-300 hover:text-white p-1.5 rounded transition-colors" title="Edit Project">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                            </button>
                            <button onclick="openDeleteModal('${p.id}')" class="btn-action bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white p-1.5 rounded transition-colors" title="Delete Project">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        updateStatuses();
    } catch (error) {
        showToast("Cannot connect to server.", "error");
    }
}

function handleDragStart(e) { draggedRow = this; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => this.classList.add('opacity-50'), 0); }
function handleDragOver(e) { e.preventDefault(); return false; }
function handleDragEnter(e) { if (this !== draggedRow) this.classList.add('border-t-2', 'border-indigo-500'); }
function handleDragLeave() { this.classList.remove('border-t-2', 'border-indigo-500'); }
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
function handleDragEnd() { this.classList.remove('opacity-50'); document.querySelectorAll('#project-list tr').forEach(r => r.classList.remove('border-t-2', 'border-indigo-500')); }

async function saveNewOrder() {
    const tbody = document.getElementById('project-list');
    const newOrderIDs = Array.from(tbody.children).map(tr => tr.dataset.id);
    const res = await fetch('/api/projects/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newOrderIDs) });
    if(!res.ok) { showToast("Failed to save new order", "error"); loadProjects(); }
}

function toggleBoard() {
    const list = document.getElementById('tag-list');
    const chevron = document.getElementById('board-chevron');
    if(list) list.classList.toggle('hidden');
    if(chevron) chevron.classList.toggle('rotate-180');
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

function openEditModal(id) {
    const project = cachedProjects.find(p => p.id === id);
    if (!project) return;
    document.getElementById('editProjId').value = project.id;
    document.getElementById('editProjName').value = project.name;
    document.getElementById('editProjPath').value = project.path;
    document.getElementById('editProjCmd').value = project.command || '';
    document.getElementById('editProjTag').value = project.tag || '';
    document.getElementById('editProjInteractive').checked = project.interactive;
    document.getElementById('editProjAutoStart').checked = project.auto_start || false;
    document.getElementById('editProjAutoRestart').checked = project.auto_restart || false;

    const modal = document.getElementById('editModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEditModal() { document.getElementById('editModal').classList.add('hidden'); }

async function submitEditProject(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    const originalHTML = toggleButtonLoading(btn, true);

    const updatedProject = {
        id: document.getElementById('editProjId').value,
        name: document.getElementById('editProjName').value,
        path: document.getElementById('editProjPath').value,
        command: document.getElementById('editProjCmd').value,
        tag: document.getElementById('editProjTag').value,
        interactive: document.getElementById('editProjInteractive').checked,
        auto_start: document.getElementById('editProjAutoStart').checked,
        auto_restart: document.getElementById('editProjAutoRestart').checked
    };

    try {
        const response = await fetch('/api/projects/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedProject) });
        if (response.ok) {
            closeEditModal();
            loadProjects(); 
            showToast("Project updated successfully!", "success");
        } else {
            const err = await response.json();
            showToast(err.error, "error");
        }
    } catch (e) {
        showToast("Server error during update", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

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

async function updateStatuses() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) return;
        const projects = await response.json();
        cachedProjects = projects; 

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

async function startProject(id, btn) { 
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/start?id=${id}`, { method: 'POST' }); 
        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || "Failed to start", "error");
        } else {
            showToast("Project started", "success");
        }
        updateStatuses(); 
    } catch (e) {
        console.error("Start Error:", e);
        showToast("Network error", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

async function stopProject(id, btn) { 
    const originalHTML = toggleButtonLoading(btn, true);
    try {
        const res = await fetch(`/api/projects/stop?id=${id}`, { method: 'POST' }); 
        if (!res.ok) {
            const data = await res.json();
            if (!data.error.includes("not currently running")) showToast(data.error || "Failed to stop", "error");
        } else {
            showToast("Project stopped", "success");
        }
        updateStatuses(); 
    } catch (e) {
        console.error("Stop Error:", e);
        showToast("Network error", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

function openModal() { 
    document.getElementById('addModal').classList.replace('hidden', 'flex'); 
    toggleSourceMode(); 
    toggleWorkspaceMode(); 
}
function closeModal() { document.getElementById('addModal').classList.add('hidden'); document.getElementById('addForm').reset(); }

async function submitNewProject(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    
    const loadingText = mode === 'github' ? 'Cloning Repo...' : '';
    const originalHTML = toggleButtonLoading(btn, true, loadingText);

    try {
        if (mode === 'local') {
            let finalPath = document.getElementById('projPath').value.trim();
            const useWs = document.getElementById('useWorkspace').checked;

            if (useWs) {
                const formattedWs = globalWorkspace + (globalWorkspace.endsWith('/') || globalWorkspace.endsWith('\\') ? '' : '/');
                finalPath = formattedWs + finalPath;
            }

            const data = {
                name: document.getElementById('projName').value,
                path: finalPath,
                command: document.getElementById('projCmd').value,
                tag: document.getElementById('projTag').value,
                interactive: document.getElementById('projInteractive').checked,
                auto_start: document.getElementById('projAutoStart').checked,
                auto_restart: document.getElementById('projAutoRestart').checked,
                initial_env: document.getElementById('projInitialEnv').value 
            };

            const res = await fetch('/api/projects/add', { method: 'POST', body: JSON.stringify(data) });
            if (res.ok) { 
                closeModal(); 
                loadProjects(); 
                showToast("Workspace folder created and project added!", "success");
            } else {
                const err = await res.json();
                showToast(err.error, "error");
            }

        } else {
            const data = {
                repo_url: document.getElementById('repoUrl').value,
                command: document.getElementById('projCmd').value,
                tag: document.getElementById('projTag').value,
                interactive: document.getElementById('projInteractive').checked,
                auto_start: document.getElementById('projAutoStart').checked,
                auto_restart: document.getElementById('projAutoRestart').checked,
                initial_env: document.getElementById('projInitialEnv').value 
            };

            const res = await fetch('/api/projects/clone', { method: 'POST', body: JSON.stringify(data) });
            if (res.ok) { 
                closeModal(); 
                loadProjects(); 
                showToast("Repository perfectly cloned into workspace!", "success");
            } else {
                const err = await res.json();
                showToast(err.error, "error");
            }
        }
    } catch (err) {
        showToast("Server connection failed.", "error");
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
    }
}

function openDeleteModal(id) { projectToDelete = id; document.getElementById('deleteModal').classList.replace('hidden', 'flex'); }
function closeDeleteModal() { document.getElementById('deleteModal').classList.replace('flex', 'hidden'); }

async function executeDelete() { 
    const btn = document.getElementById('confirmDeleteBtn');
    const originalHTML = toggleButtonLoading(btn, true);
    const deleteFiles = document.getElementById('deleteFilesFromDisk').checked;
    
    try {
        const res = await fetch(`/api/projects/delete?id=${projectToDelete}&remove_files=${deleteFiles}`, { method: 'DELETE' }); 
        if(res.ok) {
            closeDeleteModal(); 
            loadProjects();
            
            if (deleteFiles) {
                showToast("Project and files permanently deleted", "success");
            } else {
                showToast("Project removed from dashboard", "success");
            }
        } else {
            const data = await res.json();
            showToast(data.error, "error");
            closeDeleteModal();
        }
    } catch (err) {
        showToast("Failed to delete project", "error");
        closeDeleteModal();
    } finally {
        toggleButtonLoading(btn, false, originalHTML);
        document.getElementById('deleteFilesFromDisk').checked = false;
    }
}

const terminalOutput = document.getElementById('terminal-output');

function connectWebSocket() {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    socket.onopen = () => appendLog("=== Connected to DionyHub Log Stream ===", "text-indigo-400");
    
    socket.onmessage = (e) => {
        logBuffer.push(e.data);
    };
    
    socket.onclose = () => setTimeout(connectWebSocket, 3000);
}

function flushLogBuffer() {
    if (logBuffer.length === 0 || !terminalOutput) return;

    const fragment = document.createDocumentFragment();
    const now = new Date();
    const timeString = now.toLocaleTimeString('tr-TR', { hour12: false });

    logBuffer.forEach(msg => {
        const lines = msg.split('\n');
        lines.forEach(l => {
            if (!l.trim()) return;
            const lineDiv = document.createElement('div');
            lineDiv.className = 'font-mono text-sm mb-0.5 leading-relaxed flex';
            
            let textColor = 'text-gray-300';
            const lowerLine = l.toLowerCase();
            if (lowerLine.includes('error') || lowerLine.includes('fail') || lowerLine.includes('panic') || lowerLine.includes('exit status 1')) {
                textColor = 'text-red-400';
            } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
                textColor = 'text-yellow-400';
            } else if (lowerLine.includes('starting') || lowerLine.includes('listening') || lowerLine.includes('success')) {
                textColor = 'text-emerald-400';
            }

            lineDiv.innerHTML = `<span class="text-gray-600 shrink-0 mr-3 select-none">[${timeString}]</span><span class="${textColor} break-all">${l}</span>`;
            fragment.appendChild(lineDiv);
        });
    });

    terminalOutput.appendChild(fragment);
    
    while (terminalOutput.childElementCount > MAX_LOG_LINES) {
        terminalOutput.removeChild(terminalOutput.firstElementChild);
    }
    
    // YENİ: Smooth scroll komutu eklendi
    terminalOutput.scrollTo({
        top: terminalOutput.scrollHeight,
        behavior: 'smooth'
    });
    
    logBuffer = [];
}

function appendLog(msg, forceColorClass = null) {
    if (!terminalOutput) return;

    const lines = msg.split('\n');
    const now = new Date();
    const timeString = now.toLocaleTimeString('tr-TR', { hour12: false });
    const fragment = document.createDocumentFragment();

    lines.forEach(l => {
        if (!l.trim()) return;
        const lineDiv = document.createElement('div');
        lineDiv.className = 'font-mono text-sm mb-0.5 leading-relaxed flex';
        let textColor = forceColorClass || 'text-gray-300';
        lineDiv.innerHTML = `<span class="text-gray-600 shrink-0 mr-3 select-none">[${timeString}]</span><span class="${textColor} break-all">${l}</span>`;
        fragment.appendChild(lineDiv);
    });
    
    terminalOutput.appendChild(fragment);
    while (terminalOutput.childElementCount > MAX_LOG_LINES) terminalOutput.removeChild(terminalOutput.firstElementChild);
    
    // YENİ: Smooth scroll komutu eklendi
    terminalOutput.scrollTo({
        top: terminalOutput.scrollHeight,
        behavior: 'smooth'
    });
}

function clearTerminal() { 
    if(terminalOutput) terminalOutput.innerHTML = ''; 
    logBuffer = []; 
    appendLog("=== Terminal Cleared ===", "text-gray-500");
}