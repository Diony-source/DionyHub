let projectToDelete = null;
let currentTagFilter = null;
let draggedRow = null;
let availableTags = []; // YENİ: Etiketleri hafızada tutacak dizi

document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    setInterval(updateStatuses, 2000);
    connectWebSocket();
    initTagAutocomplete(); // YENİ: Şık dropdown'ı başlat
});

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("API error");
        
        const projects = await response.json();
        
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
                    <button onclick="startProject('${p.id}')" class="btn-action bg-emerald-600/90 hover:bg-emerald-500 text-white px-4 py-2 rounded shadow-lg shadow-emerald-900/20 text-sm font-medium">Start</button>
                    <button onclick="stopProject('${p.id}')" class="btn-action bg-rose-600/90 hover:bg-rose-500 text-white px-4 py-2 rounded shadow-lg shadow-rose-900/20 text-sm font-medium">Stop</button>
                    <button onclick="openDeleteModal('${p.id}')" class="btn-action bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white p-2 rounded shadow-lg text-sm font-medium transition-colors" title="Delete Project">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
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
   DRAG & DROP FONKSİYONLARI
========================================= */

function handleDragStart(e) {
    draggedRow = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    setTimeout(() => this.classList.add('opacity-50'), 0);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedRow) {
        this.classList.add('border-t-2', 'border-indigo-500');
    }
}

function handleDragLeave(e) {
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

        if (draggedIndex < droppedIndex) {
            this.parentNode.insertBefore(draggedRow, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedRow, this);
        }

        saveNewOrder();
    }
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('opacity-50');
    document.querySelectorAll('#project-list tr').forEach(row => {
        row.classList.remove('border-t-2', 'border-indigo-500');
    });
}

async function saveNewOrder() {
    const tbody = document.getElementById('project-list');
    const newOrderIDs = Array.from(tbody.children).map(tr => tr.dataset.id);

    try {
        const response = await fetch('/api/projects/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newOrderIDs)
        });

        if (!response.ok) {
            console.error("Sıralama kaydedilemedi.");
            loadProjects();
        }
    } catch (error) {
        console.error("Reorder request failed:", error);
    }
}

/* =========================================
   SIDEBAR VE TAG KONTROLLERİ
========================================= */

function toggleBoard() {
    const list = document.getElementById('tag-list');
    const chevron = document.getElementById('board-chevron');
    
    if (list.classList.contains('hidden')) {
        list.classList.remove('hidden');
        chevron.classList.add('rotate-180');
    } else {
        list.classList.add('hidden');
        chevron.classList.remove('rotate-180');
    }
}

function setFilter(tag) {
    currentTagFilter = tag;
    loadProjects();
    
    document.querySelectorAll('.tag-filter-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30');
        btn.classList.add('text-gray-400', 'hover:bg-gray-700/30', 'border-transparent');
    });

    if (tag === null) {
        document.getElementById('btn-filter-all').classList.add('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30');
        document.getElementById('btn-filter-all').classList.remove('text-gray-400', 'hover:bg-gray-700/30', 'border-transparent');
    } else {
        const activeBtn = document.getElementById(`btn-filter-${tag}`);
        if (activeBtn) {
            activeBtn.classList.add('bg-indigo-500/20', 'text-indigo-400', 'border-indigo-500/30');
            activeBtn.classList.remove('text-gray-400', 'hover:bg-gray-700/30', 'border-transparent');
        }
    }
}

function renderSidebarTags(projects) {
    projects.sort((a, b) => (a.order || 0) - (b.order || 0));

    // YENİ: Etiket listesini global değişkene ata
    availableTags = [...new Set(projects.map(p => p.tag).filter(t => t && t.trim() !== ''))];
    
    const tagList = document.getElementById('tag-list');
    if (tagList) {
        tagList.innerHTML = `
            <button id="btn-filter-all" onclick="setFilter(null)" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border bg-indigo-500/20 text-indigo-400 border-indigo-500/30">
                All Projects
            </button>
        `;

        availableTags.forEach(tag => {
            tagList.innerHTML += `
                <button id="btn-filter-${tag}" onclick="setFilter('${tag}')" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border border-transparent text-gray-400 hover:bg-gray-700/30 hover:text-gray-200">
                    # ${tag}
                </button>
            `;
        });

        if (currentTagFilter && !availableTags.includes(currentTagFilter)) {
            setFilter(null);
        }
    }
    // Datalist render etme kısmı tamamen silindi.
}

/* =========================================
   YENİ: PREMIUM AUTOCOMPLETE LOGIC
========================================= */

