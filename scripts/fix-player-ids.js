/**
 * Targeted player ID lookup — finds missing/wrong player IDs
 * Uses team squads instead of search (more reliable)
 * 
 * Run: API_FOOTBALL_KEY=xxx node scripts/fix-player-ids.js
 */

const https = require('https');
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = 'v3.football.api-sports.io';

function apiGet(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const query = new URLSearchParams(params).toString();
        const url = `https://${API_HOST}${endpoint}?${query}`;
        console.log(`[API] GET ${endpoint}?${query}`);
        const options = { headers: { 'x-apisports-key': API_KEY } };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Parse: ${e.message}`)); }
            });
        }).on('error', reject);
    });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Players we need to find, grouped by their CURRENT team API ID
const PLAYERS_TO_FIND = {
    // team_id: [{ name, search terms }]
    66: [{ name: 'Jhon Duran', search: ['duran', 'jhon'] }],              // Aston Villa
    91: [{ name: 'Mika Biereth', search: ['biereth', 'mika'] }],          // AS Monaco
    529: [{ name: 'Lamine Yamal', search: ['yamal', 'lamine'] },
    { name: 'Raphinha', search: ['raphinha'] },
    { name: 'Robert Lewandowski', search: ['lewandowski'] }],         // Barcelona
    40: [{ name: 'Cody Gakpo', search: ['gakpo', 'cody'] },
    { name: 'Mohamed Salah', search: ['salah'] }],                    // Liverpool
    85: [{ name: 'Desire Doue', search: ['doue', 'desire'] },
    { name: 'Ousmane Dembele', search: ['dembele'] },
    { name: 'Bradley Barcola', search: ['barcola'] }],                // PSG
    541: [{ name: 'Vinícius Júnior', search: ['vinicius', 'vinícius'] },
    { name: 'Kylian Mbappe', search: ['mbappe', 'mbappé'] }],        // Real Madrid
    168: [{ name: 'Lois Openda', search: ['openda', 'lois'] }],            // Bayer Leverkusen
    496: [{ name: 'Dusan Vlahovic', search: ['vlahovic', 'vlahović'] }],   // Juventus
    505: [{ name: 'Lautaro Martinez', search: ['lautaro', 'martinez'] }],  // Inter Milan
    50: [{ name: 'Omar Marmoush', search: ['marmoush', 'omar'] },
    { name: 'Erling Haaland', search: ['haaland'] }],                // Man City
    530: [{ name: 'Julian Alvarez', search: ['alvarez', 'julian'] },
    { name: 'Alexander Sorloth', search: ['sorloth', 'sørloth'] }],   // Atletico Madrid
    42: [{ name: 'Bukayo Saka', search: ['saka'] }],                      // Arsenal
    34: [{ name: 'Alexander Isak', search: ['isak'] }],                   // Newcastle
    165: [{ name: 'Serhou Guirassy', search: ['guirassy'] }],              // BVB
    33: [{ name: 'Rasmus Højlund', search: ['hojlund', 'højlund'] }],      // Man United
    157: [{ name: 'Michael Olise', search: ['olise'] },
    { name: 'Harry Kane', search: ['kane'] }],                       // Bayern Munich
    228: [{ name: 'Viktor Gyökeres', search: ['gyokeres', 'gyökeres'] }],  // Sporting CP
    211: [{ name: 'Vangelis Pavlidis', search: ['pavlidis'] }],            // Benfica
    502: [{ name: 'Moise Kean', search: ['kean'] }],                       // Fiorentina
    49: [{ name: 'Cole Palmer', search: ['palmer'] }],                     // Chelsea
    645: [{ name: 'Victor Osimhen', search: ['osimhen'] }],                // Galatasaray
    497: [{ name: 'Hugo Ekitike', search: ['ekitike'] }],                  // Eintracht Frankfurt → 91? or Roma
    163: [{ name: 'Alassane Plea', search: ['plea', 'pléa'] }],            // Gladbach
    95: [{ name: 'Emanuel Emegha', search: ['emegha'] }],                 // Strasbourg
    79: [{ name: 'Jonathan David', search: ['david', 'jonathan'] }],      // Lille
    // check Aghehowa
    85: [{ name: 'Victor Aghehowa', search: ['aghehowa', 'osimhen'] }],   // PSG? Not sure
};

async function main() {
    if (!API_KEY) { console.log('Set API_FOOTBALL_KEY'); process.exit(1); }

    // Status check
    const status = await apiGet('/status');
    console.log(`Quota: ${status.response?.requests?.current}/${status.response?.requests?.limit_day}\n`);

    // Get unique team IDs
    const teamIds = [...new Set(Object.keys(PLAYERS_TO_FIND).map(Number))];
    const foundMap = {};

    for (const teamId of teamIds) {
        const playersToFind = PLAYERS_TO_FIND[teamId];
        if (!playersToFind) continue;

        try {
            // Get team squad
            const res = await apiGet('/players/squads', { team: teamId });
            const squad = res.response?.[0]?.players || [];

            if (squad.length === 0) {
                console.log(`⚠️ No squad found for team ${teamId}`);
            }

            for (const target of playersToFind) {
                const match = squad.find(p => {
                    const pName = p.name.toLowerCase();
                    return target.search.some(s => pName.includes(s.toLowerCase()));
                });

                if (match) {
                    foundMap[target.name] = match.id;
                    console.log(`✅ ${target.name} → ID: ${match.id} (${match.name}, #${match.number})`);
                } else {
                    console.log(`❌ ${target.name} not in team ${teamId} squad`);
                    // List squad for debugging
                    squad.slice(0, 5).forEach(p => console.log(`   Squad: ${p.id} = ${p.name}`));
                }
            }

            await sleep(6500);
        } catch (err) {
            console.log(`❌ Team ${teamId} error: ${err.message}`);
        }
    }

    console.log('\n=== CORRECTED PLAYER ID MAP ===');
    console.log(JSON.stringify(foundMap, null, 2));
}

main().catch(console.error);
