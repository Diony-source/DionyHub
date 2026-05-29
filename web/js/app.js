let projectToDelete = null;
let currentTagFilter = null; // YENİ: Hangi etikette olduğumuzu tutar

document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    setInterval(updateStatuses, 2000);
    connectWebSocket();
});

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("API error");
        
        const projects = await response.json();
        
        // YENİ: Sol menüyü dinamik etiketlerle güncelle
        renderSidebarTags(projects);

        const tbody = document.getElementById('project-list');
        tbody.innerHTML = '';

        // YENİ: Projeleri seçili etikete göre filtrele
        const filteredProjects = currentTagFilter 
            ? projects.filter(p => p.tag && p.tag.toLowerCase() === currentTagFilter.toLowerCase())
            : projects;

        if (filteredProjects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">No projects found in this view.</td></tr>`;
            return;
        }

        filteredProjects.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-700/50 hover:bg-gray-750 transition-colors group';
            
            // Eğer etiketi varsa isminin yanında küçük bir badge (rozet) olarak gösterelim
            const tagBadge = p.tag ? `<span class="ml-3 px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-[10px] uppercase tracking-wider rounded border border-indigo-500/30">${p.tag}</span>` : '';

            tr.innerHTML = `
                <td class="p-5 font-medium text-gray-200 flex items-center gap-3">
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
   YENİ: SIDEBAR VE TAG KONTROLLERİ
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
    loadProjects(); // Tabloyu yeni filtreyle tekrar çiz
    
    // Sol menüdeki aktif sekmeyi renklendir
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
    // Projelerdeki benzersiz ve boş olmayan etiketleri çıkar
    const tags = [...new Set(projects.map(p => p.tag).filter(t => t && t.trim() !== ''))];
    
    const tagList = document.getElementById('tag-list');
    tagList.innerHTML = `
        <button id="btn-filter-all" onclick="setFilter(null)" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border bg-indigo-500/20 text-indigo-400 border-indigo-500/30">
            All Projects
        </button>
    `;

    tags.forEach(tag => {
        // Tag butonlarını oluştur
        tagList.innerHTML += `
            <button id="btn-filter-${tag}" onclick="setFilter('${tag}')" class="tag-filter-btn w-full text-left px-4 py-1.5 rounded-md text-sm transition-colors border border-transparent text-gray-400 hover:bg-gray-700/30 hover:text-gray-200">
                # ${tag}
            </button>
        `;
    });

    // Eğer silinen bir tag filtresinde kalmışsak All Projects'e dön
    if (currentTagFilter && !tags.includes(currentTagFilter)) {
        setFilter(null);
    }
}

/* =========================================
   GÜNCELLENMİŞ ADD MODAL KONTROLÜ
========================================= */
// Diğer modal ve API fonksiyonları aynı... (updateStatuses, startProject, vb. değişmedi)

async function submitNewProject(event) {
    event.preventDefault();

    const newProject = {
        name: document.getElementById('projName').value,
        path: document.getElementById('projPath').value,
        command: document.getElementById('projCmd').value,
        tag: document.getElementById('projTag').value, // YENİ: Etiketi de yolla
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

/* =========================================
   WEBSOCKET & TERMINAL KONTROLLERİ
========================================= */

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