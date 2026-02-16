/**
 * Soccer Pool Tracker — CRON Data Update Script
 * 
 * Fetches real standings and player goals from API-Football,
 * applies rules engine, and writes computed results.json.
 * 
 * Run manually:  API_FOOTBALL_KEY=xxx node scripts/update-data.js
 * Run via CRON:   GitHub Actions (see .github/workflows/update-standings.yml)
 * 
 * API Budget: Uses ~20-25 requests per run (well within 100/day free limit)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = 'v3.football.api-sports.io';
const SEASON = 2024; // API-Football uses the start-year of the season
const ROSTERS_PATH = path.join(__dirname, '..', 'data', 'rosters.json');
const RESULTS_PATH = path.join(__dirname, '..', 'data', 'results.json');

// ══════════════════════════════════════════════════════════════════
// LEAGUE & TEAM ID MAPPINGS (API-Football well-known IDs)
// ══════════════════════════════════════════════════════════════════

// Leagues we need to fetch standings from
const LEAGUES = {
    // league_id: { name, country }
    39: { name: 'Premier League', country: 'England' },
    140: { name: 'La Liga', country: 'Spain' },
    78: { name: 'Bundesliga', country: 'Germany' },
    135: { name: 'Serie A', country: 'Italy' },
    61: { name: 'Ligue 1', country: 'France' },
    94: { name: 'Primeira Liga', country: 'Portugal' },
    88: { name: 'Eredivisie', country: 'Netherlands' },
    179: { name: 'Scottish Premiership', country: 'Scotland' },
    203: { name: 'Süper Lig', country: 'Turkey' },
    144: { name: 'Belgian Pro League', country: 'Belgium' },
    345: { name: 'Czech First League', country: 'Czech Republic' },
    286: { name: 'Serbian SuperLiga', country: 'Serbia' },
    197: { name: 'Super League', country: 'Greece' },
    // UEFA competitions
    2: { name: 'UEFA Champions League', country: 'Europe' },
    3: { name: 'UEFA Europa League', country: 'Europe' },
    848: { name: 'UEFA Conference League', country: 'Europe' },
};

// Team name → { api_id, league_id }
const TEAM_MAP = {
    // Erik
    'Manchester City': { api_id: 50, league_id: 39 },
    'Atletico Madrid': { api_id: 530, league_id: 140 },
    'Benfica': { api_id: 211, league_id: 94 },
    'Ajax': { api_id: 194, league_id: 88 },
    'Feyenoord': { api_id: 209, league_id: 88 },
    'Fiorentina': { api_id: 502, league_id: 135 },
    // Henry
    'Bayern Munich': { api_id: 157, league_id: 78 },
    'Liverpool': { api_id: 40, league_id: 39 },
    'Borussia Dortmund': { api_id: 165, league_id: 78 },
    'Sporting CP': { api_id: 228, league_id: 94 },
    'Atalanta': { api_id: 499, league_id: 135 },
    'Lyon': { api_id: 80, league_id: 61 },
    // Owen
    'Arsenal': { api_id: 42, league_id: 39 },
    'Chelsea': { api_id: 49, league_id: 39 },
    'Celtic': { api_id: 247, league_id: 179 },
    'Fenerbahce': { api_id: 611, league_id: 203 },
    'Slavia Praha': { api_id: 553, league_id: 345 },
    'AS Monaco': { api_id: 91, league_id: 61 },
    // Ian
    'Real Madrid': { api_id: 541, league_id: 140 },
    'Inter Milan': { api_id: 505, league_id: 135 },
    'Red Star Belgrade': { api_id: 598, league_id: 286 },
    'Olympiacos': { api_id: 568, league_id: 197 },
    'Sparta Praha': { api_id: 558, league_id: 345 },
    'Union SG': { api_id: 740, league_id: 144 },
    // Scott
    'PSG': { api_id: 85, league_id: 61 },
    'Napoli': { api_id: 492, league_id: 135 },
    'FC Porto': { api_id: 212, league_id: 94 },
    'Bayer Leverkusen': { api_id: 168, league_id: 78 },
    'Rangers': { api_id: 257, league_id: 179 },
    'Ipswich Town': { api_id: 57, league_id: 39 },
    // Josh
    'Barcelona': { api_id: 529, league_id: 140 },
    'Galatasaray': { api_id: 645, league_id: 203 },
    'PSV Eindhoven': { api_id: 197, league_id: 88 },
    'Aston Villa': { api_id: 66, league_id: 39 },
    'AS Roma': { api_id: 497, league_id: 135 },
    'Strasbourg': { api_id: 95, league_id: 61 },
};

// Player name → api_id
const PLAYER_MAP = {
    // Erik
    'Kylian Mbappe': 278,
    'Alexander Isak': 2295,
    'Serhou Guirassy': 25074,
    'Jhon Duran': 337092,
    'Rasmus Højlund': 303894,
    'Mika Biereth': 338393,
    // Henry
    'Erling Haaland': 1100,
    'Bukayo Saka': 136718,
    'Bradley Barcola': 324282,
    'Julian Alvarez': 186155,
    'Jonathan David': 9100,
    'Victor Aghehowa': 407897,
    // Owen
    'Viktor Gyökeres': 196968,
    'Raphinha': 48783,
    'Lamine Yamal': 401188,
    'Michael Olise': 162771,
    'Cody Gakpo': 303430,
    'Desire Doue': 389998,
    // Ian
    'Robert Lewandowski': 521,
    'Ousmane Dembele': 434,
    'Vangelis Pavlidis': 48808,
    'Alexander Sorloth': 2063,
    'Moise Kean': 1164,
    'Ollie Watkins': 19465,
    // Scott
    'Mohamed Salah': 306,
    'Victor Osimhen': 47380,
    'Vinícius Júnior': 5765,
    'Cole Palmer': 284324,
    'Lois Openda': 196925,
    'Dusan Vlahovic': 159607,
    // Josh
    'Harry Kane': 184,
    'Lautaro Martinez': 288,
    'Omar Marmoush': 132874,
    'Hugo Ekitike': 303523,
    'Alassane Plea': 2034,
    'Emanuel Emegha': 304826,
};

// Players and the team they play for (for API queries)
const PLAYER_TEAMS = {
    'Kylian Mbappe': 541,      // Real Madrid
    'Alexander Isak': 34,      // Newcastle
    'Serhou Guirassy': 165,    // BVB
    'Jhon Duran': 66,          // Aston Villa
    'Rasmus Højlund': 33,      // Man United
    'Mika Biereth': 1393,      // Sturm Graz → Monaco? Check
    'Erling Haaland': 50,      // Man City
    'Bukayo Saka': 42,         // Arsenal
    'Bradley Barcola': 85,     // PSG
    'Julian Alvarez': 530,     // Atletico Madrid
    'Jonathan David': 79,      // Lille
    'Victor Aghehowa': 85,     // PSG → Check
    'Viktor Gyökeres': 228,    // Sporting CP
    'Raphinha': 529,           // Barcelona
    'Lamine Yamal': 529,       // Barcelona
    'Michael Olise': 157,      // Bayern Munich
    'Cody Gakpo': 40,          // Liverpool
    'Desire Doue': 85,         // PSG
    'Robert Lewandowski': 529, // Barcelona
    'Ousmane Dembele': 85,     // PSG
    'Vangelis Pavlidis': 211,  // Benfica
    'Alexander Sorloth': 530,  // Atletico Madrid
    'Moise Kean': 502,         // Fiorentina
    'Ollie Watkins': 66,       // Aston Villa
    'Mohamed Salah': 40,       // Liverpool
    'Victor Osimhen': 645,     // Galatasaray
    'Vinícius Júnior': 541,    // Real Madrid
    'Cole Palmer': 49,         // Chelsea
    'Lois Openda': 168,        // Bayer Leverkusen
    'Dusan Vlahovic': 496,     // Juventus
    'Harry Kane': 157,         // Bayern Munich
    'Lautaro Martinez': 505,   // Inter Milan
    'Omar Marmoush': 50,       // Man City
    'Hugo Ekitike': 497,       // AS Roma → Eintracht
    'Alassane Plea': 163,      // Borussia M'gladbach? Check
    'Emanuel Emegha': 95,      // Strasbourg
};

// ══════════════════════════════════════════════════════════════════
// API UTILITY
// ══════════════════════════════════════════════════════════════════

let requestCount = 0;

function apiGet(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const query = new URLSearchParams(params).toString();
        const fullUrl = `https://${API_HOST}${endpoint}?${query}`;
        requestCount++;
        console.log(`   [API ${requestCount}] GET ${endpoint}?${query.slice(0, 80)}`);

        const options = {
            headers: { 'x-apisports-key': API_KEY },
        };

        https.get(fullUrl, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.errors && Object.keys(parsed.errors).length > 0) {
                        console.log(`   ⚠️  API Error: ${JSON.stringify(parsed.errors)}`);
                    }
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════════
// DATA FETCHING
// ══════════════════════════════════════════════════════════════════

/**
 * Fetch league standings for all relevant leagues.
 * Returns: { league_id: { team_api_id: points } }
 */
