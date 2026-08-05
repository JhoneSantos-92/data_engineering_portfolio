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
    feltTable: document.querySelector('.felt-table'),
    dealOverlay: document.getElementById('deal-overlay'),
    confettiLayer: document.getElementById('confetti-layer'),
};

const SEAT_BY_INDEX = { 0: 'seatBottom', 1: 'seatRight', 2: 'seatTop', 3: 'seatLeft' };
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let G = createGame(logMessage);
let scheduled = false;
let playHiddenMode = false;
let timerId = null;
let dealing = false;
let viraFlipPending = false;
let lastRenderedVira = null;
let lastTableKeys = [null, null, null, null];
let prevScoreA = 0;
let prevScoreB = 0;

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

function showAvatarSignal(key, badgeEl, icon, signalId) {
    badgeEl.innerHTML = `<span class="signal-icon-glyph anim-${signalId || 'default'}">${icon}</span>`;
    badgeEl.classList.remove('show');
    void badgeEl.offsetWidth;
    badgeEl.classList.add('show');
    if (badgeTimeouts[key]) clearTimeout(badgeTimeouts[key]);
    badgeTimeouts[key] = setTimeout(() => {
        badgeEl.classList.remove('show');
    }, 5000);
}

function pulseFeltTable() {
    if (prefersReducedMotion || !el.feltTable) return;
    el.feltTable.classList.remove('call-pulse');
    void el.feltTable.offsetWidth;
    el.feltTable.classList.add('call-pulse');
}

function shakeFeltTable() {
    if (prefersReducedMotion || !el.feltTable) return;
    el.feltTable.classList.remove('shake');
    void el.feltTable.offsetWidth;
    el.feltTable.classList.add('shake');
}

function triggerCardSweep(winnerIndex) {
    if (prefersReducedMotion || winnerIndex === null || winnerIndex === undefined) return;
    let sx = 0;
    let sy = 0;
    if (winnerIndex === 2) sy = -220;
    else if (winnerIndex === 0) sy = 220;
    else if (winnerIndex === 3) sx = -220;
    else if (winnerIndex === 1) sx = 220;
    [el.slotTop, el.slotLeft, el.slotRight, el.slotBottom].forEach((slot) => {
        const card = slot.querySelector('.card');
        if (!card) return;
        card.style.setProperty('--sx', `${sx}px`);
        card.style.setProperty('--sy', `${sy}px`);
        card.classList.add('sweeping');
    });
}

function runDealAnimation(onDone) {
    if (prefersReducedMotion) {
        onDone();
        return;
    }
    const overlay = el.dealOverlay;
    overlay.innerHTML = '';
    const feltRect = el.feltTable.getBoundingClientRect();
    const deckRect = document.querySelector('.vira-box').getBoundingClientRect();
    const deckX = deckRect.left + deckRect.width / 2 - feltRect.left;
    const deckY = deckRect.top + deckRect.height / 2 - feltRect.top;

    const order = [];
    for (let round = 0; round < 3; round++) {
        for (let p = 0; p < 4; p++) order.push(p);
    }
    order.forEach((playerIdx, i) => {
        const seatEl = el[SEAT_BY_INDEX[playerIdx]];
        const seatRect = seatEl.getBoundingClientRect();
        const targetX = seatRect.left + seatRect.width / 2 - feltRect.left;
        const targetY = seatRect.top + seatRect.height / 2 - feltRect.top;
        const card = document.createElement('div');
        card.className = 'card card-back deal-card';
        card.style.left = `${deckX}px`;
        card.style.top = `${deckY}px`;
        card.style.opacity = '0';
        overlay.appendChild(card);
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.left = `${targetX}px`;
            card.style.top = `${targetY}px`;
        }, 30 + i * 60);
    });

    const totalTime = 30 + order.length * 60 + 600;
    setTimeout(() => {
        overlay.innerHTML = '';
        onDone();
    }, totalTime);
}

function beginHandWithDealAnimation() {
    startHand(G);
    if (prefersReducedMotion) {
        viraFlipPending = false;
        tick();
        return;
    }
    dealing = true;
    render();
    runDealAnimation(() => {
        dealing = false;
        viraFlipPending = true;
        tick();
    });
}

