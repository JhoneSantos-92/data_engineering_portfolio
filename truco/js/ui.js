import {
    SUIT_INFO, SINAIS, CALL_NAME,
    createGame, startHand, playCard, advanceTurnAfterPlay, finishTrick,
    runFromHand, makeCall, acceptCall, runFromCall, raiseCall,
    aiPickCard, aiConsiderCall, aiRespondToCall, aiMaoOnzeDecision,
    cardLabel, teamName, nextLevel, canCall,
    beginTeamASignalPhase, logSilentOpponentSignal, sendPartnerSignal,
} from './truco.js';

const BOT_DELAY = 850;
const PLAY_TURN_DELAY = 3000;
const TURN_SECONDS = 10;

const el = {
    scoreA: document.getElementById('score-a'),
    scoreB: document.getElementById('score-b'),
    handNumber: document.getElementById('hand-number'),
    vira: document.getElementById('vira-card'),
    manilha: document.getElementById('manilha-label'),
    seatTop: document.getElementById('seat-top'),
    seatLeft: document.getElementById('seat-left'),
    seatRight: document.getElementById('seat-right'),
    seatBottom: document.getElementById('seat-bottom'),
    slotTop: document.getElementById('slot-top'),
    slotLeft: document.getElementById('slot-left'),
    slotRight: document.getElementById('slot-right'),
    slotBottom: document.getElementById('slot-bottom'),
    log: document.getElementById('log-panel'),
    actionBar: document.getElementById('action-bar'),
    turnTimer: document.getElementById('turn-timer'),
    callBanner: document.getElementById('call-banner'),
    signalRow: document.getElementById('signal-row'),
    badgeDuda: document.getElementById('badge-duda'),
    badgeVoce: document.getElementById('badge-voce'),
    newGameBtn: document.getElementById('new-game-btn'),
    infoBtn: document.getElementById('info-btn'),
    infoModal: document.getElementById('info-modal'),
    infoClose: document.getElementById('info-close'),
    historyBtn: document.getElementById('history-btn'),
    historyModal: document.getElementById('history-modal'),
    historyClose: document.getElementById('history-close'),
    endModal: document.getElementById('end-modal'),
    endTitle: document.getElementById('end-title'),
    endText: document.getElementById('end-text'),
    endPlayAgain: document.getElementById('end-play-again'),
};

let G = createGame(logMessage);
let scheduled = false;
let playHiddenMode = false;
let timerId = null;

function clearHumanTimer() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
    el.turnTimer.hidden = true;
}

function startHumanTimer(onExpire) {
    clearHumanTimer();
    let remaining = TURN_SECONDS;
    el.turnTimer.hidden = false;
    el.turnTimer.textContent = `⏱ ${remaining}s`;
    el.turnTimer.style.setProperty('--pct', '100%');
    timerId = setInterval(() => {
        remaining -= 1;
        el.turnTimer.textContent = `⏱ ${remaining}s`;
        el.turnTimer.style.setProperty('--pct', `${(remaining / TURN_SECONDS) * 100}%`);
        if (remaining <= 0) {
            clearHumanTimer();
            onExpire();
        }
    }, 1000);
}

let bannerTimeout = null;

function showBanner(text, variant) {
    el.callBanner.textContent = text;
    el.callBanner.className = 'call-banner' + (variant ? ` banner-${variant}` : '');
    void el.callBanner.offsetWidth;
    el.callBanner.classList.add('show');
    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
        el.callBanner.classList.remove('show');
    }, 2400);
}

const badgeTimeouts = {};

function showAvatarSignal(key, badgeEl, icon) {
    badgeEl.textContent = icon;
    badgeEl.classList.remove('show');
    void badgeEl.offsetWidth;
    badgeEl.classList.add('show');
    if (badgeTimeouts[key]) clearTimeout(badgeTimeouts[key]);
    badgeTimeouts[key] = setTimeout(() => {
        badgeEl.classList.remove('show');
    }, 5000);
}

function logMessage(msg) {
    G.log_messages = G.log_messages || [];
    G.log_messages.push(msg);
    renderLog();
}

function renderLog() {
    const msgs = G.log_messages || [];
    el.log.innerHTML = msgs.map((m) => `<div class="log-line">${m}</div>`).join('');
    el.log.scrollTop = el.log.scrollHeight;
}

