const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const selectors = require('./selectors');

(async () => {
    let client;
    try {
        const targets = await CDP.List({ port: 9223 });
        const workspacePages = targets.filter(t => t.url && t.url.includes('workbench') && t.type === 'page');
        if (!workspacePages.length) { console.log('No workspace pages open.'); return; }
        
        client = await CDP({ target: workspacePages[0] });
        await client.Runtime.enable();
        
        console.log('Finding target container...');
        // Find actual scrollable div
        const setupRes = await client.Runtime.evaluate({
            expression: `(function() {
                var allDivs = document.querySelectorAll('.antigravity-agent-side-panel div');
                for (var i=0; i<allDivs.length; i++) {
                    var d = allDivs[i];
                    if (d.scrollHeight > d.clientHeight + 10 && d.clientHeight > 100) {
                        window.__rescueTarget = d;
                        return true;
                    }
                }
                return false;
            })()`,
            returnByValue: true
        });
        
        if (!setupRes.result.value) { console.log('Could not find scroll container.'); return; }
        
        console.log('Scrolling to very top...');
        await client.Runtime.evaluate({ expression: 'window.__rescueTarget.scrollTop = 0;' });
        await new Promise(r => setTimeout(r, 2000));
        
        let accumulated = [];
        let canScrollMore = true;
        let scrolls = 0;
        
        console.log('Scrolling down and accumulating messages...');
        while (canScrollMore && scrolls < 300) {
            const raw = await selectors.readMessages(client.Runtime, 'antigravity_panel', 'rescue');
            const domList = JSON.parse(raw);
            
            // Apply standard accumulation merge
            if (accumulated.length === 0) {
                accumulated = domList.slice();
            } else if (domList.length > 0) {
                const acc = accumulated;
                const dom = domList;
                
                let overlapLen = 0;
                for (let tryLen = Math.min(acc.length, dom.length); tryLen >= 1; tryLen--) {
                    let match = true;
                    for (let k = 0; k < tryLen; k++) {
                        const accMsg = acc[acc.length - tryLen + k];
                        const domMsg = dom[k];
                        if (accMsg.role !== domMsg.role) { match = false; break; }
                        if (accMsg.content !== domMsg.content &&
                            !domMsg.content.startsWith(accMsg.content.substring(0, 80)) &&
                            !accMsg.content.startsWith(domMsg.content.substring(0, 80))) {
                            match = false; break;
                        }
                    }
                    if (match) { overlapLen = tryLen; break; }
                }

                if (overlapLen > 0) {
                    for (let k = 0; k < overlapLen; k++) {
                        const accIdx = acc.length - overlapLen + k;
                        const domIdx = k;
                        if (dom[domIdx].content.length > acc[accIdx].content.length) {
                            acc[accIdx] = dom[domIdx];
                        }
                    }
                    for (let k = overlapLen; k < dom.length; k++) {
                        acc.push(dom[k]);
                    }
                } else {
                    const lastAccContent = acc.length > 0 ? acc[acc.length - 1].content : '';
                    const firstDomContent = dom[0]?.content || '';
                    if (!lastAccContent || !firstDomContent.startsWith(lastAccContent.substring(0, 80))) {
                        for (const m of dom) acc.push(m);
                    }
                }
            }
            
            const stepRes = await client.Runtime.evaluate({
                expression: `(function() {
                    var t = window.__rescueTarget;
                    var old = t.scrollTop;
                    t.scrollTop += 3000;
                    return t.scrollTop > old;
                })()`,
                returnByValue: true
            });
            canScrollMore = stepRes.result.value;
            scrolls++;
            await new Promise(r => setTimeout(r, 600));
            process.stdout.write(accumulated.length + '..');
        }
        
        console.log('\\nFinished scrolling down. Total accumulated: ' + accumulated.length);
        
        const storePath = path.join(__dirname, 'session-store.json');
        let store = { sessions: {} };
        if (fs.existsSync(storePath)) {
            store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        }
        
        let activeSessionId = null;
        let maxTime = 0;
        for (const sid in store.sessions) {
            const s = store.sessions[sid];
            if (s.agent_type === 'antigravity_panel' && s.status === 'healthy') {
                const t = new Date(s.last_seen_at).getTime();
                if (t > maxTime) { maxTime = t; activeSessionId = sid; }
            }
        }
        
        if (activeSessionId) {
            store.sessions[activeSessionId].accumulated_messages = accumulated;
            fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
            console.log('Injected ' + accumulated.length + ' messages into session ' + activeSessionId);
        } else {
            console.log('Could not find active antigravity_panel session in store.');
        }
        
        await client.close();
    } catch(e) { 
        if (client) try { await client.close(); } catch(e2){}
        console.error('Error:', e.message); 
    }
})();
