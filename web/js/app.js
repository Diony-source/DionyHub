// Sayfa yüklendiğinde projeleri çek ve her 2 saniyede bir durumu güncelle (Polling)
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
                <td class="p-5 text-right space-x-3">
                    <button onclick="startProject('${p.id}')" class="btn-action bg-emerald-600/90 hover:bg-emerald-500 text-white px-5 py-2 rounded shadow-lg shadow-emerald-900/20 text-sm font-medium">Start</button>
                    <button onclick="stopProject('${p.id}')" class="btn-action bg-rose-600/90 hover:bg-rose-500 text-white px-5 py-2 rounded shadow-lg shadow-rose-900/20 text-sm font-medium">Stop</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        updateStatuses();
    } catch (error) {
        console.error("Load error:", error);
        document.getElementById('project-list').innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-400">Veriler yüklenirken hata oluştu.</td></tr>`;
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