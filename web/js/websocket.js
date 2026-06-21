function connectWebSocket() {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    socket.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            
            // --- YENİ EKLENEN SİHİR: OTONOM YENİLEME ---
            if (msg.action === 'reload') {
                // Sayfayı asla F5'lemeden arka planda projeleri ve etiketleri yeniler
                loadProjects(); 
                return;
            }

            if (msg.action === 'clear') {
                if (terminalPool[msg.id]) terminalPool[msg.id].term.clear();
                return;
            }
            if (msg.id === 'metrics') {
                const statsArray = JSON.parse(msg.data);
                if (!statsArray) return; 
                statsArray.forEach(stat => {
                    const proj = cachedProjects.find(x => (x.id || x.ID) === stat.id);
                    if (proj) proj.status = stat.status;

                    const badge = document.getElementById('status-' + stat.id);
                    const statsDiv = document.getElementById('stats-' + stat.id);
                    if (!badge) return;
                    let prevStatus = terminalPool[stat.id] ? terminalPool[stat.id].lastStatus : null;
                    if (terminalPool[stat.id]) terminalPool[stat.id].lastStatus = stat.status;

                    if (stat.status === 'running') {
                        badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-colors';
                        badge.innerText = 'Running';
                        if (statsDiv) {
                            const hrs = Math.floor(stat.uptime / 3600); const mins = Math.floor((stat.uptime % 3600) / 60); const secs = stat.uptime % 60;
                            const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m` : (mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
                            const sparkHtml = drawSparkline(stat.id, stat.cpu);
                            statsDiv.innerHTML = `<div class="flex flex-col gap-0.5"><div class="flex gap-2"><span class="text-indigo-400">CPU: ${stat.cpu.toFixed(1)}%</span><span class="text-emerald-400">RAM: ${stat.ram.toFixed(1)} MB</span></div><span class="text-amber-400 font-bold opacity-80">UP: ${uptimeStr}</span></div> ${sparkHtml}`;
                        }
                        if (!terminalPool[stat.id]) { const p = cachedProjects.find(x => x.id === stat.id || x.ID === stat.id); if(p) getOrCreateTerminal(p.id || p.ID, p.name || p.Name); }
                    } else {
                        badge.className = 'px-3 py-1 bg-gray-800/60 text-gray-400 text-xs rounded-full border border-gray-700/50 font-bold transition-colors';
                        badge.innerText = 'Stopped';
                        if (statsDiv) statsDiv.innerHTML = `<span class="text-gray-600">CPU: --</span><span class="text-gray-600">RAM: --</span>`;
                        if (prevStatus === 'running' && terminalPool[stat.id]) {
                            const p = cachedProjects.find(x => x.id === stat.id || x.ID === stat.id);
                            if (p && (p.auto_close || p.AutoClose)) minimizeTerminal(stat.id, p.name || p.Name);
                        }
                    }
                });
                return; 
            }
            let projName = "Unknown";
            if (msg.id === 'system') projName = "DionyHub System Logs";
            else { const p = cachedProjects.find(x => x.id === msg.id || x.ID === msg.id); projName = p ? (p.name || p.Name) : msg.id; }
            
            const termInstance = getOrCreateTerminal(msg.id, projName);
            if (msg.id === 'system') termInstance.term.write('\x1b[36m' + msg.data + '\x1b[0m');
            else termInstance.term.write(msg.data); 
        } catch (err) {
            if(terminalPool['system']) terminalPool['system'].term.write(e.data);
        }
    };
    socket.onclose = () => {
        if (terminalPool['system']) terminalPool['system'].term.writeln('\x1b[31m=== Connection lost. Reconnecting in 3s... ===\x1b[0m');
        setTimeout(connectWebSocket, 3000);
    };
}