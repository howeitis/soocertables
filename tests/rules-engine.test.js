/**
 * Rules Engine Unit Tests — Tests all 4 PRD Acceptance Criteria
 * Run: node tests/rules-engine.test.js
 */

const assert = require('assert');
const {
    calculateTeamPoints,
    calculatePlayerGoals,
    calculatePayouts,
    isSupercup,
    getDomesticCupBonus,
    getUefaCupBonus,
} = require('../js/rules-engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
    }
}

console.log('\n🏟️  Soccer Pool Tracker — Rules Engine Tests\n');

// ═══════════════════════════════════════════════════════════════════
// TEST CASE A: Team Points — Cup Math (Non-Stacking)
// Arsenal: 80 league pts + FA Cup Runner-up (+12) + UCL Winner (+20)
// Expected: 112 (NOT 112 + 8 from semifinal)
// ═══════════════════════════════════════════════════════════════════
console.log('Test Case A: Team Points — Cup Milestones Do Not Stack');

test('Arsenal: 80 league + FA Cup Runner-up (+12) + UCL Winner (+20) = 112', () => {
    const result = calculateTeamPoints({
        league_points: 80,
        uefa_league_phase_points: 0,
        domestic_cup: { milestone: 'runner_up' },  // +12 (NOT +12 + +8)
        uefa_cup: { competition: 'champions_league', milestone: 'winner' }, // +20
    });
    assert.strictEqual(result.total, 112);
    assert.strictEqual(result.domestic_cup_points, 12);
    assert.strictEqual(result.uefa_points, 20); // 0 phase + 20 bonus
});

test('Domestic cup semifinal only = +8', () => {
    const result = calculateTeamPoints({
        league_points: 50,
        uefa_league_phase_points: 10,
        domestic_cup: { milestone: 'semifinal' },
        uefa_cup: null,
    });
    assert.strictEqual(result.total, 68); // 50 + 10 + 8
    assert.strictEqual(result.domestic_cup_points, 8);
});

test('Domestic cup winner = +15 (not +15 +12 +8)', () => {
    const result = calculateTeamPoints({
        league_points: 60,
        uefa_league_phase_points: 0,
        domestic_cup: { milestone: 'winner' },
        uefa_cup: null,
    });
    assert.strictEqual(result.total, 75); // 60 + 15
    assert.strictEqual(result.domestic_cup_points, 15);
});

test('Europa League runner-up = +10 (not +10 +6)', () => {
    const result = calculateTeamPoints({
        league_points: 40,
        uefa_league_phase_points: 12,
        domestic_cup: null,
        uefa_cup: { competition: 'europa_league', milestone: 'runner_up' },
    });
    assert.strictEqual(result.total, 62); // 40 + 12 + 10
    assert.strictEqual(result.uefa_points, 22); // 12 phase + 10 bonus
});

test('Conference League winner = +12', () => {
    const result = calculateTeamPoints({
        league_points: 30,
        uefa_league_phase_points: 8,
        domestic_cup: null,
        uefa_cup: { competition: 'conference_league', milestone: 'winner' },
    });
    assert.strictEqual(result.total, 50); // 30 + 8 + 12
});

test('No cups = league + UEFA phase only', () => {
    const result = calculateTeamPoints({
        league_points: 80,
        uefa_league_phase_points: 18,
        domestic_cup: null,
        uefa_cup: null,
    });
    assert.strictEqual(result.total, 98);
});

// ═══════════════════════════════════════════════════════════════════
// TEST CASE B: Goal Math — Extra Time vs. Shootout
// Mbappe: 1 goal (90min) + 1 goal (118min ET) + 1 penalty shootout
// Expected: 2
// ═══════════════════════════════════════════════════════════════════
console.log('\nTest Case B: Goal Math — Extra Time vs. Shootout');

test('Mbappe: 1 normal + 1 ET + 1 shootout = 2 goals counted', () => {
    const goals = [
        { date: '2025-11-15', minute: 90, type: 'normal', competition: 'Ligue 1' },
        { date: '2025-11-15', minute: 118, type: 'normal', competition: 'Ligue 1' },
        { date: '2025-11-15', minute: 0, type: 'penalty_shootout', competition: 'Ligue 1' },
    ];
    const count = calculatePlayerGoals(goals, '2025-08-01');
    assert.strictEqual(count, 2);
});

test('Own goals are excluded', () => {
    const goals = [
        { date: '2025-10-01', minute: 45, type: 'normal', competition: 'Premier League' },
        { date: '2025-10-01', minute: 67, type: 'own_goal', competition: 'Premier League' },
    ];
    const count = calculatePlayerGoals(goals, '2025-08-01');
    assert.strictEqual(count, 1);
});

test('Regular penalties (in-match) DO count', () => {
    const goals = [
        { date: '2025-10-01', minute: 85, type: 'penalty', competition: 'La Liga' },
    ];
    const count = calculatePlayerGoals(goals, '2025-08-01');
    assert.strictEqual(count, 1);
});