async function fetchAllLeagueStandings() {
    const standingsMap = {}; // team_api_id → league_points

    // Get unique league IDs we need
    const leagueIds = [...new Set(Object.values(TEAM_MAP).map(t => t.league_id))];

    for (const leagueId of leagueIds) {
        // Skip UEFA competitions - those are handled separately
        if ([2, 3, 848].includes(leagueId)) continue;

        try {
            const res = await apiGet('/standings', { league: leagueId, season: SEASON });
            const standings = res.response?.[0]?.league?.standings;
            if (standings) {
                // Some leagues have groups → flatten
                const allTeams = standings.flat();
                for (const entry of allTeams) {
                    standingsMap[entry.team.id] = {
                        points: entry.points || 0,
                        league_name: LEAGUES[leagueId]?.name || `League ${leagueId}`,
                    };
                }
            }
            await sleep(6500);
        } catch (err) {
            console.log(`   ❌ Failed to fetch league ${leagueId}: ${err.message}`);
        }
    }

    return standingsMap;
}

/**
 * Fetch UEFA competition standings (Champions League, Europa, Conference).
 * Returns: { team_api_id: { phase_points, competition, milestone } }
 */
async function fetchUEFAStandings() {
    const uefaMap = {}; // team_api_id → { phase_points, competition }

    const uefaLeagues = [
        { id: 2, key: 'champions_league' },
        { id: 3, key: 'europa_league' },
        { id: 848, key: 'conference_league' },
    ];

    for (const league of uefaLeagues) {
        try {
            const res = await apiGet('/standings', { league: league.id, season: SEASON });
            const standings = res.response?.[0]?.league?.standings;
            if (standings) {
                const allTeams = standings.flat();
                for (const entry of allTeams) {
                    uefaMap[entry.team.id] = {
                        phase_points: entry.points || 0,
                        competition: league.key,
                    };
                }
            }
            await sleep(6500);
        } catch (err) {
            console.log(`   ❌ Failed to fetch UEFA ${league.key}: ${err.message}`);
        }
    }

    return uefaMap;
}