function cardEl(card, opts = {}) {
    const info = SUIT_INFO[card.suit];
    const div = document.createElement('div');
    div.className = `card card-${info.color}` + (opts.small ? ' card-small' : '');
    div.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${info.symbol}</span>`;
    return div;
}

function cardBackEl() {
    const div = document.createElement('div');
    div.className = 'card card-back';
    return div;
}

function render() {
    el.scoreA.textContent = G.score.A;
    el.scoreB.textContent = G.score.B;
    el.handNumber.textContent = G.handNumber;

    el.vira.innerHTML = '';
    if (G.vira) el.vira.appendChild(cardEl(G.vira));
    el.manilha.textContent = G.manilhaRank ? `Manilha: ${G.manilhaRank}` : '';

    renderSeat(el.seatTop, G.players[2], false);
    renderSeat(el.seatLeft, G.players[3], false);
    renderSeat(el.seatRight, G.players[1], false);
    renderSeat(el.seatBottom, G.players[0], true);
    el.seatTop.classList.toggle('turn-active', G.phase === 'playing' && G.turnIndex === 2);
    el.seatLeft.classList.toggle('turn-active', G.phase === 'playing' && G.turnIndex === 3);
    el.seatRight.classList.toggle('turn-active', G.phase === 'playing' && G.turnIndex === 1);
    el.seatBottom.classList.toggle('turn-active', G.phase === 'playing' && G.turnIndex === 0);

    renderSlot(el.slotTop, G.table[2], 2);
    renderSlot(el.slotLeft, G.table[3], 3);
    renderSlot(el.slotRight, G.table[1], 1);
    renderSlot(el.slotBottom, G.table[0], 0);

    renderActionBar();
}

function renderSeat(container, player, isHuman) {
    container.querySelector('.seat-name').textContent = player.name + (isHuman ? ' (você)' : '');
    const handDiv = container.querySelector('.seat-hand');
    handDiv.innerHTML = '';
    if (isHuman) {
        player.hand.forEach((card) => {
            const c = cardEl(card);
            c.classList.add('clickable');
            const canPlay = G.phase === 'playing' && G.turnIndex === 0 && !G.matchOver;
            if (!canPlay) c.classList.add('disabled');
            else {
                if (playHiddenMode) c.classList.add('card-armed');
                c.addEventListener('click', () => onHumanPlay(card));
            }
            handDiv.appendChild(c);
        });
    } else if (G.maoDeFerro || (G.maoDeOnze && G.maoOnzeTeam === 'A' && player.team === 'A')) {
        player.hand.forEach((card) => handDiv.appendChild(cardEl(card)));
    } else {
        player.hand.forEach(() => handDiv.appendChild(cardBackEl()));
    }
}

function renderSlot(container, entry, playerIndex) {
    container.innerHTML = '';
    const isWinner = G.phase === 'trick-over' && G.trickWinnerIndex === playerIndex;
    container.classList.toggle('slot-winner', isWinner);
    if (!entry) return;
    const cardDiv = entry.hidden ? cardBackEl() : cardEl(entry.card);
    if (isWinner) cardDiv.classList.add('card-winner');
    container.appendChild(cardDiv);
}

function renderActionBar() {
    el.actionBar.innerHTML = '';
    clearHumanTimer();

    if (G.matchOver) {
        showEndModal();
        return;
    }

    if (G.phase === 'ferro-reveal') {
        el.actionBar.innerHTML = '<p class="prompt">Mão de ferro! Todas as cartas na mesa. Boa sorte.</p>';
        addButton('Continuar', () => {
            logSilentOpponentSignal(G);
            beginTeamASignalPhase(G);
            tick();
        });
        return;
    }

    if (G.phase === 'mao11-human') {
        el.actionBar.innerHTML = '<p class="prompt">Mão de Onze! Sua dupla está com 11 pontos. Vocês veem as cartas uma da outra (mão aberta). Jogar vale 3, correr entrega 1 ponto.</p>';
        addButton('Jogar (vale 3)', () => {
            logSilentOpponentSignal(G);
            G.phase = 'playing';
            tick();
        });
        addButton('Correr (perde 1)', () => {
            runFromHand(G, 'A', 1);
            tick();
        }, true);
        startHumanTimer(() => {
            runFromHand(G, 'A', 1);
            tick();
        });
        return;
    }

    if (G.phase === 'signal-phase') {
        const s = G.dudaSignal;
        el.actionBar.innerHTML = `<p class="prompt">Duda sinalizou: ${s.icon} ${s.desc} Agora é sua vez de sinalizar para ela antes da 1ª carta.</p>`;
        showBanner(`Duda sinalizou: ${s.icon}`);
        showAvatarSignal('duda', el.badgeDuda, s.icon);
        startHumanTimer(() => {
            const nada = SINAIS.find((x) => x.id === 'nada');
            sendPartnerSignal(G, nada.boost);
            showAvatarSignal('voce', el.badgeVoce, nada.icon);
            G.log('Você não sinalizou a tempo — sinal de "não tenho nada" enviado automaticamente.');
            tick();
        });
        return;
    }

    if (G.phase === 'trick-over') {
        const r = G.trickResolution;
        el.actionBar.innerHTML = `<p class="prompt">${r && r.result === 'D' ? 'Vaza empatada.' : `Vaza vencida por ${teamName(r.result)}!`}</p>`;
        return;
    }

    if (G.phase === 'hand-over' || G.phase === 'mao11-bot') {
        el.actionBar.innerHTML = '<p class="prompt">Preparando a próxima mão...</p>';
        if (G.phase === 'hand-over' && G.lastHandWinner) {
            showBanner(
                G.lastHandWinner === 'A' ? '🎉 Vitória da mão!' : '😕 Vocês perderam a mão',
                G.lastHandWinner === 'A' ? 'win' : 'lose'
            );
        }
        return;
    }

    if (G.phase === 'awaiting-response' && !G.pendingCall) {
        el.actionBar.innerHTML = '<p class="prompt">Aguardando...</p>';
        return;
    }

    if (G.phase === 'awaiting-response' && G.pendingCall.respondingTeam === 'A') {
        const call = G.pendingCall;
        el.actionBar.innerHTML = `<p class="prompt">${teamName(call.byTeam)} pediu ${CALL_NAME[call.level]}! Vale ${call.level} pontos.</p>`;
        addButton('Aceitar', () => { acceptCall(G); tick(); });
        addButton('Correr', () => { runFromCall(G); tick(); }, true);
        if (call.level < 12) {
            const raisedLevel = nextLevel(call.level);
            addButton(`Aumentar p/ ${CALL_NAME[raisedLevel]}`, () => {
                raiseCall(G);
                showBanner(`Você pediu ${CALL_NAME[raisedLevel]}!`);
                tick();
            });
        }
        startHumanTimer(() => { runFromCall(G); tick(); });
        return;
    }

    if (G.phase === 'awaiting-response') {
        const call = G.pendingCall;
        const caller = call.byPlayerName || teamName(call.byTeam);
        el.actionBar.innerHTML = `<p class="prompt">${caller} pediu ${CALL_NAME[call.level]}! Aguardando resposta de ${teamName(call.respondingTeam)}...</p>`;
        return;
    }

    if (G.phase === 'playing' && G.turnIndex === 0) {
        playHiddenMode = false;
        const canHide = G.roundResults.length > 0;
        el.actionBar.innerHTML = canHide
            ? '<p class="prompt">Sua vez: jogue uma carta, peça um aumento ou jogue uma carta virada.</p>'
            : '<p class="prompt">Sua vez: jogue uma carta ou peça um aumento.</p>';
        if (canCall(G, 'A')) {
            const callLevel = nextLevel(G.stake);
            addButton(`Pedir ${CALL_NAME[callLevel]}`, () => {
                makeCall(G, 'A', 'Você');
                showBanner(`Você pediu ${CALL_NAME[callLevel]}!`);
                tick();
            });
        }
        if (canHide) {
            const hideBtn = addButton('🂠 Jogar virada', () => {
                playHiddenMode = !playHiddenMode;
                hideBtn.classList.toggle('btn-active', playHiddenMode);
                renderSeat(el.seatBottom, G.players[0], true);
            }, true);
            hideBtn.title = 'Depois da 1ª rodada você pode "queimar" uma carta virada, sem revelar seu valor.';
        }
        startHumanTimer(() => {
            const card = aiPickCard(G, 0);
            playCard(G, 0, card, false);
            advanceTurnAfterPlay(G);
            tick();
        });
        return;
    }

    el.actionBar.innerHTML = `<p class="prompt">Vez de ${G.players[G.turnIndex].name}...</p>`;
}

function addButton(label, onClick, secondary) {
    const btn = document.createElement('button');
    btn.className = secondary ? 'btn btn-secondary' : 'btn btn-primary';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    el.actionBar.appendChild(btn);
    return btn;
}

function onHumanPlay(card) {
    if (G.phase !== 'playing' || G.turnIndex !== 0) return;
    const hidden = playHiddenMode && G.roundResults.length > 0;
    playHiddenMode = false;
    playCard(G, 0, card, hidden);
    advanceTurnAfterPlay(G);
    afterCardPlayed();
}

function afterCardPlayed() {
    render();
    if (G.matchOver) return;
    scheduled = true;
    setTimeout(() => {
        scheduled = false;
        tick();
    }, PLAY_TURN_DELAY);
}

function showEndModal() {
    el.endTitle.textContent = G.winner === 'A' ? '🏆 Vitória!' : '💔 Derrota';
    el.endText.textContent = `Placar final: Nós ${G.score.A} x ${G.score.B} Eles.`;
    el.endModal.classList.add('open');
}

function tick() {
    render();
    if (G.matchOver) return;
    if (scheduled) return;

    if (G.phase === 'trick-over') {
        finishTrick(G);
        tick();
        return;
    }

    if (G.phase === 'hand-over') {
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            startHand(G);
            tick();
        }, 1600);
        return;
    }

    if (G.phase === 'mao11-bot') {
        const team = G.score.A === 11 ? 'A' : 'B';
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            const decision = aiMaoOnzeDecision(G, team);
            G.log(`${teamName(team)} decidiu ${decision === 'jogar' ? 'jogar (vale 3)' : 'correr (perde 1)'} na mão de onze.`);
            if (decision === 'correr') runFromHand(G, team, 1);
            else beginTeamASignalPhase(G);
            tick();
        }, BOT_DELAY);
        return;
    }

    if (G.phase === 'awaiting-response' && G.pendingCall && G.pendingCall.respondingTeam === 'B') {
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            if (!G.pendingCall) { tick(); return; }
            const decision = aiRespondToCall(G);
            if (decision === 'accept') acceptCall(G);
            else if (decision === 'run') runFromCall(G);
            else {
                const call = G.pendingCall;
                const newLevel = nextLevel(call.level);
                const newCaller = call.respondingTeam;
                raiseCall(G);
                showBanner(`${teamName(newCaller)} pediu ${CALL_NAME[newLevel]}!`);
            }
            tick();
        }, BOT_DELAY);
        return;
    }

    if (G.phase === 'playing' && G.turnIndex !== 0) {
        const idx = G.turnIndex;
        if (aiConsiderCall(G, idx)) {
            const player = G.players[idx];
            const level = nextLevel(G.stake);
            makeCall(G, player.team, player.name);
            showBanner(`${player.name} pediu ${CALL_NAME[level]}!`);
            tick();
        } else {
            const card = aiPickCard(G, idx);
            playCard(G, idx, card);
            advanceTurnAfterPlay(G);
            afterCardPlayed();
        }
        return;
    }
}

function buildSignalRow() {
    el.signalRow.innerHTML = '<span class="signal-label">Sinalizar p/ Duda:</span>';
    SINAIS.forEach((s) => {
        const btn = document.createElement('button');
        btn.className = 'signal-btn';
        btn.title = s.desc;
        btn.innerHTML = `<span class="signal-icon">${s.icon}</span>`;
        btn.addEventListener('click', () => {
            const wasSignalPhase = G.phase === 'signal-phase';
            sendPartnerSignal(G, s.boost);
            showAvatarSignal('voce', el.badgeVoce, s.icon);
            G.log(`Você sinalizou: ${s.desc}`);
            if (wasSignalPhase) tick();
            else render();
        });
        el.signalRow.appendChild(btn);
    });
}

function newGame() {
    G = createGame(logMessage);
    G.log_messages = [];
    scheduled = false;
    startHand(G);
    tick();
}

el.newGameBtn.addEventListener('click', newGame);
el.endPlayAgain.addEventListener('click', () => {
    el.endModal.classList.remove('open');
    newGame();
});
el.infoBtn.addEventListener('click', () => el.infoModal.classList.add('open'));
el.infoClose.addEventListener('click', () => el.infoModal.classList.remove('open'));
el.infoModal.addEventListener('click', (e) => { if (e.target === el.infoModal) el.infoModal.classList.remove('open'); });

el.historyBtn.addEventListener('click', () => el.historyModal.classList.add('open'));
el.historyClose.addEventListener('click', () => el.historyModal.classList.remove('open'));
el.historyModal.addEventListener('click', (e) => { if (e.target === el.historyModal) el.historyModal.classList.remove('open'); });

buildSignalRow();
newGame();
