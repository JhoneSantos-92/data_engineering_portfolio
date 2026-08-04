'use strict';

const RANK_ORDER = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const SUITS = ['O', 'E', 'C', 'P'];
const SUIT_INFO = {
    O: { name: 'Ouros', symbol: '♦', color: 'red' },
    E: { name: 'Espadas', symbol: '♠', color: 'black' },
    C: { name: 'Copas', symbol: '♥', color: 'red' },
    P: { name: 'Paus', symbol: '♣', color: 'black' },
};
// Ordem de força das manilhas, do truco paulista: ouros < espadas < copas < paus (zap)
const SUIT_MANILHA_RANK = { O: 1, E: 2, C: 3, P: 4 };

const SEATS = [
    { id: 0, name: 'Você', team: 'A', human: true },
    { id: 1, name: 'Zeca', team: 'B', human: false },
    { id: 2, name: 'Duda', team: 'A', human: false },
    { id: 3, name: 'Naná', team: 'B', human: false },
];

const CALL_NAME = { 3: 'TRUCO', 6: 'SEIS', 9: 'NOVE', 12: 'DOZE' };
const nextLevel = (s) => (s === 1 ? 3 : s === 3 ? 6 : s === 6 ? 9 : 12);

function buildDeck() {
    const deck = [];
    for (const rank of RANK_ORDER) {
        for (const suit of SUITS) deck.push({ rank, suit });
    }
    return deck;
}