test('Supercup goals are excluded', () => {
    const goals = [
        { date: '2025-08-10', minute: 30, type: 'normal', competition: 'UEFA Super Cup' },
        { date: '2025-08-14', minute: 60, type: 'normal', competition: 'Community Shield' },
        { date: '2025-09-01', minute: 55, type: 'normal', competition: 'Premier League' },
    ];
    const count = calculatePlayerGoals(goals, '2025-08-01');
    assert.strictEqual(count, 1);
});

// ═══════════════════════════════════════════════════════════════════
// TEST CASE C: Phase 2 Start Date
// Player active_from_date: 2026-02-01
// Goal on Jan 28 (excluded) + Goal on Feb 3 (counted)
// Expected: 1
// ═══════════════════════════════════════════════════════════════════
console.log('\nTest Case C: Phase 2 — Active From Date');

test('Player active from Feb 1: Jan 28 goal excluded, Feb 3 goal counted = 1', () => {
    const goals = [
        { date: '2026-01-28', minute: 55, type: 'normal', competition: 'Premier League' },
        { date: '2026-02-03', minute: 70, type: 'normal', competition: 'Premier League' },
    ];
    const count = calculatePlayerGoals(goals, '2026-02-01');
    assert.strictEqual(count, 1);
});

test('Goal on exact active_from_date is counted', () => {
    const goals = [
        { date: '2026-02-01', minute: 20, type: 'normal', competition: 'Bundesliga' },
    ];
    const count = calculatePlayerGoals(goals, '2026-02-01');
    assert.strictEqual(count, 1);
});

// ═══════════════════════════════════════════════════════════════════
// TEST CASE D: Player Transfers
// Player has 5 accumulated goals, then transfers out
// Engine must persist accumulated goals (not reset to 0)
// ═══════════════════════════════════════════════════════════════════
console.log('\nTest Case D: Player Transfers — Persisted Goals');

test('Transferred player retains 5 accumulated goals', () => {
    // When a player transfers out of tracking coverage, the API simply
    // stops returning new goals. The engine counts all goals it has seen.
    const goals = [
        { date: '2025-09-01', minute: 15, type: 'normal', competition: 'Premier League' },
        { date: '2025-09-15', minute: 32, type: 'normal', competition: 'Premier League' },
        { date: '2025-10-01', minute: 50, type: 'normal', competition: 'Champions League' },
        { date: '2025-10-20', minute: 78, type: 'normal', competition: 'Premier League' },
        { date: '2025-11-05', minute: 62, type: 'normal', competition: 'League Cup' },
        // No more goals after transfer — API coverage stops
    ];
    const count = calculatePlayerGoals(goals, '2025-08-01');
    assert.strictEqual(count, 5);
});

// ═══════════════════════════════════════════════════════════════════
// Payout Logic Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\nPayout Logic Tests');

test('Clear 1st and 2nd: $250 and $50', () => {
    const standings = [
        { participant: 'A', total: 100 },
        { participant: 'B', total: 80 },
        { participant: 'C', total: 60 },
    ];
    const payouts = calculatePayouts(standings);
    assert.strictEqual(payouts[0].payout, 250);
    assert.strictEqual(payouts[1].payout, 50);
    assert.strictEqual(payouts[2].payout, 0);
});

test('Tie at 1st: split $300, 2nd gets $0', () => {
    const standings = [
        { participant: 'A', total: 100 },
        { participant: 'B', total: 100 },
        { participant: 'C', total: 60 },
    ];
    const payouts = calculatePayouts(standings);
    assert.strictEqual(payouts[0].payout, 150);
    assert.strictEqual(payouts[1].payout, 150);
    assert.strictEqual(payouts[2].payout, 0);
});

test('Three-way tie at 1st: split $300 three ways', () => {
    const standings = [
        { participant: 'A', total: 100 },
        { participant: 'B', total: 100 },
        { participant: 'C', total: 100 },
    ];
    const payouts = calculatePayouts(standings);
    assert.strictEqual(payouts[0].payout, 100);
    assert.strictEqual(payouts[1].payout, 100);
    assert.strictEqual(payouts[2].payout, 100);
});

// ═══════════════════════════════════════════════════════════════════
// Supercup Detection Tests
// ═══════════════════════════════════════════════════════════════════
console.log('\nSupercup Detection');

test('UEFA Super Cup is detected as supercup', () => {
    assert.strictEqual(isSupercup('UEFA Super Cup'), true);
});

test('Community Shield is detected as supercup', () => {
    assert.strictEqual(isSupercup('Community Shield'), true);
});

test('Supercopa de España is detected as supercup', () => {
    assert.strictEqual(isSupercup('Supercopa de España'), true);
});

test('DFL-Supercup is detected as supercup', () => {
    assert.strictEqual(isSupercup('DFL-Supercup'), true);
});

test('Premier League is NOT a supercup', () => {
    assert.strictEqual(isSupercup('Premier League'), false);
});

test('Champions League is NOT a supercup', () => {
    assert.strictEqual(isSupercup('Champions League'), false);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