function spawnConfetti() {
    if (prefersReducedMotion) return;
    const colors = ['#e8c25f', '#f2d98a', '#4fae6b', '#7fd89a', '#d9614f'];
    el.confettiLayer.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
        piece.style.animationDelay = `${Math.random() * 0.4}s`;
        el.confettiLayer.appendChild(piece);
    }
    setTimeout(() => {
        el.confettiLayer.innerHTML = '';
    }, 4200);
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
    let cls = `card card-${info.color}` + (opts.small ? ' card-small' : '');
    if (G.manilhaRank && card.rank === G.manilhaRank) cls += ' card-manilha';
    div.className = cls;
    div.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${info.symbol}</span>`;
    return div;
}

function cardBackEl() {
    const div = document.createElement('div');
    div.className = 'card card-back';
    return div;
}

function render() {
    if (dealing) {
        renderDealingShell();
        return;
    }
    el.signalRow.classList.remove('dealing-lock');

    if (G.score.A !== prevScoreA) {
        el.scoreA.classList.remove('flash');
        void el.scoreA.offsetWidth;
        el.scoreA.classList.add('flash');
        prevScoreA = G.score.A;
    }
    if (G.score.B !== prevScoreB) {
        el.scoreB.classList.remove('flash');
        void el.scoreB.offsetWidth;
        el.scoreB.classList.add('flash');
        prevScoreB = G.score.B;
    }
    el.scoreA.textContent = G.score.A;
    el.scoreB.textContent = G.score.B;
    el.handNumber.textContent = G.handNumber;

    if (G.vira !== lastRenderedVira) {
        el.vira.innerHTML = '';
        if (G.vira) {
            const viraDiv = cardEl(G.vira);
            if (viraFlipPending) {
                viraDiv.classList.add('vira-flip');
                viraFlipPending = false;
            }
            el.vira.appendChild(viraDiv);
        }
        lastRenderedVira = G.vira;
    }
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

function renderDealingShell() {
    clearHumanTimer();
    el.scoreA.textContent = G.score.A;
    el.scoreB.textContent = G.score.B;
    el.handNumber.textContent = G.handNumber;
    el.vira.innerHTML = '';
    lastRenderedVira = null;
    el.manilha.textContent = '';
    [el.seatTop, el.seatLeft, el.seatRight, el.seatBottom].forEach((seatEl) => {
        seatEl.classList.remove('turn-active');
        seatEl.querySelector('.seat-hand').innerHTML = '';
    });
    [el.slotTop, el.slotLeft, el.slotRight, el.slotBottom].forEach((slotEl) => {
        slotEl.innerHTML = '';
        slotEl.classList.remove('slot-winner');
    });
    lastTableKeys = [null, null, null, null];
    el.actionBar.innerHTML = '<p class="prompt">Distribuindo as cartas...</p>';
    el.signalRow.classList.add('dealing-lock');
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

const SLOT_DIRECTION = { 0: 'slide-bottom', 1: 'slide-right', 2: 'slide-top', 3: 'slide-left' };

function renderSlot(container, entry, playerIndex) {
    const key = entry ? (entry.hidden ? 'hidden' : `${entry.card.rank}${entry.card.suit}`) : null;
    const isNew = key !== lastTableKeys[playerIndex];
    lastTableKeys[playerIndex] = key;

    container.innerHTML = '';
    const isWinner = G.phase === 'trick-over' && G.trickWinnerIndex === playerIndex;
    container.classList.toggle('slot-winner', isWinner);
    if (!entry) return;
    const cardDiv = entry.hidden ? cardBackEl() : cardEl(entry.card);
    if (isWinner) cardDiv.classList.add('card-winner');
    if (isNew && !prefersReducedMotion) cardDiv.classList.add(SLOT_DIRECTION[playerIndex]);
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
        showAvatarSignal('duda', el.badgeDuda, s.icon, s.id);
        startHumanTimer(() => {
            const nada = SINAIS.find((x) => x.id === 'nada');
            sendPartnerSignal(G, nada.boost);
            showAvatarSignal('voce', el.badgeVoce, nada.icon, nada.id);
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
            if (G.lastHandWinner === 'B' && G.stake >= 3) shakeFeltTable();
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
                pulseFeltTable();
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
                pulseFeltTable();
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
            if (!card) { tick(); return; }
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
    const modalBox = el.endModal.querySelector('.modal-box');
    modalBox.classList.toggle('win-glow', G.winner === 'A');
    if (G.winner === 'A') spawnConfetti();
}

function tick() {
    render();
    if (G.matchOver) return;
    if (scheduled) return;

    if (G.phase === 'trick-over') {
        triggerCardSweep(G.trickWinnerIndex);
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            finishTrick(G);
            tick();
        }, prefersReducedMotion ? 0 : 480);
        return;
    }

    if (G.phase === 'hand-over') {
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            beginHandWithDealAnimation();
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
                pulseFeltTable();
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
            pulseFeltTable();
            tick();
        } else {
            const card = aiPickCard(G, idx);
            if (!card) { tick(); return; }
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
            if (dealing) return;
            const wasSignalPhase = G.phase === 'signal-phase';
            sendPartnerSignal(G, s.boost);
            showAvatarSignal('voce', el.badgeVoce, s.icon, s.id);
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
    dealing = false;
    lastRenderedVira = null;
    lastTableKeys = [null, null, null, null];
    prevScoreA = 0;
    prevScoreB = 0;
    beginHandWithDealAnimation();
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