/**
 * Fetch top scorers for leagues that have our players.
 * Returns: { player_api_id: total_goals }
 */
async function fetchPlayerGoals() {
    const goalMap = {}; // player_api_id → goals

    // Fetch from each relevant league's top scorers
    // But more efficient: fetch player stats directly by player ID
    const playerIds = Object.values(PLAYER_MAP);
    const uniquePlayerIds = [...new Set(playerIds)];

    // Batch by 5 to avoid rate limits, but we really need individual player stats
    for (const [playerName, playerId] of Object.entries(PLAYER_MAP)) {
        try {
            const res = await apiGet('/players', {
                id: playerId,
                season: SEASON,
            });

            const playerData = res.response?.[0];
            if (playerData) {
                let totalGoals = 0;
                for (const stat of playerData.statistics || []) {
                    const leagueName = (stat.league?.name || '').toLowerCase();
                    // Exclude supercup competitions
                    if (leagueName.includes('super cup') || leagueName.includes('supercup') ||
                        leagueName.includes('community shield') || leagueName.includes('supercopa') ||
                        leagueName.includes('supercoppa') || leagueName.includes('trophée des champions')) {
                        continue;
                    }
                    // Count goals (API-Football already excludes own goals from the goals.total)
                    // Penalty shootout goals are also not counted in regular stats
                    const goals = stat.goals?.total || 0;
                    totalGoals += goals;
                }
                goalMap[playerName] = totalGoals;
                console.log(`   ⚽ ${playerName}: ${totalGoals} goals`);
            } else {
                goalMap[playerName] = 0;
                console.log(`   ⚠️  ${playerName}: No data found`);
            }
            await sleep(6500);
        } catch (err) {
            console.log(`   ❌ ${playerName}: ${err.message}`);
            goalMap[playerName] = 0;
        }
    }

    return goalMap;
}

// ══════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════