function shuffle(deck) {
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

function cardStrength(card, manilhaRank) {
    if (card.rank === manilhaRank) return 100 + SUIT_MANILHA_RANK[card.suit];
    return RANK_ORDER.indexOf(card.rank) + 1;
}

function cardLabel(card) {
    return `${card.rank}${SUIT_INFO[card.suit].symbol}`;
}

function handStrength(hand, manilhaRank) {
    return hand.reduce((sum, c) => sum + cardStrength(c, manilhaRank), 0);
}

// Resolve o vencedor da mao a partir dos resultados de cada vaza ('A' | 'B' | 'D').
// Empate na 1a vaza passa a decisao para a 2a; empate na vaza decisiva mantem quem
// venceu (ou empatou) por ultimo antes, e um triplo empate vai para quem "abriu" a mao.
function decideHandWinner(results, firstLeaderTeam) {
    const [r1, r2, r3] = results;
    if (r1 !== 'D') {
        if (!r2) return null;
        if (r2 === r1 || r2 === 'D') return r1;
        if (!r3) return null;
        return r3 === 'D' ? r1 : r3;
    }
    if (!r2) return null;
    if (r2 !== 'D') return r2;
    if (!r3) return null;
    if (r3 !== 'D') return r3;
    return firstLeaderTeam;
}

const SINAIS = [
    { id: 'paus', icon: '😉', label: 'Piscar o olho', desc: 'Sinal do Zap: você tem a manilha de Paus, a carta mais forte do jogo.', boost: 4 },
    { id: 'copas', icon: '🤨', label: 'Levantar a sobrancelha', desc: 'Sinal da manilha de Copas.', boost: 3 },
    { id: 'espadas', icon: '🙂‍↔️', label: 'Balançar o rosto', desc: 'Sinal da manilha de Espadas.', boost: 2 },
    { id: 'ouros', icon: '😛', label: 'Mostrar a língua', desc: 'Sinal da manilha de Ouros.', boost: 1 },
    { id: 'nada', icon: '😮‍💨', label: 'Suspirar', desc: 'Sinal de mão fraca: "não tenho nada".', boost: -3 },
];

function createGame(logFn) {
    const G = {
        players: SEATS.map((s) => ({ ...s, hand: [] })),
        deck: [],
        vira: null,
        manilhaRank: null,
        dealerIndex: 3,
        leaderIndex: 0,
        firstLeaderTeam: 'A',
        turnIndex: 0,
        table: [null, null, null, null],
        roundResults: [],
        stake: 1,
        pendingCall: null,
        callRight: null,
        score: { A: 0, B: 0 },
        handNumber: 0,
        maoDeOnze: false,
        maoOnzeTeam: null,
        maoDeFerro: false,
        partnerSignal: 0,
        matchOver: false,
        lastHandWinner: null,
        phase: 'idle',
        log: logFn || (() => {}),
    };
    return G;
}

function teamName(team) {
    return team === 'A' ? 'Nós' : 'Eles';
}

function startHand(G) {
    G.handNumber += 1;
    G.deck = shuffle(buildDeck());
    G.players.forEach((p) => (p.hand = []));
    for (let i = 0; i < 3; i++) {
        for (const p of G.players) p.hand.push(G.deck.pop());
    }
    G.vira = G.deck.pop();
    G.manilhaRank = RANK_ORDER[(RANK_ORDER.indexOf(G.vira.rank) + 1) % RANK_ORDER.length];

    G.dealerIndex = (G.dealerIndex + 1) % 4;
    G.leaderIndex = (G.dealerIndex + 1) % 4;
    G.turnIndex = G.leaderIndex;
    G.firstLeaderTeam = G.players[G.leaderIndex].team;
    G.table = [null, null, null, null];
    G.roundResults = [];
    G.stake = 1;
    G.pendingCall = null;
    G.callRight = null;
    G.partnerSignal = 0;
    G.maoDeOnze = false;
    G.maoOnzeTeam = null;
    G.maoDeFerro = false;
    G.lastHandWinner = null;

    G.log(`--- Mão ${G.handNumber} --- vira: ${cardLabel(G.vira)} (manilha: ${G.manilhaRank})`);

    if (G.score.A === 11 && G.score.B === 11) {
        G.maoDeFerro = true;
        G.stake = 3;
        G.log('MÃO DE FERRO! Ambas as duplas em 11 pontos. Todas as cartas reveladas, vale 3.');
        G.phase = 'ferro-reveal';
        return;
    }
    if (G.score.A === 11 || G.score.B === 11) {
        G.maoDeOnze = true;
        G.maoOnzeTeam = G.score.A === 11 ? 'A' : 'B';
        G.stake = 3;
        G.log(`MÃO DE ONZE para ${teamName(G.maoOnzeTeam)}! Vale 3 pontos. A dupla vê as cartas uma da outra (mão aberta) e só pode jogar ou correr.`);
        G.phase = G.maoOnzeTeam === 'A' ? 'mao11-human' : 'mao11-bot';
        return;
    }
    G.phase = 'playing';
}

function teamHandStrength(G, team) {
    return G.players.filter((p) => p.team === team).reduce((s, p) => s + handStrength(p.hand, G.manilhaRank), 0);
}

function tableEntryStrength(entry, manilhaRank) {
    return entry.hidden ? -1 : cardStrength(entry.card, manilhaRank);
}

function playCard(G, playerIndex, card, hidden = false) {
    const player = G.players[playerIndex];
    player.hand = player.hand.filter((c) => !(c.rank === card.rank && c.suit === card.suit));
    G.table[playerIndex] = { card, hidden };
    G.log(hidden ? `${player.name} jogou uma carta virada.` : `${player.name} jogou ${cardLabel(card)}.`);
}

function advanceTurnAfterPlay(G) {
    const filled = G.table.filter(Boolean).length;
    if (filled === 4) {
        resolveTrick(G);
        return;
    }
    G.turnIndex = (G.turnIndex + 1) % 4;
    G.phase = 'playing';
}

function resolveTrick(G) {
    const strengths = G.table.map((entry) => tableEntryStrength(entry, G.manilhaRank));
    const max = Math.max(...strengths);
    const topPlayers = strengths.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0);
    const teams = new Set(topPlayers.map((i) => G.players[i].team));

    let result;
    let winnerIndex = null;
    if (teams.size === 1) {
        result = [...teams][0];
        winnerIndex = topPlayers[0];
    } else {
        result = 'D';
    }
    G.roundResults.push(result);

    const roundNum = G.roundResults.length;
    if (result === 'D') G.log(`Vaza ${roundNum} empatada.`);
    else G.log(`Vaza ${roundNum} vencida por ${teamName(result)}.`);

    const decided = decideHandWinner(G.roundResults, G.firstLeaderTeam);
    G.table = [null, null, null, null];

    if (decided) {
        endHand(G, decided);
        return;
    }
    if (G.roundResults.length >= 3) {
        endHand(G, G.firstLeaderTeam);
        return;
    }

    if (result !== 'D') G.leaderIndex = winnerIndex;
    G.turnIndex = G.leaderIndex;
    G.phase = 'playing';
}

function endHand(G, winnerTeam) {
    G.score[winnerTeam] += G.stake;
    G.lastHandWinner = winnerTeam;
    G.log(`${teamName(winnerTeam)} venceu a mão e soma ${G.stake} ponto(s). Placar: Nós ${G.score.A} x ${G.score.B} Eles.`);
    G.phase = 'hand-over';
    if (G.score[winnerTeam] >= 12) {
        G.matchOver = true;
        G.winner = winnerTeam;
        G.log(`${teamName(winnerTeam)} venceu a partida com ${G.score[winnerTeam]} pontos!`);
    }
}

