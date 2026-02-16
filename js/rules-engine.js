/**
 * Soccer Pool Tracker — Rules Engine
 * Implements all PRD v3.0 scoring logic for Team Pool and Goals Pool.
 * This module is isomorphic: used by both the CRON script and unit tests.
 */

// ── Cup Milestone Constants (non-stacking: only highest applies) ────────────
const DOMESTIC_CUP_MILESTONES = {
    winner: 15,
    runner_up: 12,
    semifinal: 8,
};

const UEFA_CUP_MILESTONES = {
    champions_league: { winner: 20, runner_up: 15, semifinal: 10 },
    europa_league: { winner: 12, runner_up: 10, semifinal: 6 },
    conference_league: { winner: 12, runner_up: 10, semifinal: 6 },
};

// Supercup competitions to exclude (case-insensitive matching)
const SUPERCUP_KEYWORDS = [
    'super cup', 'supercup', 'community shield', 'supercopa',
    'supercoppa', 'trophée des champions', 'dfl-supercup',
];

/**
 * Determines if a competition is a Supercup (excluded from scoring).
 * @param {string} competitionName
 * @returns {boolean}
 */
function isSupercup(competitionName) {
    const lower = (competitionName || '').toLowerCase();
    return SUPERCUP_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Gets the highest domestic cup milestone bonus (non-stacking).
 * @param {object} cupProgress - { milestone: 'winner'|'runner_up'|'semifinal'|null }
 * @returns {number}
 */
function getDomesticCupBonus(cupProgress) {
    if (!cupProgress || !cupProgress.milestone) return 0;
    return DOMESTIC_CUP_MILESTONES[cupProgress.milestone] || 0;
}

/**
 * Gets the highest UEFA cup milestone bonus (non-stacking).
 * @param {object} cupProgress - { competition: 'champions_league'|'europa_league'|'conference_league', milestone: string }
 * @returns {number}
 */
function getUefaCupBonus(cupProgress) {
    if (!cupProgress || !cupProgress.competition || !cupProgress.milestone) return 0;
    const tier = UEFA_CUP_MILESTONES[cupProgress.competition];
    if (!tier) return 0;
    return tier[cupProgress.milestone] || 0;
}

/**
 * Calculates total team points from all components.
 * CRITICAL: Milestones do NOT stack. Only highest achieved milestone in each cup counts.
 *
 * @param {object} teamData
 * @param {number} teamData.league_points - Total domestic league points
 * @param {number} teamData.uefa_league_phase_points - Points from UEFA group/league phase
 * @param {object|null} teamData.domestic_cup - { milestone: 'winner'|'runner_up'|'semifinal' }
 * @param {object|null} teamData.uefa_cup - { competition: string, milestone: string }
 * @returns {{ total: number, league_points: number, uefa_points: number, domestic_cup_points: number }}
 */
function calculateTeamPoints(teamData) {
    const league = teamData.league_points || 0;
    const uefaPhase = teamData.uefa_league_phase_points || 0;
    const domesticBonus = getDomesticCupBonus(teamData.domestic_cup);
    const uefaBonus = getUefaCupBonus(teamData.uefa_cup);

    return {
        total: league + uefaPhase + domesticBonus + uefaBonus,
        league_points: league,
        uefa_points: uefaPhase + uefaBonus,
        domestic_cup_points: domesticBonus,
    };
}

/**
 * Calculates valid goals for a player, applying all exclusion rules.
 *
 * @param {Array} goals - Array of goal events: { date, minute, type, competition }
 *   - type: 'normal'|'penalty'|'own_goal'|'penalty_shootout'
 *   - minute: number (> 90 for ET, negative or special for shootout)
 * @param {string} activeFromDate - ISO date string. Goals before this date are excluded.
 * @returns {number}
 */
function calculatePlayerGoals(goals, activeFromDate) {
    if (!goals || !Array.isArray(goals)) return 0;

    const activeDate = new Date(activeFromDate);

    return goals.filter(goal => {
        // Exclude goals before active_from_date
        const goalDate = new Date(goal.date);
        if (goalDate < activeDate) return false;

        // Exclude penalty shootout goals
        if (goal.type === 'penalty_shootout') return false;

        // Exclude own goals
        if (goal.type === 'own_goal') return false;

        // Exclude supercup goals
        if (isSupercup(goal.competition || '')) return false;

        return true;
    }).length;
}

/**
 * Calculates financial payouts for a pool.
 * Rules:
 *   - 1st place: $250, 2nd place: $50
 *   - If 2-way tie at 1st: split $300 evenly ($150 each), 2nd gets $0
 *   - If 3+ way tie at 1st: winner decided alphabetically by first name
 *
 * @param {Array} standings - Sorted array of { participant, total }
 * @returns {Array} - Array of { participant, payout }
 */
function calculatePayouts(standings) {
    if (!standings || standings.length === 0) return [];

    const sorted = [...standings].sort((a, b) => b.total - a.total);
    const topScore = sorted[0].total;
    const tiedForFirst = sorted.filter(s => s.total === topScore);

    const payouts = sorted.map(s => ({ participant: s.participant, payout: 0 }));

    if (tiedForFirst.length === 2) {
        // 2-way tie: split $300 evenly ($150 each), 2nd gets $0
        payouts.forEach(p => {
            if (sorted.find(s => s.participant === p.participant && s.total === topScore)) {
                p.payout = 150;
            }
        });
    } else if (tiedForFirst.length >= 3) {
        // 3+ way tie: alphabetical by first name decides winner
        const alphabetical = [...tiedForFirst].sort((a, b) =>
            a.participant.localeCompare(b.participant)
        );
        // First alphabetically gets $250
        const winnerId = alphabetical[0].participant;
        payouts.find(p => p.participant === winnerId).payout = 250;
        // Find second place (next highest score after tied group, or second alphabetical)
        const nonTied = sorted.filter(s => s.total < topScore);
        if (nonTied.length > 0) {
            payouts.find(p => p.participant === nonTied[0].participant).payout = 50;
        }
    } else {
        // Clear 1st place
        payouts[0].payout = 250;
        if (payouts.length > 1) {
            payouts[1].payout = 50;
        }
    }

    return payouts;
}

/**
 * Computes full results from rosters + raw API data.
 * Orchestrates scoring for all participants and returns the results.json shape.
 *
 * @param {object} rosters - Parsed rosters.json
 * @param {object} apiData - Raw data from sports API (teams standings, player goals, cup progress)
 * @returns {object} - Full results.json structure
 */
function computeResults(rosters, apiData) {
    const teamPool = [];
    const goalsPool = [];

    for (const roster of rosters.rosters) {
        // ── Team Pool ──
        let participantTeamTotal = 0;
        const teamBreakdowns = [];

        for (const team of roster.teams) {
            const teamApiData = apiData.teams[team.name] || {};
            const scored = calculateTeamPoints(teamApiData);
            participantTeamTotal += scored.total;
            teamBreakdowns.push({
                name: team.name,
                league_points: scored.league_points,
                uefa_points: scored.uefa_points,
                domestic_cup_points: scored.domestic_cup_points,
            });
        }

        teamPool.push({
            participant: roster.participant,
            total_points: participantTeamTotal,
            rank: 0, // assigned after sorting
            teams: teamBreakdowns,
        });

        // ── Goals Pool ──
        let participantGoalsTotal = 0;
        const playerBreakdowns = [];

        for (const player of roster.players) {
            const playerGoals = apiData.players[player.name] || [];
            const count = calculatePlayerGoals(playerGoals, player.active_from_date);
            participantGoalsTotal += count;
            playerBreakdowns.push({ name: player.name, goals: count });
        }

        goalsPool.push({
            participant: roster.participant,
            total_goals: participantGoalsTotal,
            rank: 0,
            players: playerBreakdowns,
        });
    }

    // ── Assign ranks ──
    teamPool.sort((a, b) => b.total_points - a.total_points);
    teamPool.forEach((entry, i) => { entry.rank = i + 1; });

    goalsPool.sort((a, b) => b.total_goals - a.total_goals);
    goalsPool.forEach((entry, i) => { entry.rank = i + 1; });

    return {
        last_updated: new Date().toISOString(),
        season: rosters.pool_metadata.season,
        team_pool: teamPool,
        goals_pool: goalsPool,
    };
}

// ── Exports (Node.js compatible) ──
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isSupercup,
        getDomesticCupBonus,
        getUefaCupBonus,
        calculateTeamPoints,
        calculatePlayerGoals,
        calculatePayouts,
        computeResults,
        DOMESTIC_CUP_MILESTONES,
        UEFA_CUP_MILESTONES,
    };
}
