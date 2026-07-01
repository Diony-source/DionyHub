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
                    const proj = cachedProjects.find(x => String(x.id || x.ID) === String(stat.id));
                    if (proj) proj.status = stat.status;

                    const badge = document.getElementById('status-' + stat.id);
                    const statsDiv = document.getElementById('stats-' + stat.id);
                    if (!badge) return; // Etiket yoksa pas geç (Güvenlik kilidi)
                    
                    let prevStatus = terminalPool[stat.id] ? terminalPool[stat.id].lastStatus : null;
                    if (terminalPool[stat.id]) terminalPool[stat.id].lastStatus = stat.status;

                    // YENİ VE TEMİZLENMİŞ GÜNCELLEME BLOKLARI (statusSpan çöpleri silindi)
                    if (stat.status === 'running') {
                        badge.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30 font-bold shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse';
                        badge.innerText = 'Running';
                        
                        if (statsDiv) {
                            statsDiv.innerHTML = `<span>CPU: ${stat.cpu.toFixed(1)}%</span><span>RAM: ${stat.ram.toFixed(0)}MB</span>` + (typeof drawSparkline === 'function' ? drawSparkline(stat.id, stat.cpu) : '');
                        }
                    } else if (stat.status === 'stopped') {
                        badge.className = 'px-3 py-1 bg-gray-800/60 text-gray-500 text-xs rounded-full border border-gray-700/50 font-bold transition-all';
                        badge.innerText = 'Stopped';
                        
                        if (statsDiv) {
                            statsDiv.innerHTML = `<span>CPU: --</span><span>RAM: --</span>`;
                        }

                        // 🛡️ ÇÖKME (CRASH) TESPİT MOTORU VE OBS ENTEGRASYONU
                        if (prevStatus === 'running' && typeof triggerObsEmergencyScene === 'function') {
                            const statIdStr = String(stat.id); // Tip güvenliği sağlandı
                            
                            if (window.manualStopFlags && window.manualStopFlags.has(statIdStr)) {
                                // Kullanıcı kendi durdurduysa OBS tetiklenmez
                                window.manualStopFlags.delete(statIdStr); 
                            } else {
                                // Çökme durumu
                                const pName = proj ? (proj.name || proj.Name) : 'Proje';
                                triggerObsEmergencyScene(pName);
                            }
                        }
                    }
                });
                return; // Metrikler işlendi, işlem sonlandırılıyor.
            }
            
            // Eğer gelen mesaj bir Terminal Logu değilse, ekrana basma (Spam filtresi)
            if (msg.action !== 'log' && msg.id !== 'system') {
                return;
            }

            const termInstance = terminalPool[msg.id];
            if (!termInstance || !termInstance.term) return;

            // --- SMART CANVAS (AKILLI VURGU MOTORU) ---
            let textData = msg.data || "";
            if (msg.id !== 'system' && !textData.includes('\x1b[')) {
                textData = textData.replace(/\b(ERROR|ERR|FAIL|FAILED|FATAL|EXCEPTION|PANIC)\b/gi, "\x1b[1;31m$1\x1b[0m");
                textData = textData.replace(/\b(WARN|WARNING)\b/gi, "\x1b[1;33m$1\x1b[0m");
                textData = textData.replace(/\b(SUCCESS|OK|READY|STARTED|LISTENING)\b/gi, "\x1b[1;32m$1\x1b[0m");
                textData = textData.replace(/(https?:\/\/[^\s]+)/gi, "\x1b[4;36m$1\x1b[0m");
            }
            
            termInstance.term.write(textData); 
            
        } catch (err) {
            if (err instanceof SyntaxError) {
                if(terminalPool['system']) terminalPool['system'].term.write(e.data + "\r\n");
            } else {
                console.error("UI Parsing Error:", err);
            }
        }
    };

    socket.onclose = () => { setTimeout(connectWebSocket, 3000); };
    socket.onerror = (err) => { socket.close(); };
}