function initTagAutocomplete() {
    const tagInput = document.getElementById('projTag');
    const tagDropdown = document.getElementById('tagDropdown');

    if (!tagInput || !tagDropdown) return;

    // Tıklandığında veya yazı yazıldığında menüyü güncelle ve göster
    tagInput.addEventListener('focus', () => updateDropdown(tagInput.value));
    tagInput.addEventListener('input', (e) => updateDropdown(e.target.value));
    
    // İnputtan çıkıldığında menüyü kapat
    tagInput.addEventListener('blur', () => {
        // Blur anında dropdown'ın hemen kapanmasını önlemek için minik bir gecikme
        setTimeout(() => tagDropdown.classList.add('hidden'), 150);
    });

    function updateDropdown(filterText) {
        const filteredTags = availableTags.filter(tag => tag.toLowerCase().includes(filterText.toLowerCase()));

        if (filteredTags.length === 0) {
            tagDropdown.classList.add('hidden');
            return;
        }

        tagDropdown.innerHTML = '';
        filteredTags.forEach(tag => {
            const item = document.createElement('div');
            item.className = 'px-4 py-2 text-sm text-gray-300 hover:bg-indigo-600 hover:text-white cursor-pointer transition-colors';
            item.textContent = tag;
            
            // Satıra tıklandığında inputa değeri yaz ve menüyü gizle
            item.onmousedown = (e) => {
                e.preventDefault(); // Blur olayının tetiklenmesini durdurur
                tagInput.value = tag;
                tagDropdown.classList.add('hidden');
            };
            tagDropdown.appendChild(item);
        });
        tagDropdown.classList.remove('hidden');
    }
}

/* =========================================
   DİĞER FONKSİYONLAR (API, MODAL, WEBSOCKET)
========================================= */

async function updateStatuses() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) return;
        const projects = await response.json();

        projects.forEach(p => {
            const badge = document.getElementById('status-' + p.id);
            const stats = document.getElementById('stats-' + p.id);
            if (!badge) return;

            if (p.status === 'running') {
                badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-medium shadow-[0_0_10px_rgba(16,185,129,0.2)]';
                badge.innerText = 'Running';
                
                if (stats && p.cpu !== undefined && p.ram !== undefined) {
                    stats.innerHTML = `
                        <span class="text-indigo-400">CPU: ${p.cpu.toFixed(1)}%</span>
                        <span class="text-emerald-400">RAM: ${p.ram.toFixed(1)} MB</span>
                    `;
                }
            } else {
                badge.className = 'px-3 py-1 bg-gray-600/30 text-gray-400 text-xs rounded-full border border-gray-500/30 font-medium';
                badge.innerText = 'Stopped';
                
                if (stats) {
                    stats.innerHTML = `
                        <span class="text-gray-600">CPU: --</span>
                        <span class="text-gray-600">RAM: --</span>
                    `;
                }
            }
        });
    } catch (error) {
        console.error("Status update error:", error);
    }
}

async function startProject(id) {
    try {
        const response = await fetch('/api/projects/start?id=' + id, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) alert('Hata: ' + result.error);
        updateStatuses();
    } catch (error) {
        console.error('Start error:', error);
    }
}

async function stopProject(id) {
    try {
        const response = await fetch('/api/projects/stop?id=' + id, { method: 'POST' });
        const result = await response.json();
        if (!response.ok && !result.error.includes("not currently running")) {
            alert('Hata: ' + result.error);
        }
        updateStatuses();
    } catch (error) {
        console.error('Stop error:', error);
    }
}

function openModal() {
    const modal = document.getElementById('addModal');
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeModal() {
    const modal = document.getElementById('addModal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.getElementById('addForm').reset();
    }
}

async function submitNewProject(event) {
    event.preventDefault();

    const newProject = {
        name: document.getElementById('projName').value,
        path: document.getElementById('projPath').value,
        command: document.getElementById('projCmd').value,
        tag: document.getElementById('projTag').value,
        interactive: document.getElementById('projInteractive').checked
    };

    try {
        const response = await fetch('/api/projects/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newProject)
        });

        const result = await response.json();

        if (response.ok) {
            closeModal();
            loadProjects();
        } else {
            alert('Hata: ' + result.error);
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('Projeyi kaydederken sunucuya ulaşılamadı.');
    }
}

function openDeleteModal(id) {
    projectToDelete = id;
    const modal = document.getElementById('deleteModal');
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('confirmDeleteBtn').onclick = executeDelete;
    }
}

function closeDeleteModal() {
    projectToDelete = null;
    const modal = document.getElementById('deleteModal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function executeDelete() {
    if (!projectToDelete) return;

    try {
        const response = await fetch('/api/projects/delete?id=' + projectToDelete, { method: 'DELETE' });
        const result = await response.json();
        
        if (response.ok) {
            closeDeleteModal();
            loadProjects();
        } else {
            alert('Hata: ' + result.error);
            closeDeleteModal();
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('Projeyi silerken sunucuya ulaşılamadı.');
        closeDeleteModal();
    }
}

const terminalOutput = document.getElementById('terminal-output');

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        appendLog("=== Connected to DionyHub Log Stream ===", "text-indigo-400");
    };

    socket.onmessage = (event) => {
        appendLog(event.data);
    };

    socket.onclose = () => {
        appendLog("=== Connection lost. Reconnecting in 3 seconds... ===", "text-rose-400");
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
        console.error("WebSocket Error:", error);
    };
}

function appendLog(message, colorClass = "text-green-400") {
    if (!terminalOutput) return;
    
    const lines = message.split('\n');
    lines.forEach(lineText => {
        if (lineText.trim() === '') return;
        const line = document.createElement('div');
        line.className = colorClass;
        line.textContent = lineText;
        terminalOutput.appendChild(line);
    });
    
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function clearTerminal() {
    if (terminalOutput) {
        terminalOutput.innerHTML = '';
        appendLog("=== Terminal Cleared ===", "text-gray-500");
    }
}