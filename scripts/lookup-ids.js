/**
 * Utility script to look up API-Football team and player IDs.
 * Run: API_FOOTBALL_KEY=xxx node scripts/lookup-ids.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = 'v3.football.api-sports.io';

function apiGet(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const query = new URLSearchParams(params).toString();
        const url = `https://${API_HOST}${endpoint}?${query}`;
        const options = {
            headers: { 'x-apisports-key': API_KEY },
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Parse error: ${e.message}\nRaw: ${data.slice(0, 200)}`)); }
            });
        }).on('error', reject);
    });
}

async function lookupTeams() {
    const teams = [
        // Erik
        "Manchester City", "Atletico Madrid", "Benfica", "Ajax", "Feyenoord", "Fiorentina",
        // Henry
        "Bayern Munich", "Liverpool", "Borussia Dortmund", "Sporting CP", "Atalanta", "Lyon",
        // Owen
        "Arsenal", "Chelsea", "Celtic", "Fenerbahce", "Slavia Praha", "AS Monaco",
        // Ian
        "Real Madrid", "Inter Milan", "Red Star Belgrade", "Olympiacos", "Sparta Praha", "Union SG",
        // Scott
        "PSG", "Napoli", "FC Porto", "Bayer Leverkusen", "Rangers", "Ipswich Town",
        // Josh
        "Barcelona", "Galatasaray", "PSV Eindhoven", "Aston Villa", "AS Roma", "Strasbourg",
    ];

    console.log('=== TEAM ID LOOKUP ===\n');

    const results = {};
    for (const team of teams) {
        try {
            const res = await apiGet('/teams', { search: team.split(' ')[0] === 'AS' ? team : team.split(' ').slice(-1)[0] || team });
            const matches = res.response || [];

            // Try to find best match
            const exact = matches.find(m =>
                m.team.name.toLowerCase() === team.toLowerCase() ||
                m.team.name.toLowerCase().includes(team.toLowerCase()) ||
                team.toLowerCase().includes(m.team.name.toLowerCase())
            );

            if (exact) {
                results[team] = exact.team.id;
                console.log(`✅ ${team} → ID: ${exact.team.id} (${exact.team.name})`);
            } else if (matches.length > 0) {
                // Show top 3 matches for manual review
                results[team] = matches[0].team.id;
                console.log(`⚠️  ${team} → Best guess ID: ${matches[0].team.id} (${matches[0].team.name})`);
                matches.slice(0, 3).forEach(m => console.log(`     Option: ${m.team.id} = ${m.team.name} (${m.team.country})`));
            } else {
                results[team] = null;
                console.log(`❌ ${team} → NOT FOUND`);
            }
        } catch (err) {
            console.log(`❌ ${team} → ERROR: ${err.message}`);
            results[team] = null;
        }

        // Rate limit: 10 req/min = 1 every 6s
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log('\n=== TEAM ID MAP ===');
    console.log(JSON.stringify(results, null, 2));
    return results;
}

async function lookupPlayers() {
    const players = [
        // Erik
        "Mbappe", "Isak", "Guirassy", "Duran", "Hojlund", "Biereth",
        // Henry
        "Haaland", "Saka", "Barcola", "Julian Alvarez", "Jonathan David", "Aghehowa",
        // Owen
        "Gyokeres", "Raphinha", "Yamal", "Olise", "Gakpo", "Doue",
        // Ian
        "Lewandowski", "Dembele", "Pavlidis", "Sorloth", "Kean", "Watkins",
        // Scott
        "Salah", "Osimhen", "Vinicius", "Palmer", "Openda", "Vlahovic",
        // Josh
        "Kane", "Lautaro", "Marmoush", "Ekitike", "Plea", "Emegha",
    ];

    const fullNames = [
        "Kylian Mbappe", "Alexander Isak", "Serhou Guirassy", "Jhon Duran", "Rasmus Højlund", "Mika Biereth",
        "Erling Haaland", "Bukayo Saka", "Bradley Barcola", "Julian Alvarez", "Jonathan David", "Victor Aghehowa",
        "Viktor Gyökeres", "Raphinha", "Lamine Yamal", "Michael Olise", "Cody Gakpo", "Desire Doue",
        "Robert Lewandowski", "Ousmane Dembele", "Vangelis Pavlidis", "Alexander Sorloth", "Moise Kean", "Ollie Watkins",
        "Mohamed Salah", "Victor Osimhen", "Vinícius Júnior", "Cole Palmer", "Lois Openda", "Dusan Vlahovic",
        "Harry Kane", "Lautaro Martinez", "Omar Marmoush", "Hugo Ekitike", "Alassane Plea", "Emanuel Emegha",
    ];

    console.log('\n=== PLAYER ID LOOKUP ===\n');

    const results = {};
    for (let i = 0; i < players.length; i++) {
        const searchName = players[i];
        const fullName = fullNames[i];
        try {
            const res = await apiGet('/players', { search: searchName, season: 2024 });
            const matches = res.response || [];

            if (matches.length > 0) {
                const player = matches[0].player;
                results[fullName] = player.id;
                console.log(`✅ ${fullName} → ID: ${player.id} (${player.name}, ${player.nationality})`);
            } else {
                results[fullName] = null;
                console.log(`❌ ${fullName} → NOT FOUND (searched: ${searchName})`);
            }
        } catch (err) {
            console.log(`❌ ${fullName} → ERROR: ${err.message}`);
            results[fullName] = null;
        }

        await new Promise(r => setTimeout(r, 1500));
    }

    console.log('\n=== PLAYER ID MAP ===');
    console.log(JSON.stringify(results, null, 2));
    return results;
}

async function main() {
    if (!API_KEY) {
        console.log('❌ Set API_FOOTBALL_KEY environment variable');
        process.exit(1);
    }

    // Check API status first
    const status = await apiGet('/status');
    console.log('API Status:', JSON.stringify(status.response?.requests || status, null, 2));
    console.log('');

    const teamIds = await lookupTeams();
    const playerIds = await lookupPlayers();

    // Save the mapping
    fs.writeFileSync(
        path.join(__dirname, 'id-mappings.json'),
        JSON.stringify({ teams: teamIds, players: playerIds }, null, 2)
    );
    console.log('\n✅ Saved to scripts/id-mappings.json');
}

main().catch(console.error);
