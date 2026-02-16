/**
 * Soccer Pool Tracker — CRON Data Update Script
 * 
 * Fetches real standings and player goals from API-Football,
 * applies rules engine, and writes computed results.json.
 * 
 * Run manually:  API_FOOTBALL_KEY=xxx node scripts/update-data.js
 * Run via CRON:   GitHub Actions (see .github/workflows/update-standings.yml)
 * 
 * API Budget: Uses ~53 requests per run (within 100/day free limit)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = 'v3.football.api-sports.io';
const SEASON = 2024; // Free plan max: 2024 (2024-25 season)
const ROSTERS_PATH = path.join(__dirname, '..', 'data', 'rosters.json');
const RESULTS_PATH = path.join(__dirname, '..', 'data', 'results.json');

// ══════════════════════════════════════════════════════════════════
// LEAGUE & TEAM ID MAPPINGS (API-Football well-known IDs)
// ══════════════════════════════════════════════════════════════════

const LEAGUES = {
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
    2: { name: 'UEFA Champions League', country: 'Europe' },
    3: { name: 'UEFA Europa League', country: 'Europe' },
    848: { name: 'UEFA Conference League', country: 'Europe' },
};

// Team name -> { api_id, league_id }
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

// Player name -> api_id (verified from /players/squads endpoint)
const PLAYER_MAP = {
    // Erik
    'Kylian Mbappe': 278,           // Real Madrid #10
    'Alexander Isak': 903,          // Newcastle #14
    'Serhou Guirassy': 21393,       // BVB #9
    'Jhon Duran': 337092,           // Aston Villa / TBD
    'Rasmus Højlund': 303894,       // Man United
    'Mika Biereth': 283026,         // Monaco #14
    // Henry
    'Erling Haaland': 1100,         // Man City
    'Bukayo Saka': 1460,            // Arsenal #7
    'Bradley Barcola': 161904,      // PSG #29
    'Julian Alvarez': 6009,         // Atletico #19
    'Jonathan David': 8489,         // Juventus #30
    'Victor Aghehowa': 407897,      // TBD
    // Owen
    'Viktor Gyökeres': 18979,       // Arsenal #14
    'Raphinha': 1496,               // Barcelona #11
    'Lamine Yamal': 386828,         // Barcelona #10
    'Michael Olise': 19617,         // Bayern #17
    'Cody Gakpo': 247,              // Liverpool #18
    'Desire Doue': 343027,          // PSG #14
    // Ian
    'Robert Lewandowski': 521,      // Barcelona #9
    'Ousmane Dembele': 153,         // PSG #10
    'Vangelis Pavlidis': 48808,     // Benfica
    'Alexander Sorloth': 8492,      // Atletico #9
    'Moise Kean': 877,              // Fiorentina #20
    'Ollie Watkins': 19366,         // Aston Villa #11
    // Scott
    'Mohamed Salah': 306,           // Liverpool #11
    'Victor Osimhen': 2780,         // Galatasaray #45
    'Vinícius Júnior': 762,         // Real Madrid #7
    'Cole Palmer': 152982,          // Chelsea #10
    'Lois Openda': 86,              // Juventus #20
    'Dusan Vlahovic': 30415,        // Juventus #9
    // Josh
    'Harry Kane': 184,              // Bayern #9
    'Lautaro Martinez': 217,        // Inter #10
    'Omar Marmoush': 132874,        // Man City
    'Hugo Ekitike': 303523,         // Eintracht Frankfurt
    'Alassane Plea': 2034,          // Gladbach
    'Emanuel Emegha': 203762,       // Strasbourg #10
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
 * Fetch league standings for all relevant domestic leagues.
 * Returns: { team_api_id: { points, league_name } }
 */
async function fetchAllLeagueStandings() {
    const standingsMap = {};

    const leagueIds = [...new Set(Object.values(TEAM_MAP).map(t => t.league_id))];

    for (const leagueId of leagueIds) {
        if ([2, 3, 848].includes(leagueId)) continue;

        try {
            const res = await apiGet('/standings', { league: leagueId, season: SEASON });
            const standings = res.response?.[0]?.league?.standings;
            if (standings) {
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
 * Returns: { team_api_id: { phase_points, competition } }
 */
async function fetchUEFAStandings() {
    const uefaMap = {};

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
 * Fetch player goals from individual player stats.
 * Returns: { player_name: total_goals }
 */
async function fetchPlayerGoals() {
    const goalMap = {};

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
                    const goals = stat.goals?.total || 0;
                    totalGoals += goals;
                }
                goalMap[playerName] = totalGoals;
                console.log(`   ⚽ ${playerName}: ${totalGoals} goals`);
            } else {
                goalMap[playerName] = 0;
                console.log(`   ⚠️  ${playerName}: No data found (ID: ${playerId})`);
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
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   Season: ${SEASON}\n`);

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
        // Team scoring
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

        // Goals scoring
        let participantGoalsTotal = 0;
        const playerBreakdowns = [];

        for (const player of roster.players) {
            const goals = playerGoals[player.name] || 0;
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
