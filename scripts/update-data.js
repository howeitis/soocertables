/**
 * Soccer Pool Tracker — CRON Data Update Script
 * 
 * Run via GitHub Actions twice daily, or manually:
 *   node scripts/update-data.js
 * 
 * Requires: FOOTBALL_DATA_API_KEY environment variable
 * (or API_FOOTBALL_KEY for API-Football via RapidAPI)
 * 
 * This script:
 * 1. Reads rosters.json for the participant/team/player mapping
 * 2. Fetches standings and player stats from the sports API
 * 3. Applies the rules engine to compute scores
 * 4. Writes the computed results.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Configuration ────────────────────────────────────────────────
const API_KEY = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_DATA_API_KEY || '';
const ROSTERS_PATH = path.join(__dirname, '..', 'data', 'rosters.json');
const RESULTS_PATH = path.join(__dirname, '..', 'data', 'results.json');

// API-Football (RapidAPI) config
const API_HOST = 'v3.football.api-sports.io';

// Season identifier (API-Football uses the start year)
const SEASON = 2025;

// ── Utility: HTTPS GET with JSON response ────────────────────────
function apiGet(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const query = new URLSearchParams(params).toString();
        const url = `https://${API_HOST}${endpoint}?${query}`;

        const options = {
            headers: {
                'x-apisports-key': API_KEY,
            },
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse API response: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

// ── Main Update Pipeline ─────────────────────────────────────────
async function main() {
    console.log('🔄 Soccer Pool Tracker — Data Update');
    console.log(`   Time: ${new Date().toISOString()}`);

    // 1. Load rosters
    const rosters = JSON.parse(fs.readFileSync(ROSTERS_PATH, 'utf8'));
    console.log(`   Loaded ${rosters.rosters.length} participant rosters`);

    if (!API_KEY) {
        console.log('⚠️  No API key found. Skipping API fetch — results.json will not be updated.');
        console.log('   Set API_FOOTBALL_KEY or FOOTBALL_DATA_API_KEY environment variable.');
        process.exit(0);
    }

    try {
        // 2. Fetch data for all teams and players
        const teamPool = [];
        const goalsPool = [];

        for (const roster of rosters.rosters) {
            console.log(`\n📋 Processing: ${roster.participant}`);

            // ── Team Scoring ──
            let participantTeamTotal = 0;
            const teamBreakdowns = [];

            for (const team of roster.teams) {
                const teamId = team.api_id;
                if (!teamId) {
                    console.log(`   ⚠️  Skipping team "${team.name}" — no api_id`);
                    teamBreakdowns.push({
                        name: team.name,
                        league_points: 0,
                        uefa_points: 0,
                        domestic_cup_points: 0,
                        details: 'No API ID configured',
                    });
                    continue;
                }

                // Fetch league standings for this team
                // (In production, batch these calls by league to save API quota)
                // TODO: Implement full API fetch + rules engine computation
                console.log(`   📊 Fetch standings for ${team.name} (ID: ${teamId})`);
            }

            teamPool.push({
                participant: roster.participant,
                total_points: participantTeamTotal,
                rank: 0,
                teams: teamBreakdowns,
            });

            // ── Player Goals ──
            let participantGoalsTotal = 0;
            const playerBreakdowns = [];

            for (const player of roster.players) {
                const playerId = player.api_id;
                if (!playerId) {
                    console.log(`   ⚠️  Skipping player "${player.name}" — no api_id`);
                    playerBreakdowns.push({ name: player.name, goals: 0 });
                    continue;
                }

                // Fetch player stats
                // TODO: Implement full API fetch with goal filtering
                console.log(`   ⚽ Fetch goals for ${player.name} (ID: ${playerId})`);
            }

            goalsPool.push({
                participant: roster.participant,
                total_goals: participantGoalsTotal,
                rank: 0,
                players: playerBreakdowns,
            });
        }

        // 3. Assign ranks
        teamPool.sort((a, b) => b.total_points - a.total_points);
        teamPool.forEach((entry, i) => { entry.rank = i + 1; });

        goalsPool.sort((a, b) => b.total_goals - a.total_goals);
        goalsPool.forEach((entry, i) => { entry.rank = i + 1; });

        // 4. Write results
        const results = {
            last_updated: new Date().toISOString(),
            season: rosters.pool_metadata.season,
            team_pool: teamPool,
            goals_pool: goalsPool,
        };

        fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
        console.log(`\n✅ Results written to ${RESULTS_PATH}`);

    } catch (err) {
        console.error('❌ Update failed:', err.message);
        process.exit(1);
    }
}

main();
