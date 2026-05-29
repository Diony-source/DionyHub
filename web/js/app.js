document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    setInterval(updateStatuses, 2000);
});

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("API error");
        
        const projects = await response.json();
        const tbody = document.getElementById('project-list');
        tbody.innerHTML = '';

        if (projects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-500">No projects found. Click 'Add Project' to start.</td></tr>`;
            return;
        }

        projects.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-700/50 hover:bg-gray-750 transition-colors group';
            
            tr.innerHTML = `
                <td class="p-5 font-medium text-gray-200 flex items-center gap-3">
                    <div class="h-8 w-8 rounded bg-gray-700 flex items-center justify-center text-indigo-400 font-bold group-hover:bg-indigo-500/20 transition-colors">
                        ${p.name.charAt(0).toUpperCase()}
                    </div>
                    ${p.name}
                </td>
                <td class="p-5 text-sm text-gray-400 font-mono text-xs truncate max-w-xs" title="${p.path}">
                    ${p.path}
                </td>
                <td class="p-5">
                    <span id="status-${p.id}" class="px-3 py-1 bg-gray-600/30 text-gray-400 text-xs rounded-full border border-gray-500/30 font-medium">Loading...</span>
                </td>
                <td class="p-5 text-right space-x-2">
                    <button onclick="startProject('${p.id}')" class="btn-action bg-emerald-600/90 hover:bg-emerald-500 text-white px-4 py-2 rounded shadow-lg shadow-emerald-900/20 text-sm font-medium">Start</button>
                    <button onclick="stopProject('${p.id}')" class="btn-action bg-rose-600/90 hover:bg-rose-500 text-white px-4 py-2 rounded shadow-lg shadow-rose-900/20 text-sm font-medium">Stop</button>
                    
                    <button onclick="deleteProject('${p.id}')" class="btn-action bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white p-2 rounded shadow-lg text-sm font-medium transition-colors" title="Delete Project">
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

async function updateStatuses() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) return;
        const projects = await response.json();

        projects.forEach(p => {
            const badge = document.getElementById('status-' + p.id);
            if (!badge) return;

            if (p.status === 'running') {
                badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-medium shadow-[0_0_10px_rgba(16,185,129,0.2)]';
                badge.innerText = 'Running';
            } else {
                badge.className = 'px-3 py-1 bg-gray-600/30 text-gray-400 text-xs rounded-full border border-gray-500/30 font-medium';
                badge.innerText = 'Stopped';
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

// YENİ: Projeyi Silme Fonksiyonu
async function deleteProject(id) {
    // Kazara silmelere karşı basit bir onay penceresi
    if (!confirm("Are you sure you want to permanently remove this project from DionyHub?")) {
        return;
    }

    try {
        const response = await fetch('/api/projects/delete?id=' + id, { method: 'DELETE' });
        const result = await response.json();
        
        if (response.ok) {
            loadProjects(); // Tabloyu anında yenile
        } else {
            alert('Hata: ' + result.error);
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('Projeyi silerken sunucuya ulaşılamadı.');
    }
}

function openModal() {
    const modal = document.getElementById('addModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    const modal = document.getElementById('addModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('addForm').reset();
}

async function submitNewProject(event) {
    event.preventDefault();

    const newProject = {
        name: document.getElementById('projName').value,
        path: document.getElementById('projPath').value,
        command: document.getElementById('projCmd').value,
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