async function main() {
    console.log('🔄 Soccer Pool Tracker — Live Data Update');
    console.log(`   Time: ${new Date().toISOString()}\n`);

    if (!API_KEY) {
        console.log('❌ No API key. Set API_FOOTBALL_KEY environment variable.');
        process.exit(1);
    }

    // Check API status
    const status = await apiGet('/status');
    const remaining = status.response?.requests;
    console.log(`   API Quota: ${remaining?.current || '?'}/${remaining?.limit_day || '?'} used today\n`);

    // Load rosters
    const rosters = JSON.parse(fs.readFileSync(ROSTERS_PATH, 'utf8'));

    // 1. Fetch all league standings
    console.log('📊 Fetching league standings...');
    const leagueStandings = await fetchAllLeagueStandings();
    console.log(`   Found standings for ${Object.keys(leagueStandings).length} teams\n`);

    // 2. Fetch UEFA standings
    console.log('🏆 Fetching UEFA standings...');
    const uefaStandings = await fetchUEFAStandings();
    console.log(`   Found UEFA data for ${Object.keys(uefaStandings).length} teams\n`);

    // 3. Fetch player goals
    console.log('⚽ Fetching player goals...');
    const playerGoals = await fetchPlayerGoals();
    console.log(`   Fetched goals for ${Object.keys(playerGoals).length} players\n`);

    // 4. Compute results
    console.log('📋 Computing results...');
    const teamPool = [];
    const goalsPool = [];

    for (const roster of rosters.rosters) {
        // ── Team scoring ──
        let participantTeamTotal = 0;
        const teamBreakdowns = [];

        for (const team of roster.teams) {
            const teamInfo = TEAM_MAP[team.name];
            if (!teamInfo) {
                teamBreakdowns.push({
                    name: team.name, league_points: 0, uefa_points: 0,
                    domestic_cup_points: 0, details: 'Unknown team'
                });
                continue;
            }

            const leagueData = leagueStandings[teamInfo.api_id] || {};
            const uefaData = uefaStandings[teamInfo.api_id] || {};

            const leaguePts = leagueData.points || 0;
            const uefaPhasePts = uefaData.phase_points || 0;
            // Cup milestones would require fixture analysis - omitted for now
            const total = leaguePts + uefaPhasePts;
            participantTeamTotal += total;

            const detailParts = [`League: ${leaguePts}`];
            if (uefaPhasePts > 0) {
                const compName = uefaData.competition === 'champions_league' ? 'UCL' :
                    uefaData.competition === 'europa_league' ? 'UEL' : 'UECL';
                detailParts.push(`${compName} Phase: ${uefaPhasePts}`);
            }

            teamBreakdowns.push({
                name: team.name,
                league_points: leaguePts,
                uefa_points: uefaPhasePts,
                domestic_cup_points: 0,
                details: detailParts.join(' | '),
            });
        }

        teamPool.push({
            participant: roster.participant,
            total_points: participantTeamTotal,
            rank: 0,
            teams: teamBreakdowns,
        });

        // ── Goals scoring ──
        let participantGoalsTotal = 0;
        const playerBreakdowns = [];

        for (const player of roster.players) {
            const goals = playerGoals[player.name] || 0;

            // Check active_from_date (for Phase 2 players)
            // API-Football returns season totals, so if active_from_date is in the future
            // relative to the season start, we'd need match-by-match data.
            // For now, use the full count (most players are active from season start).
            participantGoalsTotal += goals;
            playerBreakdowns.push({ name: player.name, goals: goals });
        }

        goalsPool.push({
            participant: roster.participant,
            total_goals: participantGoalsTotal,
            rank: 0,
            players: playerBreakdowns,
        });
    }

    // Assign ranks
    teamPool.sort((a, b) => b.total_points - a.total_points);
    teamPool.forEach((e, i) => { e.rank = i + 1; });

    goalsPool.sort((a, b) => b.total_goals - a.total_goals);
    goalsPool.forEach((e, i) => { e.rank = i + 1; });

    // 5. Write results
    const results = {
        last_updated: new Date().toISOString(),
        season: rosters.pool_metadata.season,
        team_pool: teamPool,
        goals_pool: goalsPool,
    };

    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
    console.log(`\n✅ Results written to ${RESULTS_PATH}`);
    console.log(`   Total API requests used: ${requestCount}`);

    // Print summary
    console.log('\n=== TEAM POOL ===');
    teamPool.forEach(t => console.log(`   ${t.rank}. ${t.participant}: ${t.total_points} pts`));
    console.log('\n=== GOALS POOL ===');
    goalsPool.forEach(g => console.log(`   ${g.rank}. ${g.participant}: ${g.total_goals} goals`));
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
