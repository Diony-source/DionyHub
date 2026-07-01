function connectWebSocket() {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    socket.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            
            if (msg.action === 'reload') {
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
                        badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-bold shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse';
                        badge.innerText = 'Running';
                        statusSpan.innerText = 'Running';
                        statusSpan.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-bold shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse';
                    } else if (stat.status === 'stopped') {
                        badge.className = 'px-3 py-1 bg-gray-800/60 text-gray-500 text-xs rounded-full border border-gray-700/50 font-bold transition-all';
                        badge.innerText = 'Stopped';
                        statusSpan.innerText = 'Stopped';
                        statusSpan.className = 'px-3 py-1 bg-rose-500/10 text-rose-400 text-xs rounded-full border border-rose-500/20 font-bold shadow-[0_0_10px_rgba(225,29,72,0.2)]';
                        
                        // 🛡️ YAYINCI ZIRHI: Proje 'running' durumdan aniden 'stopped' durumuna düşerse OBS'e acil durum sinyali gönder
                        if (prevStatus === 'running' && typeof triggerObsEmergencyScene === 'function') {
                            const pName = proj ? (proj.name || proj.Name) : 'Proje';
                            triggerObsEmergencyScene(pName);
                        }
                    }
                });
                return; 
            }
            
            let projName = "Unknown";
            if (msg.id === 'system') projName = "DionyHub System Logs";
            else { const p = cachedProjects.find(x => x.id === msg.id || x.ID === msg.id); projName = p ? (p.name || p.Name) : msg.id; }
            
            const termInstance = getOrCreateTerminal(msg.id, projName);
            
            // --- 🚀 YENİ: VS CODE TARZI CTRL + CLICK LİNK MOTORU ---
            if (!termInstance.__linkEngineReady && termInstance.term && typeof termInstance.term.registerLinkProvider === 'function') {
                termInstance.__linkEngineReady = true;
                termInstance.term.registerLinkProvider({
                    provideLinks: (bufferLineNumber, callback) => {
                        const line = termInstance.term.buffer.active.getLine(bufferLineNumber - 1);
                        if (!line) { callback([]); return; }
                        const text = line.translateToString(true);
                        const links = [];
                        
                        // Terminal içindeki temiz URL'leri yakalayan regex
                        const regex = /(https?:\/\/[a-zA-Z0-9\-\.\_\~\:\/\?\#\[\]\@\!\$\&\'\(\)\*\+\,\;\=\%]+)/g;
                        let match;
                        while ((match = regex.exec(text)) !== null) {
                            links.push({
                                range: { 
                                    start: { x: match.index + 1, y: bufferLineNumber }, 
                                    end: { x: match.index + match[0].length, y: bufferLineNumber } 
                                },
                                text: match[0],
                                activate: (event, uri) => {
                                    if (event.ctrlKey || event.metaKey) {
                                        window.open(uri, '_blank'); // Yan sekmede tertemiz açar
                                    } else {
                                        // VS Code hissini tamamlayan o tatlı uyarı
                                        if (typeof showToast === 'function') {
                                            showToast("Linke gitmek için CTRL + Click yapın", "success");
                                        }
                                    }
                                }
                            });
                        }
                        callback(links);
                    }
                });
            }
            
            // --- SMART CANVAS (AKILLI VURGU MOTORU) ---
            let textData = msg.data;
            if (msg.id !== 'system' && !textData.includes('\x1b[')) {
                textData = textData.replace(/\b(ERROR|ERR|FAIL|FAILED|FATAL|EXCEPTION|PANIC)\b/gi, "\x1b[1;31m$1\x1b[0m");
                textData = textData.replace(/\b(WARN|WARNING)\b/gi, "\x1b[1;33m$1\x1b[0m");
                textData = textData.replace(/\b(SUCCESS|OK|READY|STARTED|LISTENING)\b/gi, "\x1b[1;32m$1\x1b[0m");
                textData = textData.replace(/(https?:\/\/[^\s]+)/gi, "\x1b[4;36m$1\x1b[0m");
            }
            
            termInstance.term.write(textData); 
            
        } catch (err) {
            if(terminalPool['system']) terminalPool['system'].term.write(e.data);
        }
    };
    
    socket.onclose = () => {
        if (terminalPool['system']) terminalPool['system'].term.writeln('\x1b[31m=== Connection lost. Reconnecting in 3s... ===\x1b[0m');
        setTimeout(connectWebSocket, 3000);
    };
}