function runFromHand(G, runningTeam, points) {
    const otherTeam = runningTeam === 'A' ? 'B' : 'A';
    G.lastHandWinner = otherTeam;
    G.log(`${teamName(runningTeam)} correu. ${teamName(otherTeam)} ganha ${points} ponto(s).`);
    G.score[otherTeam] += points;
    G.phase = 'hand-over';
    if (G.score[otherTeam] >= 12) {
        G.matchOver = true;
        G.winner = otherTeam;
        G.log(`${teamName(otherTeam)} venceu a partida com ${G.score[otherTeam]} pontos!`);
    }
}

function canCall(G, team) {
    return G.stake < 12 && !G.maoDeOnze && !G.maoDeFerro && (G.callRight === null || G.callRight === team);
}

function makeCall(G, byTeam) {
    const level = nextLevel(G.stake);
    G.pendingCall = { byTeam, level, respondingTeam: byTeam === 'A' ? 'B' : 'A', previousStake: G.stake };
    G.log(`${teamName(byTeam)} pediu ${CALL_NAME[level]}! Vale ${level} pontos se aceito.`);
    G.phase = 'awaiting-response';
}

function acceptCall(G) {
    if (!G.pendingCall) return;
    G.log(`${teamName(G.pendingCall.respondingTeam)} aceitou. Valendo ${G.pendingCall.level} pontos.`);
    G.stake = G.pendingCall.level;
    G.callRight = G.pendingCall.respondingTeam;
    G.pendingCall = null;
    G.phase = 'playing';
}

function runFromCall(G) {
    if (!G.pendingCall) return;
    const call = G.pendingCall;
    G.pendingCall = null;
    runFromHand(G, call.respondingTeam, call.previousStake);
}

function raiseCall(G) {
    if (!G.pendingCall) return;
    const call = G.pendingCall;
    G.stake = call.level;
    G.callRight = call.respondingTeam;
    G.log(`${teamName(call.respondingTeam)} aceitou e já aumentou!`);
    makeCall(G, call.respondingTeam);
}

// --- IA -------------------------------------------------------------------

function aiPickCard(G, playerIndex) {
    const player = G.players[playerIndex];
    const hand = player.hand.slice().sort((a, b) => cardStrength(a, G.manilhaRank) - cardStrength(b, G.manilhaRank));
    const tableCards = G.table.map((entry, i) => (entry ? { strength: tableEntryStrength(entry, G.manilhaRank), team: G.players[i].team } : null)).filter(Boolean);
    const bestOnTable = tableCards.length ? Math.max(...tableCards.map((t) => t.strength)) : -1;
    const teamAlreadyWinning = tableCards.some((t) => t.team === player.team && t.strength === bestOnTable);

    if (tableCards.length === 0) {
        const roundsWon = countRoundsWonBy(G, player.team);
        if (roundsWon > 0 || G.roundResults.length === 2) return hand[hand.length - 1];
        return hand[0];
    }

    if (teamAlreadyWinning) return hand[0];

    const winners = hand.filter((c) => cardStrength(c, G.manilhaRank) > bestOnTable);
    if (winners.length) return winners[0];
    return hand[0];
}

function countRoundsWonBy(G, team) {
    return G.roundResults.filter((r) => r === team).length;
}

function aiEstimateStrength(G, team) {
    let s = teamHandStrength(G, team) / G.players.filter((p) => p.team === team).length;
    if (team === 'A') s += G.partnerSignal * 6;
    return s;
}

function aiConsiderCall(G, playerIndex) {
    const player = G.players[playerIndex];
    if (!canCall(G, player.team)) return false;
    const strength = aiEstimateStrength(G, player.team);
    const threshold = 16 + Math.random() * 9;
    return strength > threshold && Math.random() < 0.55;
}

function aiRespondToCall(G) {
    const team = G.pendingCall.respondingTeam;
    const strength = aiEstimateStrength(G, team);
    const risk = G.pendingCall.level;
    const acceptThreshold = 12 + risk * 0.6;
    if (strength >= acceptThreshold + 10 && risk < 12 && Math.random() < 0.5) return 'raise';
    if (strength >= acceptThreshold) return 'accept';
    return 'run';
}

function aiMaoOnzeDecision(G, team) {
    const strength = aiEstimateStrength(G, team);
    return strength >= 20 ? 'jogar' : 'correr';
}

export {
    RANK_ORDER, SUITS, SUIT_INFO, SINAIS, CALL_NAME,
    createGame, startHand, playCard, advanceTurnAfterPlay, resolveTrick,
    endHand, runFromHand, makeCall, acceptCall, runFromCall, raiseCall, canCall,
    aiPickCard, aiConsiderCall, aiRespondToCall, aiMaoOnzeDecision,
    cardStrength, cardLabel, handStrength, teamName, nextLevel, teamHandStrength,
    tableEntryStrength,
};
