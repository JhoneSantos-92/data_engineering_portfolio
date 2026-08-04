import {
    SUIT_INFO, SINAIS, CALL_NAME,
    createGame, startHand, playCard, advanceTurnAfterPlay,
    runFromHand, makeCall, acceptCall, runFromCall, raiseCall,
    aiPickCard, aiConsiderCall, aiRespondToCall, aiMaoOnzeDecision,
    cardLabel, teamName, nextLevel,
} from './truco.js';

const BOT_DELAY = 850;

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
    signalRow: document.getElementById('signal-row'),
    newGameBtn: document.getElementById('new-game-btn'),
    infoBtn: document.getElementById('info-btn'),
    infoModal: document.getElementById('info-modal'),
    infoClose: document.getElementById('info-close'),
    endModal: document.getElementById('end-modal'),
    endTitle: document.getElementById('end-title'),
    endText: document.getElementById('end-text'),
    endPlayAgain: document.getElementById('end-play-again'),
};

let G = createGame(logMessage);
let scheduled = false;

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

    renderSlot(el.slotTop, G.table[2]);
    renderSlot(el.slotLeft, G.table[3]);
    renderSlot(el.slotRight, G.table[1]);
    renderSlot(el.slotBottom, G.table[0]);

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
            else c.addEventListener('click', () => onHumanPlay(card));
            handDiv.appendChild(c);
        });
    } else if (G.maoDeFerro) {
        player.hand.forEach((card) => handDiv.appendChild(cardEl(card)));
    } else {
        player.hand.forEach(() => handDiv.appendChild(cardBackEl()));
    }
}

function renderSlot(container, card) {
    container.innerHTML = '';
    if (card) container.appendChild(cardEl(card));
}

function renderActionBar() {
    el.actionBar.innerHTML = '';
    el.signalRow.style.display = 'none';

    if (G.matchOver) {
        showEndModal();
        return;
    }

    if (G.phase === 'ferro-reveal') {
        el.actionBar.innerHTML = '<p class="prompt">Mão de ferro! Todas as cartas na mesa. Boa sorte.</p>';
        addButton('Continuar', () => {
            G.phase = 'playing';
            tick();
        });
        return;
    }

    if (G.phase === 'mao11-human') {
        el.actionBar.innerHTML = '<p class="prompt">Mão de Onze! Sua dupla está com 11 pontos. Jogar vale 3, correr entrega 1 ponto.</p>';
        addButton('Jogar (vale 3)', () => {
            G.phase = 'playing';
            tick();
        });
        addButton('Correr (perde 1)', () => {
            runFromHand(G, 'A', 1);
            tick();
        }, true);
        return;
    }

    if (G.phase === 'hand-over' || G.phase === 'mao11-bot') {
        el.actionBar.innerHTML = '<p class="prompt">Preparando a próxima mão...</p>';
        return;
    }

    if (G.phase === 'awaiting-response' && G.pendingCall.respondingTeam === 'A') {
        const call = G.pendingCall;
        el.actionBar.innerHTML = `<p class="prompt">${teamName(call.byTeam)} pediu ${CALL_NAME[call.level]}! Vale ${call.level} pontos.</p>`;
        addButton('Aceitar', () => { acceptCall(G); tick(); });
        addButton('Correr', () => { runFromCall(G); tick(); }, true);
        if (call.level < 12) addButton(`Aumentar p/ ${CALL_NAME[nextLevel(call.level)]}`, () => { raiseCall(G); tick(); });
        return;
    }

    if (G.phase === 'awaiting-response') {
        el.actionBar.innerHTML = `<p class="prompt">Aguardando resposta de ${teamName(G.pendingCall.respondingTeam)}...</p>`;
        return;
    }

    if (G.phase === 'playing' && G.turnIndex === 0) {
        el.actionBar.innerHTML = '<p class="prompt">Sua vez: jogue uma carta ou peça um aumento.</p>';
        if (G.stake < 12 && !G.maoDeOnze && !G.maoDeFerro) {
            addButton(`Pedir ${CALL_NAME[nextLevel(G.stake)]}`, () => { makeCall(G, 'A'); tick(); });
        }
        el.signalRow.style.display = 'flex';
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
}

function onHumanPlay(card) {
    if (G.phase !== 'playing' || G.turnIndex !== 0) return;
    playCard(G, 0, card);
    advanceTurnAfterPlay(G);
    tick();
}

function showEndModal() {
    el.endTitle.textContent = G.winner === 'A' ? 'Você venceu!' : 'Você perdeu!';
    el.endText.textContent = `Placar final: Nós ${G.score.A} x ${G.score.B} Eles.`;
    el.endModal.classList.add('open');
}

function tick() {
    render();
    if (G.matchOver) return;
    if (scheduled) return;

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
            else G.phase = 'playing';
            tick();
        }, BOT_DELAY);
        return;
    }

    if (G.phase === 'awaiting-response' && G.pendingCall.respondingTeam === 'B') {
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            const decision = aiRespondToCall(G);
            if (decision === 'accept') acceptCall(G);
            else if (decision === 'run') runFromCall(G);
            else raiseCall(G);
            tick();
        }, BOT_DELAY);
        return;
    }

    if (G.phase === 'playing' && G.turnIndex !== 0) {
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            const idx = G.turnIndex;
            const noCallYet = !G.maoDeOnze && !G.maoDeFerro && G.stake < 12;
            if (noCallYet && aiConsiderCall(G, idx)) {
                makeCall(G, G.players[idx].team);
            } else {
                const card = aiPickCard(G, idx);
                playCard(G, idx, card);
                advanceTurnAfterPlay(G);
            }
            tick();
        }, BOT_DELAY);
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
            G.partnerSignal = s.boost;
            G.log(`Você sinalizou: ${s.desc}`);
            render();
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

buildSignalRow();
newGame();
